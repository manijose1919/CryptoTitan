import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Candle, ScanResult, SignalResult } from '../pipeline/types.ts';
import { ADX_THRESHOLDS, V2_CONFIG } from './config.ts';

vi.mock('../indicators/indicators.ts', () => ({
  adx: vi.fn(),
}));

vi.mock('../pipeline/marketScanner.ts', () => ({
  scanMarket: vi.fn(),
  getPassedTickers: vi.fn(),
}));

vi.mock('../pipeline/signalGenerator.ts', () => ({
  generateSignals: vi.fn(() => []),
  generateShortSignals: vi.fn(() => []),
  getPassedSignals: vi.fn((sigs: SignalResult[]) => sigs),
}));

vi.mock('../pipeline/momentumSignal.ts', () => ({
  detectMomentumEntry: vi.fn(),
}));

vi.mock('../pipeline/breakoutSignal.ts', () => ({
  detectBreakoutEntry: vi.fn(() => null),
}));

import { adx } from '../indicators/indicators.ts';
import { getPassedTickers, scanMarket } from '../pipeline/marketScanner.ts';
import { detectMomentumEntry } from '../pipeline/momentumSignal.ts';
import { runAllStrategies } from './strategyRunner.ts';

function makeCandles(n: number): Candle[] {
  const out: Candle[] = [];
  let t = 1_700_000_000_000;
  for (let i = 0; i < n; i++) {
    out.push({
      time: t,
      open: 10,
      high: 11,
      low: 9,
      close: 10.5,
      volume: 1_000,
    });
    t += 4 * 60 * 60 * 1000;
  }
  return out;
}

function scanPass(ticker: string): ScanResult {
  return {
    ticker,
    passed: true,
    reason: 'PASS',
    regime: 'STRONG_UP',
    atrPercent: 1.8,
    volumeUsd24h: 1_000_000,
    spreadPercent: 0.05,
  };
}

describe('strategyRunner ADX parity (TREND + MOMENTUM)', () => {
  const tf = V2_CONFIG.CANDLE_INTERVAL;
  const ticker = 'AVAXUSD';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(scanMarket).mockReturnValue([scanPass(ticker)]);
    vi.mocked(getPassedTickers).mockReturnValue([scanPass(ticker)]);
    vi.mocked(detectMomentumEntry).mockReturnValue({
      ticker,
      passed: true,
      confidence: 0.75,
      compositeScore: 75,
      regime: 'STRONG_UP',
      side: 'long',
      reason: 'momentum',
      signals: { atr: 0.2, atr_percent: 1.8 },
    } as unknown as SignalResult);
  });

  it('blocks MOMENTUM when ADX < TREND_MIN (AVAX-style desync)', () => {
    vi.mocked(adx).mockReturnValue(ADX_THRESHOLDS.TREND_MIN - 4.8); // 15.2

    const candles = makeCandles(Math.max(V2_CONFIG.MIN_CANDLES, 50));
    const allCandles = new Map([[ticker, new Map([[tf, candles]])]]);

    const signals = runAllStrategies(allCandles, [ticker]);

    expect(signals.filter(s => s._strategy === 'MOMENTUM')).toHaveLength(0);
    expect(signals.filter(s => s._strategy === 'TREND')).toHaveLength(0);
    expect(detectMomentumEntry).not.toHaveBeenCalled();
  });

  it('allows MOMENTUM when ADX >= TREND_MIN and TREND has no signal', () => {
    vi.mocked(adx).mockReturnValue(ADX_THRESHOLDS.TREND_MIN + 5);

    const candles = makeCandles(Math.max(V2_CONFIG.MIN_CANDLES, 50));
    const allCandles = new Map([[ticker, new Map([[tf, candles]])]]);

    const signals = runAllStrategies(allCandles, [ticker]);

    expect(detectMomentumEntry).toHaveBeenCalled();
    expect(signals.some(s => s._strategy === 'MOMENTUM' && s.ticker === ticker)).toBe(true);
  });
});
