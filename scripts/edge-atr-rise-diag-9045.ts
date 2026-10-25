#!/usr/bin/env node
/**
 * Low-ATR UP near-miss diagnostic (research only).
 *
 * Soak: BNBUSD UP rejected ATR%~0.99 < min 1.5 for many cycles.
 * Ask: how often does ATR rise into [1.5, 2.8] within K bars while UP/STRONG_UP
 * + ADX≥TREND_MIN still holds — delayed entry without lowering minATR?
 *
 * Prefer DATA_DIR=/tmp/cryptotitan-edge-research.
 */
import { initializeDatabase } from '../services/database.js';
import { initV2Tables } from '../v2/attribution/attributionStore.ts';
import { V2_CONFIG, ADX_THRESHOLDS } from '../v2/engine/config.ts';
import { adx, computeSignals } from '../v2/indicators/indicators.ts';
import { evaluateSignals, setSignalWeightMode } from '../v2/pipeline/signalGenerator.ts';
import { checkTimeGate, TIME_GATE_CONFIG } from '../v2/pipeline/timeGate.ts';
import {
  passesConfirmBar,
  passesEntryBarQuality,
} from '../v2/backtest/backtestEngine.ts';
import { loadAllCandles } from '../v2/backtest/candleCache.ts';
import { writeResearchArtifact } from './researchArtifactWrite.ts';

const CAD10 = [...V2_CONFIG.SCAN_TICKERS];
const MIN_ADX = ADX_THRESHOLDS.TREND_MIN;
const MIN_ATR = 1.5;
const MAX_ATR = 2.8;
const LOOKAHEADS = [1, 3, 6, 12] as const;

type WindowStats = {
  bars: number;
  upAdx: number;
  inBand: number;
  nearMissLowAtr: number;
  riseWithin: Record<string, number>;
  riseConfirmEligible: Record<string, number>;
};

function empty(): WindowStats {
  const riseWithin: Record<string, number> = {};
  const riseConfirmEligible: Record<string, number> = {};
  for (const k of LOOKAHEADS) {
    riseWithin[`k${k}`] = 0;
    riseConfirmEligible[`k${k}`] = 0;
  }
  return { bars: 0, upAdx: 0, inBand: 0, nearMissLowAtr: 0, riseWithin, riseConfirmEligible };
}

function scoreOk(
  signals: ReturnType<typeof computeSignals>['signals'],
  regime: string,
  barTime: number,
): boolean {
  const evals = evaluateSignals(signals);
  const totalWeight = evals.reduce((sum, e) => sum + e.weight, 0);
  let compositeScore =
    totalWeight > 0 ? evals.reduce((sum, e) => sum + e.score * e.weight, 0) / totalWeight : 0;
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
  if (
    !passesEntryBarQuality(
      signalBar,
      atrValue,
      { confirmMode: 'bullish_close', maxSignalCloseLocation: 0.85 },
      'long',
    ).ok
  ) {
    return false;
  }
  return passesConfirmBar(signalBar, confirmBar, 'bullish_close', 'long').ok;
}

async function scanWindow(label: string, days: number, end: Date): Promise<WindowStats> {
  const startDate = new Date(end.getTime() - days * 86400000);
  console.log(`>>> ${label} ${startDate.toISOString().slice(0, 10)}→${end.toISOString().slice(0, 10)}`);
  const all = await loadAllCandles(CAD10, startDate, end, '4h');
  const stats = empty();

  for (const ticker of CAD10) {
    const candles = all.get(ticker);
    if (!candles || candles.length < 40) continue;
    for (let bar = 30; bar < candles.length - 2; bar++) {
      stats.bars++;
      const window = candles.slice(0, bar + 1);
      const { signals, regime: regimeResult } = computeSignals(window);
      const regime = String(regimeResult.regime);
      if (regime !== 'UP' && regime !== 'STRONG_UP') continue;
      if (adx(window) < MIN_ADX) continue;
      stats.upAdx++;
      const atrPct = signals.atr_percent as number;
      if (atrPct >= MIN_ATR && atrPct <= MAX_ATR) {
        stats.inBand++;
        continue;
      }
      if (!(atrPct < MIN_ATR)) continue;
      stats.nearMissLowAtr++;

      const maxK = Math.max(...LOOKAHEADS);
      let foundAt: number | null = null;
      for (let j = 1; j <= maxK && bar + j < candles.length - 2; j++) {
        const w2 = candles.slice(0, bar + j + 1);
        const { signals: s2, regime: r2 } = computeSignals(w2);
        const reg2 = String(r2.regime);
        if (reg2 !== 'UP' && reg2 !== 'STRONG_UP') break;
        if (adx(w2) < MIN_ADX) continue;
        const a2 = s2.atr_percent as number;
        if (a2 >= MIN_ATR && a2 <= MAX_ATR) {
          foundAt = j;
          break;
        }
      }
      if (foundAt == null) continue;
      for (const k of LOOKAHEADS) {
        if (foundAt <= k) stats.riseWithin[`k${k}`]!++;
      }
      const coolBar = bar + foundAt;
      const wCool = candles.slice(0, coolBar + 1);
      const { signals: sigCool, regime: regCool } = computeSignals(wCool);
      if (!scoreOk(sigCool, String(regCool.regime), candles[coolBar]!.time)) continue;
      if (!confirmEligible(candles, coolBar, sigCool.atr as number)) continue;
      for (const k of LOOKAHEADS) {
        if (foundAt <= k) stats.riseConfirmEligible[`k${k}`]!++;
      }
    }
  }
  console.log(JSON.stringify(stats));
  return stats;
}

async function main(): Promise<void> {
  initializeDatabase();
  initV2Tables();
  (V2_CONFIG as { ALLOWED_REGIMES: readonly string[] }).ALLOWED_REGIMES = ['STRONG_UP', 'UP'];
  (V2_CONFIG as { MIN_CONFIDENCE: number }).MIN_CONFIDENCE = 0.6;
  (V2_CONFIG as { MAX_SIGNAL_CLOSE_LOCATION: number }).MAX_SIGNAL_CLOSE_LOCATION = 0.85;
  (TIME_GATE_CONFIG as { BLOCKED_HOURS: readonly number[] }).BLOCKED_HOURS = [13, 20];
  setSignalWeightMode('static');

  const end = new Date();
  end.setUTCHours(0, 0, 0, 0);
  const end45 = new Date(end.getTime() - 45 * 86400000);
  const end60 = new Date(end.getTime() - 60 * 86400000);

  const earlier90 = await scanWindow('earlier90', 90, end45);
  const oos45 = await scanWindow('oos45', 45, end);
  const earlier60 = await scanWindow('earlier60', 60, end60);
  const oos60 = await scanWindow('oos60', 60, end);

  const out = {
    generatedAt: new Date().toISOString(),
    purpose: 'Count low-ATR UP near-misses that rise into ATR band without lowering minATR',
    band: [MIN_ATR, MAX_ATR],
    minAdx: MIN_ADX,
    lookAheads: [...LOOKAHEADS],
    earlier90,
    oos45,
    earlier60,
    oos60,
  };
  const paths = writeResearchArtifact('edge-atr-rise-diag-9045.json', JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ written: paths }, null, 2));
  for (const [name, s] of [
    ['earlier90', earlier90],
    ['oos45', oos45],
    ['earlier60', earlier60],
    ['oos60', oos60],
  ] as const) {
    const rate12 =
      s.nearMissLowAtr > 0
        ? ((s.riseWithin.k12 ?? 0) / s.nearMissLowAtr * 100).toFixed(1)
        : 'n/a';
    console.log(
      `${name}: upAdx=${s.upAdx} inBand=${s.inBand} lowMiss=${s.nearMissLowAtr} rise≤12=${s.riseWithin.k12} (${rate12}%) confirmEligible≤12=${s.riseConfirmEligible.k12}`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
