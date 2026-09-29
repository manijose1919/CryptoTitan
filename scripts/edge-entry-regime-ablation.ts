#!/usr/bin/env node
/**
 * Fee-aware TREND entry/regime ablations (research only).
 * Pre-registered after exit knobs failed under STRATEGY_EXIT parity.
 *
 * Protocol:
 *   next-bar open, 0.52% RT, 5bps/side, pessimistic, CAD10, 4h
 *   earlier45 + oos45; bar: OOS PF>1.1 & net>0 & earlier PF>=0.9
 *
 * Variants are single-knob vs baseline. `allow_UP` is a deliberate
 * loosening experiment — promote only if it clears the bar.
 *
 * Usage:
 *   DATA_DIR=/tmp/cryptotitan-edge-research \
 *     node --experimental-strip-types scripts/edge-entry-regime-ablation.ts
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { initializeDatabase } from '../services/database.js';
import { initV2Tables } from '../v2/attribution/attributionStore.ts';
import { V2_CONFIG, MOMENTUM_CONFIG } from '../v2/engine/config.ts';
import { runBacktest } from '../v2/backtest/backtestEngine.ts';
import type { BacktestConfig, BacktestResult } from '../v2/backtest/types.ts';

const CAD10 = [...V2_CONFIG.SCAN_TICKERS];

type Snap = {
  MIN_COMPOSITE_SCORE: number;
  MIN_CONFIDENCE: number;
  MIN_EXPECTED_RETURN: number;
  MIN_VOLUME_24H_USD: number;
  ALLOWED_REGIMES: readonly string[];
  MOMENTUM_ENABLED: boolean;
};

function snap(): Snap {
  return {
    MIN_COMPOSITE_SCORE: V2_CONFIG.MIN_COMPOSITE_SCORE,
    MIN_CONFIDENCE: V2_CONFIG.MIN_CONFIDENCE,
    MIN_EXPECTED_RETURN: V2_CONFIG.MIN_EXPECTED_RETURN,
    MIN_VOLUME_24H_USD: V2_CONFIG.MIN_VOLUME_24H_USD,
    ALLOWED_REGIMES: [...V2_CONFIG.ALLOWED_REGIMES],
    MOMENTUM_ENABLED: MOMENTUM_CONFIG.ENABLED,
  };
}

function restore(s: Snap): void {
  (V2_CONFIG as { MIN_COMPOSITE_SCORE: number }).MIN_COMPOSITE_SCORE = s.MIN_COMPOSITE_SCORE;
  (V2_CONFIG as { MIN_CONFIDENCE: number }).MIN_CONFIDENCE = s.MIN_CONFIDENCE;
  (V2_CONFIG as { MIN_EXPECTED_RETURN: number }).MIN_EXPECTED_RETURN = s.MIN_EXPECTED_RETURN;
  (V2_CONFIG as { MIN_VOLUME_24H_USD: number }).MIN_VOLUME_24H_USD = s.MIN_VOLUME_24H_USD;
  (V2_CONFIG as { ALLOWED_REGIMES: readonly string[] }).ALLOWED_REGIMES = s.ALLOWED_REGIMES;
  (MOMENTUM_CONFIG as { ENABLED: boolean }).ENABLED = s.MOMENTUM_ENABLED;
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
  { id: 'baseline', label: 'Paper entry gates (STRONG_UP, score≥60, conf≥0.65)', apply: () => {} },
  {
    id: 'score_65',
    label: 'Tighter score: MIN_COMPOSITE_SCORE 65',
    apply: () => {
      (V2_CONFIG as { MIN_COMPOSITE_SCORE: number }).MIN_COMPOSITE_SCORE = 65;
    },
  },
  {
    id: 'conf_70',
    label: 'Tighter confidence: MIN_CONFIDENCE 0.70',
    apply: () => {
      (V2_CONFIG as { MIN_CONFIDENCE: number }).MIN_CONFIDENCE = 0.70;
    },
  },
  {
    id: 'min_exp_1pct',
    label: 'Higher fee edge: MIN_EXPECTED_RETURN 1.0%',
    apply: () => {
      (V2_CONFIG as { MIN_EXPECTED_RETURN: number }).MIN_EXPECTED_RETURN = 0.01;
    },
  },
  {
    id: 'vol_1m',
    label: 'Higher liquidity: MIN_VOLUME_24H_USD $1M',
    apply: () => {
      (V2_CONFIG as { MIN_VOLUME_24H_USD: number }).MIN_VOLUME_24H_USD = 1_000_000;
    },
  },
  {
    id: 'mom_off',
    label: 'TREND-only: MOMENTUM_CONFIG.ENABLED=false',
    apply: () => {
      (MOMENTUM_CONFIG as { ENABLED: boolean }).ENABLED = false;
    },
  },
  {
    id: 'allow_UP',
    label: 'Loosen regime: ALLOWED_REGIMES STRONG_UP+UP (research)',
    apply: () => {
      (V2_CONFIG as { ALLOWED_REGIMES: readonly string[] }).ALLOWED_REGIMES = ['STRONG_UP', 'UP'];
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
  const baseline = snap();

  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  TREND entry/regime ablations (fee-aware, CAD10, 4h)    ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log(`Baseline regimes: ${baseline.ALLOWED_REGIMES.join(',')}`);
  console.log(`Fees: ${(V2_CONFIG.FEE_ROUND_TRIP_TAKER * 100).toFixed(2)}% RT + ${(V2_CONFIG.PAPER_SLIPPAGE_PER_SIDE * 100).toFixed(2)}%/side`);
  console.log(`Bar: OOS PF>1.1 & net>0 & earlier PF>=0.9`);

  const rows: Array<Record<string, unknown>> = [];
  for (const ab of ABLATIONS) {
    restore(baseline);
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
  restore(baseline);

  const out = {
    generatedAt: new Date().toISOString(),
    hypothesis:
      'Pivot from failed exit mining to entry/regime filters under fee-aware STRATEGY_EXIT-parity backtests.',
    protocol: {
      fills: 'next-bar-open (backtestEngine + STRATEGY_EXIT_CONFIGS.TREND)',
      barSequence: 'pessimistic',
      feeRoundTrip: V2_CONFIG.FEE_ROUND_TRIP_TAKER,
      slippagePerSide: V2_CONFIG.PAPER_SLIPPAGE_PER_SIDE,
      tickers: CAD10,
      promotionBar: 'OOS PF>1.1 & net>0 & earlier PF>=0.9',
    },
    rows,
    anyPromote: rows.some((r) => r.meetsPromotionBar === true),
  };

  const path = '/opt/cursor/artifacts/edge-entry-regime-ablation.json';
  writeFileSync(path, JSON.stringify(out, null, 2));
  console.log(`\nWrote ${path}`);
  console.log(`anyPromote=${out.anyPromote}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
