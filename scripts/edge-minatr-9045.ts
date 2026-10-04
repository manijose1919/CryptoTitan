#!/usr/bin/env node
/**
 * minATR floor ablations under the promote package (research only).
 *
 * Context: paper soak often has UP regimes but ATR% < 1.5 on BTC/ETH/BNB/SOL
 * (2026-10-04: SOL ATR%~1.22). Question: does minATR 1.25 (or 1.0) clear robust
 * 90/45 with more trades than live 1.5, or does lowering the floor destroy earlier PF?
 *
 * Package held fixed: UP+STRONG_UP, MAX_ATR=2.5, bullish_close, chase≤0.80.
 * Protocol: 90d earlier / 45d OOS, CAD10, 4h, 0.52% RT, 5bps, pessimistic.
 * Bar: OOS PF>1.1 & net>0 & earlier PF≥0.9 & earlier n≥10.
 *
 * Usage:
 *   DATA_DIR=/tmp/cryptotitan-edge-research \
 *     node --experimental-strip-types scripts/edge-minatr-9045.ts
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { initializeDatabase } from '../services/database.js';
import { initV2Tables } from '../v2/attribution/attributionStore.ts';
import { V2_CONFIG } from '../v2/engine/config.ts';
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
    avgWin: Number(s.avgWinPnl.toFixed(2)),
    avgLoss: Number(s.avgLossPnl.toFixed(2)),
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

type Ablation = {
  id: string;
  label: string;
  minAtr: number | null;
};

const CONFIRM = {
  confirmMode: 'bullish_close' as const,
  maxSignalCloseLocation: 0.8,
};

const ABLATIONS: Ablation[] = [
  { id: 'minatr_100', label: 'promote + minATR≥1.0 (scanner default pre-promote)', minAtr: 1.0 },
  { id: 'minatr_125', label: 'promote + minATR≥1.25 (soak near-miss band)', minAtr: 1.25 },
  { id: 'minatr_150', label: 'promote + minATR≥1.5 (paper live)', minAtr: 1.5 },
  { id: 'minatr_175', label: 'promote + minATR≥1.75 (tighter)', minAtr: 1.75 },
  { id: 'minatr_off', label: 'NEGATIVE CTRL: promote + no minATR filter', minAtr: null },
];

async function runWindow(label: string, days: number, end: Date, ab: Ablation) {
  const baseline = snap();
  try {
    (V2_CONFIG as { ALLOWED_REGIMES: readonly string[] }).ALLOWED_REGIMES = ['STRONG_UP', 'UP'];
    (V2_CONFIG as { MAX_ATR_PERCENT: number }).MAX_ATR_PERCENT = 2.5;
    const startDate = new Date(end.getTime() - days * 86400000);
    const entryFilters: BacktestConfig['entryFilters'] = {
      ...CONFIRM,
      ...(ab.minAtr != null ? { minSignalAtrPercent: ab.minAtr } : {}),
    };
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
      entryFilters,
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
  console.log('║  minATR under promote package (robust 90/45)            ║');
  console.log('╚══════════════════════════════════════════════════════════╝');

  const rows = [];
  for (const ab of ABLATIONS) {
    const earlier = await runWindow(`${ab.id}/earlier90`, 90, endEarlier90, ab);
    const oos = await runWindow(`${ab.id}/oos45`, 45, endRecent, ab);
    const row = {
      id: ab.id,
      label: ab.label,
      minAtr: ab.minAtr,
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
      'Paper soak is ATR-starved under minATR=1.5; ask whether 1.25 clears robust 90/45 with more n without hurting PF vs live 1.5.',
    protocol: {
      windows: '90d earlier / 45d OOS',
      promotionBar: 'OOS PF>1.1 & net>0 & earlier PF>=0.9 & earlier n>=10',
      packageFixed: 'UP+STRONG_UP MAX_ATR=2.5 bullish_close chase≤0.80',
      feeRoundTrip: V2_CONFIG.FEE_ROUND_TRIP_TAKER,
    },
    rows,
    anyPromote: rows.some((r) => r.meetsPromotionBar),
    liveKeepMinatr150: rows.find((r) => r.id === 'minatr_150')?.meetsPromotionBar ?? false,
  };
  writeFileSync('/opt/cursor/artifacts/edge-minatr-9045.json', JSON.stringify(out, null, 2));
  writeFileSync('/cursor/stores/self/artifacts/edge-minatr-9045.json', JSON.stringify(out, null, 2));
  console.log(`\nWrote edge-minatr-9045.json anyPromote=${out.anyPromote}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
