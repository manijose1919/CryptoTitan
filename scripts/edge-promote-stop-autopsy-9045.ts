#!/usr/bin/env node
/**
 * Stop-loss autopsy under full promote stack (research only).
 * Ask: do remaining stop_loss trades share signal-bar features we can gate
 * without killing dual-split n/PF?
 *
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
import { setSignalWeightMode } from '../v2/pipeline/signalGenerator.ts';
import { TIME_GATE_CONFIG } from '../v2/pipeline/timeGate.ts';
import { runBacktest } from '../v2/backtest/backtestEngine.ts';
import type { BacktestConfig, BacktestTrade } from '../v2/backtest/types.ts';
import { writeResearchArtifact } from './researchArtifactWrite.ts';

const CAD10 = [...V2_CONFIG.SCAN_TICKERS];
const FILTERS: BacktestConfig['entryFilters'] = {
  confirmMode: 'bullish_close',
  maxSignalCloseLocation: 0.85,
  minAdx: ADX_THRESHOLDS.TREND_MIN,
  minSignalAtrPercent: 1.5,
  confirmMomentum: true,
};

function feat(t: BacktestTrade) {
  const s = (t.entrySignals ?? {}) as Record<string, unknown>;
  const num = (k: string) => (typeof s[k] === 'number' ? (s[k] as number) : null);
  return {
    ticker: t.ticker,
    entryTime: t.entryTime,
    entryHourUtc: new Date(t.entryTime).getUTCHours(),
    holdBars: t.holdBars,
    pnlNet: t.pnlNet != null ? Number(t.pnlNet.toFixed(2)) : null,
    confidence: t.entryConfidence,
    score: t.compositeScore,
    atrPercent: t.atrPercent,
    close_location: num('close_location'),
    volume_ratio: num('volume_ratio'),
    range_atr: num('range_atr') ?? (num('bar_range_atr') as number | null),
    adx: num('adx'),
    rsi: num('rsi'),
    bb_position: num('bb_position'),
    exitReason: t.exitReason,
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
  console.log(`>>> ${label} ${startDate.toISOString().slice(0, 10)}→${end.toISOString().slice(0, 10)}`);
  const r = await runBacktest(config);
  const closed = r.trades.filter((t) => t.pnlNet != null);
  const stops = closed.filter((t) => t.exitReason === 'stop_loss').map(feat);
  const others = closed.filter((t) => t.exitReason !== 'stop_loss').map(feat);
  console.log(`    n=${closed.length} stops=${stops.length} other=${others.length}`);
  return {
    label,
    n: closed.length,
    net: Number(closed.reduce((a, t) => a + (t.pnlNet ?? 0), 0).toFixed(2)),
    stops,
    others,
  };
}

function mean(xs: (number | null | undefined)[]): number | null {
  const v = xs.filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
  if (!v.length) return null;
  return Number((v.reduce((a, b) => a + b, 0) / v.length).toFixed(4));
}

function compare(stops: ReturnType<typeof feat>[], others: ReturnType<typeof feat>[]) {
  const keys = ['confidence', 'score', 'atrPercent', 'close_location', 'volume_ratio', 'adx', 'rsi', 'bb_position', 'holdBars'] as const;
  const out: Record<string, { stopMean: number | null; otherMean: number | null; stopN: number; otherN: number }> = {};
  for (const k of keys) {
    const s = stops.map((t) => t[k] as number | null);
    const o = others.map((t) => t[k] as number | null);
    out[k] = {
      stopMean: mean(s),
      otherMean: mean(o),
      stopN: s.filter((x) => typeof x === 'number').length,
      otherN: o.filter((x) => typeof x === 'number').length,
    };
  }
  return out;
}

async function main(): Promise<void> {
  initializeDatabase();
  initV2Tables();
  (V2_CONFIG as { ALLOWED_REGIMES: readonly string[] }).ALLOWED_REGIMES = ['STRONG_UP'];
  (V2_CONFIG as { MAX_ATR_PERCENT: number }).MAX_ATR_PERCENT = 2.5;
  (V2_CONFIG as { MIN_CONFIDENCE: number }).MIN_CONFIDENCE = 0.6;
  (V2_CONFIG as { MAX_SIGNAL_CLOSE_LOCATION: number }).MAX_SIGNAL_CLOSE_LOCATION = 0.85;
  (TIME_GATE_CONFIG as { BLOCKED_HOURS: readonly number[] }).BLOCKED_HOURS = [13, 20];
  (STRATEGY_EXIT_CONFIGS.TREND as { timeKillBars: number }).timeKillBars = 4;
  (MOMENTUM_CONFIG as { ENABLED: boolean }).ENABLED = true;
  setSignalWeightMode('static');

  const end = new Date();
  end.setUTCHours(0, 0, 0, 0);
  // Full 150d window covering stress OOS stops + earlier
  const win = await run(150, end, 'last150');

  const out = {
    generatedAt: new Date().toISOString(),
    purpose: 'Feature contrast stop_loss vs non-stop under promote stack',
    stack:
      'STRONG_UP + confirm + chase0.85 + MAX2.5 + minATR1.5 + ADX20 + confirmMomentum + no_overnight + conf0.60 + tk4',
    window: win,
    contrast: compare(win.stops, win.others),
    stopTickers: win.stops.reduce((m: Record<string, number>, t) => {
      m[t.ticker] = (m[t.ticker] ?? 0) + 1;
      return m;
    }, {}),
  };
  const paths = writeResearchArtifact('edge-promote-stop-autopsy-9045.json', JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ written: paths, stopN: win.stops.length, contrast: out.contrast, stops: win.stops }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
