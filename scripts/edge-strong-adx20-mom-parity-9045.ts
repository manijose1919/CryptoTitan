#!/usr/bin/env node
/**
 * Re-baseline STRONG_UP+confirm+ADX20 after MOMENTUM ADX parity (research only).
 *
 * Context: until 2026-10-06, backtest MOMENTUM ignored entryFilters.minAdx while
 * TREND honored it — same desync as paper AVAX. After the fix, re-measure the
 * paper live stack and MOMENTUM on/off under ADX parity.
 *
 * Protocol: 90/45 CAD10 4h 0.52% RT 5bps pessimistic. Bar: OOS PF>1.1 & net>0
 * & earlier PF≥0.9 & earlier n≥10.
 *
 * Usage:
 *   DATA_DIR=/tmp/cryptotitan-edge-research \
 *     node --experimental-strip-types scripts/edge-strong-adx20-mom-parity-9045.ts
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { initializeDatabase } from '../services/database.js';
import { initV2Tables } from '../v2/attribution/attributionStore.ts';
import { V2_CONFIG, MOMENTUM_CONFIG, ADX_THRESHOLDS, STRATEGY_EXIT_CONFIGS } from '../v2/engine/config.ts';
import type { StrategyExitConfig } from '../v2/engine/config.ts';
import { runBacktest } from '../v2/backtest/backtestEngine.ts';
import type { BacktestConfig, BacktestResult } from '../v2/backtest/types.ts';

const CAD10 = [...V2_CONFIG.SCAN_TICKERS];
const MIN_ADX = ADX_THRESHOLDS.TREND_MIN;

type Snap = {
  regimes: readonly string[];
  maxAtr: number;
  momEnabled: boolean;
  exit: StrategyExitConfig;
};

function snap(): Snap {
  const t = STRATEGY_EXIT_CONFIGS.TREND;
  return {
    regimes: [...V2_CONFIG.ALLOWED_REGIMES],
    maxAtr: V2_CONFIG.MAX_ATR_PERCENT,
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

type Ablation = {
  id: string;
  label: string;
  momEnabled: boolean;
  entryFilters: BacktestConfig['entryFilters'];
  applyExit?: () => void;
};

const BASE_FILTERS: BacktestConfig['entryFilters'] = {
  confirmMode: 'bullish_close',
  maxSignalCloseLocation: 0.8,
  minAdx: MIN_ADX,
  minSignalAtrPercent: 1.5,
};

const ABLATIONS: Ablation[] = [
  {
    id: 'paper_live_mom_on',
    label: 'Paper live: STRONG_UP+confirm+chase+MAX2.5+ADX20+minATR1.5 (MOMENTUM on)',
    momEnabled: true,
    entryFilters: { ...BASE_FILTERS },
  },
  {
    id: 'paper_live_mom_off',
    label: 'Same stack, MOMENTUM_CONFIG.ENABLED=false',
    momEnabled: false,
    entryFilters: { ...BASE_FILTERS },
  },
  {
    id: 'no_minatr_mom_on',
    label: 'Stack without minSignalAtrPercent (MOMENTUM on)',
    momEnabled: true,
    entryFilters: {
      confirmMode: 'bullish_close',
      maxSignalCloseLocation: 0.8,
      minAdx: MIN_ADX,
    },
  },
  {
    id: 'timekill_3_mom_on',
    label: 'Paper live + timeKillBars 2→3 (MOMENTUM on)',
    momEnabled: true,
    entryFilters: { ...BASE_FILTERS },
    applyExit: () => {
      STRATEGY_EXIT_CONFIGS.TREND.timeKillBars = 3;
    },
  },
  {
    id: 'timekill_minmove_1_mom_on',
    label: 'Paper live + timeKillMinMove→1% (MOMENTUM on)',
    momEnabled: true,
    entryFilters: { ...BASE_FILTERS },
    applyExit: () => {
      STRATEGY_EXIT_CONFIGS.TREND.timeKillMinMove = 0.01;
    },
  },
  {
    id: 'chase085_mom_on',
    label: 'Paper live chase≤0.85 (MOMENTUM on)',
    momEnabled: true,
    entryFilters: { ...BASE_FILTERS, maxSignalCloseLocation: 0.85 },
  },
  {
    id: 'confirm_above_mom_on',
    label: 'close_above_signal + chase + ADX20 (MOMENTUM on)',
    momEnabled: true,
    entryFilters: {
      confirmMode: 'close_above_signal',
      maxSignalCloseLocation: 0.8,
      minAdx: MIN_ADX,
      minSignalAtrPercent: 1.5,
    },
  },
];

async function runWindow(label: string, days: number, end: Date, ab: Ablation) {
  const baseline = snap();
  try {
    (V2_CONFIG as { ALLOWED_REGIMES: readonly string[] }).ALLOWED_REGIMES = ['STRONG_UP'];
    (V2_CONFIG as { MAX_ATR_PERCENT: number }).MAX_ATR_PERCENT = 2.5;
    (MOMENTUM_CONFIG as { ENABLED: boolean }).ENABLED = ab.momEnabled;
    ab.applyExit?.();
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
  console.log('║  STRONG_UP+ADX20 MOMENTUM parity re-baseline (90/45)   ║');
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
      `== ${ab.id}: pass=${row.meetsPromotionBar} | OOS PF=${oos.pf} net=$${oos.net} n=${oos.trades} | earlier PF=${earlier.pf} n=${earlier.trades}`,
    );
  }

  const out = {
    generatedAt: new Date().toISOString(),
    hypothesis:
      'After MOMENTUM honors minAdx, re-measure paper stack and exit/confirm knobs; MOMENTUM on vs off shows prior ADX20 contamination.',
    protocol: {
      windows: '90d earlier / 45d OOS',
      promotionBar: 'OOS PF>1.1 & net>0 & earlier PF>=0.9 & earlier n>=10',
      fixed: `regimes=STRONG_UP, MAX_ATR=2.5, minAdx=${MIN_ADX}`,
    },
    rows,
    anyPromote: rows.some((r) => r.meetsPromotionBar),
  };
  writeFileSync('/opt/cursor/artifacts/edge-strong-adx20-mom-parity-9045.json', JSON.stringify(out, null, 2));
  writeFileSync('/cursor/stores/self/artifacts/edge-strong-adx20-mom-parity-9045.json', JSON.stringify(out, null, 2));
  console.log(`\nWrote edge-strong-adx20-mom-parity-9045.json anyPromote=${out.anyPromote}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
