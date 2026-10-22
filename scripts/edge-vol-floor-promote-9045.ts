#!/usr/bin/env node
/**
 * minVolumeRatio floor under full promote stack (research only).
 * Stop autopsy: BNB stop at volume_ratio≈0.16; only one other trade <0.3 (+$0.56).
 * Ask: does vol≥0.3 improve dual-split without starving n?
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
import type { BacktestConfig, BacktestResult } from '../v2/backtest/types.ts';
import { writeResearchArtifact } from './researchArtifactWrite.ts';

const CAD10 = [...V2_CONFIG.SCAN_TICKERS];

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

function pfOk(pf: number | null, min: number): boolean {
  return pf == null ? true : pf >= min;
}

function meetsBar(
  oos: { pf: number | null; net: number; trades: number },
  earlier: { pf: number | null; trades: number },
): boolean {
  return oos.trades > 0 && pfOk(oos.pf, 1.1) && oos.net > 0 && pfOk(earlier.pf, 0.9) && earlier.trades >= 10;
}

async function run(days: number, end: Date, label: string, minVol: number | undefined) {
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
    entryFilters: {
      confirmMode: 'bullish_close',
      maxSignalCloseLocation: 0.85,
      minAdx: ADX_THRESHOLDS.TREND_MIN,
      minSignalAtrPercent: 1.5,
      confirmMomentum: true,
      ...(minVol != null ? { minVolumeRatio: minVol } : {}),
    },
    seed: false,
  };
  console.log(`>>> ${label} vol=${minVol ?? 'off'} ${startDate.toISOString().slice(0, 10)}→${end.toISOString().slice(0, 10)}`);
  const out = summarize(await runBacktest(config));
  console.log(`    n=${out.trades} WR=${out.winRate} net=$${out.net} PF=${out.pf}`);
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
  const end45 = new Date(end.getTime() - 45 * 86400000);
  const end60 = new Date(end.getTime() - 60 * 86400000);

  const variants: { id: string; minVol?: number }[] = [
    { id: 'paper_live' },
    { id: 'vol_030', minVol: 0.3 },
    { id: 'vol_025', minVol: 0.25 },
    { id: 'vol_020', minVol: 0.2 },
  ];

  const rows = [];
  for (const v of variants) {
    const earlier90 = await run(90, end45, `${v.id}/earlier90`, v.minVol);
    const oos45 = await run(45, end, `${v.id}/oos45`, v.minVol);
    const earlier60 = await run(60, end60, `${v.id}/earlier60`, v.minVol);
    const oos60 = await run(60, end, `${v.id}/oos60`, v.minVol);
    const pass9045 = meetsBar(oos45, earlier90);
    const pass6060 = meetsBar(oos60, earlier60);
    rows.push({
      id: v.id,
      minVol: v.minVol ?? null,
      split_90_45: { earlier: earlier90, oos: oos45, pass: pass9045 },
      split_60_60: { earlier: earlier60, oos: oos60, pass: pass6060 },
      dualPass: pass9045 && pass6060,
    });
    console.log(`  dualPass=${pass9045 && pass6060}`);
  }

  const out = {
    generatedAt: new Date().toISOString(),
    purpose: 'Volume floor under promote stack after BNB stop autopsy',
    stack:
      'STRONG_UP + confirm + chase0.85 + MAX2.5 + minATR1.5 + ADX20 + confirmMomentum + no_overnight + conf0.60 + tk4',
    rows,
    anyDualPass: rows.some((r) => r.dualPass),
  };
  const paths = writeResearchArtifact('edge-vol-floor-promote-9045.json', JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ written: paths, anyDualPass: out.anyDualPass }, null, 2));
  for (const r of rows) {
    const a = r.split_90_45;
    const b = r.split_60_60;
    console.log(
      `${r.dualPass ? 'DUAL' : '----'} ${r.id} | 90/45 n=${a.earlier.trades}/${a.oos.trades} PF=${a.earlier.pf}/${a.oos.pf} net=$${a.earlier.net}/$${a.oos.net} | 60/60 n=${b.earlier.trades}/${b.oos.trades} PF=${b.earlier.pf}/${b.oos.pf} net=$${b.earlier.net}/$${b.oos.net}`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
