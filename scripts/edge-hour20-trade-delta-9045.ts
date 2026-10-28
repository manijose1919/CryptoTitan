#!/usr/bin/env node
/**
 * Autopsy: which fee-aware trades appear when hour 20 is unblocked (TG [13] vs [13,20]).
 * Research only — locked ADX15 stack otherwise identical.
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

function tradeKey(t: BacktestResult['trades'][number]): string {
  return `${t.ticker}|${t.entryTime}|${t.side}|${Number(t.entryPrice).toFixed(6)}`;
}

async function run(days: number, end: Date, hours: readonly number[]) {
  (TIME_GATE_CONFIG as { BLOCKED_HOURS: readonly number[] }).BLOCKED_HOURS = hours;
  (TIME_GATE_CONFIG as { BLOCKED_DAYS: readonly number[] }).BLOCKED_DAYS = [5];
  (TIME_GATE_CONFIG as { ENABLED: boolean }).ENABLED = true;
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
  console.log(`>>> days=${days} hours=${hours.join(',')} ${startDate.toISOString().slice(0, 10)}→${end.toISOString().slice(0, 10)}`);
  return runBacktest(config);
}

function summarizeDelta(label: string, with20: BacktestResult, without20: BacktestResult) {
  const oldKeys = new Set(without20.trades.map(tradeKey));
  const added = with20.trades.filter((t) => !oldKeys.has(tradeKey(t)));
  const byTicker: Record<string, { n: number; net: number }> = {};
  const byHour: Record<string, { n: number; net: number }> = {};
  for (const t of added) {
    const hour = new Date(t.entryTime).getUTCHours();
    byTicker[t.ticker] ??= { n: 0, net: 0 };
    byTicker[t.ticker]!.n++;
    byTicker[t.ticker]!.net += t.pnlNet ?? 0;
    byHour[String(hour)] ??= { n: 0, net: 0 };
    byHour[String(hour)]!.n++;
    byHour[String(hour)]!.net += t.pnlNet ?? 0;
  }
  for (const v of Object.values(byTicker)) v.net = Number(v.net.toFixed(2));
  for (const v of Object.values(byHour)) v.net = Number(v.net.toFixed(2));
  const net = Number(added.reduce((a, t) => a + (t.pnlNet ?? 0), 0).toFixed(2));
  const wins = added.filter((t) => (t.pnlNet ?? 0) > 0).length;
  console.log(
    `  ${label}: base n=${without20.trades.length} net=$${without20.summary.totalPnlNet.toFixed(2)} | +hour20path n=${with20.trades.length} | added n=${added.length} WR=${added.length ? (wins / added.length).toFixed(3) : 'n/a'} net=$${net}`,
  );
  console.log('    byHour', byHour);
  console.log('    byTicker', byTicker);
  return {
    baseN: without20.trades.length,
    baseNet: Number(without20.summary.totalPnlNet.toFixed(2)),
    newN: with20.trades.length,
    addedN: added.length,
    addedWins: wins,
    addedNet: net,
    byHour,
    byTicker,
    sample: added.slice(0, 12).map((t) => ({
      ticker: t.ticker,
      entry: new Date(t.entryTime).toISOString(),
      hour: new Date(t.entryTime).getUTCHours(),
      net: Number((t.pnlNet ?? 0).toFixed(2)),
      exitReason: t.exitReason,
    })),
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

  const windows = [
    { id: 'oos45', days: 45 },
    { id: 'oos60', days: 60 },
    { id: 'earlier90', days: 90, endOffset: 45 },
  ];

  const rows = [];
  for (const w of windows) {
    const wEnd = w.endOffset ? new Date(end.getTime() - w.endOffset * 86400000) : end;
    const blocked = await run(w.days, wEnd, [13, 20]);
    const open20 = await run(w.days, wEnd, [13]);
    rows.push({ id: w.id, ...summarizeDelta(w.id, open20, blocked) });
  }

  const out = {
    generatedAt: new Date().toISOString(),
    purpose: 'Hour-20 unblock trade delta autopsy under locked ADX15 stack',
    stack:
      'STRONG_UP+UP + confirm + chase0.85 + ATR1.5-2.8 + ADX15 + mom + conf0.60 + tk4 + vol0.20 + Fri',
    rows,
  };
  const paths = writeResearchArtifact('edge-hour20-trade-delta-9045.json', JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ written: paths }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
