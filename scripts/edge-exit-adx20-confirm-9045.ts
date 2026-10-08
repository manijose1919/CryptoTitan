#!/usr/bin/env node
/**
 * TREND exit knobs under full paper ADX20+confirm stack (research only).
 *
 * Prior exit ablations (2026-09-29) predate confirm+ADX20; paper_live earlier
 * drag is now time_kill (−$10 on n=6) while OOS trailing is strongly positive.
 *
 * Protocol: 90/45 CAD10 4h 0.52% RT 5bps pessimistic + confirmMomentum.
 * Bar: OOS PF>1.1 & net>0 & earlier PF≥0.9 & earlier n≥10.
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
  mom: boolean;
  exit: StrategyExitConfig;
};

function snap(): Snap {
  const t = STRATEGY_EXIT_CONFIGS.TREND;
  return {
    regimes: [...V2_CONFIG.ALLOWED_REGIMES],
    maxAtr: V2_CONFIG.MAX_ATR_PERCENT,
    mom: MOMENTUM_CONFIG.ENABLED,
    exit: {
      ...t,
      timeKillBarsByTf: t.timeKillBarsByTf ? { ...t.timeKillBarsByTf } : undefined,
    },
  };
}

function restore(s: Snap): void {
  (V2_CONFIG as { ALLOWED_REGIMES: readonly string[] }).ALLOWED_REGIMES = s.regimes;
  (V2_CONFIG as { MAX_ATR_PERCENT: number }).MAX_ATR_PERCENT = s.maxAtr;
  (MOMENTUM_CONFIG as { ENABLED: boolean }).ENABLED = s.mom;
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

type Ablation = { id: string; label: string; apply: () => void };

const ABLATIONS: Ablation[] = [
  { id: 'paper_live', label: 'Paper live exits', apply: () => {} },
  {
    id: 'tk_3',
    label: 'timeKillBars 2→3',
    apply: () => {
      STRATEGY_EXIT_CONFIGS.TREND.timeKillBars = 3;
    },
  },
  {
    id: 'tk_4',
    label: 'timeKillBars 2→4',
    apply: () => {
      STRATEGY_EXIT_CONFIGS.TREND.timeKillBars = 4;
    },
  },
  {
    id: 'tk_min_01',
    label: 'timeKillMinMove 0.7%→1.0%',
    apply: () => {
      STRATEGY_EXIT_CONFIGS.TREND.timeKillMinMove = 0.01;
    },
  },
  {
    id: 'tk_min_005',
    label: 'timeKillMinMove 0.7%→0.5% (kill sooner)',
    apply: () => {
      STRATEGY_EXIT_CONFIGS.TREND.timeKillMinMove = 0.005;
    },
  },
  {
    id: 'trail_gb_025',
    label: 'trailGiveback 0.03→0.025',
    apply: () => {
      STRATEGY_EXIT_CONFIGS.TREND.trailGivebackPercent = 0.025;
    },
  },
  {
    id: 'trail_gb_02',
    label: 'trailGiveback 0.03→0.02',
    apply: () => {
      STRATEGY_EXIT_CONFIGS.TREND.trailGivebackPercent = 0.02;
    },
  },
  {
    id: 'sl_atr_12',
    label: 'slAtrMult 1.5→1.2',
    apply: () => {
      STRATEGY_EXIT_CONFIGS.TREND.slAtrMult = 1.2;
    },
  },
];

async function runWindow(label: string, days: number, end: Date, ab: Ablation) {
  const baseline = snap();
  try {
    (V2_CONFIG as { ALLOWED_REGIMES: readonly string[] }).ALLOWED_REGIMES = ['STRONG_UP'];
    (V2_CONFIG as { MAX_ATR_PERCENT: number }).MAX_ATR_PERCENT = 2.5;
    (MOMENTUM_CONFIG as { ENABLED: boolean }).ENABLED = true;
    ab.apply();
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
      entryFilters: { ...PAPER_FILTERS },
      seed: false,
    };
    console.log(`\n>>> ${label} | ${startDate.toISOString().slice(0, 10)}→${end.toISOString().slice(0, 10)}`);
    const result = await runBacktest(config);
    const summary = summarize(result);
    console.log(
      `    n=${summary.trades} WR=${summary.winRate} net=$${summary.net} PF=${summary.pf} byReason=${JSON.stringify(summary.byReason)}`,
    );
    return summary;
  } finally {
    restore(baseline);
  }
}

async function main(): Promise<void> {
  mkdirSync('/opt/cursor/artifacts', { recursive: true });
  initializeDatabase();
  initV2Tables();
  const endRecent = new Date();
  endRecent.setUTCHours(0, 0, 0, 0);
  const endEarlier90 = new Date(endRecent.getTime() - 45 * 86400000);

  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  Exit knobs under ADX20+confirm paper stack (90/45)    ║');
  console.log('╚══════════════════════════════════════════════════════════╝');

  const rows = [];
  for (const ab of ABLATIONS) {
    const earlier90 = await runWindow(`${ab.id}/earlier90`, 90, endEarlier90, ab);
    const oos45 = await runWindow(`${ab.id}/oos45`, 45, endRecent, ab);
    rows.push({
      id: ab.id,
      label: ab.label,
      earlier90,
      oos45,
      meetsPromotionBar: meetsBar(oos45, earlier90),
    });
  }

  const out = {
    generatedAt: new Date().toISOString(),
    hypothesis:
      'Under ADX20+confirm, earlier drag is time_kill; longer leash or tighter trail may lift earlier PF without entry loosen (n≥10 still required for promote).',
    protocol: {
      windows: '90d earlier / 45d OOS',
      promotionBar: 'OOS PF>1.1 & net>0 & earlier PF>=0.9 & earlier n>=10',
      fixed: 'STRONG_UP MAX2.5 minAdx=20 confirmMomentum chase0.8 minATR1.5 conf0.65',
    },
    rows,
    anyPromote: rows.some((r) => r.meetsPromotionBar),
  };
  writeFileSync('/opt/cursor/artifacts/edge-exit-adx20-confirm-9045.json', JSON.stringify(out, null, 2));
  writeFileSync('/cursor/stores/self/artifacts/edge-exit-adx20-confirm-9045.json', JSON.stringify(out, null, 2));
  console.log('\nWrote edge-exit-adx20-confirm-9045.json');
  console.log(`anyPromote=${out.anyPromote}`);
  for (const r of rows) {
    console.log(
      `${r.meetsPromotionBar ? 'PASS' : 'fail'} ${r.id} earlier n=${r.earlier90.trades} PF=${r.earlier90.pf} | oos n=${r.oos45.trades} PF=${r.oos45.pf}`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
