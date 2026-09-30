#!/usr/bin/env node
/**
 * Fee-aware ablation: MAX_ATR_PERCENT ceiling (research only).
 *
 * Pre-registered from loss-structure autopsy (2026-09-30):
 *   OOS atr_2.5_4 band: n=13, net −$58, avgLoss −$10.83 — largest drag.
 *   Hypothesis: cap MAX_ATR_PERCENT 8→2.5 to refuse wide-stop death-zone entries.
 *
 * Protocol: next-bar open, 0.52% RT, 5bps, pessimistic, CAD10, STRONG_UP, 4h
 * Bar: OOS PF>1.1 & net>0 & earlier PF>=0.9
 *
 * Usage:
 *   DATA_DIR=/tmp/cryptotitan-edge-research \
 *     node --experimental-strip-types scripts/edge-max-atr-ceiling.ts
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
  return {
    trades: s.totalTrades,
    winRate: Number(s.winRate.toFixed(4)),
    net: Number(s.totalPnlNet.toFixed(2)),
    pf: s.profitFactor === Infinity ? null : Number(s.profitFactor.toFixed(3)),
    avgWin: Number(s.avgWinPnl.toFixed(2)),
    avgLoss: Number(s.avgLossPnl.toFixed(2)),
  };
}

function meetsBar(oos: { pf: number | null; net: number }, earlier: { pf: number | null }): boolean {
  return (oos.pf ?? 0) > 1.1 && oos.net > 0 && (earlier.pf ?? 0) >= 0.9;
}

async function runWindow(label: string, days: number, end: Date, maxAtr: number) {
  const prev = V2_CONFIG.MAX_ATR_PERCENT;
  (V2_CONFIG as { MAX_ATR_PERCENT: number }).MAX_ATR_PERCENT = maxAtr;
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
    seed: false,
  };
  console.log(`\n>>> ${label} maxAtr=${maxAtr} | ${startDate.toISOString().slice(0, 10)}→${end.toISOString().slice(0, 10)}`);
  const result = await runBacktest(config);
  (V2_CONFIG as { MAX_ATR_PERCENT: number }).MAX_ATR_PERCENT = prev;
  const summary = summarize(result);
  console.log(
    `    trades=${summary.trades} WR=${(summary.winRate * 100).toFixed(1)}% net=$${summary.net} PF=${summary.pf} avgW=$${summary.avgWin} avgL=$${summary.avgLoss}`,
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
  console.log('║  MAX_ATR ceiling ablation (fee-aware, CAD10)            ║');
  console.log('╚══════════════════════════════════════════════════════════╝');

  const rows = [];
  for (const maxAtr of [8.0, 2.5, 3.0] as const) {
    const id = maxAtr === 8 ? 'baseline_max8' : `max_atr_${maxAtr}`;
    const earlier = await runWindow(`${id}/earlier45`, 45, endEarlier, maxAtr);
    const oos = await runWindow(`${id}/oos45`, 45, endRecent, maxAtr);
    const full = await runWindow(`${id}/full90`, 90, endRecent, maxAtr);
    const row = { id, maxAtr, earlier45: earlier, oos45: oos, full90: full, meetsPromotionBar: meetsBar(oos, earlier) };
    rows.push(row);
    console.log(`== ${id}: pass=${row.meetsPromotionBar} | OOS PF=${oos.pf} net=$${oos.net} | earlier PF=${earlier.pf}`);
  }

  const out = {
    generatedAt: new Date().toISOString(),
    hypothesis: 'Cap MAX_ATR_PERCENT to exclude atr_2.5_4 stop-out death zone from loss autopsy.',
    protocol: {
      fills: 'next-bar-open + STRATEGY_EXIT parity',
      feeRoundTrip: V2_CONFIG.FEE_ROUND_TRIP_TAKER,
      slippagePerSide: V2_CONFIG.PAPER_SLIPPAGE_PER_SIDE,
      promotionBar: 'OOS PF>1.1 & net>0 & earlier PF>=0.9',
    },
    rows,
    anyPromote: rows.some((r) => r.meetsPromotionBar),
  };
  const path = '/opt/cursor/artifacts/edge-max-atr-ceiling.json';
  writeFileSync(path, JSON.stringify(out, null, 2));
  console.log(`\nWrote ${path} anyPromote=${out.anyPromote}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
