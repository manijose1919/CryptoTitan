#!/usr/bin/env node
/**
 * Neighborhood around closest miss: conf0.55 + chase≤0.75 + rangeAtr≤2.0
 * (earlier PF 0.965 n=8 — PF clears, need n≥10 without tanking PF).
 *
 * Protocol: 90/45 CAD10 4h 0.52% RT 5bps pessimistic + confirmMomentum + ADX20.
 * Bar: OOS PF>1.1 & net>0 & earlier PF≥0.9 & earlier n≥10.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { initializeDatabase } from '../services/database.js';
import { initV2Tables } from '../v2/attribution/attributionStore.ts';
import { V2_CONFIG, MOMENTUM_CONFIG, ADX_THRESHOLDS } from '../v2/engine/config.ts';
import { runBacktest } from '../v2/backtest/backtestEngine.ts';
import type { BacktestConfig, BacktestResult } from '../v2/backtest/types.ts';

const CAD10 = [...V2_CONFIG.SCAN_TICKERS];
const MIN_ADX = ADX_THRESHOLDS.TREND_MIN;

type Snap = { minConf: number; regimes: readonly string[]; maxAtr: number; mom: boolean };
function snap(): Snap {
  return {
    minConf: V2_CONFIG.MIN_CONFIDENCE,
    regimes: [...V2_CONFIG.ALLOWED_REGIMES],
    maxAtr: V2_CONFIG.MAX_ATR_PERCENT,
    mom: MOMENTUM_CONFIG.ENABLED,
  };
}
function restore(s: Snap): void {
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
  range?: number;
};

const ABLATIONS: Ablation[] = [
  { id: 'anchor_055_075_r2', label: 'anchor conf0.55 chase0.75 range2.0', conf: 0.55, chase: 0.75, range: 2.0 },
  { id: 'r2_1', label: 'conf0.55 chase0.75 range2.1', conf: 0.55, chase: 0.75, range: 2.1 },
  { id: 'r2_25', label: 'conf0.55 chase0.75 range2.25', conf: 0.55, chase: 0.75, range: 2.25 },
  { id: 'r2_5', label: 'conf0.55 chase0.75 range2.5', conf: 0.55, chase: 0.75, range: 2.5 },
  { id: 'chase_078_r2', label: 'conf0.55 chase0.78 range2.0', conf: 0.55, chase: 0.78, range: 2.0 },
  { id: 'chase_080_r2', label: 'conf0.55 chase0.80 range2.0', conf: 0.55, chase: 0.8, range: 2.0 },
  { id: 'conf_057_075_r2', label: 'conf0.57 chase0.75 range2.0', conf: 0.57, chase: 0.75, range: 2.0 },
  { id: 'conf_058_075_r2', label: 'conf0.58 chase0.75 range2.0', conf: 0.58, chase: 0.75, range: 2.0 },
  { id: 'conf_060_075_r2_1', label: 'conf0.60 chase0.75 range2.1', conf: 0.6, chase: 0.75, range: 2.1 },
  { id: 'conf_055_075_r2_no_range', label: 'conf0.55 chase0.75 (no range — ref)', conf: 0.55, chase: 0.75 },
];

async function runWindow(label: string, days: number, end: Date, ab: Ablation) {
  const baseline = snap();
  try {
    (V2_CONFIG as { ALLOWED_REGIMES: readonly string[] }).ALLOWED_REGIMES = ['STRONG_UP'];
    (V2_CONFIG as { MAX_ATR_PERCENT: number }).MAX_ATR_PERCENT = 2.5;
    (MOMENTUM_CONFIG as { ENABLED: boolean }).ENABLED = true;
    (V2_CONFIG as { MIN_CONFIDENCE: number }).MIN_CONFIDENCE = ab.conf;
    const entryFilters: BacktestConfig['entryFilters'] = {
      confirmMode: 'bullish_close',
      maxSignalCloseLocation: ab.chase,
      minAdx: MIN_ADX,
      minSignalAtrPercent: 1.5,
      confirmMomentum: true,
      ...(ab.range != null ? { maxSignalRangeAtrMult: ab.range } : {}),
    };
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
  const endRecent = new Date();
  endRecent.setUTCHours(0, 0, 0, 0);
  const endEarlier90 = new Date(endRecent.getTime() - 45 * 86400000);

  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  conf+range neighborhood (closest miss PF0.965 n=8)    ║');
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
      'Anchor conf0.55+chase0.75+range2.0 clears earlier PF≥0.9 at n=8; small range/chase/conf nudges may clear n≥10 without PF collapse.',
    protocol: {
      windows: '90d earlier / 45d OOS',
      promotionBar: 'OOS PF>1.1 & net>0 & earlier PF>=0.9 & earlier n>=10',
      fixed: 'STRONG_UP MAX2.5 minAdx=20 confirmMomentum minATR1.5',
    },
    rows,
    anyPromote: rows.some((r) => r.meetsPromotionBar),
  };
  writeFileSync('/opt/cursor/artifacts/edge-conf-range-neighborhood-9045.json', JSON.stringify(out, null, 2));
  writeFileSync('/cursor/stores/self/artifacts/edge-conf-range-neighborhood-9045.json', JSON.stringify(out, null, 2));
  console.log('\nWrote edge-conf-range-neighborhood-9045.json');
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
