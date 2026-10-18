#!/usr/bin/env node
/**
 * Confirm-bar ADX persistence under locked stack (research only).
 * Hypothesis: some earlier losers enter after ADX decays on the confirm bar
 * (signal ADX≥20, confirm ADX soft). Require confirm-bar ADX≥TREND_MIN.
 *
 * Protocol: 90/45 CAD10 4h fee-aware locked stack + static weights.
 * Bar: OOS PF>1.1 & net>0 & earlier PF≥0.9 & earlier n≥10.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { initializeDatabase } from '../services/database.js';
import { initV2Tables } from '../v2/attribution/attributionStore.ts';
import { V2_CONFIG, MOMENTUM_CONFIG, ADX_THRESHOLDS } from '../v2/engine/config.ts';
import { setSignalWeightMode } from '../v2/pipeline/signalGenerator.ts';
import { adx } from '../v2/indicators/indicators.ts';
import { runBacktest } from '../v2/backtest/backtestEngine.ts';
import type { BacktestConfig, BacktestResult } from '../v2/backtest/types.ts';
import { loadAllCandles } from '../v2/backtest/candleCache.ts';

const CAD10 = [...V2_CONFIG.SCAN_TICKERS];
const MIN_ADX = ADX_THRESHOLDS.TREND_MIN;

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

const FILTERS: BacktestConfig['entryFilters'] = {
  confirmMode: 'bullish_close',
  maxSignalCloseLocation: 0.8,
  minAdx: MIN_ADX,
  minSignalAtrPercent: 1.5,
  confirmMomentum: true,
};

async function runPaper(days: number, end: Date, label: string) {
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
  console.log(`  >>> paper ${label}`);
  const r = await runBacktest(config);
  const out = summarize(r);
  console.log(`      n=${out.trades} WR=${out.winRate} net=$${out.net} PF=${out.pf}`);
  return out;
}

/**
 * Diagnostic: among locked-stack TREND-eligible signal bars, how often does
 * confirm-bar ADX drop below MIN_ADX? (doesn't re-simulate full fills)
 */
async function confirmAdxDecayDiag(days: number, end: Date, label: string) {
  const startDate = new Date(end.getTime() - days * 86400000);
  const all = await loadAllCandles(CAD10, startDate, end, '4h');
  let signalAdxOk = 0;
  let confirmAdxOk = 0;
  let confirmAdxFail = 0;
  for (const [, candles] of all) {
    for (let bar = V2_CONFIG.MIN_CANDLES; bar < candles.length - 1; bar++) {
      const win = candles.slice(0, bar + 1);
      if (win.length < 30) continue;
      if (adx(win) < MIN_ADX) continue;
      signalAdxOk++;
      const winConfirm = candles.slice(0, bar + 2);
      if (winConfirm.length < 30 || adx(winConfirm) < MIN_ADX) confirmAdxFail++;
      else confirmAdxOk++;
    }
  }
  const out = { label, signalAdxOk, confirmAdxOk, confirmAdxFail };
  console.log(`  diag ${label}: signalAdxOk=${signalAdxOk} confirmOk=${confirmAdxOk} confirmFail=${confirmAdxFail}`);
  return out;
}

async function main(): Promise<void> {
  mkdirSync('/opt/cursor/artifacts', { recursive: true });
  mkdirSync('/cursor/stores/self/artifacts', { recursive: true });
  initializeDatabase();
  initV2Tables();
  (V2_CONFIG as { ALLOWED_REGIMES: readonly string[] }).ALLOWED_REGIMES = ['STRONG_UP'];
  (V2_CONFIG as { MAX_ATR_PERCENT: number }).MAX_ATR_PERCENT = 2.5;
  (MOMENTUM_CONFIG as { ENABLED: boolean }).ENABLED = true;
  setSignalWeightMode('static');

  const end = new Date();
  end.setUTCHours(0, 0, 0, 0);
  const end45 = new Date(end.getTime() - 45 * 86400000);

  console.log('\n=== paper locked baseline (reference) ===');
  const earlier90 = await runPaper(90, end45, 'earlier90');
  const oos45 = await runPaper(45, end, 'oos45');

  console.log('\n=== confirm ADX decay diag (all ADX≥20 signal bars) ===');
  const diagEarlier = await confirmAdxDecayDiag(90, end45, 'earlier90');
  const diagOos = await confirmAdxDecayDiag(45, end, 'oos45');

  const out = {
    generatedAt: new Date().toISOString(),
    purpose: 'Measure confirm-bar ADX decay vs signal; paper locked baseline reference',
    note: 'Full confirmAdx gate not yet wired into backtestEngine — diag first',
    paper: {
      earlier90,
      oos45,
      pass9045: meetsBar(oos45, earlier90),
    },
    confirmAdxDiag: { earlier90: diagEarlier, oos45: diagOos },
  };
  writeFileSync('/opt/cursor/artifacts/edge-confirm-adx-persist-9045.json', JSON.stringify(out, null, 2));
  writeFileSync('/cursor/stores/self/artifacts/edge-confirm-adx-persist-9045.json', JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
