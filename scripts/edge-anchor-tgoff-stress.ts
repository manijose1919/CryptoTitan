#!/usr/bin/env node
/**
 * Stress: anchor quality package + TimeGate fully off (60/60 + 90/45).
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

async function run(days: number, end: Date, label: string) {
  const startDate = new Date(end.getTime() - days * 86400000);
  const config: BacktestConfig = {
    startDate, endDate: end, tickers: CAD10, budgetPerTicker: 1000,
    interval: '4h', intervalMinutes: 240,
    maxOpenPositions: V2_CONFIG.MAX_OPEN_POSITIONS,
    feeRoundTrip: V2_CONFIG.FEE_ROUND_TRIP_TAKER,
    slippagePerSide: V2_CONFIG.PAPER_SLIPPAGE_PER_SIDE,
    barSequence: 'pessimistic',
    entryFilters: {
      confirmMode: 'bullish_close', maxSignalCloseLocation: 0.75,
      minAdx: MIN_ADX, minSignalAtrPercent: 1.5, confirmMomentum: true,
      maxSignalRangeAtrMult: 2.0,
    },
    seed: false,
  };
  console.log(`>>> ${label} ${startDate.toISOString().slice(0,10)}→${end.toISOString().slice(0,10)}`);
  const r = await runBacktest(config);
  const s = r.summary;
  const out = { trades: s.totalTrades, net: Number(s.totalPnlNet.toFixed(2)), pf: s.profitFactor === Infinity ? null : Number(s.profitFactor.toFixed(3)), winRate: Number(s.winRate.toFixed(4)) };
  console.log(`    n=${out.trades} PF=${out.pf} net=$${out.net}`);
  return out;
}

async function main() {
  mkdirSync('/opt/cursor/artifacts', { recursive: true });
  initializeDatabase(); initV2Tables();
  (V2_CONFIG as { ALLOWED_REGIMES: readonly string[] }).ALLOWED_REGIMES = ['STRONG_UP'];
  (V2_CONFIG as { MAX_ATR_PERCENT: number }).MAX_ATR_PERCENT = 2.5;
  (MOMENTUM_CONFIG as { ENABLED: boolean }).ENABLED = true;
  (V2_CONFIG as { MIN_CONFIDENCE: number }).MIN_CONFIDENCE = 0.55;
  (TIME_GATE_CONFIG as { ENABLED: boolean }).ENABLED = false;

  const end = new Date(); end.setUTCHours(0,0,0,0);
  const end60 = new Date(end.getTime() - 60 * 86400000);
  const earlier60 = await run(60, end60, 'earlier60');
  const oos60 = await run(60, end, 'oos60');
  const end45 = new Date(end.getTime() - 45 * 86400000);
  const earlier90 = await run(90, end45, 'earlier90');
  const oos45 = await run(45, end, 'oos45');
  const meets = (oos: { pf: number | null; net: number }, earlier: { pf: number | null; trades: number }) =>
    (oos.pf ?? 0) > 1.1 && oos.net > 0 && (earlier.pf ?? 0) >= 0.9 && earlier.trades >= 10;
  const out = {
    generatedAt: new Date().toISOString(),
    candidate: 'anchor conf0.55 chase0.75 range2 + TIME_GATE off',
    split_60_60: { earlier: earlier60, oos: oos60, pass: meets(oos60, earlier60) },
    split_90_45: { earlier: earlier90, oos: oos45, pass: meets(oos45, earlier90) },
  };
  writeFileSync('/opt/cursor/artifacts/edge-anchor-tgoff-stress.json', JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });
