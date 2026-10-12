#!/usr/bin/env node
/**
 * ATR-cooldown near-miss diagnostic (research only).
 *
 * Live soak: DOTUSD STRONG_UP rejected at ATR%~2.7 > MAX 2.5.
 * Question: how often does ATR cool back into [1.5, 2.5] within K bars
 * while STRONG_UP+ADX≥20 still holds — a delayed-entry path that does NOT
 * raise MAX_ATR?
 *
 * Counts earlier90 / oos45 opportunities; does not place trades.
 *
 * Usage:
 *   DATA_DIR=/tmp/cryptotitan-edge-research \
 *     node --experimental-strip-types scripts/edge-atr-cooldown-diag.ts
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { initializeDatabase } from '../services/database.js';
import { initV2Tables } from '../v2/attribution/attributionStore.ts';
import { V2_CONFIG, ADX_THRESHOLDS } from '../v2/engine/config.ts';
import { adx, computeSignals } from '../v2/indicators/indicators.ts';
import { evaluateSignals } from '../v2/pipeline/signalGenerator.ts';
import { checkTimeGate } from '../v2/pipeline/timeGate.ts';
import {
  passesConfirmBar,
  passesEntryBarQuality,
} from '../v2/backtest/backtestEngine.ts';
import { loadAllCandles } from '../v2/backtest/candleCache.ts';

const CAD10 = [...V2_CONFIG.SCAN_TICKERS];
const MIN_ADX = ADX_THRESHOLDS.TREND_MIN;
const LOOKAHEADS = [1, 3, 6, 12] as const;

type WindowStats = {
  bars: number;
  strongUpAdx: number;
  inBand: number; // SU+ADX+ATR 1.5–2.5
  nearMissHighAtr: number; // SU+ADX+ATR > 2.5
  coolWithin: Record<string, number>;
  coolConfirmEligible: Record<string, number>;
};

function empty(): WindowStats {
  const coolWithin: Record<string, number> = {};
  const coolConfirmEligible: Record<string, number> = {};
  for (const k of LOOKAHEADS) {
    coolWithin[`k${k}`] = 0;
    coolConfirmEligible[`k${k}`] = 0;
  }
  return { bars: 0, strongUpAdx: 0, inBand: 0, nearMissHighAtr: 0, coolWithin, coolConfirmEligible };
}

function scoreOk(window: ReturnType<typeof computeSignals>['signals'], regime: string, barTime: number): boolean {
  const evals = evaluateSignals(window);
  const totalWeight = evals.reduce((sum, e) => sum + e.weight, 0);
  let compositeScore = totalWeight > 0
    ? evals.reduce((sum, e) => sum + e.score * e.weight, 0) / totalWeight
    : 0;
  if (regime === 'STRONG_UP') compositeScore += 8;
  else if (regime === 'UP') compositeScore += 2;
  compositeScore = Math.min(compositeScore, 100);
  const tg = checkTimeGate(barTime);
  const confidence = compositeScore / 100;
  return (
    tg.allow
    && compositeScore >= V2_CONFIG.MIN_COMPOSITE_SCORE - tg.scoreBoost
    && confidence >= V2_CONFIG.MIN_CONFIDENCE
  );
}

function confirmEligible(
  candles: import('../v2/pipeline/types.ts').Candle[],
  bar: number,
  atrValue: number,
): boolean {
  const signalBar = candles[bar]!;
  const confirmBar = candles[bar + 1];
  if (!confirmBar || bar + 2 >= candles.length) return false;
  if (!passesEntryBarQuality(signalBar, atrValue, {
    confirmMode: 'bullish_close',
    maxSignalCloseLocation: 0.8,
  }, 'long').ok) return false;
  return passesConfirmBar(signalBar, confirmBar, 'bullish_close', 'long').ok;
}

async function analyze(label: string, days: number, end: Date): Promise<WindowStats> {
  const startDate = new Date(end.getTime() - days * 86400000);
  console.log(`\n>>> ${label} ${startDate.toISOString().slice(0, 10)}→${end.toISOString().slice(0, 10)}`);
  const allCandles = await loadAllCandles(CAD10, startDate, end, '4h');
  const s = empty();
  const maxK = Math.max(...LOOKAHEADS);

  for (const [, candles] of allCandles) {
    for (let bar = V2_CONFIG.MIN_CANDLES; bar < candles.length - 2; bar++) {
      s.bars++;
      const window = candles.slice(0, bar + 1);
      if (window.length < 30) continue;
      const { signals, regime } = computeSignals(window);
      if (regime.regime !== 'STRONG_UP') continue;
      if (adx(window) < MIN_ADX) continue;
      s.strongUpAdx++;
      const atrPct = signals.atr_percent as number;
      if (atrPct >= 1.5 && atrPct <= 2.5) {
        s.inBand++;
        continue;
      }
      if (!(atrPct > 2.5)) continue;
      s.nearMissHighAtr++;

      // Look ahead for first cool-into-band while still SU+ADX
      let foundAt: number | null = null;
      for (let j = 1; j <= maxK && bar + j < candles.length - 2; j++) {
        const w2 = candles.slice(0, bar + j + 1);
        const { signals: sig2, regime: reg2 } = computeSignals(w2);
        if (reg2.regime !== 'STRONG_UP') break;
        if (adx(w2) < MIN_ADX) continue;
        const atr2 = sig2.atr_percent as number;
        if (atr2 >= 1.5 && atr2 <= 2.5) {
          foundAt = j;
          break;
        }
      }
      if (foundAt == null) continue;
      for (const k of LOOKAHEADS) {
        if (foundAt <= k) s.coolWithin[`k${k}`]++;
      }

      const coolBar = bar + foundAt;
      const wCool = candles.slice(0, coolBar + 1);
      const { signals: sigCool, regime: regCool } = computeSignals(wCool);
      if (!scoreOk(sigCool, String(regCool.regime), candles[coolBar]!.time)) continue;
      if (!confirmEligible(candles, coolBar, sigCool.atr as number)) continue;
      for (const k of LOOKAHEADS) {
        if (foundAt <= k) s.coolConfirmEligible[`k${k}`]++;
      }
    }
  }

  console.log(
    `  bars=${s.bars} SU+ADX=${s.strongUpAdx} inBand=${s.inBand} nearMissATR>${2.5}=${s.nearMissHighAtr}`,
  );
  console.log('  coolWithin', s.coolWithin);
  console.log('  coolConfirmEligible', s.coolConfirmEligible);
  return s;
}

async function main(): Promise<void> {
  mkdirSync('/opt/cursor/artifacts', { recursive: true });
  mkdirSync('/cursor/stores/self/artifacts', { recursive: true });
  initializeDatabase();
  initV2Tables();
  (V2_CONFIG as { ALLOWED_REGIMES: readonly string[] }).ALLOWED_REGIMES = ['STRONG_UP'];
  (V2_CONFIG as { MAX_ATR_PERCENT: number }).MAX_ATR_PERCENT = 2.5;

  const end = new Date();
  end.setUTCHours(0, 0, 0, 0);
  const end45 = new Date(end.getTime() - 45 * 86400000);

  const out = {
    generatedAt: new Date().toISOString(),
    purpose: 'Count ATR>MAX near-misses that cool into band without raising MAX_ATR',
    lookAheadsBars: [...LOOKAHEADS],
    windows: {
      earlier90: await analyze('earlier90', 90, end45),
      oos45: await analyze('oos45', 45, end),
    },
  };
  writeFileSync('/opt/cursor/artifacts/edge-atr-cooldown-diag.json', JSON.stringify(out, null, 2));
  writeFileSync('/cursor/stores/self/artifacts/edge-atr-cooldown-diag.json', JSON.stringify(out, null, 2));
  console.log('\nWrote edge-atr-cooldown-diag.json');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
