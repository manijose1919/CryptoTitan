#!/usr/bin/env node
/**
 * Entry-feature autopsy under locked stack (research).
 * Compare signal features on earlier90 losers vs oos45 winners to find
 * tighten-only thresholds (no regime/ATR loosen).
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { initializeDatabase } from '../services/database.js';
import { initV2Tables } from '../v2/attribution/attributionStore.ts';
import { V2_CONFIG, MOMENTUM_CONFIG, ADX_THRESHOLDS } from '../v2/engine/config.ts';
import { runBacktest } from '../v2/backtest/backtestEngine.ts';
import type { BacktestConfig, BacktestTrade } from '../v2/backtest/types.ts';

const CAD10 = [...V2_CONFIG.SCAN_TICKERS];
const FILTERS: BacktestConfig['entryFilters'] = {
  confirmMode: 'bullish_close',
  maxSignalCloseLocation: 0.8,
  minAdx: ADX_THRESHOLDS.TREND_MIN,
  minSignalAtrPercent: 1.5,
  confirmMomentum: true,
};

const FEATURES = [
  'rsi', 'atr_percent', 'volume_ratio', 'bb_percent_b', 'bb_width',
  'trend_strength', 'price_vs_ema50', 'tc_value', 'td_score',
  'sr_channel_position', 'macd_histogram',
] as const;

function feat(t: BacktestTrade) {
  const s = t.entrySignals as Record<string, unknown>;
  const out: Record<string, number | null> = {
    confidence: t.entryConfidence,
    score: t.compositeScore,
    atrPercent: t.atrPercent,
    holdBars: t.holdBars,
  };
  for (const k of FEATURES) {
    const v = s?.[k];
    out[k] = typeof v === 'number' ? Number(v.toFixed(4)) : null;
  }
  return out;
}

function row(t: BacktestTrade) {
  return {
    id: t.id,
    ticker: t.ticker,
    pnlNet: t.pnlNet != null ? Number(t.pnlNet.toFixed(2)) : null,
    exitReason: t.exitReason,
    entryTime: t.entryTime,
    ...feat(t),
  };
}

function stats(rows: ReturnType<typeof row>[], key: string) {
  const vals = rows.map((r) => r[key as keyof typeof r]).filter((v): v is number => typeof v === 'number');
  if (!vals.length) return null;
  const sorted = [...vals].sort((a, b) => a - b);
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  return {
    n: vals.length,
    mean: Number(mean.toFixed(4)),
    min: sorted[0],
    p50: sorted[Math.floor(sorted.length / 2)],
    max: sorted[sorted.length - 1],
  };
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
  console.log(`>>> ${label}`);
  const r = await runBacktest(config);
  const closed = r.trades.filter((t) => t.pnlNet != null).map(row);
  const wins = closed.filter((t) => (t.pnlNet ?? 0) > 0);
  const losses = closed.filter((t) => (t.pnlNet ?? 0) <= 0);
  console.log(`  n=${closed.length} W=${wins.length} L=${losses.length}`);
  return { closed, wins, losses };
}

async function main(): Promise<void> {
  mkdirSync('/opt/cursor/artifacts', { recursive: true });
  mkdirSync('/cursor/stores/self/artifacts', { recursive: true });
  initializeDatabase();
  initV2Tables();
  (V2_CONFIG as { ALLOWED_REGIMES: readonly string[] }).ALLOWED_REGIMES = ['STRONG_UP'];
  (V2_CONFIG as { MAX_ATR_PERCENT: number }).MAX_ATR_PERCENT = 2.5;
  (MOMENTUM_CONFIG as { ENABLED: boolean }).ENABLED = true;

  const end = new Date();
  end.setUTCHours(0, 0, 0, 0);
  const end45 = new Date(end.getTime() - 45 * 86400000);

  const earlier90 = await run(90, end45, 'earlier90');
  const oos45 = await run(45, end, 'oos45');

  const keys = ['confidence', 'score', 'atrPercent', 'holdBars', ...FEATURES];
  const compare: Record<string, unknown> = {};
  for (const k of keys) {
    compare[k] = {
      earlierLosses: stats(earlier90.losses, k),
      earlierWins: stats(earlier90.wins, k),
      oosWins: stats(oos45.wins, k),
      oosLosses: stats(oos45.losses, k),
    };
  }

  const out = {
    generatedAt: new Date().toISOString(),
    purpose: 'Feature gaps: earlier90 losers vs oos45 winners under locked stack',
    earlier90: { trades: earlier90.closed, wins: earlier90.wins.length, losses: earlier90.losses.length },
    oos45: { trades: oos45.closed, wins: oos45.wins.length, losses: oos45.losses.length },
    featureCompare: compare,
  };
  writeFileSync('/opt/cursor/artifacts/edge-entry-feature-autopsy-9045.json', JSON.stringify(out, null, 2));
  writeFileSync('/cursor/stores/self/artifacts/edge-entry-feature-autopsy-9045.json', JSON.stringify(out, null, 2));

  console.log('\nFeature compare (mean):');
  for (const k of keys) {
    const c = compare[k] as { earlierLosses: { mean: number } | null; oosWins: { mean: number } | null };
    if (!c.earlierLosses || !c.oosWins) continue;
    const gap = c.oosWins.mean - c.earlierLosses.mean;
    console.log(`  ${k}: earlierL=${c.earlierLosses.mean} oosW=${c.oosWins.mean} gap=${gap.toFixed(4)}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
