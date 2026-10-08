#!/usr/bin/env node
/**
 * Pair closest quality package with overnight TimeGate unblock.
 *
 * Anchor: conf0.55 + chase≤0.75 + rangeAtr≤2.0 → earlier PF 0.965 n=8 (need +2 n).
 * Overnight unblock alone cleared 90/45 (n=13 PF1.18) but failed 60/60 (earlier n=6).
 * Hypothesis: range quality + overnight n may clear both bars.
 *
 * Protocol: 90/45 then 60/60 if 90/45 passes. CAD10 4h ADX20+confirmMomentum.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { initializeDatabase } from '../services/database.js';
import { initV2Tables } from '../v2/attribution/attributionStore.ts';
import { V2_CONFIG, MOMENTUM_CONFIG, ADX_THRESHOLDS } from '../v2/engine/config.ts';
import { runBacktest } from '../v2/backtest/backtestEngine.ts';
import type { BacktestConfig, BacktestResult } from '../v2/backtest/types.ts';
import { TIME_GATE_CONFIG } from '../v2/pipeline/timeGate.ts';

const CAD10 = [...V2_CONFIG.SCAN_TICKERS];
const MIN_ADX = ADX_THRESHOLDS.TREND_MIN;

type GateSnap = {
  ENABLED: boolean;
  BLOCKED_HOURS: readonly number[];
  BLOCKED_DAYS: readonly number[];
  minConf: number;
  regimes: readonly string[];
  maxAtr: number;
  mom: boolean;
};

function snap(): GateSnap {
  return {
    ENABLED: TIME_GATE_CONFIG.ENABLED,
    BLOCKED_HOURS: [...TIME_GATE_CONFIG.BLOCKED_HOURS],
    BLOCKED_DAYS: [...TIME_GATE_CONFIG.BLOCKED_DAYS],
    minConf: V2_CONFIG.MIN_CONFIDENCE,
    regimes: [...V2_CONFIG.ALLOWED_REGIMES],
    maxAtr: V2_CONFIG.MAX_ATR_PERCENT,
    mom: MOMENTUM_CONFIG.ENABLED,
  };
}

function restore(s: GateSnap): void {
  (TIME_GATE_CONFIG as { ENABLED: boolean }).ENABLED = s.ENABLED;
  (TIME_GATE_CONFIG as { BLOCKED_HOURS: readonly number[] }).BLOCKED_HOURS = s.BLOCKED_HOURS;
  (TIME_GATE_CONFIG as { BLOCKED_DAYS: readonly number[] }).BLOCKED_DAYS = s.BLOCKED_DAYS;
  (V2_CONFIG as { MIN_CONFIDENCE: number }).MIN_CONFIDENCE = s.minConf;
  (V2_CONFIG as { ALLOWED_REGIMES: readonly string[] }).ALLOWED_REGIMES = s.regimes;
  (V2_CONFIG as { MAX_ATR_PERCENT: number }).MAX_ATR_PERCENT = s.maxAtr;
  (MOMENTUM_CONFIG as { ENABLED: boolean }).ENABLED = s.mom;
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

function meetsBar(
  oos: { pf: number | null; net: number },
  earlier: { pf: number | null; trades: number },
): boolean {
  return (oos.pf ?? 0) > 1.1 && oos.net > 0 && (earlier.pf ?? 0) >= 0.9 && earlier.trades >= 10;
}

type Ablation = {
  id: string;
  label: string;
  conf: number;
  chase: number;
  range: number;
  overnightUnblock: boolean;
};

const ANCHOR_FILTERS = (chase: number, range: number): BacktestConfig['entryFilters'] => ({
  confirmMode: 'bullish_close',
  maxSignalCloseLocation: chase,
  minAdx: MIN_ADX,
  minSignalAtrPercent: 1.5,
  confirmMomentum: true,
  maxSignalRangeAtrMult: range,
});

const ABLATIONS: Ablation[] = [
  {
    id: 'paper_live',
    label: 'Paper live control',
    conf: 0.65,
    chase: 0.8,
    range: 99,
    overnightUnblock: false,
  },
  {
    id: 'anchor_only',
    label: 'Anchor conf0.55 chase0.75 range2 (live TimeGate)',
    conf: 0.55,
    chase: 0.75,
    range: 2.0,
    overnightUnblock: false,
  },
  {
    id: 'overnight_only',
    label: 'Overnight unblock only (conf0.65 chase0.80 no range)',
    conf: 0.65,
    chase: 0.8,
    range: 99,
    overnightUnblock: true,
  },
  {
    id: 'anchor_overnight',
    label: 'Anchor + overnight unblock',
    conf: 0.55,
    chase: 0.75,
    range: 2.0,
    overnightUnblock: true,
  },
  {
    id: 'anchor_conf065_overnight',
    label: 'range2+chase0.75 + overnight (keep conf0.65)',
    conf: 0.65,
    chase: 0.75,
    range: 2.0,
    overnightUnblock: true,
  },
  {
    id: 'conf055_chase075_overnight',
    label: 'conf0.55 chase0.75 + overnight (no range)',
    conf: 0.55,
    chase: 0.75,
    range: 99,
    overnightUnblock: true,
  },
];

async function runWindow(label: string, days: number, end: Date, ab: Ablation) {
  const baseline = snap();
  try {
    (V2_CONFIG as { ALLOWED_REGIMES: readonly string[] }).ALLOWED_REGIMES = ['STRONG_UP'];
    (V2_CONFIG as { MAX_ATR_PERCENT: number }).MAX_ATR_PERCENT = 2.5;
    (MOMENTUM_CONFIG as { ENABLED: boolean }).ENABLED = true;
    (V2_CONFIG as { MIN_CONFIDENCE: number }).MIN_CONFIDENCE = ab.conf;
    if (ab.overnightUnblock) {
      (TIME_GATE_CONFIG as { BLOCKED_HOURS: readonly number[] }).BLOCKED_HOURS = [13, 20];
    }
    const entryFilters =
      ab.range >= 99
        ? {
            confirmMode: 'bullish_close' as const,
            maxSignalCloseLocation: ab.chase,
            minAdx: MIN_ADX,
            minSignalAtrPercent: 1.5,
            confirmMomentum: true,
          }
        : ANCHOR_FILTERS(ab.chase, ab.range);
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
      entryFilters,
      seed: false,
    };
    console.log(`\n>>> ${label} | ${startDate.toISOString().slice(0, 10)}→${end.toISOString().slice(0, 10)}`);
    const result = await runBacktest(config);
    const summary = summarize(result);
    console.log(`    n=${summary.trades} WR=${summary.winRate} net=$${summary.net} PF=${summary.pf}`);
    return summary;
  } finally {
    restore(baseline);
  }
}

async function main(): Promise<void> {
  mkdirSync('/opt/cursor/artifacts', { recursive: true });
  initializeDatabase();
  initV2Tables();

  const end = new Date();
  end.setUTCHours(0, 0, 0, 0);
  const end45 = new Date(end.getTime() - 45 * 86400000);
  const end60 = new Date(end.getTime() - 60 * 86400000);

  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  Anchor quality × overnight TimeGate (90/45 + 60/60)   ║');
  console.log('╚══════════════════════════════════════════════════════════╝');

  const rows = [];
  for (const ab of ABLATIONS) {
    const earlier90 = await runWindow(`${ab.id}/earlier90`, 90, end45, ab);
    const oos45 = await runWindow(`${ab.id}/oos45`, 45, end, ab);
    const pass9045 = meetsBar(oos45, earlier90);
    let split6060: { earlier: ReturnType<typeof summarize>; oos: ReturnType<typeof summarize>; pass: boolean } | null =
      null;
    if (pass9045 || ab.id === 'anchor_overnight' || ab.id === 'overnight_only') {
      const earlier60 = await runWindow(`${ab.id}/earlier60`, 60, end60, ab);
      const oos60 = await runWindow(`${ab.id}/oos60`, 60, end, ab);
      split6060 = { earlier: earlier60, oos: oos60, pass: meetsBar(oos60, earlier60) };
    }
    rows.push({
      id: ab.id,
      label: ab.label,
      earlier90,
      oos45,
      meetsPromotionBar_90_45: pass9045,
      split_60_60: split6060,
    });
  }

  const out = {
    generatedAt: new Date().toISOString(),
    hypothesis:
      'Anchor (conf0.55+chase0.75+range2) needs +2 earlier n; overnight unblock supplies n; together may clear 90/45 and 60/60.',
    protocol: {
      promotionBar: 'OOS PF>1.1 & net>0 & earlier PF>=0.9 & earlier n>=10',
      fixed: 'STRONG_UP MAX2.5 minAdx=20 confirmMomentum minATR1.5',
    },
    rows,
    anyPromote9045: rows.some((r) => r.meetsPromotionBar_90_45),
    anyPromote6060: rows.some((r) => r.split_60_60?.pass),
  };
  writeFileSync('/opt/cursor/artifacts/edge-anchor-overnight-9045.json', JSON.stringify(out, null, 2));
  writeFileSync('/cursor/stores/self/artifacts/edge-anchor-overnight-9045.json', JSON.stringify(out, null, 2));
  console.log('\nWrote edge-anchor-overnight-9045.json');
  console.log(`anyPromote9045=${out.anyPromote9045} anyPromote6060=${out.anyPromote6060}`);
  for (const r of rows) {
    const s60 = r.split_60_60
      ? ` | 60/60 earlier n=${r.split_60_60.earlier.trades} PF=${r.split_60_60.earlier.pf} pass=${r.split_60_60.pass}`
      : '';
    console.log(
      `${r.meetsPromotionBar_90_45 ? 'PASS' : 'fail'} ${r.id} earlier n=${r.earlier90.trades} PF=${r.earlier90.pf}${s60}`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
