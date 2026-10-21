#!/usr/bin/env node
/**
 * Neighborhood around no_overnight TimeGate (clears 90/45, fails 60/60 earlier n=8).
 * Goal: find a fee-aware nudge that lifts earlier60 n to ≥10 without collapsing PF.
 *
 * Fixed: BLOCKED_HOURS=[13,20] (overnight 0-7 unblocked), Friday kept, locked stack.
 * Variants nudge conf / chase / Friday only.
 *
 * Protocol: 90/45 + 60/60. Bar: OOS PF>1.1 & net>0 & earlier PF≥0.9 & earlier n≥10.
 * Prefer DATA_DIR=/tmp/cryptotitan-edge-research.
 */
import { initializeDatabase } from '../services/database.js';
import { initV2Tables } from '../v2/attribution/attributionStore.ts';
import { V2_CONFIG, MOMENTUM_CONFIG, ADX_THRESHOLDS } from '../v2/engine/config.ts';
import { setSignalWeightMode } from '../v2/pipeline/signalGenerator.ts';
import { TIME_GATE_CONFIG } from '../v2/pipeline/timeGate.ts';
import { runBacktest } from '../v2/backtest/backtestEngine.ts';
import type { BacktestConfig, BacktestResult } from '../v2/backtest/types.ts';
import { writeResearchArtifact } from './researchArtifactWrite.ts';

const CAD10 = [...V2_CONFIG.SCAN_TICKERS];

type Snap = {
  conf: number;
  hours: readonly number[];
  days: readonly number[];
};

function snap(): Snap {
  return {
    conf: V2_CONFIG.MIN_CONFIDENCE,
    hours: [...TIME_GATE_CONFIG.BLOCKED_HOURS],
    days: [...TIME_GATE_CONFIG.BLOCKED_DAYS],
  };
}

function restore(s: Snap): void {
  (V2_CONFIG as { MIN_CONFIDENCE: number }).MIN_CONFIDENCE = s.conf;
  (TIME_GATE_CONFIG as { BLOCKED_HOURS: readonly number[] }).BLOCKED_HOURS = s.hours;
  (TIME_GATE_CONFIG as { BLOCKED_DAYS: readonly number[] }).BLOCKED_DAYS = s.days;
}

function summarize(result: BacktestResult) {
  const s = result.summary;
  if (result.trades.some((t) => t.holdBars < 0)) throw new Error('holdBars<0');
  return {
    trades: s.totalTrades,
    winRate: Number(s.winRate.toFixed(4)),
    net: Number(s.totalPnlNet.toFixed(2)),
    pf: s.profitFactor === Infinity ? null : Number(s.profitFactor.toFixed(3)),
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

async function run(
  days: number,
  end: Date,
  label: string,
  chase: number,
): Promise<ReturnType<typeof summarize>> {
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
    entryFilters: {
      confirmMode: 'bullish_close',
      maxSignalCloseLocation: chase,
      minAdx: ADX_THRESHOLDS.TREND_MIN,
      minSignalAtrPercent: 1.5,
      confirmMomentum: true,
    },
    seed: false,
  };
  console.log(`>>> ${label} ${startDate.toISOString().slice(0, 10)}→${end.toISOString().slice(0, 10)}`);
  const out = summarize(await runBacktest(config));
  console.log(`    n=${out.trades} WR=${out.winRate} net=$${out.net} PF=${out.pf}`);
  return out;
}

type Variant = {
  id: string;
  chase: number;
  apply: () => void;
};

const VARIANTS: Variant[] = [
  {
    id: 'no_overnight_paper',
    chase: 0.8,
    apply: () => {
      (TIME_GATE_CONFIG as { BLOCKED_HOURS: readonly number[] }).BLOCKED_HOURS = [13, 20];
    },
  },
  {
    id: 'no_ovn_conf060',
    chase: 0.8,
    apply: () => {
      (TIME_GATE_CONFIG as { BLOCKED_HOURS: readonly number[] }).BLOCKED_HOURS = [13, 20];
      (V2_CONFIG as { MIN_CONFIDENCE: number }).MIN_CONFIDENCE = 0.6;
    },
  },
  {
    id: 'no_ovn_conf062',
    chase: 0.8,
    apply: () => {
      (TIME_GATE_CONFIG as { BLOCKED_HOURS: readonly number[] }).BLOCKED_HOURS = [13, 20];
      (V2_CONFIG as { MIN_CONFIDENCE: number }).MIN_CONFIDENCE = 0.62;
    },
  },
  {
    id: 'no_ovn_chase085',
    chase: 0.85,
    apply: () => {
      (TIME_GATE_CONFIG as { BLOCKED_HOURS: readonly number[] }).BLOCKED_HOURS = [13, 20];
    },
  },
  {
    id: 'no_ovn_no_friday',
    chase: 0.8,
    apply: () => {
      (TIME_GATE_CONFIG as { BLOCKED_HOURS: readonly number[] }).BLOCKED_HOURS = [13, 20];
      (TIME_GATE_CONFIG as { BLOCKED_DAYS: readonly number[] }).BLOCKED_DAYS = [];
    },
  },
  {
    id: 'no_ovn_conf060_chase085',
    chase: 0.85,
    apply: () => {
      (TIME_GATE_CONFIG as { BLOCKED_HOURS: readonly number[] }).BLOCKED_HOURS = [13, 20];
      (V2_CONFIG as { MIN_CONFIDENCE: number }).MIN_CONFIDENCE = 0.6;
    },
  },
];

async function main(): Promise<void> {
  initializeDatabase();
  initV2Tables();
  (V2_CONFIG as { ALLOWED_REGIMES: readonly string[] }).ALLOWED_REGIMES = ['STRONG_UP'];
  (V2_CONFIG as { MAX_ATR_PERCENT: number }).MAX_ATR_PERCENT = 2.5;
  (MOMENTUM_CONFIG as { ENABLED: boolean }).ENABLED = true;
  setSignalWeightMode('static');

  const end = new Date();
  end.setUTCHours(0, 0, 0, 0);
  const end45 = new Date(end.getTime() - 45 * 86400000);
  const end60 = new Date(end.getTime() - 60 * 86400000);

  const rows = [];
  for (const v of VARIANTS) {
    const s = snap();
    try {
      v.apply();
      const earlier90 = await run(90, end45, `${v.id}/earlier90`, v.chase);
      const oos45 = await run(45, end, `${v.id}/oos45`, v.chase);
      const earlier60 = await run(60, end60, `${v.id}/earlier60`, v.chase);
      const oos60 = await run(60, end, `${v.id}/oos60`, v.chase);
      rows.push({
        id: v.id,
        chase: v.chase,
        minConfidence: V2_CONFIG.MIN_CONFIDENCE,
        blockedHours: [...TIME_GATE_CONFIG.BLOCKED_HOURS],
        blockedDays: [...TIME_GATE_CONFIG.BLOCKED_DAYS],
        split_90_45: { earlier: earlier90, oos: oos45, pass: meetsBar(oos45, earlier90) },
        split_60_60: { earlier: earlier60, oos: oos60, pass: meetsBar(oos60, earlier60) },
      });
    } finally {
      restore(s);
    }
  }

  const out = {
    generatedAt: new Date().toISOString(),
    purpose: 'Lift no_overnight earlier60 n=8→≥10 without killing dual-split PF',
    stack: 'STRONG_UP + confirm + MAX2.5 + minATR1.5 + ADX20 + confirmMomentum + no_overnight',
    signalWeightMode: 'static',
    rows,
    anyPromote: rows.some((r) => r.split_90_45.pass && r.split_60_60.pass),
  };
  writeResearchArtifact('edge-overnight-n-neighborhood-9045.json', JSON.stringify(out, null, 2));
  console.log('\nWrote edge-overnight-n-neighborhood-9045.json');
  console.log(`anyPromote=${out.anyPromote}`);
  for (const r of rows) {
    console.log(
      `${r.id}: 90/45 pass=${r.split_90_45.pass} n=${r.split_90_45.earlier.trades}/${r.split_90_45.oos.trades} PF=${r.split_90_45.earlier.pf}/${r.split_90_45.oos.pf} | 60/60 pass=${r.split_60_60.pass} n=${r.split_60_60.earlier.trades}/${r.split_60_60.oos.trades} PF=${r.split_60_60.earlier.pf}/${r.split_60_60.oos.pf}`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
