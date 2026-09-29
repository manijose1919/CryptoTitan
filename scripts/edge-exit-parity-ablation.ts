#!/usr/bin/env node
/**
 * Fee-aware TREND exit ablations against paper STRATEGY_EXIT_CONFIGS
 * (post backtestEngine exit-parity fix). Research only — no auto-promote.
 *
 * Protocol (pre-registered):
 *   next-bar open, 0.52% RT, 5bps/side, pessimistic, CAD10, STRONG_UP, 4h
 *   earlier45 + oos45; bar: OOS PF>1.1 & net>0 & earlier PF>=0.9
 *
 * Note: trail activate is fee-floored at 0.52%×3≈1.56%, so trail_act variants
 * below that floor are no-ops vs paper — only test values ≥ floor.
 *
 * Usage:
 *   DATA_DIR=/tmp/cryptotitan-edge-research \
 *     node --experimental-strip-types scripts/edge-exit-parity-ablation.ts
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { initializeDatabase } from '../services/database.js';
import { initV2Tables } from '../v2/attribution/attributionStore.ts';
import { V2_CONFIG, STRATEGY_EXIT_CONFIGS } from '../v2/engine/config.ts';
import type { StrategyExitConfig } from '../v2/engine/config.ts';
import { runBacktest } from '../v2/backtest/backtestEngine.ts';
import type { BacktestConfig, BacktestResult } from '../v2/backtest/types.ts';

const CAD10 = [...V2_CONFIG.SCAN_TICKERS];

type TrendSnap = StrategyExitConfig & { stopLossAtrMult: number; takeProfitAtrMult: number };

function snapTrend(): TrendSnap {
  const t = STRATEGY_EXIT_CONFIGS.TREND;
  return {
    ...t,
    timeKillBarsByTf: t.timeKillBarsByTf ? { ...t.timeKillBarsByTf } : undefined,
    stopLossAtrMult: V2_CONFIG.STOP_LOSS_ATR_MULT,
    takeProfitAtrMult: V2_CONFIG.TAKE_PROFIT_ATR_MULT,
  };
}

function restoreTrend(s: TrendSnap): void {
  const { stopLossAtrMult, takeProfitAtrMult, ...exit } = s;
  Object.assign(STRATEGY_EXIT_CONFIGS.TREND, exit);
  (V2_CONFIG as { STOP_LOSS_ATR_MULT: number }).STOP_LOSS_ATR_MULT = stopLossAtrMult;
  (V2_CONFIG as { TAKE_PROFIT_ATR_MULT: number }).TAKE_PROFIT_ATR_MULT = takeProfitAtrMult;
}

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

type Ablation = { id: string; label: string; apply: () => void };

const ABLATIONS: Ablation[] = [
  { id: 'baseline', label: 'Paper TREND exits (parity path)', apply: () => {} },
  {
    id: 'timekill_3bars',
    label: 'Longer hold: timeKillBars 2→3 (4h→12h)',
    apply: () => {
      STRATEGY_EXIT_CONFIGS.TREND.timeKillBars = 3;
    },
  },
  {
    id: 'timekill_4bars',
    label: 'Longer hold: timeKillBars 2→4 (4h→16h)',
    apply: () => {
      STRATEGY_EXIT_CONFIGS.TREND.timeKillBars = 4;
    },
  },
  {
    id: 'timekill_minmove_1pct',
    label: 'Stricter stagnant band: timeKillMinMove 0.7%→1.0%',
    apply: () => {
      STRATEGY_EXIT_CONFIGS.TREND.timeKillMinMove = 0.01;
    },
  },
  {
    id: 'trail_giveback_5pct',
    label: 'Wider trail giveback 3%→5% of peak gain',
    apply: () => {
      STRATEGY_EXIT_CONFIGS.TREND.trailGivebackPercent = 0.05;
    },
  },
  {
    id: 'trail_act_2pct',
    label: 'Later trail arm 1.4%→2.0% (above ~1.56% fee floor)',
    apply: () => {
      STRATEGY_EXIT_CONFIGS.TREND.trailActivatePercent = 0.02;
    },
  },
  {
    id: 'sl_atr_1_2',
    label: 'Tighter initial SL ATR mult 1.5→1.2',
    apply: () => {
      STRATEGY_EXIT_CONFIGS.TREND.slAtrMult = 1.2;
      (V2_CONFIG as { STOP_LOSS_ATR_MULT: number }).STOP_LOSS_ATR_MULT = 1.2;
    },
  },
  {
    id: 'qk_bars_2',
    label: 'Slower quick-kill: quickKillBars 1→2',
    apply: () => {
      STRATEGY_EXIT_CONFIGS.TREND.quickKillBars = 2;
    },
  },
];

async function runWindow(label: string, days: number, end: Date) {
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
  console.log(`\n>>> ${label} | ${startDate.toISOString().slice(0, 10)}→${endDate.toISOString().slice(0, 10)}`);
  const result = await runBacktest(config);
  const summary = summarize(result);
  const elapsedSec = Number(((Date.now() - t0) / 1000).toFixed(1));
  console.log(
    `    trades=${summary.trades} WR=${(summary.winRate * 100).toFixed(1)}% net=$${summary.net} PF=${summary.pf} avgW=$${summary.avgWin} avgL=$${summary.avgLoss} (${elapsedSec}s)`,
  );
  return { ...summary, start: startDate.toISOString().slice(0, 10), end: endDate.toISOString().slice(0, 10), elapsedSec };
}

async function main(): Promise<void> {
  mkdirSync('/opt/cursor/artifacts', { recursive: true });
  initializeDatabase();
  initV2Tables();

  const endRecent = new Date();
  endRecent.setUTCHours(0, 0, 0, 0);
  const endEarlier = new Date(endRecent.getTime() - 45 * 86400000);
  const baseline = snapTrend();
  const feeFloor = V2_CONFIG.FEE_ROUND_TRIP_TAKER * V2_CONFIG.TRAIL_ACTIVATE_FEE_FLOOR_MULT;

  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  TREND exit-parity ablations (fee-aware, CAD10, 4h)     ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log(`Regimes: ${V2_CONFIG.ALLOWED_REGIMES.join(',')}`);
  console.log(`Fees: ${(V2_CONFIG.FEE_ROUND_TRIP_TAKER * 100).toFixed(2)}% RT + ${(V2_CONFIG.PAPER_SLIPPAGE_PER_SIDE * 100).toFixed(2)}%/side`);
  console.log(`Trail fee floor: ${(feeFloor * 100).toFixed(2)}%`);
  console.log(`Bar: OOS PF>1.1 & net>0 & earlier PF>=0.9`);

  const rows: Array<Record<string, unknown>> = [];
  for (const ab of ABLATIONS) {
    restoreTrend(baseline);
    ab.apply();
    const earlier = await runWindow(`${ab.id}/earlier45`, 45, endEarlier);
    const oos = await runWindow(`${ab.id}/oos45`, 45, endRecent);
    const full = await runWindow(`${ab.id}/full90`, 90, endRecent);
    const row = {
      id: ab.id,
      label: ab.label,
      earlier45: earlier,
      oos45: oos,
      full90: full,
      meetsPromotionBar: meetsBar(oos, earlier),
    };
    rows.push(row);
    console.log(`== ${ab.id}: pass=${row.meetsPromotionBar} | OOS PF=${oos.pf} net=$${oos.net} | earlier PF=${earlier.pf}`);
  }
  restoreTrend(baseline);

  const out = {
    generatedAt: new Date().toISOString(),
    hypothesis:
      'With backtestEngine reading STRATEGY_EXIT_CONFIGS, re-test TREND exit knobs (time-kill bars, trail, SL, QK) for fee-aware CAD edge.',
    protocol: {
      fills: 'next-bar-open (backtestEngine + STRATEGY_EXIT_CONFIGS.TREND)',
      barSequence: 'pessimistic',
      feeRoundTrip: V2_CONFIG.FEE_ROUND_TRIP_TAKER,
      slippagePerSide: V2_CONFIG.PAPER_SLIPPAGE_PER_SIDE,
      trailFeeFloor: feeFloor,
      regimes: [...V2_CONFIG.ALLOWED_REGIMES],
      tickers: CAD10,
      promotionBar: 'OOS PF>1.1 & net>0 & earlier PF>=0.9',
    },
    rows,
    anyPromote: rows.some((r) => r.meetsPromotionBar === true),
  };

  const path = '/opt/cursor/artifacts/edge-exit-parity-ablation.json';
  writeFileSync(path, JSON.stringify(out, null, 2));
  console.log(`\nWrote ${path}`);
  console.log(`anyPromote=${out.anyPromote}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
