#!/usr/bin/env node
/**
 * ADX paper/backtest parity under the promote package (research only).
 *
 * Context: paper soak shows ADA/LINK/AVAX scanner-PASS but no TREND signals
 * because strategyRunner ADX gate (TREND_MIN=20) rejects ADX 12–17. Fee-aware
 * promote-package backtests historically omitted this gate — optimistic vs paper.
 *
 * Question: with minAdx=20 (paper parity), does UP+confirm+chase+minATR≥1.5
 * still clear robust 90/45?
 *
 * Protocol: 90d earlier / 45d OOS, CAD10, 4h, 0.52% RT, 5bps, pessimistic.
 * Bar: OOS PF>1.1 & net>0 & earlier PF≥0.9 & earlier n≥10.
 *
 * Usage:
 *   DATA_DIR=/tmp/cryptotitan-edge-research \
 *     node --experimental-strip-types scripts/edge-adx-parity-9045.ts
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { initializeDatabase } from '../services/database.js';
import { initV2Tables } from '../v2/attribution/attributionStore.ts';
import { V2_CONFIG, ADX_THRESHOLDS } from '../v2/engine/config.ts';
import { runBacktest } from '../v2/backtest/backtestEngine.ts';
import type { BacktestConfig, BacktestResult } from '../v2/backtest/types.ts';

const CAD10 = [...V2_CONFIG.SCAN_TICKERS];

type Snap = { regimes: readonly string[]; maxAtr: number };

function snap(): Snap {
  return { regimes: [...V2_CONFIG.ALLOWED_REGIMES], maxAtr: V2_CONFIG.MAX_ATR_PERCENT };
}

function restore(s: Snap): void {
  (V2_CONFIG as { ALLOWED_REGIMES: readonly string[] }).ALLOWED_REGIMES = s.regimes;
  (V2_CONFIG as { MAX_ATR_PERCENT: number }).MAX_ATR_PERCENT = s.maxAtr;
}

function summarize(result: BacktestResult) {
  const s = result.summary;
  if (result.trades.some((t) => t.holdBars < 0)) {
    throw new Error('holdBars<0 invariant failed');
  }
  const byRegime: Record<string, number> = {};
  for (const t of result.trades) {
    const k = String(t.entryRegime);
    byRegime[k] = (byRegime[k] ?? 0) + 1;
  }
  return {
    trades: s.totalTrades,
    winRate: Number(s.winRate.toFixed(4)),
    net: Number(s.totalPnlNet.toFixed(2)),
    pf: s.profitFactor === Infinity ? null : Number(s.profitFactor.toFixed(3)),
    zeroHoldStops: result.trades.filter((t) => t.exitReason === 'stop_loss' && t.holdBars === 0).length,
    byRegime,
  };
}

function meetsBar(
  oos: { pf: number | null; net: number },
  earlier: { pf: number | null; trades: number },
): boolean {
  return (oos.pf ?? 0) > 1.1 && oos.net > 0 && (earlier.pf ?? 0) >= 0.9 && earlier.trades >= 10;
}

const PROMOTE_BASE = {
  confirmMode: 'bullish_close' as const,
  maxSignalCloseLocation: 0.8,
  minSignalAtrPercent: 1.5,
};

type Ablation = {
  id: string;
  label: string;
  entryFilters: BacktestConfig['entryFilters'];
};

const ABLATIONS: Ablation[] = [
  {
    id: 'promote_no_adx',
    label: 'promote package (legacy research — no ADX)',
    entryFilters: { ...PROMOTE_BASE },
  },
  {
    id: 'promote_adx20',
    label: 'promote + minAdx=20 (paper TREND_MIN parity)',
    entryFilters: { ...PROMOTE_BASE, minAdx: ADX_THRESHOLDS.TREND_MIN },
  },
  {
    id: 'promote_adx15',
    label: 'promote + minAdx=15 (looser ADX probe)',
    entryFilters: { ...PROMOTE_BASE, minAdx: 15 },
  },
];

async function runWindow(label: string, days: number, end: Date, ab: Ablation) {
  const baseline = snap();
  try {
    (V2_CONFIG as { ALLOWED_REGIMES: readonly string[] }).ALLOWED_REGIMES = ['STRONG_UP', 'UP'];
    (V2_CONFIG as { MAX_ATR_PERCENT: number }).MAX_ATR_PERCENT = 2.5;
    const startDate = new Date(end.getTime() - days * 86400000);
    const config: BacktestConfig = {
      startDate,
      endDate: end,
      tickers: CAD10,
      budgetPerTicker: 1000,
      interval: '4h',
      intervalMinutes: 240,
      maxOpenPositions: V2_CONFIG.MAX_OPEN_POSITIONS,
      feeRoundTrip: V2_CONFIG.FEE_ROUND_TRIP_TAKER,
      slippagePerSide: V2_CONFIG.PAPER_SLIPPAGE_PER_SIDE,
      barSequence: 'pessimistic',
      entryFilters: ab.entryFilters,
      seed: false,
    };
    console.log(`\n>>> ${label} | ${startDate.toISOString().slice(0, 10)}→${end.toISOString().slice(0, 10)}`);
    const result = await runBacktest(config);
    const summary = summarize(result);
    console.log(
      `    trades=${summary.trades} WR=${(summary.winRate * 100).toFixed(1)}% net=$${summary.net} PF=${summary.pf} zH=${summary.zeroHoldStops} regimes=${JSON.stringify(summary.byRegime)}`,
    );
    return summary;
  } finally {
    restore(baseline);
  }
}

async function main(): Promise<void> {
  mkdirSync('/opt/cursor/artifacts', { recursive: true });
  mkdirSync('/cursor/stores/self/artifacts', { recursive: true });
  initializeDatabase();
  initV2Tables();
  const endRecent = new Date();
  endRecent.setUTCHours(0, 0, 0, 0);
  const endEarlier90 = new Date(endRecent.getTime() - 45 * 86400000);

  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  ADX parity under promote package (robust 90/45)        ║');
  console.log('╚══════════════════════════════════════════════════════════╝');

  const rows = [];
  for (const ab of ABLATIONS) {
    const earlier = await runWindow(`${ab.id}/earlier90`, 90, endEarlier90, ab);
    const oos = await runWindow(`${ab.id}/oos45`, 45, endRecent, ab);
    const row = {
      id: ab.id,
      label: ab.label,
      earlier90: earlier,
      oos45: oos,
      meetsPromotionBar: meetsBar(oos, earlier),
    };
    rows.push(row);
    console.log(
      `== ${ab.id}: pass=${row.meetsPromotionBar} | OOS PF=${oos.pf} net=$${oos.net} n=${oos.trades} | earlier PF=${earlier.pf} n=${earlier.trades}`,
    );
  }

  const out = {
    generatedAt: new Date().toISOString(),
    hypothesis:
      'Paper ADX≥20 blocks current PASS tickers; ask whether promote package still clears robust 90/45 with paper-parity ADX in the fee-aware backtest.',
    protocol: {
      windows: '90d earlier / 45d OOS',
      promotionBar: 'OOS PF>1.1 & net>0 & earlier PF>=0.9 & earlier n>=10',
      paperTrendMinAdx: ADX_THRESHOLDS.TREND_MIN,
      feeRoundTrip: V2_CONFIG.FEE_ROUND_TRIP_TAKER,
    },
    rows,
    anyPromote: rows.some((r) => r.meetsPromotionBar),
    paperParityClears: rows.find((r) => r.id === 'promote_adx20')?.meetsPromotionBar ?? false,
  };
  writeFileSync('/opt/cursor/artifacts/edge-adx-parity-9045.json', JSON.stringify(out, null, 2));
  writeFileSync('/cursor/stores/self/artifacts/edge-adx-parity-9045.json', JSON.stringify(out, null, 2));
  console.log(`\nWrote edge-adx-parity-9045.json anyPromote=${out.anyPromote} paperParityClears=${out.paperParityClears}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
