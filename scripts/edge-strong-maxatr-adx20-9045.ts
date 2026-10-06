#!/usr/bin/env node
/**
 * STRONG_UP + confirm + ADX≥20 with fine MAX_ATR grid (research only).
 *
 * Context: best ADX20 stack (STRONG_UP+confirm+chase+MAX2.5) is PF-positive
 * (earlier PF1.25 / OOS PF3.77) but n=6/7. Paper soak: ADAUSD STRONG_UP with
 * ATR%~2.66 rejected by MAX_ATR=2.5. Hypothesis: MAX_ATR 2.6–2.8 raises n≥10
 * without repeating MAX3.0 OOS collapse (PF0.57).
 *
 * Also probes minATR=1.0 and no-chase under the same ADX/STRONG_UP/confirm frame.
 * Protocol: 90/45 CAD10 4h 0.52% RT 5bps pessimistic; stress 60/60 on any pass.
 * Bar: OOS PF>1.1 & net>0 & earlier PF≥0.9 & earlier n≥10.
 *
 * Usage:
 *   DATA_DIR=/tmp/cryptotitan-edge-research \
 *     node --experimental-strip-types scripts/edge-strong-maxatr-adx20-9045.ts
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
    id: 'max25_chase',
    label: 'STRONG_UP+confirm+chase+MAX2.5+ADX20 (paper live)',
    maxAtr: 2.5,
    entryFilters: { confirmMode: 'bullish_close', maxSignalCloseLocation: 0.8, minAdx: MIN_ADX },
  },
  {
    id: 'max26_chase',
    label: 'STRONG_UP+confirm+chase+MAX2.6+ADX20 (covers ADA~2.66 near-miss)',
    maxAtr: 2.6,
    entryFilters: { confirmMode: 'bullish_close', maxSignalCloseLocation: 0.8, minAdx: MIN_ADX },
  },
  {
    id: 'max27_chase',
    label: 'STRONG_UP+confirm+chase+MAX2.7+ADX20',
    maxAtr: 2.7,
    entryFilters: { confirmMode: 'bullish_close', maxSignalCloseLocation: 0.8, minAdx: MIN_ADX },
  },
  {
    id: 'max275_chase',
    label: 'STRONG_UP+confirm+chase+MAX2.75+ADX20',
    maxAtr: 2.75,
    entryFilters: { confirmMode: 'bullish_close', maxSignalCloseLocation: 0.8, minAdx: MIN_ADX },
  },
  {
    id: 'max28_chase',
    label: 'STRONG_UP+confirm+chase+MAX2.8+ADX20',
    maxAtr: 2.8,
    entryFilters: { confirmMode: 'bullish_close', maxSignalCloseLocation: 0.8, minAdx: MIN_ADX },
  },
  {
    id: 'max26_no_chase',
    label: 'STRONG_UP+confirm+MAX2.6+ADX20 (no chase)',
    maxAtr: 2.6,
    entryFilters: { confirmMode: 'bullish_close', minAdx: MIN_ADX },
  },
  {
    id: 'max25_chase_minatr10',
    label: 'STRONG_UP+confirm+chase+MAX2.5+ADX20+minATR1.0',
    maxAtr: 2.5,
    entryFilters: {
      confirmMode: 'bullish_close',
      maxSignalCloseLocation: 0.8,
      minSignalAtrPercent: 1.0,
      minAdx: MIN_ADX,
    },
  },
  {
    id: 'max26_chase_minatr10',
    label: 'STRONG_UP+confirm+chase+MAX2.6+ADX20+minATR1.0',
    maxAtr: 2.6,
    entryFilters: {
      confirmMode: 'bullish_close',
      maxSignalCloseLocation: 0.8,
      minSignalAtrPercent: 1.0,
      minAdx: MIN_ADX,
    },
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
  console.log('║  STRONG_UP+confirm+ADX20 MAX_ATR grid (robust 90/45)    ║');
  console.log('╚══════════════════════════════════════════════════════════╝');

  const rows = [];
  for (const ab of ABLATIONS) {
    const earlier = await runWindow(`${ab.id}/earlier90`, 90, endEarlier90, ab);
    const oos = await runWindow(`${ab.id}/oos45`, 45, endRecent, ab);
    const row = {
      id: ab.id,
      label: ab.label,
      maxAtr: ab.maxAtr,
      entryFilters: ab.entryFilters,
      earlier90: earlier,
      oos45: oos,
      meetsPromotionBar: meetsBar(oos, earlier),
    };
    rows.push(row);
    console.log(
      `== ${ab.id}: pass=${row.meetsPromotionBar} | OOS PF=${oos.pf} net=$${oos.net} n=${oos.trades} | earlier PF=${earlier.pf} n=${earlier.trades}`,
    );
  }

  const promoters = rows.filter((r) => r.meetsPromotionBar);
  let stress = null;
  if (promoters.length > 0) {
    const best = promoters.sort((a, b) => (b.oos45.net) - (a.oos45.net))[0]!;
    const bestAb = ABLATIONS.find((a) => a.id === best.id)!;
    const earlier60 = await runWindow(`${best.id}/earlier60`, 60, endEarlier60, bestAb);
    const oos60 = await runWindow(`${best.id}/oos60`, 60, endRecent, bestAb);
    stress = {
      id: best.id,
      split_60_60: { earlier: earlier60, oos: oos60, pass: meetsBar(oos60, earlier60) },
    };
  }

  const out = {
    generatedAt: new Date().toISOString(),
    hypothesis:
      'Fine MAX_ATR grid (2.6–2.8) under STRONG_UP+confirm+ADX20 can clear n≥10 where MAX2.5 is n-starved and MAX3.0 collapses OOS; motivated by live ADA STRONG_UP ATR%~2.66.',
    protocol: {
      windows: '90d earlier / 45d OOS (+60/60 on any promote)',
      promotionBar: 'OOS PF>1.1 & net>0 & earlier PF>=0.9 & earlier n>=10',
      fixed: `regimes=STRONG_UP, confirm=bullish_close, minAdx=${MIN_ADX}`,
      feeRoundTrip: V2_CONFIG.FEE_ROUND_TRIP_TAKER,
      note: 'Paper soak 2026-10-06: ADAUSD STRONG_UP ATR%≈2.66 > max 2.5.',
    },
    rows,
    anyPromote: promoters.length > 0,
    promoters: promoters.map((r) => r.id),
    stress,
  };
  writeFileSync('/opt/cursor/artifacts/edge-strong-maxatr-adx20-9045.json', JSON.stringify(out, null, 2));
  writeFileSync('/cursor/stores/self/artifacts/edge-strong-maxatr-adx20-9045.json', JSON.stringify(out, null, 2));
  console.log(`\nWrote edge-strong-maxatr-adx20-9045.json anyPromote=${out.anyPromote} promoters=${JSON.stringify(out.promoters)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
