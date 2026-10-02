#!/usr/bin/env node
/**
 * Stress the UP+confirm+minATR stack that cleared robust 90/45.
 * Windows: 45/45, 60/60, 90/45, full90. Same promotion bar + earlier n≥10.
 *
 * Usage:
 *   DATA_DIR=/tmp/cryptotitan-edge-research \
 *     node --experimental-strip-types scripts/edge-up-confirm-promote-stress.ts
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { initializeDatabase } from '../services/database.js';
import { initV2Tables } from '../v2/attribution/attributionStore.ts';
import { V2_CONFIG } from '../v2/engine/config.ts';
import { runBacktest } from '../v2/backtest/backtestEngine.ts';
import type { BacktestConfig, BacktestResult } from '../v2/backtest/types.ts';

const CAD10 = [...V2_CONFIG.SCAN_TICKERS];
const ENTRY = {
  confirmMode: 'bullish_close' as const,
  maxSignalCloseLocation: 0.8,
  minSignalAtrPercent: 1.5,
};

function summarize(result: BacktestResult) {
  const s = result.summary;
  if (result.trades.some((t) => t.holdBars < 0)) throw new Error('holdBars<0');
  const byRegime: Record<string, number> = {};
  for (const t of result.trades) {
    byRegime[String(t.entryRegime)] = (byRegime[String(t.entryRegime)] ?? 0) + 1;
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

async function runWindow(label: string, days: number, end: Date) {
  const prevR = [...V2_CONFIG.ALLOWED_REGIMES];
  const prevA = V2_CONFIG.MAX_ATR_PERCENT;
  (V2_CONFIG as { ALLOWED_REGIMES: readonly string[] }).ALLOWED_REGIMES = ['STRONG_UP', 'UP'];
  (V2_CONFIG as { MAX_ATR_PERCENT: number }).MAX_ATR_PERCENT = 2.5;
  try {
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
      entryFilters: ENTRY,
      seed: false,
    };
    console.log(`\n>>> ${label} | ${startDate.toISOString().slice(0, 10)}→${end.toISOString().slice(0, 10)}`);
    const result = await runBacktest(config);
    const summary = summarize(result);
    console.log(
      `    trades=${summary.trades} WR=${(summary.winRate * 100).toFixed(1)}% net=$${summary.net} PF=${summary.pf} zH=${summary.zeroHoldStops} regimes=${JSON.stringify(summary.byRegime)}`,
    );
    return summary;
  } finally {
    (V2_CONFIG as { ALLOWED_REGIMES: readonly string[] }).ALLOWED_REGIMES = prevR;
    (V2_CONFIG as { MAX_ATR_PERCENT: number }).MAX_ATR_PERCENT = prevA;
  }
}

async function main(): Promise<void> {
  mkdirSync('/opt/cursor/artifacts', { recursive: true });
  initializeDatabase();
  initV2Tables();
  const endRecent = new Date();
  endRecent.setUTCHours(0, 0, 0, 0);

  const end45 = new Date(endRecent.getTime() - 45 * 86400000);
  const end60 = new Date(endRecent.getTime() - 60 * 86400000);

  const earlier45 = await runWindow('split45/earlier45', 45, end45);
  const oos45 = await runWindow('split45/oos45', 45, endRecent);
  const earlier60 = await runWindow('split60/earlier60', 60, end60);
  const oos60 = await runWindow('split60/oos60', 60, endRecent);
  const earlier90 = await runWindow('split90/earlier90', 90, end45);
  const oos45b = await runWindow('split90/oos45', 45, endRecent);
  const full90 = await runWindow('full90', 90, endRecent);

  const splits = {
    split_45_45: { earlier: earlier45, oos: oos45, pass: meetsBar(oos45, earlier45) },
    split_60_60: { earlier: earlier60, oos: oos60, pass: meetsBar(oos60, earlier60) },
    split_90_45: { earlier: earlier90, oos: oos45b, pass: meetsBar(oos45b, earlier90) },
    full90,
  };
  for (const [k, v] of Object.entries(splits)) {
    if (k === 'full90') {
      console.log(`== full90: n=${full90.trades} PF=${full90.pf} net=$${full90.net}`);
    } else {
      const s = v as { earlier: { pf: number | null; trades: number }; oos: { pf: number | null; net: number }; pass: boolean };
      console.log(
        `== ${k}: pass=${s.pass} | earlier n=${s.earlier.trades} PF=${s.earlier.pf} | oos PF=${s.oos.pf} net=$${s.oos.net}`,
      );
    }
  }

  const out = {
    generatedAt: new Date().toISOString(),
    candidate: {
      regimes: ['STRONG_UP', 'UP'],
      maxAtr: 2.5,
      entryFilters: ENTRY,
    },
    splits,
    allSplitPass: splits.split_45_45.pass && splits.split_60_60.pass && splits.split_90_45.pass,
  };
  writeFileSync('/opt/cursor/artifacts/edge-up-confirm-promote-stress.json', JSON.stringify(out, null, 2));
  writeFileSync('/cursor/stores/self/artifacts/edge-up-confirm-promote-stress.json', JSON.stringify(out, null, 2));
  console.log(`\nWrote promote-stress allSplitPass=${out.allSplitPass}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
