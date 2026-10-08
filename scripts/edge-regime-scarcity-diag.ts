#!/usr/bin/env node
/**
 * Regime / ADX scarcity diagnostic for n-starve under STRONG_UP paper stack.
 *
 * Counts ticker-bars by HTF regime and ADX≥20 in earlier60 / oos60 / earlier90 / oos45.
 * Explains why entry packages stall at earlier60 n≈8–9 even with TimeGate off.
 *
 * Usage:
 *   DATA_DIR=/tmp/cryptotitan-edge-research \
 *     node --experimental-strip-types scripts/edge-regime-scarcity-diag.ts
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { initializeDatabase } from '../services/database.js';
import { initV2Tables } from '../v2/attribution/attributionStore.ts';
import { V2_CONFIG, ADX_THRESHOLDS } from '../v2/engine/config.ts';
import { adx, computeSignals } from '../v2/indicators/indicators.ts';
import { loadAllCandles } from '../v2/backtest/candleCache.ts';

const CAD10 = [...V2_CONFIG.SCAN_TICKERS];
const MIN_ADX = ADX_THRESHOLDS.TREND_MIN;

type Counts = {
  bars: number;
  byRegime: Record<string, number>;
  strongUp: number;
  strongUpAdx20: number;
  strongUpAdx20AtrBand: number;
  up: number;
  upAdx20: number;
};

function empty(): Counts {
  return {
    bars: 0,
    byRegime: {},
    strongUp: 0,
    strongUpAdx20: 0,
    strongUpAdx20AtrBand: 0,
    up: 0,
    upAdx20: 0,
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
      const atr = signals.atr_percent as number;
      const atrBand = atr >= 1.5 && atr <= 2.5;
      if (reg === 'STRONG_UP') {
        c.strongUp++;
        if (adxOk) {
          c.strongUpAdx20++;
          if (atrBand) c.strongUpAdx20AtrBand++;
        }
      }
      if (reg === 'UP') {
        c.up++;
        if (adxOk) c.upAdx20++;
      }
    }
  }
  console.log(
    `  bars=${c.bars} STRONG_UP=${c.strongUp} SU+ADX20=${c.strongUpAdx20} SU+ADX+ATR=${c.strongUpAdx20AtrBand} UP=${c.up} UP+ADX20=${c.upAdx20}`,
  );
  console.log('  byRegime', c.byRegime);
  return c;
}

async function main(): Promise<void> {
  mkdirSync('/opt/cursor/artifacts', { recursive: true });
  mkdirSync('/cursor/stores/self/artifacts', { recursive: true });
  initializeDatabase();
  initV2Tables();

  const end = new Date();
  end.setUTCHours(0, 0, 0, 0);
  const end45 = new Date(end.getTime() - 45 * 86400000);
  const end60 = new Date(end.getTime() - 60 * 86400000);

  const out = {
    generatedAt: new Date().toISOString(),
    purpose: 'Explain earlier60 n-starve under STRONG_UP+ADX20+ATR band (pre timeGate/score/confirm)',
    windows: {
      earlier60: await windowCounts('earlier60', 60, end60),
      oos60: await windowCounts('oos60', 60, end),
      earlier90: await windowCounts('earlier90', 90, end45),
      oos45: await windowCounts('oos45', 45, end),
    },
  };
  writeFileSync('/opt/cursor/artifacts/edge-regime-scarcity-diag.json', JSON.stringify(out, null, 2));
  writeFileSync('/cursor/stores/self/artifacts/edge-regime-scarcity-diag.json', JSON.stringify(out, null, 2));
  console.log('\nWrote edge-regime-scarcity-diag.json');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
