#!/usr/bin/env node
/**
 * Re-test TimeGate relaxations after scarcity asymmetry flip (2026-10-20).
 * earlier60 in-band SU bars now ≥ oos60 — does overnight unblock / TG-off
 * clear earlier n≥10 under locked stack?
 *
 * Protocol: 90/45 + 60/60 CAD10 4h. Bar: OOS PF>1.1 & net>0 & earlier PF≥0.9 & n≥10.
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
const FILTERS: BacktestConfig['entryFilters'] = {
  confirmMode: 'bullish_close',
  maxSignalCloseLocation: 0.8,
  minAdx: ADX_THRESHOLDS.TREND_MIN,
  minSignalAtrPercent: 1.5,
  confirmMomentum: true,
};

type GateSnap = {
  ENABLED: boolean;
  BLOCKED_HOURS: readonly number[];
  BLOCKED_DAYS: readonly number[];
};

function snapGate(): GateSnap {
  return {
    ENABLED: TIME_GATE_CONFIG.ENABLED,
    BLOCKED_HOURS: [...TIME_GATE_CONFIG.BLOCKED_HOURS],
    BLOCKED_DAYS: [...TIME_GATE_CONFIG.BLOCKED_DAYS],
  };
}

function restoreGate(s: GateSnap): void {
  (TIME_GATE_CONFIG as { ENABLED: boolean }).ENABLED = s.ENABLED;
  (TIME_GATE_CONFIG as { BLOCKED_HOURS: readonly number[] }).BLOCKED_HOURS = s.BLOCKED_HOURS;
  (TIME_GATE_CONFIG as { BLOCKED_DAYS: readonly number[] }).BLOCKED_DAYS = s.BLOCKED_DAYS;
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

/** null PF = all winners (Infinity) — treat as passing the PF threshold. */
function pfOk(pf: number | null, min: number): boolean {
  return pf == null ? true : pf >= min;
}

function meetsBar(
  oos: { pf: number | null; net: number; trades: number },
  earlier: { pf: number | null; trades: number },
): boolean {
  return oos.trades > 0 && pfOk(oos.pf, 1.1) && oos.net > 0 && pfOk(earlier.pf, 0.9) && earlier.trades >= 10;
}

async function run(days: number, end: Date, label: string) {
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
    entryFilters: { ...FILTERS },
    seed: false,
  };
  console.log(`>>> ${label} ${startDate.toISOString().slice(0, 10)}→${end.toISOString().slice(0, 10)}`);
  const out = summarize(await runBacktest(config));
  console.log(`    n=${out.trades} WR=${out.winRate} net=$${out.net} PF=${out.pf}`);
  return out;
}

type Variant = { id: string; apply: () => void };

const VARIANTS: Variant[] = [
  { id: 'paper_live', apply: () => {} },
  {
    id: 'no_overnight',
    apply: () => {
      (TIME_GATE_CONFIG as { BLOCKED_HOURS: readonly number[] }).BLOCKED_HOURS = [13, 20];
    },
  },
  {
    id: 'timegate_off',
    apply: () => {
      (TIME_GATE_CONFIG as { ENABLED: boolean }).ENABLED = false;
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
    const gate = snapGate();
    try {
      v.apply();
      const earlier90 = await run(90, end45, `${v.id}/earlier90`);
      const oos45 = await run(45, end, `${v.id}/oos45`);
      const earlier60 = await run(60, end60, `${v.id}/earlier60`);
      const oos60 = await run(60, end, `${v.id}/oos60`);
      rows.push({
        id: v.id,
        split_90_45: { earlier: earlier90, oos: oos45, pass: meetsBar(oos45, earlier90) },
        split_60_60: { earlier: earlier60, oos: oos60, pass: meetsBar(oos60, earlier60) },
      });
    } finally {
      restoreGate(gate);
    }
  }

  const out = {
    generatedAt: new Date().toISOString(),
    purpose: 'Re-test TimeGate relax after scarcity flip (earlier60 in-band ≥ oos60)',
    stack: 'STRONG_UP + confirm + chase0.8 + MAX2.5 + minATR1.5 + ADX20 + confirmMomentum',
    signalWeightMode: 'static',
    rows,
    anyPromote: rows.some((r) => r.split_90_45.pass && r.split_60_60.pass),
  };
  writeResearchArtifact('edge-timegate-scarcity-flip-9045.json', JSON.stringify(out, null, 2));
  console.log('\nWrote edge-timegate-scarcity-flip-9045.json');
  console.log(`anyPromote=${out.anyPromote}`);
  for (const r of rows) {
    console.log(
      `${r.id}: 90/45 pass=${r.split_90_45.pass} earlier n=${r.split_90_45.earlier.trades} PF=${r.split_90_45.earlier.pf} | 60/60 pass=${r.split_60_60.pass} earlier n=${r.split_60_60.earlier.trades} PF=${r.split_60_60.earlier.pf}`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
