#!/usr/bin/env node
/**
 * Fee-aware confirmation-bar entry ablations (research only).
 *
 * Pre-registered after 2026-09-30 entry-bar quality miss: chase/wide filters
 * failed the promotion bar. Hypothesis: waiting one confirmation bar after
 * the signal (enter at T+2 open) cuts same-bar stop-outs enough to clear
 * OOS PF>1.1 & net>0 with earlier PF≥0.9 — optionally stacked with
 * MAX_ATR=2.5 ± chase (best directional levers so far).
 *
 * Protocol: next-bar open (or T+2 under confirmMode), 0.52% RT, 5bps,
 * pessimistic, CAD10, STRONG_UP, 4h.
 *
 * Usage:
 *   DATA_DIR=/tmp/cryptotitan-edge-research \
 *     node --experimental-strip-types scripts/edge-confirm-bar.ts
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { initializeDatabase } from '../services/database.js';
import { initV2Tables } from '../v2/attribution/attributionStore.ts';
import { V2_CONFIG } from '../v2/engine/config.ts';
import { runBacktest } from '../v2/backtest/backtestEngine.ts';
import type { BacktestConfig, BacktestResult } from '../v2/backtest/types.ts';

const CAD10 = [...V2_CONFIG.SCAN_TICKERS];

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

type Ablation = {
  id: string;
  label: string;
  maxAtr?: number;
  entryFilters?: BacktestConfig['entryFilters'];
};

const ABLATIONS: Ablation[] = [
  { id: 'baseline', label: 'No confirm, MAX_ATR=8 (control)' },
  {
    id: 'confirm_bullish',
    label: 'confirmMode=bullish_close (T+2 entry)',
    entryFilters: { confirmMode: 'bullish_close' },
  },
  {
    id: 'confirm_above',
    label: 'confirmMode=close_above_signal (T+2 entry)',
    entryFilters: { confirmMode: 'close_above_signal' },
  },
  {
    id: 'confirm_bullish_chase',
    label: 'bullish_close + closeLoc≤0.80',
    entryFilters: { confirmMode: 'bullish_close', maxSignalCloseLocation: 0.8 },
  },
  {
    id: 'maxatr_2_5',
    label: 'MAX_ATR=2.5 only (repeat)',
    maxAtr: 2.5,
  },
  {
    id: 'maxatr_2_5_confirm_bullish',
    label: 'MAX_ATR=2.5 + bullish_close',
    maxAtr: 2.5,
    entryFilters: { confirmMode: 'bullish_close' },
  },
  {
    id: 'maxatr_2_5_confirm_above',
    label: 'MAX_ATR=2.5 + close_above_signal',
    maxAtr: 2.5,
    entryFilters: { confirmMode: 'close_above_signal' },
  },
  {
    id: 'maxatr_2_5_confirm_bullish_chase',
    label: 'MAX_ATR=2.5 + bullish_close + closeLoc≤0.80',
    maxAtr: 2.5,
    entryFilters: { confirmMode: 'bullish_close', maxSignalCloseLocation: 0.8 },
  },
];

async function runWindow(label: string, days: number, end: Date, ab: Ablation) {
  const prevMax = V2_CONFIG.MAX_ATR_PERCENT;
  if (ab.maxAtr != null) {
    (V2_CONFIG as { MAX_ATR_PERCENT: number }).MAX_ATR_PERCENT = ab.maxAtr;
  }
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
  (V2_CONFIG as { MAX_ATR_PERCENT: number }).MAX_ATR_PERCENT = prevMax;
  const summary = summarize(result);
  console.log(
    `    trades=${summary.trades} WR=${(summary.winRate * 100).toFixed(1)}% net=$${summary.net} PF=${summary.pf} avgW=$${summary.avgWin} avgL=$${summary.avgLoss} zeroHoldSL=${summary.zeroHoldStops}`,
  );
  return summary;
}

async function main(): Promise<void> {
  mkdirSync('/opt/cursor/artifacts', { recursive: true });
  initializeDatabase();
  initV2Tables();
  const endRecent = new Date();
  endRecent.setUTCHours(0, 0, 0, 0);
  const endEarlier = new Date(endRecent.getTime() - 45 * 86400000);

  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  Confirm-bar entry ablations (fee-aware, CAD10)         ║');
  console.log('╚══════════════════════════════════════════════════════════╝');

  const rows = [];
  for (const ab of ABLATIONS) {
    const earlier = await runWindow(`${ab.id}/earlier45`, 45, endEarlier, ab);
    const oos = await runWindow(`${ab.id}/oos45`, 45, endRecent, ab);
    const full = await runWindow(`${ab.id}/full90`, 90, endRecent, ab);
    const row = {
      id: ab.id,
      label: ab.label,
      earlier45: earlier,
      oos45: oos,
      full90: full,
      meetsPromotionBar: meetsBar(oos, earlier),
    };
    rows.push(row);
    console.log(
      `== ${ab.id}: pass=${row.meetsPromotionBar} | OOS PF=${oos.pf} net=$${oos.net} zeroHoldSL=${oos.zeroHoldStops} | earlier PF=${earlier.pf}`,
    );
  }

  const out = {
    generatedAt: new Date().toISOString(),
    hypothesis:
      'One confirmation bar after signal (enter T+2 open), optionally + MAX_ATR=2.5 ± chase, cuts holdBars=0 stops enough to clear the promotion bar.',
    protocol: {
      fills: 'confirmMode → entry at bar+2 open; else next-bar-open + STRATEGY_EXIT parity',
      feeRoundTrip: V2_CONFIG.FEE_ROUND_TRIP_TAKER,
      slippagePerSide: V2_CONFIG.PAPER_SLIPPAGE_PER_SIDE,
      promotionBar: 'OOS PF>1.1 & net>0 & earlier PF>=0.9',
    },
    rows,
    anyPromote: rows.some((r) => r.meetsPromotionBar),
  };
  const path = '/opt/cursor/artifacts/edge-confirm-bar.json';
  writeFileSync(path, JSON.stringify(out, null, 2));
  console.log(`\nWrote ${path} anyPromote=${out.anyPromote}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
