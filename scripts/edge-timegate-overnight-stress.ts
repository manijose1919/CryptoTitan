#!/usr/bin/env node
/**
 * 60/60 stress for no-overnight TimeGate under ADX20+confirm (research→promote).
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { initializeDatabase } from '../services/database.js';
import { initV2Tables } from '../v2/attribution/attributionStore.ts';
import { V2_CONFIG, MOMENTUM_CONFIG, ADX_THRESHOLDS } from '../v2/engine/config.ts';
import { runBacktest } from '../v2/backtest/backtestEngine.ts';
import type { BacktestConfig } from '../v2/backtest/types.ts';
import { TIME_GATE_CONFIG } from '../v2/pipeline/timeGate.ts';

const CAD10 = [...V2_CONFIG.SCAN_TICKERS];
const MIN_ADX = ADX_THRESHOLDS.TREND_MIN;
const FILTERS = {
  confirmMode: 'bullish_close' as const,
  maxSignalCloseLocation: 0.8,
  minAdx: MIN_ADX,
  minSignalAtrPercent: 1.5,
  confirmMomentum: true,
};

function meetsBar(oos: any, earlier: any) {
  return (oos.pf ?? 0) > 1.1 && oos.net > 0 && (earlier.pf ?? 0) >= 0.9 && earlier.trades >= 10;
}

async function run(days: number, end: Date) {
  const startDate = new Date(end.getTime() - days * 86400000);
  const config: BacktestConfig = {
    startDate, endDate: end, tickers: CAD10, budgetPerTicker: 1000,
    interval: '4h', intervalMinutes: 240,
    maxOpenPositions: V2_CONFIG.MAX_OPEN_POSITIONS,
    feeRoundTrip: V2_CONFIG.FEE_ROUND_TRIP_TAKER,
    slippagePerSide: V2_CONFIG.PAPER_SLIPPAGE_PER_SIDE,
    barSequence: 'pessimistic', entryFilters: FILTERS, seed: false,
  };
  console.log(`>>> ${startDate.toISOString().slice(0,10)}→${end.toISOString().slice(0,10)}`);
  const r = await runBacktest(config);
  const s = r.summary;
  const out = {
    trades: s.totalTrades,
    net: Number(s.totalPnlNet.toFixed(2)),
    pf: s.profitFactor === Infinity ? null : Number(s.profitFactor.toFixed(3)),
    winRate: Number(s.winRate.toFixed(4)),
  };
  console.log(`    n=${out.trades} PF=${out.pf} net=$${out.net}`);
  return out;
}

async function main() {
  mkdirSync('/opt/cursor/artifacts', { recursive: true });
  initializeDatabase(); initV2Tables();
  (V2_CONFIG as any).ALLOWED_REGIMES = ['STRONG_UP'];
  (V2_CONFIG as any).MAX_ATR_PERCENT = 2.5;
  (MOMENTUM_CONFIG as any).ENABLED = true;
  // Candidate: unblock overnight 0-7; keep 13/20 + Friday
  (TIME_GATE_CONFIG as any).BLOCKED_HOURS = [13, 20];

  const end = new Date(); end.setUTCHours(0,0,0,0);
  const end60 = new Date(end.getTime() - 60 * 86400000);
  const earlier60 = await run(60, end60);
  const oos60 = await run(60, end);
  const end45 = new Date(end.getTime() - 45 * 86400000);
  const earlier90 = await run(90, end45);
  const oos45 = await run(45, end);

  const out = {
    generatedAt: new Date().toISOString(),
    candidate: 'BLOCKED_HOURS=[13,20] (drop 0-7 overnight); Friday kept; ADX20+confirmMomentum stack',
    split_60_60: { earlier: earlier60, oos: oos60, pass: meetsBar(oos60, earlier60) },
    split_90_45: { earlier: earlier90, oos: oos45, pass: meetsBar(oos45, earlier90) },
  };
  writeFileSync('/opt/cursor/artifacts/edge-timegate-overnight-stress.json', JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });
