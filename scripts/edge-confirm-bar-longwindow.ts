#!/usr/bin/env node
/**
 * Longer-window stress of the confirm-bar stack that cleared the numeric bar
 * with earlier n=4 (fragile). Protocol: same fees/fills; windows 90d earlier
 * + 45d OOS (and 60/60) on the single candidate:
 *   MAX_ATR=2.5 + bullish_close + closeLoc≤0.80
 *
 * Usage:
 *   DATA_DIR=/tmp/cryptotitan-edge-research \
 *     node --experimental-strip-types scripts/edge-confirm-bar-longwindow.ts
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { initializeDatabase } from '../services/database.js';
import { initV2Tables } from '../v2/attribution/attributionStore.ts';
import { V2_CONFIG } from '../v2/engine/config.ts';
import { runBacktest } from '../v2/backtest/backtestEngine.ts';
import type { BacktestConfig, BacktestResult } from '../v2/backtest/types.ts';

const CAD10 = [...V2_CONFIG.SCAN_TICKERS];

const CANDIDATE = {
  id: 'maxatr_2_5_confirm_bullish_chase',
  maxAtr: 2.5,
  entryFilters: {
    confirmMode: 'bullish_close' as const,
    maxSignalCloseLocation: 0.8,
  },
};

function summarize(result: BacktestResult) {
  const s = result.summary;
  const zeroHoldStops = result.trades.filter(
    (t) => t.exitReason === 'stop_loss' && t.holdBars === 0,
  ).length;
  return {
    trades: s.totalTrades,
    winRate: Number(s.winRate.toFixed(4)),
    net: Number(s.totalPnlNet.toFixed(2)),
    pf: s.profitFactor === Infinity ? null : Number(s.profitFactor.toFixed(3)),
    avgWin: Number(s.avgWinPnl.toFixed(2)),
    avgLoss: Number(s.avgLossPnl.toFixed(2)),
    zeroHoldStops,
  };
}

function meetsBar(oos: { pf: number | null; net: number }, earlier: { pf: number | null }): boolean {
  return (oos.pf ?? 0) > 1.1 && oos.net > 0 && (earlier.pf ?? 0) >= 0.9;
}

async function runWindow(
  label: string,
  days: number,
  end: Date,
  opts: { maxAtr: number; entryFilters?: BacktestConfig['entryFilters'] } = {
    maxAtr: CANDIDATE.maxAtr,
    entryFilters: CANDIDATE.entryFilters,
  },
) {
  const prevMax = V2_CONFIG.MAX_ATR_PERCENT;
  (V2_CONFIG as { MAX_ATR_PERCENT: number }).MAX_ATR_PERCENT = opts.maxAtr;
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
    entryFilters: opts.entryFilters,
    seed: false,
  };
  console.log(`\n>>> ${label} | ${startDate.toISOString().slice(0, 10)}→${end.toISOString().slice(0, 10)}`);
  const result = await runBacktest(config);
  (V2_CONFIG as { MAX_ATR_PERCENT: number }).MAX_ATR_PERCENT = prevMax;
  const summary = summarize(result);
  console.log(
    `    trades=${summary.trades} WR=${(summary.winRate * 100).toFixed(1)}% net=$${summary.net} PF=${summary.pf} zeroHoldSL=${summary.zeroHoldStops}`,
  );
  return summary;
}

async function main(): Promise<void> {
  mkdirSync('/opt/cursor/artifacts', { recursive: true });
  initializeDatabase();
  initV2Tables();
  const endRecent = new Date();
  endRecent.setUTCHours(0, 0, 0, 0);

  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  Confirm-bar long-window stress (passing stack only)    ║');
  console.log('╚══════════════════════════════════════════════════════════╝');

  // Split A: 90d earlier ending 45d ago, 45d OOS to today
  const endEarlier90 = new Date(endRecent.getTime() - 45 * 86400000);
  const earlier90 = await runWindow('splitA/earlier90', 90, endEarlier90);
  const oos45 = await runWindow('splitA/oos45', 45, endRecent);
  const splitA = {
    id: 'split_90_45',
    earlier90,
    oos45,
    meetsPromotionBar: meetsBar(oos45, earlier90),
  };
  console.log(`== splitA: pass=${splitA.meetsPromotionBar}`);

  // Split B: 60/60
  const endEarlier60 = new Date(endRecent.getTime() - 60 * 86400000);
  const earlier60 = await runWindow('splitB/earlier60', 60, endEarlier60);
  const oos60 = await runWindow('splitB/oos60', 60, endRecent);
  const splitB = {
    id: 'split_60_60',
    earlier60,
    oos60,
    meetsPromotionBar: meetsBar(oos60, earlier60),
  };
  console.log(`== splitB: pass=${splitB.meetsPromotionBar}`);

  // Control baseline on split A (no filters, MAX_ATR=8)
  const baselineOpts = { maxAtr: 8, entryFilters: undefined };
  const baseEarlier = await runWindow('baselineA/earlier90_MAX8', 90, endEarlier90, baselineOpts);
  const baseOos = await runWindow('baselineA/oos45_MAX8', 45, endRecent, baselineOpts);

  const out = {
    generatedAt: new Date().toISOString(),
    candidate: CANDIDATE,
    hypothesis: 'Longer earlier window must keep PF≥0.9 with n≫4 before paper promote.',
    protocol: {
      promotionBar: 'OOS PF>1.1 & net>0 & earlier PF>=0.9',
      feeRoundTrip: V2_CONFIG.FEE_ROUND_TRIP_TAKER,
    },
    splitA,
    splitB,
    baselineSplitA: { earlier90: baseEarlier, oos45: baseOos },
    anyPromote: splitA.meetsPromotionBar || splitB.meetsPromotionBar,
  };
  const path = '/opt/cursor/artifacts/edge-confirm-bar-longwindow.json';
  writeFileSync(path, JSON.stringify(out, null, 2));
  writeFileSync('/cursor/stores/self/artifacts/edge-confirm-bar-longwindow.json', JSON.stringify(out, null, 2));
  console.log(`\nWrote ${path} anyPromote=${out.anyPromote}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
