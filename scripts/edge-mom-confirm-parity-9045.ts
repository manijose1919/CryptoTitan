#!/usr/bin/env node
/**
 * MOMENTUM confirm parity under STRONG_UP+ADX20 paper stack (research only).
 *
 * Question: should paper wire pending-confirm for MOMENTUM (today TREND-only)?
 * Compare paper-live (MOM next-bar) vs confirmMomentum=true under same stack.
 *
 * Usage:
 *   DATA_DIR=/tmp/cryptotitan-edge-research \
 *     node --experimental-strip-types scripts/edge-mom-confirm-parity-9045.ts
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { initializeDatabase } from '../services/database.js';
import { initV2Tables } from '../v2/attribution/attributionStore.ts';
import { V2_CONFIG, MOMENTUM_CONFIG, ADX_THRESHOLDS } from '../v2/engine/config.ts';
import { runBacktest } from '../v2/backtest/backtestEngine.ts';
import type { BacktestConfig, BacktestResult } from '../v2/backtest/types.ts';

const CAD10 = [...V2_CONFIG.SCAN_TICKERS];
const MIN_ADX = ADX_THRESHOLDS.TREND_MIN;

type Snap = { regimes: readonly string[]; maxAtr: number; momEnabled: boolean };

function snap(): Snap {
  return {
    regimes: [...V2_CONFIG.ALLOWED_REGIMES],
    maxAtr: V2_CONFIG.MAX_ATR_PERCENT,
    momEnabled: MOMENTUM_CONFIG.ENABLED,
  };
}

function restore(s: Snap): void {
  (V2_CONFIG as { ALLOWED_REGIMES: readonly string[] }).ALLOWED_REGIMES = s.regimes;
  (V2_CONFIG as { MAX_ATR_PERCENT: number }).MAX_ATR_PERCENT = s.maxAtr;
  (MOMENTUM_CONFIG as { ENABLED: boolean }).ENABLED = s.momEnabled;
}

function summarize(result: BacktestResult) {
  const s = result.summary;
  if (result.trades.some((t) => t.holdBars < 0)) throw new Error('holdBars<0');
  return {
    trades: s.totalTrades,
    winRate: Number(s.winRate.toFixed(4)),
    net: Number(s.totalPnlNet.toFixed(2)),
    pf: s.profitFactor === Infinity ? null : Number(s.profitFactor.toFixed(3)),
    zeroHoldStops: result.trades.filter((t) => t.exitReason === 'stop_loss' && t.holdBars === 0).length,
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
  entryFilters: BacktestConfig['entryFilters'];
};

const ABLATIONS: Ablation[] = [
  {
    id: 'paper_mom_nextbar',
    label: 'Paper today: TREND confirm; MOMENTUM next-bar (ADX20)',
    entryFilters: {
      confirmMode: 'bullish_close',
      maxSignalCloseLocation: 0.8,
      minAdx: MIN_ADX,
      minSignalAtrPercent: 1.5,
    },
  },
  {
    id: 'mom_confirm_parity',
    label: 'Proposed: MOMENTUM also confirm T+2 (confirmMomentum)',
    entryFilters: {
      confirmMode: 'bullish_close',
      maxSignalCloseLocation: 0.8,
      minAdx: MIN_ADX,
      minSignalAtrPercent: 1.5,
      confirmMomentum: true,
    },
  },
  {
    id: 'mom_off',
    label: 'Control: MOMENTUM disabled',
    entryFilters: {
      confirmMode: 'bullish_close',
      maxSignalCloseLocation: 0.8,
      minAdx: MIN_ADX,
      minSignalAtrPercent: 1.5,
    },
  },
];

async function runWindow(label: string, days: number, end: Date, ab: Ablation, momOn: boolean) {
  const baseline = snap();
  try {
    (V2_CONFIG as { ALLOWED_REGIMES: readonly string[] }).ALLOWED_REGIMES = ['STRONG_UP'];
    (V2_CONFIG as { MAX_ATR_PERCENT: number }).MAX_ATR_PERCENT = 2.5;
    (MOMENTUM_CONFIG as { ENABLED: boolean }).ENABLED = momOn;
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
    console.log(`\n>>> ${label} | mom=${momOn} | ${startDate.toISOString().slice(0, 10)}→${end.toISOString().slice(0, 10)}`);
    const result = await runBacktest(config);
    const summary = summarize(result);
    console.log(
      `    trades=${summary.trades} WR=${(summary.winRate * 100).toFixed(1)}% net=$${summary.net} PF=${summary.pf}`,
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
  console.log('║  MOMENTUM confirm parity under ADX20 stack (90/45)     ║');
  console.log('╚══════════════════════════════════════════════════════════╝');

  const rows = [];
  for (const ab of ABLATIONS) {
    const momOn = ab.id !== 'mom_off';
    const earlier = await runWindow(`${ab.id}/earlier90`, 90, endEarlier90, ab, momOn);
    const oos = await runWindow(`${ab.id}/oos45`, 45, endRecent, ab, momOn);
    const row = {
      id: ab.id,
      label: ab.label,
      earlier90: earlier,
      oos45: oos,
      meetsPromotionBar: meetsBar(oos, earlier),
    };
    rows.push(row);
    console.log(
      `== ${ab.id}: pass=${row.meetsPromotionBar} | OOS PF=${oos.pf} n=${oos.trades} | earlier PF=${earlier.pf} n=${earlier.trades}`,
    );
  }

  const out = {
    generatedAt: new Date().toISOString(),
    hypothesis:
      'Wiring pending-confirm for MOMENTUM may cut contaminated-style next-bar fills; measure vs paper next-bar under ADX20.',
    protocol: {
      windows: '90d earlier / 45d OOS',
      promotionBar: 'OOS PF>1.1 & net>0 & earlier PF>=0.9 & earlier n>=10',
      fixed: 'STRONG_UP MAX2.5 minAdx=20 chase0.8 minATR1.5',
    },
    rows,
    anyPromote: rows.some((r) => r.meetsPromotionBar),
  };
  writeFileSync('/opt/cursor/artifacts/edge-mom-confirm-parity-9045.json', JSON.stringify(out, null, 2));
  writeFileSync('/cursor/stores/self/artifacts/edge-mom-confirm-parity-9045.json', JSON.stringify(out, null, 2));
  console.log(`\nWrote edge-mom-confirm-parity-9045.json anyPromote=${out.anyPromote}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
