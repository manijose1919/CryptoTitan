#!/usr/bin/env node
/**
 * Single-knob fee-aware ablation: MIN_ATR_PERCENT 1.0 → 2.0 (research only).
 *
 * Rationale (pre-registered): Jul-23 live-band analysis found net PnL concentrated
 * in ATR 2–3%; 1–2% was ~breakeven after fees. Prior locked matrix tested 1.5%
 * (failed OOS) but not 2.0%. Entry filter only — no exit/regime/ticker mining.
 *
 * Protocol matches edge-ablation-matrix.ts:
 *   next-bar open, 0.52% RT, 5bps/side, pessimistic bars, CAD10, STRONG_UP
 *   earlier45 + oos45(recent); promotion: OOS PF>1.1 & net>0 & earlier PF>=0.9
 *
 * Usage:
 *   DATA_DIR=/tmp/cryptotitan-edge-research \
 *     node --experimental-strip-types scripts/edge-atr2-ablation.ts
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
    maxDd: Number(s.maxDrawdownUsd.toFixed(2)),
  };
}

function meetsBar(oos: { pf: number | null; net: number }, earlier: { pf: number | null }): boolean {
  return (oos.pf ?? 0) > 1.1 && oos.net > 0 && (earlier.pf ?? 0) >= 0.9;
}

async function runWindow(label: string, days: number, end: Date, atrFloor: number) {
  const prev = V2_CONFIG.MIN_ATR_PERCENT;
  (V2_CONFIG as { MIN_ATR_PERCENT: number }).MIN_ATR_PERCENT = atrFloor;
  const endDate = end;
  const startDate = new Date(endDate.getTime() - days * 86400000);
  const config: BacktestConfig = {
    startDate,
    endDate,
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
  const t0 = Date.now();
  console.log(`\n>>> ${label} atr>=${atrFloor} | ${startDate.toISOString().slice(0, 10)}→${endDate.toISOString().slice(0, 10)}`);
  const result = await runBacktest(config);
  (V2_CONFIG as { MIN_ATR_PERCENT: number }).MIN_ATR_PERCENT = prev;
  const summary = summarize(result);
  const elapsedSec = Number(((Date.now() - t0) / 1000).toFixed(1));
  console.log(`    trades=${summary.trades} WR=${(summary.winRate * 100).toFixed(1)}% net=$${summary.net} PF=${summary.pf} avgW=$${summary.avgWin} avgL=$${summary.avgLoss} (${elapsedSec}s)`);
  return {
    ...summary,
    start: startDate.toISOString().slice(0, 10),
    end: endDate.toISOString().slice(0, 10),
    elapsedSec,
  };
}

async function main(): Promise<void> {
  mkdirSync('/opt/cursor/artifacts', { recursive: true });
  initializeDatabase();
  initV2Tables();

  const endRecent = new Date();
  endRecent.setUTCHours(0, 0, 0, 0);
  const endEarlier = new Date(endRecent.getTime() - 45 * 86400000);

  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║  ATR≥2.0 entry-floor ablation (fee-aware, CAD10)    ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log(`Regimes: ${V2_CONFIG.ALLOWED_REGIMES.join(',')}`);
  console.log(`Fees: ${(V2_CONFIG.FEE_ROUND_TRIP_TAKER * 100).toFixed(2)}% RT + ${(V2_CONFIG.PAPER_SLIPPAGE_PER_SIDE * 100).toFixed(2)}%/side`);
  console.log(`Bar: OOS PF>1.1 & net>0 & earlier PF>=0.9`);

  const rows: Array<Record<string, unknown>> = [];
  for (const atrFloor of [1.0, 2.0] as const) {
    const id = atrFloor === 1.0 ? 'baseline_atr_1' : 'atr_2';
    const earlier = await runWindow(`${id}/earlier45`, 45, endEarlier, atrFloor);
    const oos = await runWindow(`${id}/oos45`, 45, endRecent, atrFloor);
    const full = await runWindow(`${id}/full90`, 90, endRecent, atrFloor);
    const row = {
      id,
      atrFloor,
      earlier45: earlier,
      oos45: oos,
      full90: full,
      meetsPromotionBar: meetsBar(oos, earlier),
    };
    rows.push(row);
    console.log(`== ${id}: pass=${row.meetsPromotionBar} | OOS PF=${oos.pf} net=$${oos.net} | earlier PF=${earlier.pf}`);
  }

  const out = {
    generatedAt: new Date().toISOString(),
    hypothesis:
      'Raise MIN_ATR_PERCENT 1.0→2.0 to drop fee-dominated 1–2% ATR band (Jul-23 live-band finding).',
    protocol: {
      fills: 'next-bar-open (backtestEngine)',
      barSequence: 'pessimistic',
      feeRoundTrip: V2_CONFIG.FEE_ROUND_TRIP_TAKER,
      slippagePerSide: V2_CONFIG.PAPER_SLIPPAGE_PER_SIDE,
      regimes: [...V2_CONFIG.ALLOWED_REGIMES],
      tickers: CAD10,
      interval: '4h',
      promotionBar: 'oos45 PF>1.1 AND oos45 net>0 AND earlier45 PF>=0.9',
    },
    rows,
    anyPass: rows.some((r) => r.meetsPromotionBar === true),
  };

  const path = '/opt/cursor/artifacts/edge-atr2-ablation.json';
  writeFileSync(path, JSON.stringify(out, null, 2));
  console.log(`\nWrote ${path}`);
  console.log(`Any pass: ${out.anyPass}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
