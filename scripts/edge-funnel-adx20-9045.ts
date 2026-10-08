#!/usr/bin/env node
/**
 * Filter-funnel autopsy under the live paper stack (research only).
 *
 * Counts how many ticker-bars survive each gate on earlier90 / oos45:
 *   bars → STRONG_UP → ATR band → ADX≥20 → composite/score → chase
 *   → confirm → entry-eligible
 *
 * Goal: see which gate kills n under STRONG_UP+confirm+ADX20 (n-starve).
 *
 * Usage:
 *   DATA_DIR=/tmp/cryptotitan-edge-research \
 *     node --experimental-strip-types scripts/edge-funnel-adx20-9045.ts
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { initializeDatabase } from '../services/database.js';
import { initV2Tables } from '../v2/attribution/attributionStore.ts';
import { V2_CONFIG, ADX_THRESHOLDS } from '../v2/engine/config.ts';
import { adx, computeSignals } from '../v2/indicators/indicators.ts';
import { evaluateSignals } from '../v2/pipeline/signalGenerator.ts';
import { scanMarket } from '../v2/pipeline/marketScanner.ts';
import { checkTimeGate } from '../v2/pipeline/timeGate.ts';
import {
  passesConfirmBar,
  passesEntryBarQuality,
  passesSignalAtrBand,
} from '../v2/backtest/backtestEngine.ts';
import { loadAllCandles } from '../v2/backtest/candleCache.ts';

const CAD10 = [...V2_CONFIG.SCAN_TICKERS];
const MIN_ADX = ADX_THRESHOLDS.TREND_MIN;

type Funnel = Record<string, number>;

function emptyFunnel(): Funnel {
  return {
    bars: 0,
    scanPass: 0,
    strongUp: 0,
    atrBand: 0,
    adxOk: 0,
    timeGate: 0,
    scoreOk: 0,
    chaseOk: 0,
    confirmOk: 0,
    entryEligible: 0,
  };
}

async function funnelWindow(label: string, days: number, end: Date): Promise<Funnel> {
  const startDate = new Date(end.getTime() - days * 86400000);
  console.log(`\n>>> ${label} ${startDate.toISOString().slice(0, 10)}→${end.toISOString().slice(0, 10)}`);
  const allCandles = await loadAllCandles(CAD10, startDate, end, '4h');
  const f = emptyFunnel();
  const dropReasons: Record<string, number> = {};

  for (const [ticker, candles] of allCandles) {
    for (let bar = V2_CONFIG.MIN_CANDLES; bar < candles.length - 2; bar++) {
      f.bars++;
      const window = candles.slice(0, bar + 1);
      const signalBar = window[window.length - 1]!;
      const confirmBar = candles[bar + 1]!;

      const scan = scanMarket(new Map([[ticker, window]]));
      const passed = scan.find((s) => s.ticker === ticker && s.passed);
      if (!passed) {
        dropReasons[`scan:${scan[0]?.reason ?? 'fail'}`] = (dropReasons[`scan:${scan[0]?.reason ?? 'fail'}`] ?? 0) + 1;
        continue;
      }
      f.scanPass++;

      if (passed.regime !== 'STRONG_UP') {
        dropReasons[`regime:${passed.regime}`] = (dropReasons[`regime:${passed.regime}`] ?? 0) + 1;
        continue;
      }
      f.strongUp++;

      const { signals, regime } = computeSignals(window);
      const atrPercent = signals.atr_percent as number;
      const atrValue = signals.atr as number;
      if (!passesSignalAtrBand(atrPercent, { minSignalAtrPercent: 1.5, maxSignalAtrPercent: 2.5 }).ok) {
        dropReasons['atrBand'] = (dropReasons['atrBand'] ?? 0) + 1;
        continue;
      }
      // Also respect scanner MAX already in scanPass; double-check config band.
      if (atrPercent < 1.5 || atrPercent > 2.5) {
        dropReasons['atrBand'] = (dropReasons['atrBand'] ?? 0) + 1;
        continue;
      }
      f.atrBand++;

      if (window.length < 30 || adx(window) < MIN_ADX) {
        dropReasons['adx'] = (dropReasons['adx'] ?? 0) + 1;
        continue;
      }
      f.adxOk++;

      const tg = checkTimeGate(signalBar.time);
      if (!tg.allow) {
        dropReasons['timeGate'] = (dropReasons['timeGate'] ?? 0) + 1;
        continue;
      }
      f.timeGate++;

      const evals = evaluateSignals(signals);
      const totalWeight = evals.reduce((sum, e) => sum + e.weight, 0);
      let compositeScore = totalWeight > 0
        ? evals.reduce((sum, e) => sum + e.score * e.weight, 0) / totalWeight
        : 0;
      if (regime.regime === 'STRONG_UP') compositeScore += 8;
      else if (regime.regime === 'UP') compositeScore += 2;
      compositeScore = Math.min(compositeScore, 100);
      const pctB = signals.bb_percent_b as number;
      if (pctB > 0.80) compositeScore -= Math.round(6 + (pctB - 0.80) * 120);
      if (regime.trendMaturity > V2_CONFIG.TREND_MATURITY_PENALTY_THRESHOLD) {
        const excess = regime.trendMaturity - V2_CONFIG.TREND_MATURITY_PENALTY_THRESHOLD;
        const maxExcess = 100 - V2_CONFIG.TREND_MATURITY_PENALTY_THRESHOLD;
        compositeScore -= Math.round((excess / maxExcess) * V2_CONFIG.TREND_MATURITY_MAX_PENALTY);
      }
      const confidence = compositeScore / 100;
      if (
        compositeScore < V2_CONFIG.MIN_COMPOSITE_SCORE - tg.scoreBoost
        || confidence < V2_CONFIG.MIN_CONFIDENCE
      ) {
        dropReasons['score'] = (dropReasons['score'] ?? 0) + 1;
        continue;
      }
      f.scoreOk++;

      if (!passesEntryBarQuality(signalBar, atrValue, { maxSignalCloseLocation: 0.8 }, 'long').ok) {
        dropReasons['chase'] = (dropReasons['chase'] ?? 0) + 1;
        continue;
      }
      f.chaseOk++;

      if (!passesConfirmBar(signalBar, confirmBar, 'bullish_close', 'long').ok) {
        dropReasons['confirm'] = (dropReasons['confirm'] ?? 0) + 1;
        continue;
      }
      f.confirmOk++;
      f.entryEligible++;
    }
  }

  const topDrops = Object.entries(dropReasons)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([k, n]) => ({ reason: k, n }));

  console.log('  funnel', f);
  console.log('  topDrops', topDrops);
  (f as Funnel & { topDrops?: typeof topDrops }).topDrops = topDrops as never;
  return Object.assign(f, { topDrops });
}

async function main(): Promise<void> {
  mkdirSync('/opt/cursor/artifacts', { recursive: true });
  mkdirSync('/cursor/stores/self/artifacts', { recursive: true });
  initializeDatabase();
  initV2Tables();
  (V2_CONFIG as { ALLOWED_REGIMES: readonly string[] }).ALLOWED_REGIMES = ['STRONG_UP'];
  (V2_CONFIG as { MAX_ATR_PERCENT: number }).MAX_ATR_PERCENT = 2.5;
  (V2_CONFIG as { MIN_ATR_PERCENT: number }).MIN_ATR_PERCENT = 1.5;

  const endRecent = new Date();
  endRecent.setUTCHours(0, 0, 0, 0);
  const endEarlier90 = new Date(endRecent.getTime() - 45 * 86400000);

  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  Paper-stack filter funnel (STRONG_UP+ADX20+confirm)   ║');
  console.log('╚══════════════════════════════════════════════════════════╝');

  const earlier = await funnelWindow('earlier90', 90, endEarlier90);
  const oos = await funnelWindow('oos45', 45, endRecent);

  const out = {
    generatedAt: new Date().toISOString(),
    stack: 'STRONG_UP + ATR1.5-2.5 + ADX≥20 + score/conf + chase≤0.80 + bullish_close confirm',
    earlier90: earlier,
    oos45: oos,
  };
  writeFileSync('/opt/cursor/artifacts/edge-funnel-adx20-9045.json', JSON.stringify(out, null, 2));
  writeFileSync('/cursor/stores/self/artifacts/edge-funnel-adx20-9045.json', JSON.stringify(out, null, 2));
  console.log('\nWrote edge-funnel-adx20-9045.json');
  console.log(
    `earlier entryEligible=${earlier.entryEligible} / bars=${earlier.bars} | oos entryEligible=${oos.entryEligible} / bars=${oos.bars}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
