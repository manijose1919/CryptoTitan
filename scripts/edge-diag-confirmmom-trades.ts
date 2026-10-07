#!/usr/bin/env node
/**
 * List earlier90 trades for paper stack ± confirmMomentum (research autopsy).
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { initializeDatabase } from '../services/database.js';
import { initV2Tables } from '../v2/attribution/attributionStore.ts';
import { V2_CONFIG, MOMENTUM_CONFIG, ADX_THRESHOLDS } from '../v2/engine/config.ts';
import { runBacktest } from '../v2/backtest/backtestEngine.ts';
import type { BacktestConfig } from '../v2/backtest/types.ts';

const CAD10 = [...V2_CONFIG.SCAN_TICKERS];
const MIN_ADX = ADX_THRESHOLDS.TREND_MIN;

async function run(label: string, confirmMomentum: boolean) {
  const end = new Date();
  end.setUTCHours(0, 0, 0, 0);
  const endEarlier = new Date(end.getTime() - 45 * 86400000);
  const startDate = new Date(endEarlier.getTime() - 90 * 86400000);
  (V2_CONFIG as { ALLOWED_REGIMES: readonly string[] }).ALLOWED_REGIMES = ['STRONG_UP'];
  (V2_CONFIG as { MAX_ATR_PERCENT: number }).MAX_ATR_PERCENT = 2.5;
  (MOMENTUM_CONFIG as { ENABLED: boolean }).ENABLED = true;
  const config: BacktestConfig = {
    startDate,
    endDate: endEarlier,
    tickers: CAD10,
    budgetPerTicker: 1000,
    interval: '4h',
    intervalMinutes: 240,
    maxOpenPositions: V2_CONFIG.MAX_OPEN_POSITIONS,
    feeRoundTrip: V2_CONFIG.FEE_ROUND_TRIP_TAKER,
    slippagePerSide: V2_CONFIG.PAPER_SLIPPAGE_PER_SIDE,
    barSequence: 'pessimistic',
    entryFilters: {
      confirmMode: 'bullish_close',
      maxSignalCloseLocation: 0.8,
      minAdx: MIN_ADX,
      minSignalAtrPercent: 1.5,
      ...(confirmMomentum ? { confirmMomentum: true } : {}),
    },
    seed: false,
  };
  console.log(`\n>>> ${label} ${startDate.toISOString().slice(0, 10)}→${endEarlier.toISOString().slice(0, 10)}`);
  const result = await runBacktest(config);
  const trades = result.trades.map((t) => ({
    id: t.id,
    ticker: t.ticker,
    entry: new Date(t.entryTime).toISOString(),
    exit: t.exitTime ? new Date(t.exitTime).toISOString() : null,
    pnl: Number((t.pnlNet ?? 0).toFixed(2)),
    reason: t.exitReason,
    regime: t.entryRegime,
    holdBars: t.holdBars,
  }));
  console.log(
    `trades=${trades.length} net=$${result.summary.totalPnlNet.toFixed(2)} PF=${result.summary.profitFactor}`,
  );
  for (const t of trades) {
    console.log(`  ${t.ticker} ${t.entry} pnl=${t.pnl} ${t.reason} hold=${t.holdBars}`);
  }
  return { label, confirmMomentum, summary: {
    trades: result.summary.totalTrades,
    net: Number(result.summary.totalPnlNet.toFixed(2)),
    pf: result.summary.profitFactor === Infinity ? null : Number(result.summary.profitFactor.toFixed(3)),
  }, trades };
}

async function main() {
  mkdirSync('/opt/cursor/artifacts', { recursive: true });
  initializeDatabase();
  initV2Tables();
  const nextbar = await run('mom_nextbar', false);
  const confirm = await run('mom_confirm', true);
  const out = { generatedAt: new Date().toISOString(), nextbar, confirm };
  writeFileSync('/opt/cursor/artifacts/edge-diag-confirmmom-trades.json', JSON.stringify(out, null, 2));
  console.log('\nWrote edge-diag-confirmmom-trades.json');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
