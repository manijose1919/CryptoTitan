#!/usr/bin/env node
/**
 * Diagnostic: why scanner-PASS tickers produce no TREND signals (research/ops).
 * Prints ADX vs TREND_MIN and composite score vs MIN_COMPOSITE for CAD10 on 4h.
 *
 * Usage:
 *   DATA_DIR=/tmp/cryptotitan-edge-research \
 *     node --experimental-strip-types scripts/diag-pass-no-signal.ts
 */
import { initializeDatabase } from '../services/database.js';
import { initV2Tables } from '../v2/attribution/attributionStore.ts';
import { V2_CONFIG, ADX_THRESHOLDS } from '../v2/engine/config.ts';
import { fetchAllCandles } from '../v2/engine/candleManager.ts';
import { scanMarket } from '../v2/pipeline/marketScanner.ts';
import { generateSignals } from '../v2/pipeline/signalGenerator.ts';
import { adx } from '../v2/indicators/indicators.ts';
import type { Candle } from '../v2/pipeline/types.ts';
import { writeFileSync, mkdirSync } from 'node:fs';

async function main(): Promise<void> {
  mkdirSync('/opt/cursor/artifacts', { recursive: true });
  mkdirSync('/cursor/stores/self/artifacts', { recursive: true });
  initializeDatabase();
  initV2Tables();

  const tickers = [...V2_CONFIG.SCAN_TICKERS];
  const tf = V2_CONFIG.CANDLE_INTERVAL;
  const all = await fetchAllCandles(tickers, [tf]);
  const tfCandles = new Map<string, Candle[]>();
  for (const [t, tfMap] of all) {
    const candles = tfMap.get(tf);
    if (candles && candles.length >= V2_CONFIG.MIN_CANDLES) tfCandles.set(t, candles);
  }

  const scanResults = scanMarket(tfCandles);
  const rows = [];
  for (const scan of scanResults) {
    const candles = tfCandles.get(scan.ticker);
    const adxVal = candles && candles.length >= 30 ? adx(candles) : null;
    const adxOk = adxVal != null && adxVal >= ADX_THRESHOLDS.TREND_MIN;
    let score: number | null = null;
    let scoreReason = '';
    let scorePassed = false;
    if (scan.passed && adxOk && candles) {
      const sigs = generateSignals([scan], new Map([[scan.ticker, candles]]));
      const s = sigs[0];
      if (s) {
        score = s.compositeScore;
        scoreReason = s.reason ?? '';
        scorePassed = s.passed;
      }
    }
    const block =
      !scan.passed ? `scan: ${scan.reason}`
        : !adxOk ? `ADX ${adxVal?.toFixed(1)} < ${ADX_THRESHOLDS.TREND_MIN}`
          : !scorePassed ? `score: ${scoreReason || score}`
            : 'WOULD SIGNAL';
    const row = {
      ticker: scan.ticker,
      regime: scan.regime,
      scanPassed: scan.passed,
      scanReason: scan.reason,
      adx: adxVal != null ? Number(adxVal.toFixed(2)) : null,
      adxOk,
      score,
      scorePassed,
      scoreReason,
      block,
    };
    rows.push(row);
    console.log(
      `${scan.ticker.padEnd(8)} scan=${scan.passed ? 'PASS' : 'FAIL'} adx=${adxVal?.toFixed(1) ?? 'n/a'} `
      + `score=${score?.toFixed(1) ?? '-'} → ${block}`,
    );
  }

  const out = {
    generatedAt: new Date().toISOString(),
    trendMinAdx: ADX_THRESHOLDS.TREND_MIN,
    minComposite: V2_CONFIG.MIN_COMPOSITE_SCORE,
    minConfidence: V2_CONFIG.MIN_CONFIDENCE,
    rows,
    wouldSignal: rows.filter((r) => r.block === 'WOULD SIGNAL').map((r) => r.ticker),
  };
  writeFileSync('/opt/cursor/artifacts/diag-pass-no-signal.json', JSON.stringify(out, null, 2));
  writeFileSync('/cursor/stores/self/artifacts/diag-pass-no-signal.json', JSON.stringify(out, null, 2));
  console.log('\nWould signal:', out.wouldSignal);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
