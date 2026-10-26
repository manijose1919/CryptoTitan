#!/usr/bin/env node
/**
 * Scarcity diagnostic under current paper gates: ADX≥15, ATR [1.5,2.8], vol≥0.20.
 * Counts UP/STRONG_UP ticker-bars that clear progressive filters (pre-confirm).
 * Prefer DATA_DIR=/tmp/cryptotitan-edge-research.
 */
import { initializeDatabase } from '../services/database.js';
import { initV2Tables } from '../v2/attribution/attributionStore.ts';
import { V2_CONFIG, ADX_THRESHOLDS } from '../v2/engine/config.ts';
import { adx, computeSignals } from '../v2/indicators/indicators.ts';
import { loadAllCandles } from '../v2/backtest/candleCache.ts';
import { writeResearchArtifact } from './researchArtifactWrite.ts';

const CAD10 = [...V2_CONFIG.SCAN_TICKERS];
const MIN_ADX = ADX_THRESHOLDS.TREND_MIN; // 15 after promote
const MIN_ATR = 1.5;
const MAX_ATR = 2.8;
const MIN_VOL = 0.2;

type Counts = {
  bars: number;
  byRegime: Record<string, number>;
  strongUp: number;
  up: number;
  suAdx: number;
  upAdx: number;
  suAdxAtr: number;
  upAdxAtr: number;
  suAdxAtrVol: number;
  upAdxAtrVol: number;
  /** UP with ADX ok but ATR below min (BNB-style near-miss) */
  upAdxLowAtr: number;
  suAdxLowAtr: number;
};

function empty(): Counts {
  return {
    bars: 0,
    byRegime: {},
    strongUp: 0,
    up: 0,
    suAdx: 0,
    upAdx: 0,
    suAdxAtr: 0,
    upAdxAtr: 0,
    suAdxAtrVol: 0,
    upAdxAtrVol: 0,
    upAdxLowAtr: 0,
    suAdxLowAtr: 0,
  };
}

async function windowCounts(label: string, days: number, end: Date): Promise<Counts> {
  const startDate = new Date(end.getTime() - days * 86400000);
  console.log(`\n>>> ${label} ${startDate.toISOString().slice(0, 10)}→${end.toISOString().slice(0, 10)}`);
  const allCandles = await loadAllCandles(CAD10, startDate, end, '4h');
  const c = empty();
  for (const [, candles] of allCandles) {
    for (let bar = V2_CONFIG.MIN_CANDLES; bar < candles.length; bar++) {
      c.bars++;
      const window = candles.slice(0, bar + 1);
      const { regime, signals } = computeSignals(window);
      const reg = String(regime.regime);
      c.byRegime[reg] = (c.byRegime[reg] ?? 0) + 1;
      const adxOk = window.length >= 30 && adx(window) >= MIN_ADX;
      const atr = Number(signals.atr_percent ?? 0);
      const vol = Number(signals.volume_ratio ?? 0);
      const atrBand = atr >= MIN_ATR && atr <= MAX_ATR;
      const volOk = vol >= MIN_VOL;
      const lowAtr = atr > 0 && atr < MIN_ATR;

      if (reg === 'STRONG_UP') {
        c.strongUp++;
        if (adxOk) {
          c.suAdx++;
          if (lowAtr) c.suAdxLowAtr++;
          if (atrBand) {
            c.suAdxAtr++;
            if (volOk) c.suAdxAtrVol++;
          }
        }
      }
      if (reg === 'UP') {
        c.up++;
        if (adxOk) {
          c.upAdx++;
          if (lowAtr) c.upAdxLowAtr++;
          if (atrBand) {
            c.upAdxAtr++;
            if (volOk) c.upAdxAtrVol++;
          }
        }
      }
    }
  }
  console.log(
    `  bars=${c.bars} SU=${c.strongUp} UP=${c.up} | SU+ADX=${c.suAdx} UP+ADX=${c.upAdx} | band=${c.suAdxAtr + c.upAdxAtr} band+vol=${c.suAdxAtrVol + c.upAdxAtrVol} | lowATR(ADX)=${c.suAdxLowAtr + c.upAdxLowAtr}`,
  );
  return c;
}

async function main(): Promise<void> {
  initializeDatabase();
  initV2Tables();

  const end = new Date();
  end.setUTCHours(0, 0, 0, 0);
  const end45 = new Date(end.getTime() - 45 * 86400000);
  const end60 = new Date(end.getTime() - 60 * 86400000);

  const out = {
    generatedAt: new Date().toISOString(),
    purpose: 'Scarcity under ADX15 + ATR[1.5,2.8] + vol0.20 (pre-confirm expectancy)',
    gates: { minAdx: MIN_ADX, minAtr: MIN_ATR, maxAtr: MAX_ATR, minVol: MIN_VOL },
    windows: {
      earlier60: await windowCounts('earlier60', 60, end60),
      oos60: await windowCounts('oos60', 60, end),
      earlier90: await windowCounts('earlier90', 90, end45),
      oos45: await windowCounts('oos45', 45, end),
      recent30: await windowCounts('recent30', 30, end),
    },
  };
  const paths = writeResearchArtifact('edge-scarcity-adx15-9045.json', JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ written: paths }, null, 2));
  for (const [k, w] of Object.entries(out.windows)) {
    console.log(
      `${k}: band+vol SU=${w.suAdxAtrVol} UP=${w.upAdxAtrVol} | lowATR UP=${w.upAdxLowAtr} SU=${w.suAdxLowAtr}`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
