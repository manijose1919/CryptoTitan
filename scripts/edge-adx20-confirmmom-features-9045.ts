#!/usr/bin/env node
/**
 * Feature / exit probes under full paper stack after MOMENTUM confirm parity.
 *
 * Paper live: STRONG_UP + confirm + chase≤0.80 + MAX2.5 + minATR1.5 + ADX≥20
 * + MOMENTUM confirmMomentum. Still n-starved on earlier half.
 *
 * Protocol: 90/45 CAD10 4h 0.52% RT 5bps pessimistic.
 * Bar: OOS PF>1.1 & net>0 & earlier PF≥0.9 & earlier n≥10.
 *
 * Usage:
 *   DATA_DIR=/tmp/cryptotitan-edge-research \
 *     node --experimental-strip-types scripts/edge-adx20-confirmmom-features-9045.ts
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { initializeDatabase } from '../services/database.js';
import { initV2Tables } from '../v2/attribution/attributionStore.ts';
import {
  V2_CONFIG,
  MOMENTUM_CONFIG,
  ADX_THRESHOLDS,
  STRATEGY_EXIT_CONFIGS,
} from '../v2/engine/config.ts';
import type { StrategyExitConfig } from '../v2/engine/config.ts';
import { runBacktest } from '../v2/backtest/backtestEngine.ts';
import type { BacktestConfig, BacktestResult } from '../v2/backtest/types.ts';

const CAD10 = [...V2_CONFIG.SCAN_TICKERS];
const MIN_ADX = ADX_THRESHOLDS.TREND_MIN;

type Snap = {
  regimes: readonly string[];
  maxAtr: number;
  minScore: number;
  momEnabled: boolean;
  exit: StrategyExitConfig;
};

function snap(): Snap {
  const t = STRATEGY_EXIT_CONFIGS.TREND;
  return {
    regimes: [...V2_CONFIG.ALLOWED_REGIMES],
    maxAtr: V2_CONFIG.MAX_ATR_PERCENT,
    minScore: V2_CONFIG.MIN_COMPOSITE_SCORE,
    momEnabled: MOMENTUM_CONFIG.ENABLED,
    exit: {
      ...t,
      timeKillBarsByTf: t.timeKillBarsByTf ? { ...t.timeKillBarsByTf } : undefined,
    },
  };
}

function restore(s: Snap): void {
  (V2_CONFIG as { ALLOWED_REGIMES: readonly string[] }).ALLOWED_REGIMES = s.regimes;
  (V2_CONFIG as { MAX_ATR_PERCENT: number }).MAX_ATR_PERCENT = s.maxAtr;
  (V2_CONFIG as { MIN_COMPOSITE_SCORE: number }).MIN_COMPOSITE_SCORE = s.minScore;
  (MOMENTUM_CONFIG as { ENABLED: boolean }).ENABLED = s.momEnabled;
  Object.assign(STRATEGY_EXIT_CONFIGS.TREND, s.exit);
}

function summarize(result: BacktestResult) {
  const s = result.summary;
  if (result.trades.some((t) => t.holdBars < 0)) throw new Error('holdBars<0');
  const byReason: Record<string, { n: number; net: number }> = {};
  for (const t of result.trades) {
    const k = String(t.exitReason);
    if (!byReason[k]) byReason[k] = { n: 0, net: 0 };
    byReason[k].n++;
    byReason[k].net += t.pnlNet ?? 0;
  }
  for (const v of Object.values(byReason)) v.net = Number(v.net.toFixed(2));
  return {
    trades: s.totalTrades,
    winRate: Number(s.winRate.toFixed(4)),
    net: Number(s.totalPnlNet.toFixed(2)),
    pf: s.profitFactor === Infinity ? null : Number(s.profitFactor.toFixed(3)),
    zeroHoldStops: result.trades.filter((t) => t.exitReason === 'stop_loss' && t.holdBars === 0).length,
    byReason,
  };
}

function meetsBar(
  oos: { pf: number | null; net: number },
  earlier: { pf: number | null; trades: number },
): boolean {
  return (oos.pf ?? 0) > 1.1 && oos.net > 0 && (earlier.pf ?? 0) >= 0.9 && earlier.trades >= 10;
}

const PAPER_FILTERS: BacktestConfig['entryFilters'] = {
  confirmMode: 'bullish_close',
  maxSignalCloseLocation: 0.8,
  minAdx: MIN_ADX,
  minSignalAtrPercent: 1.5,
  confirmMomentum: true,
};

type Ablation = {
  id: string;
  label: string;
  entryFilters: BacktestConfig['entryFilters'];
  apply?: () => void;
};

const ABLATIONS: Ablation[] = [
  {
    id: 'paper_live_confirmmom',
    label: 'Paper live (MOM confirm) baseline',
    entryFilters: { ...PAPER_FILTERS },
  },
  {
    id: 'range_atr_2',
    label: 'Paper + maxSignalRangeAtrMult=2.0',
    entryFilters: { ...PAPER_FILTERS, maxSignalRangeAtrMult: 2.0 },
  },
  {
    id: 'range_atr_2_5',
    label: 'Paper + maxSignalRangeAtrMult=2.5',
    entryFilters: { ...PAPER_FILTERS, maxSignalRangeAtrMult: 2.5 },
  },
  {
    id: 'confirm_both',
    label: 'bullish_and_above + chase + MOM confirm',
    entryFilters: { ...PAPER_FILTERS, confirmMode: 'bullish_and_above' },
  },
  {
    id: 'score_55',
    label: 'MIN_COMPOSITE_SCORE 60→55 (loosen — labeled)',
    entryFilters: { ...PAPER_FILTERS },
    apply: () => {
      (V2_CONFIG as { MIN_COMPOSITE_SCORE: number }).MIN_COMPOSITE_SCORE = 55;
    },
  },
  {
    id: 'score_65',
    label: 'MIN_COMPOSITE_SCORE 60→65 (tighten)',
    entryFilters: { ...PAPER_FILTERS },
    apply: () => {
      (V2_CONFIG as { MIN_COMPOSITE_SCORE: number }).MIN_COMPOSITE_SCORE = 65;
    },
  },
  {
    id: 'trail_gb_02',
    label: 'trailGiveback 0.03→0.02',
    entryFilters: { ...PAPER_FILTERS },
    apply: () => {
      STRATEGY_EXIT_CONFIGS.TREND.trailGivebackPercent = 0.02;
    },
  },
  {
    id: 'trail_act_018',
    label: 'trailActivate 0.014→0.018',
    entryFilters: { ...PAPER_FILTERS },
    apply: () => {
      STRATEGY_EXIT_CONFIGS.TREND.trailActivatePercent = 0.018;
    },
  },
  {
    id: 'chase_075',
    label: 'chase≤0.75 (tighter)',
    entryFilters: { ...PAPER_FILTERS, maxSignalCloseLocation: 0.75 },
  },
];

async function runWindow(label: string, days: number, end: Date, ab: Ablation) {
  const baseline = snap();
  try {
    (V2_CONFIG as { ALLOWED_REGIMES: readonly string[] }).ALLOWED_REGIMES = ['STRONG_UP'];
    (V2_CONFIG as { MAX_ATR_PERCENT: number }).MAX_ATR_PERCENT = 2.5;
    (MOMENTUM_CONFIG as { ENABLED: boolean }).ENABLED = true;
    ab.apply?.();
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
  const endEarlier90 = new Date(endRecent.getTime() - 45 * 86400000);

  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  ADX20+confirmMomentum feature probes (robust 90/45)   ║');
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
      `== ${ab.id}: pass=${row.meetsPromotionBar} | OOS PF=${oos.pf} n=${oos.trades} | earlier PF=${earlier.pf} n=${earlier.trades}`,
    );
  }

  const out = {
    generatedAt: new Date().toISOString(),
    hypothesis:
      'Under paper ADX20+MOM-confirm stack, signal-bar range / confirm-mode / score / trail knobs may raise earlier n or PF without UP/ATR loosen.',
    protocol: {
      windows: '90d earlier / 45d OOS',
      promotionBar: 'OOS PF>1.1 & net>0 & earlier PF>=0.9 & earlier n>=10',
      fixed: `STRONG_UP MAX2.5 minAdx=${MIN_ADX} confirmMomentum chase0.8 minATR1.5`,
    },
    rows,
    anyPromote: rows.some((r) => r.meetsPromotionBar),
  };
  writeFileSync('/opt/cursor/artifacts/edge-adx20-confirmmom-features-9045.json', JSON.stringify(out, null, 2));
  writeFileSync('/cursor/stores/self/artifacts/edge-adx20-confirmmom-features-9045.json', JSON.stringify(out, null, 2));
  console.log(`\nWrote edge-adx20-confirmmom-features-9045.json anyPromote=${out.anyPromote}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
