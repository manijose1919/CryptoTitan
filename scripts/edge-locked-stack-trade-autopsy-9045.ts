#!/usr/bin/env node
/**
 * Trade-level dump for locked-stack earlier90 (PF-negative) vs oos45 (strong).
 * No ablations — autopsy only.
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

function row(t: BacktestTrade) {
  const sig = t.entrySignals as Record<string, unknown> | undefined;
  return {
    id: t.id,
    ticker: t.ticker,
    regime: t.entryRegime,
    entryTime: t.entryTime,
    exitTime: t.exitTime,
    holdBars: t.holdBars,
    exitReason: t.exitReason,
    pnlNet: t.pnlNet != null ? Number(t.pnlNet.toFixed(2)) : null,
    entryPrice: t.entryPrice,
    exitPrice: t.exitPrice,
    atrPercent: t.atrPercent,
    confidence: t.entryConfidence,
    score: t.compositeScore,
    closeLocation: typeof sig?.close_location === 'number' ? sig.close_location : null,
  };
}

function byExit(trades: BacktestTrade[]) {
  const m: Record<string, { n: number; pnl: number }> = {};
  for (const t of trades) {
    const k = t.exitReason ?? 'open';
    if (!m[k]) m[k] = { n: 0, pnl: 0 };
    m[k].n++;
    m[k].pnl += t.pnlNet ?? 0;
  }
  for (const v of Object.values(m)) v.pnl = Number(v.pnl.toFixed(2));
  return m;
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
  console.log(`    n=${closed.length} byExit=${JSON.stringify(byExit(closed))}`);
  return {
    label,
    summary: {
      trades: closed.length,
      net: Number(closed.reduce((s, t) => s + (t.pnlNet ?? 0), 0).toFixed(2)),
      byExit: byExit(closed),
    },
    trades: closed.map(row).sort((a, b) => String(a.entryTime).localeCompare(String(b.entryTime))),
  };
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

  const out = {
    generatedAt: new Date().toISOString(),
    stack: 'STRONG_UP + confirm + chase0.8 + MAX2.5 + minATR1.5 + ADX20 + confirmMomentum',
    earlier90: await run(90, end45, 'earlier90'),
    oos45: await run(45, end, 'oos45'),
  };
  writeFileSync('/opt/cursor/artifacts/edge-locked-stack-trade-autopsy-9045.json', JSON.stringify(out, null, 2));
  writeFileSync(
    '/cursor/stores/self/artifacts/edge-locked-stack-trade-autopsy-9045.json',
    JSON.stringify(out, null, 2),
  );
  console.log(JSON.stringify({ earlier90: out.earlier90.summary, oos45: out.oos45.summary }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
