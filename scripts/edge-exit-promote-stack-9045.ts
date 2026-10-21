#!/usr/bin/env node
/**
 * TREND exit knobs under the 2026-10-21 promote package (research only).
 *
 * Promote stack: no_overnight + conf0.60 + chase0.85 + STRONG_UP+confirm+MAX2.5+
 * minATR1.5+ADX20+confirmMomentum. Autopsy: earlier drag is time_kill; overnight
 * entries are net-positive — do not re-block overnight from this alone.
 *
 * Protocol: 90/45 + 60/60. Bar: OOS PF>1.1 & net>0 & earlier PF≥0.9 & earlier n≥10.
 * Prefer DATA_DIR=/tmp/cryptotitan-edge-research.
 */
import { initializeDatabase } from '../services/database.js';
import { initV2Tables } from '../v2/attribution/attributionStore.ts';
import {
  V2_CONFIG,
  MOMENTUM_CONFIG,
  ADX_THRESHOLDS,
  STRATEGY_EXIT_CONFIGS,
} from '../v2/engine/config.ts';
import type { StrategyExitConfig } from '../v2/engine/config.ts';
import { setSignalWeightMode } from '../v2/pipeline/signalGenerator.ts';
import { TIME_GATE_CONFIG } from '../v2/pipeline/timeGate.ts';
import { runBacktest } from '../v2/backtest/backtestEngine.ts';
import type { BacktestConfig, BacktestResult } from '../v2/backtest/types.ts';
import { writeResearchArtifact } from './researchArtifactWrite.ts';

const CAD10 = [...V2_CONFIG.SCAN_TICKERS];
const MIN_ADX = ADX_THRESHOLDS.TREND_MIN;

type ExitSnap = StrategyExitConfig;

function snapExit(): ExitSnap {
  const t = STRATEGY_EXIT_CONFIGS.TREND;
  return {
    ...t,
    timeKillBarsByTf: t.timeKillBarsByTf ? { ...t.timeKillBarsByTf } : undefined,
  };
}

function restoreExit(s: ExitSnap): void {
  Object.assign(STRATEGY_EXIT_CONFIGS.TREND, s);
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

function pfOk(pf: number | null, min: number): boolean {
  return pf == null ? true : pf >= min;
}

function meetsBar(
  oos: { pf: number | null; net: number; trades: number },
  earlier: { pf: number | null; trades: number },
): boolean {
  return oos.trades > 0 && pfOk(oos.pf, 1.1) && oos.net > 0 && pfOk(earlier.pf, 0.9) && earlier.trades >= 10;
}

const PAPER_FILTERS: BacktestConfig['entryFilters'] = {
  confirmMode: 'bullish_close',
  maxSignalCloseLocation: 0.85,
  minAdx: MIN_ADX,
  minSignalAtrPercent: 1.5,
  confirmMomentum: true,
};

type Ablation = { id: string; label: string; apply: () => void };

const ABLATIONS: Ablation[] = [
  { id: 'paper_live', label: 'Promote-stack paper exits', apply: () => {} },
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

async function runWindow(days: number, end: Date, label: string) {
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
  console.log(`  >>> ${label} ${startDate.toISOString().slice(0, 10)}→${end.toISOString().slice(0, 10)}`);
  const summary = summarize(await runBacktest(config));
  console.log(
    `      n=${summary.trades} WR=${summary.winRate} net=$${summary.net} PF=${summary.pf}`,
  );
  return summary;
}

async function main(): Promise<void> {
  initializeDatabase();
  initV2Tables();
  (V2_CONFIG as { ALLOWED_REGIMES: readonly string[] }).ALLOWED_REGIMES = ['STRONG_UP'];
  (V2_CONFIG as { MAX_ATR_PERCENT: number }).MAX_ATR_PERCENT = 2.5;
  (V2_CONFIG as { MIN_CONFIDENCE: number }).MIN_CONFIDENCE = 0.6;
  (V2_CONFIG as { MAX_SIGNAL_CLOSE_LOCATION: number }).MAX_SIGNAL_CLOSE_LOCATION = 0.85;
  (TIME_GATE_CONFIG as { BLOCKED_HOURS: readonly number[] }).BLOCKED_HOURS = [13, 20];
  (MOMENTUM_CONFIG as { ENABLED: boolean }).ENABLED = true;
  setSignalWeightMode('static');

  const end = new Date();
  end.setUTCHours(0, 0, 0, 0);
  const end45 = new Date(end.getTime() - 45 * 86400000);
  const end60 = new Date(end.getTime() - 60 * 86400000);

  const rows = [];
  for (const ab of ABLATIONS) {
    const exitBase = snapExit();
    try {
      ab.apply();
      console.log(`\n=== ${ab.id}: ${ab.label} ===`);
      const earlier90 = await runWindow(90, end45, 'earlier90');
      const oos45 = await runWindow(45, end, 'oos45');
      const earlier60 = await runWindow(60, end60, 'earlier60');
      const oos60 = await runWindow(60, end, 'oos60');
      const pass9045 = meetsBar(oos45, earlier90);
      const pass6060 = meetsBar(oos60, earlier60);
      rows.push({
        id: ab.id,
        label: ab.label,
        split_90_45: { earlier: earlier90, oos: oos45, pass: pass9045 },
        split_60_60: { earlier: earlier60, oos: oos60, pass: pass6060 },
        dualPass: pass9045 && pass6060,
      });
      console.log(`  dualPass=${pass9045 && pass6060} 90/45=${pass9045} 60/60=${pass6060}`);
    } finally {
      restoreExit(exitBase);
    }
  }

  const out = {
    generatedAt: new Date().toISOString(),
    purpose: 'Exit knobs under promote stack — can time_kill/trail/SL improve dual-split?',
    stack:
      'STRONG_UP + confirm + chase0.85 + MAX2.5 + minATR1.5 + ADX20 + confirmMomentum + no_overnight + conf0.60',
    signalWeightMode: 'static',
    rows,
    anyDualPass: rows.some((r) => r.dualPass),
  };
  const paths = writeResearchArtifact('edge-exit-promote-stack-9045.json', JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ written: paths, anyDualPass: out.anyDualPass }, null, 2));
  for (const r of rows) {
    const a = r.split_90_45;
    const b = r.split_60_60;
    console.log(
      `${r.dualPass ? 'DUAL' : '----'} ${r.id} | 90/45 n=${a.earlier.trades}/${a.oos.trades} PF=${a.earlier.pf}/${a.oos.pf} | 60/60 n=${b.earlier.trades}/${b.oos.trades} PF=${b.earlier.pf}/${b.oos.pf}`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
