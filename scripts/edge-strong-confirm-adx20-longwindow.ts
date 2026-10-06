#!/usr/bin/env node
/**
 * Longer-window + scanner-minATR probes for STRONG_UP+confirm+ADX20+MAX2.5.
 *
 * Context: 90/45 is PF-positive but n-starved (earlier n=6). Fine MAX_ATR grid
 * did not clear n≥10. Ask whether 120/60 or lowering scanner MIN_ATR to 1.0
 * (mutates V2_CONFIG.MIN_ATR_PERCENT) clears the bar under paper ADX parity.
 *
 * Usage:
 *   DATA_DIR=/tmp/cryptotitan-edge-research \
 *     node --experimental-strip-types scripts/edge-strong-confirm-adx20-longwindow.ts
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { initializeDatabase } from '../services/database.js';
import { initV2Tables } from '../v2/attribution/attributionStore.ts';
import { V2_CONFIG, ADX_THRESHOLDS } from '../v2/engine/config.ts';
import { runBacktest } from '../v2/backtest/backtestEngine.ts';
import type { BacktestConfig, BacktestResult } from '../v2/backtest/types.ts';

const CAD10 = [...V2_CONFIG.SCAN_TICKERS];
const MIN_ADX = ADX_THRESHOLDS.TREND_MIN;

type Snap = { regimes: readonly string[]; maxAtr: number; minAtr: number };

function snap(): Snap {
  return {
    regimes: [...V2_CONFIG.ALLOWED_REGIMES],
    maxAtr: V2_CONFIG.MAX_ATR_PERCENT,
    minAtr: V2_CONFIG.MIN_ATR_PERCENT,
  };
}

function restore(s: Snap): void {
  (V2_CONFIG as { ALLOWED_REGIMES: readonly string[] }).ALLOWED_REGIMES = s.regimes;
  (V2_CONFIG as { MAX_ATR_PERCENT: number }).MAX_ATR_PERCENT = s.maxAtr;
  (V2_CONFIG as { MIN_ATR_PERCENT: number }).MIN_ATR_PERCENT = s.minAtr;
}

function summarize(result: BacktestResult) {
  const s = result.summary;
  if (result.trades.some((t) => t.holdBars < 0)) throw new Error('holdBars<0');
  return {
    trades: s.totalTrades,
    winRate: Number(s.winRate.toFixed(4)),
    net: Number(s.totalPnlNet.toFixed(2)),
    pf: s.profitFactor === Infinity ? null : Number(s.profitFactor.toFixed(3)),
    zeroHoldStops: result.trades.filter((t) => t.exitReason === 'stop_loss' && t.holdBars === 0).length,
  };
}

function meetsBar(
  oos: { pf: number | null; net: number },
  earlier: { pf: number | null; trades: number },
): boolean {
  return (oos.pf ?? 0) > 1.1 && oos.net > 0 && (earlier.pf ?? 0) >= 0.9 && earlier.trades >= 10;
}

const ENTRY = {
  confirmMode: 'bullish_close' as const,
  maxSignalCloseLocation: 0.8,
  minAdx: MIN_ADX,
};

type Ablation = {
  id: string;
  label: string;
  earlierDays: number;
  oosDays: number;
  scannerMinAtr: number;
};

const ABLATIONS: Ablation[] = [
  { id: 'w90_45_min15', label: '90/45 scanner minATR1.5 (paper)', earlierDays: 90, oosDays: 45, scannerMinAtr: 1.5 },
  { id: 'w120_60_min15', label: '120/60 scanner minATR1.5', earlierDays: 120, oosDays: 60, scannerMinAtr: 1.5 },
  { id: 'w150_75_min15', label: '150/75 scanner minATR1.5', earlierDays: 150, oosDays: 75, scannerMinAtr: 1.5 },
  { id: 'w90_45_min10', label: '90/45 scanner minATR1.0', earlierDays: 90, oosDays: 45, scannerMinAtr: 1.0 },
  { id: 'w120_60_min10', label: '120/60 scanner minATR1.0', earlierDays: 120, oosDays: 60, scannerMinAtr: 1.0 },
];

async function runWindow(label: string, days: number, end: Date, scannerMinAtr: number) {
  const baseline = snap();
  try {
    (V2_CONFIG as { ALLOWED_REGIMES: readonly string[] }).ALLOWED_REGIMES = ['STRONG_UP'];
    (V2_CONFIG as { MAX_ATR_PERCENT: number }).MAX_ATR_PERCENT = 2.5;
    (V2_CONFIG as { MIN_ATR_PERCENT: number }).MIN_ATR_PERCENT = scannerMinAtr;
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
      entryFilters: ENTRY,
      seed: false,
    };
    console.log(`\n>>> ${label} | ${startDate.toISOString().slice(0, 10)}→${end.toISOString().slice(0, 10)} minATR=${scannerMinAtr}`);
    const result = await runBacktest(config);
    const summary = summarize(result);
    console.log(
      `    trades=${summary.trades} WR=${(summary.winRate * 100).toFixed(1)}% net=$${summary.net} PF=${summary.pf} zH=${summary.zeroHoldStops}`,
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

  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  STRONG_UP+confirm+ADX20 long-window / minATR probes    ║');
  console.log('╚══════════════════════════════════════════════════════════╝');

  const rows = [];
  for (const ab of ABLATIONS) {
    const endEarlier = new Date(endRecent.getTime() - ab.oosDays * 86400000);
    const earlier = await runWindow(`${ab.id}/earlier`, ab.earlierDays, endEarlier, ab.scannerMinAtr);
    const oos = await runWindow(`${ab.id}/oos`, ab.oosDays, endRecent, ab.scannerMinAtr);
    const row = {
      id: ab.id,
      label: ab.label,
      earlierDays: ab.earlierDays,
      oosDays: ab.oosDays,
      scannerMinAtr: ab.scannerMinAtr,
      earlier,
      oos,
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
      'Longer windows or scanner minATR=1.0 under STRONG_UP+confirm+ADX20+MAX2.5 can clear n≥10 while keeping PF bars.',
    protocol: {
      package: 'STRONG_UP MAX_ATR=2.5 bullish_close chase≤0.80 minAdx=20',
      promotionBar: 'OOS PF>1.1 & net>0 & earlier PF>=0.9 & earlier n>=10',
      feeRoundTrip: V2_CONFIG.FEE_ROUND_TRIP_TAKER,
    },
    rows,
    anyPromote: rows.some((r) => r.meetsPromotionBar),
    promoters: rows.filter((r) => r.meetsPromotionBar).map((r) => r.id),
  };
  writeFileSync('/opt/cursor/artifacts/edge-strong-confirm-adx20-longwindow.json', JSON.stringify(out, null, 2));
  writeFileSync('/cursor/stores/self/artifacts/edge-strong-confirm-adx20-longwindow.json', JSON.stringify(out, null, 2));
  console.log(`\nWrote edge-strong-confirm-adx20-longwindow.json anyPromote=${out.anyPromote}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
