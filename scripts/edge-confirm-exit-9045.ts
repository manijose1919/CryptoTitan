#!/usr/bin/env node
/**
 * Exit-side ablations under the corrected confirm-bar stack (research only).
 *
 * Context: MAX_ATR=2.5 + bullish_close + chase clears fragile 45/45 but fails
 * robust 90/45. Post-fix earlier90 autopsy: time_kill drag + one stop;
 * trailing net +. Pre-register exit knobs that may cut fee-bleed time_kills
 * without casually loosening risk (wider SL is included but labeled).
 *
 * Protocol: 90d earlier / 45d OOS, CAD10, STRONG_UP, 4h, 0.52% RT, 5bps,
 * pessimistic, confirm T+2 fills. Bar: OOS PF>1.1 & net>0 & earlier PF≥0.9
 * & earlier n≥10.
 *
 * Usage:
 *   DATA_DIR=/tmp/cryptotitan-edge-research \
 *     node --experimental-strip-types scripts/edge-confirm-exit-9045.ts
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { initializeDatabase } from '../services/database.js';
import { initV2Tables } from '../v2/attribution/attributionStore.ts';
import { V2_CONFIG, STRATEGY_EXIT_CONFIGS } from '../v2/engine/config.ts';
import type { StrategyExitConfig } from '../v2/engine/config.ts';
import { runBacktest } from '../v2/backtest/backtestEngine.ts';
import type { BacktestConfig, BacktestResult } from '../v2/backtest/types.ts';

const CAD10 = [...V2_CONFIG.SCAN_TICKERS];

const ENTRY_STACK: BacktestConfig['entryFilters'] = {
  confirmMode: 'bullish_close',
  maxSignalCloseLocation: 0.8,
};

type ExitSnap = StrategyExitConfig & { maxAtr: number };

function snap(): ExitSnap {
  const t = STRATEGY_EXIT_CONFIGS.TREND;
  return {
    ...t,
    timeKillBarsByTf: t.timeKillBarsByTf ? { ...t.timeKillBarsByTf } : undefined,
    maxAtr: V2_CONFIG.MAX_ATR_PERCENT,
  };
}

function restore(s: ExitSnap): void {
  const { maxAtr, ...exit } = s;
  Object.assign(STRATEGY_EXIT_CONFIGS.TREND, exit);
  (V2_CONFIG as { MAX_ATR_PERCENT: number }).MAX_ATR_PERCENT = maxAtr;
}

function summarize(result: BacktestResult) {
  const s = result.summary;
  const negativeHold = result.trades.filter((t) => t.holdBars < 0).length;
  if (negativeHold > 0) throw new Error(`holdBars<0 on ${negativeHold} trades`);
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
    avgWin: Number(s.avgWinPnl.toFixed(2)),
    avgLoss: Number(s.avgLossPnl.toFixed(2)),
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
  entryFilters?: BacktestConfig['entryFilters'];
  apply: () => void;
};

const ABLATIONS: Ablation[] = [
  {
    id: 'confirm_baseline_exits',
    label: 'Confirm stack + paper TREND exits (control)',
    apply: () => {
      (V2_CONFIG as { MAX_ATR_PERCENT: number }).MAX_ATR_PERCENT = 2.5;
    },
  },
  {
    id: 'timekill_3',
    label: 'Confirm stack + timeKillBars 2→3',
    apply: () => {
      (V2_CONFIG as { MAX_ATR_PERCENT: number }).MAX_ATR_PERCENT = 2.5;
      STRATEGY_EXIT_CONFIGS.TREND.timeKillBars = 3;
    },
  },
  {
    id: 'timekill_4',
    label: 'Confirm stack + timeKillBars 2→4',
    apply: () => {
      (V2_CONFIG as { MAX_ATR_PERCENT: number }).MAX_ATR_PERCENT = 2.5;
      STRATEGY_EXIT_CONFIGS.TREND.timeKillBars = 4;
    },
  },
  {
    id: 'timekill_minmove_1pct',
    label: 'Confirm stack + timeKillMinMove 0.7%→1.0%',
    apply: () => {
      (V2_CONFIG as { MAX_ATR_PERCENT: number }).MAX_ATR_PERCENT = 2.5;
      STRATEGY_EXIT_CONFIGS.TREND.timeKillMinMove = 0.01;
    },
  },
  {
    id: 'no_quickkill',
    label: 'Confirm stack + quickKillBars disabled (0)',
    apply: () => {
      (V2_CONFIG as { MAX_ATR_PERCENT: number }).MAX_ATR_PERCENT = 2.5;
      STRATEGY_EXIT_CONFIGS.TREND.quickKillBars = 0;
    },
  },
  {
    id: 'sl_1_8',
    label: 'Confirm stack + SL ATR 1.5→1.8 (wider; labeled loosen)',
    apply: () => {
      (V2_CONFIG as { MAX_ATR_PERCENT: number }).MAX_ATR_PERCENT = 2.5;
      STRATEGY_EXIT_CONFIGS.TREND.slAtrMult = 1.8;
    },
  },
  {
    id: 'minatr_timekill_3',
    label: 'Confirm+chase+minATR≥1.5 + timeKillBars=3',
    entryFilters: {
      confirmMode: 'bullish_close',
      maxSignalCloseLocation: 0.8,
      minSignalAtrPercent: 1.5,
    },
    apply: () => {
      (V2_CONFIG as { MAX_ATR_PERCENT: number }).MAX_ATR_PERCENT = 2.5;
      STRATEGY_EXIT_CONFIGS.TREND.timeKillBars = 3;
    },
  },
  {
    id: 'timekill_3_minmove_1',
    label: 'Confirm stack + timeKillBars=3 + minMove 1%',
    apply: () => {
      (V2_CONFIG as { MAX_ATR_PERCENT: number }).MAX_ATR_PERCENT = 2.5;
      STRATEGY_EXIT_CONFIGS.TREND.timeKillBars = 3;
      STRATEGY_EXIT_CONFIGS.TREND.timeKillMinMove = 0.01;
    },
  },
];

async function runWindow(label: string, days: number, end: Date, ab: Ablation) {
  const baseline = snap();
  try {
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
      entryFilters: ab.entryFilters ?? ENTRY_STACK,
      seed: false,
    };
    console.log(`\n>>> ${label} | ${startDate.toISOString().slice(0, 10)}→${end.toISOString().slice(0, 10)}`);
    const result = await runBacktest(config);
    const summary = summarize(result);
    console.log(
      `    trades=${summary.trades} WR=${(summary.winRate * 100).toFixed(1)}% net=$${summary.net} PF=${summary.pf} zH=${summary.zeroHoldStops} reasons=${JSON.stringify(summary.byReason)}`,
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
  console.log('║  Confirm-stack exit ablations (robust 90/45)            ║');
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
      'Under corrected confirm fills, longer/stricter time-kill (or minATR+timekill) repairs 90d-earlier PF with n≥10 without destroying OOS.',
    protocol: {
      entry: 'MAX_ATR=2.5 + bullish_close + chase≤0.80 (unless ablation overrides)',
      windows: '90d earlier / 45d OOS',
      promotionBar: 'OOS PF>1.1 & net>0 & earlier PF>=0.9 & earlier n>=10',
      feeRoundTrip: V2_CONFIG.FEE_ROUND_TRIP_TAKER,
    },
    rows,
    anyPromote: rows.some((r) => r.meetsPromotionBar),
  };
  const path = '/opt/cursor/artifacts/edge-confirm-exit-9045.json';
  writeFileSync(path, JSON.stringify(out, null, 2));
  writeFileSync('/cursor/stores/self/artifacts/edge-confirm-exit-9045.json', JSON.stringify(out, null, 2));
  console.log(`\nWrote ${path} anyPromote=${out.anyPromote}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
