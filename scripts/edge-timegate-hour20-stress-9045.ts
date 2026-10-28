#!/usr/bin/env node
/**
 * Stress regression: paper TimeGate [13,20]+Fri vs drop hour 20 ([13]+Fri).
 * Longer windows 90/45, 60/60, 120/60, 150/75 under locked ADX15 stack.
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
    entryFilters: {
      confirmMode: 'bullish_close',
      maxSignalCloseLocation: 0.85,
      minAdx: ADX_THRESHOLDS.TREND_MIN,
      minSignalAtrPercent: 1.5,
      maxSignalAtrPercent: 2.8,
      confirmMomentum: true,
      minVolumeRatio: 0.2,
    },
    seed: false,
  };
  console.log(`>>> ${label} ${startDate.toISOString().slice(0, 10)}→${end.toISOString().slice(0, 10)}`);
  const out = summarize(await runBacktest(config));
  console.log(`    n=${out.trades} WR=${out.winRate} net=$${out.net} PF=${out.pf}`);
  return out;
}

async function stress(id: string, end: Date, hours: readonly number[]) {
  (TIME_GATE_CONFIG as { BLOCKED_HOURS: readonly number[] }).BLOCKED_HOURS = hours;
  (TIME_GATE_CONFIG as { BLOCKED_DAYS: readonly number[] }).BLOCKED_DAYS = [5];
  (TIME_GATE_CONFIG as { ENABLED: boolean }).ENABLED = true;

  const splits: { id: string; earlierDays: number; oosDays: number; earlierEndOffset: number }[] = [
    { id: '90_45', earlierDays: 90, oosDays: 45, earlierEndOffset: 45 },
    { id: '60_60', earlierDays: 60, oosDays: 60, earlierEndOffset: 60 },
    { id: '120_60', earlierDays: 120, oosDays: 60, earlierEndOffset: 60 },
    { id: '150_75', earlierDays: 150, oosDays: 75, earlierEndOffset: 75 },
  ];
  const rows = [];
  for (const s of splits) {
    const earlierEnd = new Date(end.getTime() - s.earlierEndOffset * 86400000);
    const earlier = await run(s.earlierDays, earlierEnd, `${id}/${s.id}/earlier`);
    const oos = await run(s.oosDays, end, `${id}/${s.id}/oos`);
    const pass = meetsBar(oos, earlier);
    rows.push({ id: s.id, earlier, oos, pass });
    console.log(`  ${s.id} pass=${pass}`);
  }
  return {
    id,
    hours: [...hours],
    rows,
    allPass: rows.every((r) => r.pass),
    sumNet: Number(rows.reduce((a, r) => a + (r.earlier.net || 0) + (r.oos.net || 0), 0).toFixed(2)),
  };
}

async function main(): Promise<void> {
  initializeDatabase();
  initV2Tables();
  (V2_CONFIG as { ALLOWED_REGIMES: readonly string[] }).ALLOWED_REGIMES = ['STRONG_UP', 'UP'];
  (V2_CONFIG as { MAX_ATR_PERCENT: number }).MAX_ATR_PERCENT = 2.8;
  (V2_CONFIG as { MIN_CONFIDENCE: number }).MIN_CONFIDENCE = 0.6;
  (V2_CONFIG as { MAX_SIGNAL_CLOSE_LOCATION: number }).MAX_SIGNAL_CLOSE_LOCATION = 0.85;
  (V2_CONFIG as { MIN_SIGNAL_VOLUME_RATIO: number }).MIN_SIGNAL_VOLUME_RATIO = 0.2;
  (STRATEGY_EXIT_CONFIGS.TREND as { timeKillBars: number }).timeKillBars = 4;
  (MOMENTUM_CONFIG as { ENABLED: boolean }).ENABLED = true;
  setSignalWeightMode('static');

  const end = new Date();
  end.setUTCHours(0, 0, 0, 0);

  console.log('\n######## paper [13,20] ########');
  const paper = await stress('paper_13_20', end, [13, 20]);
  console.log('\n######## drop20 [13] ########');
  const drop20 = await stress('drop_hour_20', end, [13]);

  const out = {
    generatedAt: new Date().toISOString(),
    purpose: 'Stress paper TimeGate vs drop hour 20 under ADX15 stack',
    stack:
      'STRONG_UP+UP + confirm + chase0.85 + ATR1.5-2.8 + ADX15 + mom + conf0.60 + tk4 + vol0.20 + Fri',
    paper,
    drop20,
    promoteCandidate: drop20.allPass && drop20.sumNet > paper.sumNet,
  };
  const paths = writeResearchArtifact('edge-timegate-hour20-stress-9045.json', JSON.stringify(out, null, 2));
  console.log(
    JSON.stringify(
      {
        written: paths,
        paperAllPass: paper.allPass,
        paperSumNet: paper.sumNet,
        drop20AllPass: drop20.allPass,
        drop20SumNet: drop20.sumNet,
        promoteCandidate: out.promoteCandidate,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
