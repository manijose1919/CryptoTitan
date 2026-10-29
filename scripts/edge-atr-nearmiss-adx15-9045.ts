#!/usr/bin/env node
/**
 * ATR near-miss scarcity: UP/STRONG_UP + ADX≥15 bars with ATR just below min 1.5.
 * Explains XRP/BNB soak near-misses. Prefer DATA_DIR=/tmp/cryptotitan-edge-research.
 */
import { initializeDatabase } from '../services/database.js';
import { initV2Tables } from '../v2/attribution/attributionStore.ts';
import { V2_CONFIG, ADX_THRESHOLDS } from '../v2/engine/config.ts';
import { adx, computeSignals } from '../v2/indicators/indicators.ts';
import { loadAllCandles } from '../v2/backtest/candleCache.ts';
import { writeResearchArtifact } from './researchArtifactWrite.ts';

const CAD10 = [...V2_CONFIG.SCAN_TICKERS];
const MIN_ADX = ADX_THRESHOLDS.TREND_MIN;

type Counts = {
  bars: number;
  upAdx: number;
  suAdx: number;
  /** ATR bands among UP|SU + ADX ok */
  atr_lt12: number;
  atr_12_135: number;
  atr_135_15: number;
  atr_15_28: number;
  atr_gt28: number;
  byTickerNear: Record<string, number>; // ATR in [1.35, 1.5)
};

function empty(): Counts {
  return {
    bars: 0,
    upAdx: 0,
    suAdx: 0,
    atr_lt12: 0,
    atr_12_135: 0,
    atr_135_15: 0,
    atr_15_28: 0,
    atr_gt28: 0,
    byTickerNear: {},
  };
}

async function windowCounts(label: string, days: number, end: Date): Promise<Counts> {
  const startDate = new Date(end.getTime() - days * 86400000);
  console.log(`\n>>> ${label} ${startDate.toISOString().slice(0, 10)}→${end.toISOString().slice(0, 10)}`);
  const allCandles = await loadAllCandles(CAD10, startDate, end, '4h');
  const c = empty();
  for (const [ticker, candles] of allCandles) {
    for (let bar = V2_CONFIG.MIN_CANDLES; bar < candles.length; bar++) {
      c.bars++;
      const window = candles.slice(0, bar + 1);
      const { regime, signals } = computeSignals(window);
      const reg = String(regime.regime);
      if (reg !== 'UP' && reg !== 'STRONG_UP') continue;
      if (!(window.length >= 30 && adx(window) >= MIN_ADX)) continue;
      if (reg === 'UP') c.upAdx++;
      else c.suAdx++;
      const atr = Number(signals.atr_percent ?? 0);
      if (atr < 1.2) c.atr_lt12++;
      else if (atr < 1.35) c.atr_12_135++;
      else if (atr < 1.5) {
        c.atr_135_15++;
        c.byTickerNear[ticker] = (c.byTickerNear[ticker] ?? 0) + 1;
      } else if (atr <= 2.8) c.atr_15_28++;
      else c.atr_gt28++;
    }
  }
  console.log(
    `  UP+ADX=${c.upAdx} SU+ADX=${c.suAdx} | <1.2=${c.atr_lt12} [1.2,1.35)=${c.atr_12_135} [1.35,1.5)=${c.atr_135_15} band=${c.atr_15_28} >2.8=${c.atr_gt28}`,
  );
  console.log('  nearMiss byTicker', c.byTickerNear);
  return c;
}

async function main(): Promise<void> {
  initializeDatabase();
  initV2Tables();
  const end = new Date();
  end.setUTCHours(0, 0, 0, 0);

  const out = {
    generatedAt: new Date().toISOString(),
    purpose: 'ATR near-miss counts under UP/SU + ADX15 (soak expectancy)',
    gates: { minAdx: MIN_ADX, minAtr: 1.5, maxAtr: 2.8 },
    windows: {
      recent14: await windowCounts('recent14', 14, end),
      recent30: await windowCounts('recent30', 30, end),
      oos45: await windowCounts('oos45', 45, end),
      oos60: await windowCounts('oos60', 60, end),
    },
  };
  const paths = writeResearchArtifact('edge-atr-nearmiss-adx15-9045.json', JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ written: paths }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
