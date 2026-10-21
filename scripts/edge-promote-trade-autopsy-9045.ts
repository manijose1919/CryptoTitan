#!/usr/bin/env node
/**
 * Trade autopsy for the 2026-10-21 promote package:
 *   no_overnight (BLOCKED_HOURS=[13,20]) + MIN_CONFIDENCE=0.60 + chase≤0.85
 * under locked STRONG_UP+confirm+MAX2.5+minATR1.5+ADX20+confirmMomentum.
 *
 * Asks: where do losses concentrate (UTC hour / overnight vs day / exit / conf)?
 * Protocol: 90/45 + 60/60. Prefer DATA_DIR=/tmp/cryptotitan-edge-research.
 */
import { initializeDatabase } from '../services/database.js';
import { initV2Tables } from '../v2/attribution/attributionStore.ts';
import { V2_CONFIG, MOMENTUM_CONFIG, ADX_THRESHOLDS } from '../v2/engine/config.ts';
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

function hourUtc(ms: number): number {
  return new Date(ms).getUTCHours();
}

function bucketHour(h: number): 'overnight_0_7' | 'day_8_12' | 'blocked_13' | 'day_14_19' | 'blocked_20' | 'eve_21_23' {
  if (h <= 7) return 'overnight_0_7';
  if (h <= 12) return 'day_8_12';
  if (h === 13) return 'blocked_13';
  if (h <= 19) return 'day_14_19';
  if (h === 20) return 'blocked_20';
  return 'eve_21_23';
}

function confBand(c: number): string {
  if (c < 0.6) return 'lt_0.60';
  if (c < 0.65) return '0.60_0.64';
  if (c < 0.7) return '0.65_0.69';
  return 'ge_0.70';
}

function agg(trades: BacktestTrade[], keyFn: (t: BacktestTrade) => string) {
  const m: Record<string, { n: number; wins: number; pnl: number }> = {};
  for (const t of trades) {
    const k = keyFn(t);
    if (!m[k]) m[k] = { n: 0, wins: 0, pnl: 0 };
    m[k].n++;
    if ((t.pnlNet ?? 0) > 0) m[k].wins++;
    m[k].pnl += t.pnlNet ?? 0;
  }
  const out: Record<string, { n: number; wr: number; pnl: number }> = {};
  for (const [k, v] of Object.entries(m)) {
    out[k] = { n: v.n, wr: Number((v.wins / v.n).toFixed(3)), pnl: Number(v.pnl.toFixed(2)) };
  }
  return out;
}

function row(t: BacktestTrade) {
  const sig = t.entrySignals as Record<string, unknown> | undefined;
  const h = hourUtc(t.entryTime);
  return {
    ticker: t.ticker,
    entryTime: t.entryTime,
    entryHourUtc: h,
    hourBucket: bucketHour(h),
    holdBars: t.holdBars,
    exitReason: t.exitReason,
    pnlNet: t.pnlNet != null ? Number(t.pnlNet.toFixed(2)) : null,
    confidence: t.entryConfidence,
    confBand: confBand(t.entryConfidence),
    score: t.compositeScore,
    closeLocation: typeof sig?.close_location === 'number' ? sig.close_location : null,
    atrPercent: t.atrPercent,
  };
}

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
    entryFilters: { ...FILTERS },
    seed: false,
  };
  console.log(`>>> ${label} ${startDate.toISOString().slice(0, 10)}→${end.toISOString().slice(0, 10)}`);
  const r = await runBacktest(config);
  if (r.trades.some((t) => t.holdBars < 0)) throw new Error('holdBars<0');
  const closed = r.trades.filter((t) => t.pnlNet != null);
  const s = r.summary;
  const summary = {
    trades: s.totalTrades,
    winRate: Number(s.winRate.toFixed(4)),
    net: Number(s.totalPnlNet.toFixed(2)),
    pf: s.profitFactor === Infinity ? null : Number(s.profitFactor.toFixed(3)),
    byExit: agg(closed, (t) => t.exitReason ?? 'open'),
    byHourBucket: agg(closed, (t) => bucketHour(hourUtc(t.entryTime))),
    byConfBand: agg(closed, (t) => confBand(t.entryConfidence)),
    byTicker: agg(closed, (t) => t.ticker),
  };
  console.log(
    `    n=${summary.trades} WR=${summary.winRate} net=$${summary.net} PF=${summary.pf}`,
  );
  console.log(`    byHourBucket=${JSON.stringify(summary.byHourBucket)}`);
  console.log(`    byExit=${JSON.stringify(summary.byExit)}`);
  return { label, summary, trades: closed.map(row) };
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

  const out = {
    generatedAt: new Date().toISOString(),
    purpose: 'Autopsy promote package losses by hour/exit/conf after dual-split clear',
    stack:
      'STRONG_UP + confirm + chase0.85 + MAX2.5 + minATR1.5 + ADX20 + confirmMomentum + no_overnight + conf0.60',
    signalWeightMode: 'static',
    blockedHours: [...TIME_GATE_CONFIG.BLOCKED_HOURS],
    split_90_45: {
      earlier: await runWindow(90, end45, 'earlier90'),
      oos: await runWindow(45, end, 'oos45'),
    },
    split_60_60: {
      earlier: await runWindow(60, end60, 'earlier60'),
      oos: await runWindow(60, end, 'oos60'),
    },
  };

  const paths = writeResearchArtifact(
    'edge-promote-trade-autopsy-9045.json',
    JSON.stringify(out, null, 2),
  );
  console.log(JSON.stringify({
    written: paths,
    earlier90: out.split_90_45.earlier.summary,
    oos45: out.split_90_45.oos.summary,
    earlier60: out.split_60_60.earlier.summary,
    oos60: out.split_60_60.oos.summary,
  }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
