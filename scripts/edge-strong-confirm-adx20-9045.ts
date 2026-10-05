#!/usr/bin/env node
/**
 * Expand STRONG_UP + confirm + ADX≥20 family (research only).
 *
 * Context: under minAdx=20, UP-inclusive stacks fail robust 90/45. The best
 * ADX20 result was STRONG_UP+confirm+chase+MAX2.5: earlier PF1.25 / OOS PF3.77
 * but n=6/7 (fails n≥10 only). Hypothesis: slight filter relax *within
 * STRONG_UP* (no chase, MAX3, or minATR floor off) raises n≥10 while keeping PF.
 *
 * Protocol: 90/45 CAD10 4h 0.52% RT 5bps pessimistic + 60/60 stress on best.
 * Bar: OOS PF>1.1 & net>0 & earlier PF≥0.9 & earlier n≥10.
 *
 * Usage:
 *   DATA_DIR=/tmp/cryptotitan-edge-research \
 *     node --experimental-strip-types scripts/edge-strong-confirm-adx20-9045.ts
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { initializeDatabase } from '../services/database.js';
import { initV2Tables } from '../v2/attribution/attributionStore.ts';
import { V2_CONFIG, ADX_THRESHOLDS } from '../v2/engine/config.ts';
import { runBacktest } from '../v2/backtest/backtestEngine.ts';
import type { BacktestConfig, BacktestResult } from '../v2/backtest/types.ts';

const CAD10 = [...V2_CONFIG.SCAN_TICKERS];
const MIN_ADX = ADX_THRESHOLDS.TREND_MIN;

type Snap = { regimes: readonly string[]; maxAtr: number };

function snap(): Snap {
  return { regimes: [...V2_CONFIG.ALLOWED_REGIMES], maxAtr: V2_CONFIG.MAX_ATR_PERCENT };
}

function restore(s: Snap): void {
  (V2_CONFIG as { ALLOWED_REGIMES: readonly string[] }).ALLOWED_REGIMES = s.regimes;
  (V2_CONFIG as { MAX_ATR_PERCENT: number }).MAX_ATR_PERCENT = s.maxAtr;
}

function summarize(result: BacktestResult) {
  const s = result.summary;
  if (result.trades.some((t) => t.holdBars < 0)) throw new Error('holdBars<0');
  const byRegime: Record<string, number> = {};
  for (const t of result.trades) {
    const k = String(t.entryRegime);
    byRegime[k] = (byRegime[k] ?? 0) + 1;
  }
  return {
    trades: s.totalTrades,
    winRate: Number(s.winRate.toFixed(4)),
    net: Number(s.totalPnlNet.toFixed(2)),
    pf: s.profitFactor === Infinity ? null : Number(s.profitFactor.toFixed(3)),
    zeroHoldStops: result.trades.filter((t) => t.exitReason === 'stop_loss' && t.holdBars === 0).length,
    byRegime,
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
  maxAtr: number;
  entryFilters: BacktestConfig['entryFilters'];
};

const ABLATIONS: Ablation[] = [
  {
    id: 'sc_chase_max25',
    label: 'STRONG_UP + bullish + chase + MAX2.5 + ADX20 (baseline)',
    maxAtr: 2.5,
    entryFilters: { confirmMode: 'bullish_close', maxSignalCloseLocation: 0.8, minAdx: MIN_ADX },
  },
  {
    id: 'sc_no_chase_max25',
    label: 'STRONG_UP + bullish + MAX2.5 + ADX20 (no chase)',
    maxAtr: 2.5,
    entryFilters: { confirmMode: 'bullish_close', minAdx: MIN_ADX },
  },
  {
    id: 'sc_chase_max30',
    label: 'STRONG_UP + bullish + chase + MAX3.0 + ADX20',
    maxAtr: 3.0,
    entryFilters: { confirmMode: 'bullish_close', maxSignalCloseLocation: 0.8, minAdx: MIN_ADX },
  },
  {
    id: 'sc_chase_max80',
    label: 'STRONG_UP + bullish + chase + MAX8 + ADX20',
    maxAtr: 8,
    entryFilters: { confirmMode: 'bullish_close', maxSignalCloseLocation: 0.8, minAdx: MIN_ADX },
  },
  {
    id: 'sc_no_chase_max80',
    label: 'STRONG_UP + bullish + MAX8 + ADX20 (no chase)',
    maxAtr: 8,
    entryFilters: { confirmMode: 'bullish_close', minAdx: MIN_ADX },
  },
  {
    id: 'sc_chase085_max25',
    label: 'STRONG_UP + bullish + chase≤0.85 + MAX2.5 + ADX20',
    maxAtr: 2.5,
    entryFilters: { confirmMode: 'bullish_close', maxSignalCloseLocation: 0.85, minAdx: MIN_ADX },
  },
  {
    id: 'sc_above_chase_max25',
    label: 'STRONG_UP + close_above + chase + MAX2.5 + ADX20',
    maxAtr: 2.5,
    entryFilters: { confirmMode: 'close_above_signal', maxSignalCloseLocation: 0.8, minAdx: MIN_ADX },
  },
];

async function runWindow(label: string, days: number, end: Date, ab: Ablation) {
  const baseline = snap();
  try {
    (V2_CONFIG as { ALLOWED_REGIMES: readonly string[] }).ALLOWED_REGIMES = ['STRONG_UP'];
    (V2_CONFIG as { MAX_ATR_PERCENT: number }).MAX_ATR_PERCENT = ab.maxAtr;
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
  const endEarlier60 = new Date(endRecent.getTime() - 60 * 86400000);

  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  STRONG_UP + confirm + ADX20 family (robust 90/45)      ║');
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

  // Stress best positive / highest OOS PF on 60/60 even if n-starved on 90/45
  const ranked = [...rows].sort((a, b) => (b.oos45.pf ?? 0) - (a.oos45.pf ?? 0));
  const best = ranked[0]!;
  const bestAb = ABLATIONS.find((a) => a.id === best.id)!;
  const earlier60 = await runWindow(`${best.id}/earlier60`, 60, endEarlier60, bestAb);
  const oos60 = await runWindow(`${best.id}/oos60`, 60, endRecent, bestAb);

  const out = {
    generatedAt: new Date().toISOString(),
    hypothesis:
      'STRONG_UP+confirm+ADX20 is PF-positive but n-starved; relaxing chase/MAX_ATR within STRONG_UP may clear n≥10 without repeating UP+ADX20 failure.',
    protocol: {
      windows: '90d earlier / 45d OOS (+60/60 stress on best OOS PF)',
      promotionBar: 'OOS PF>1.1 & net>0 & earlier PF>=0.9 & earlier n>=10',
      fixed: `regimes=STRONG_UP only, minAdx=${MIN_ADX}`,
    },
    rows,
    anyPromote: rows.some((r) => r.meetsPromotionBar),
    stressBest: {
      id: best.id,
      split_60_60: {
        earlier: earlier60,
        oos: oos60,
        pass: meetsBar(oos60, earlier60),
      },
    },
  };
  writeFileSync('/opt/cursor/artifacts/edge-strong-confirm-adx20-9045.json', JSON.stringify(out, null, 2));
  writeFileSync('/cursor/stores/self/artifacts/edge-strong-confirm-adx20-9045.json', JSON.stringify(out, null, 2));
  console.log(`\nWrote edge-strong-confirm-adx20-9045.json anyPromote=${out.anyPromote} stress60=${out.stressBest.split_60_60.pass}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
