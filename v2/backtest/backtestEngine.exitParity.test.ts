import { describe, expect, it } from 'vitest';
import { checkExitOnBar, resolvePaperTrendExitConfig } from './backtestEngine.ts';
import type { BacktestConfig, BacktestTrade } from './types.ts';
import type { Candle } from '../pipeline/types.ts';
import { STRATEGY_EXIT_CONFIGS, V2_CONFIG } from '../engine/config.ts';

function baseConfig(overrides: Partial<BacktestConfig> = {}): BacktestConfig {
  return {
    startDate: new Date('2026-06-01'),
    endDate: new Date('2026-09-01'),
    tickers: ['LINKUSD'],
    budgetPerTicker: 100,
    interval: '4h',
    intervalMinutes: 240,
    maxOpenPositions: 1,
    feeRoundTrip: 0.0052,
    slippagePerSide: 0.0005,
    barSequence: 'pessimistic',
    seed: false,
    ...overrides,
  };
}

function flatBar(close: number): Candle {
  return { time: Date.now(), open: close, high: close, low: close, close, volume: 1 };
}

function baseTrade(overrides: Partial<BacktestTrade> = {}): BacktestTrade {
  const entry = 14.287910385;
  return {
    id: 'bt_parity_1',
    ticker: 'LINKUSD',
    side: 'long',
    entryBar: 10,
    entryPrice: entry,
    entryTime: Date.now(),
    entrySignals: {} as BacktestTrade['entrySignals'],
    entryRegime: 'STRONG_UP',
    entryConfidence: 0.65,
    compositeScore: 65,
    exitBar: null,
    exitPrice: null,
    exitTime: null,
    exitReason: null,
    quantity: 9.29,
    positionSizeUsd: 132.78,
    stopLoss: entry * 0.97,
    takeProfit: entry * 1.09,
    currentStop: entry * 0.97,
    trailingActivated: false,
    peakPrice: entry,
    pnlGross: null,
    pnlNet: null,
    feesPaid: 0,
    holdBars: 0,
    holdDurationMs: null,
    atrPercent: 2.25,
    ...overrides,
  };
}

describe('backtestEngine exit parity with paper STRATEGY_EXIT_CONFIGS.TREND', () => {
  it('resolves 4h timeKillBars=2 and trail activate with fee floor (≥ paper 1.4%)', () => {
    const cfg = resolvePaperTrendExitConfig('4h');
    expect(cfg.timeKillBarsResolved).toBe(STRATEGY_EXIT_CONFIGS.TREND.timeKillBars);
    expect(cfg.trailActivatePercentFloored).toBeGreaterThanOrEqual(
      STRATEGY_EXIT_CONFIGS.TREND.trailActivatePercent,
    );
    // Fee floor: 0.52% × 3 = 1.56% > paper 1.4% → floored value wins
    expect(cfg.trailActivatePercentFloored).toBeCloseTo(
      V2_CONFIG.FEE_ROUND_TRIP_TAKER * V2_CONFIG.TRAIL_ACTIVATE_FEE_FLOOR_MULT,
      6,
    );
  });

  it('resolves 1h timeKillBars from ByTf override (4), not the 4h default (2)', () => {
    const cfg = resolvePaperTrendExitConfig('1h');
    expect(cfg.timeKillBarsResolved).toBe(STRATEGY_EXIT_CONFIGS.TREND.timeKillBarsByTf?.['1h']);
  });

  it('exposes paper TREND slAtrMult/tpAtrMult for entry stop/target parity', () => {
    const cfg = resolvePaperTrendExitConfig('4h');
    expect(cfg.slAtrMult).toBe(STRATEGY_EXIT_CONFIGS.TREND.slAtrMult);
    expect(cfg.tpAtrMult).toBe(STRATEGY_EXIT_CONFIGS.TREND.tpAtrMult);
  });

  it('time-kills after ≥2×4h bars when |move| < minMove (paper bar×tf, not 6h wall clock)', () => {
    const trade = baseTrade();
    const config = baseConfig({ interval: '4h', intervalMinutes: 240 });
    // Stagnant close: ~−0.35% < 0.7% min move
    const bar = flatBar(trade.entryPrice * 0.9965);

    // After 1 bar: should NOT time-kill yet (paper needs 2)
    const early = checkExitOnBar(trade, bar, trade.entryBar + 1, config);
    expect(early.exitReason).not.toBe('time_kill');

    // After 2 bars: SHOULD time-kill
    const killed = checkExitOnBar(trade, bar, trade.entryBar + 2, config);
    expect(killed.shouldExit).toBe(true);
    expect(killed.exitReason).toBe('time_kill');
  });

  it('does not time-kill at 2 bars when move exceeds minMove', () => {
    const trade = baseTrade();
    const config = baseConfig({ interval: '4h', intervalMinutes: 240 });
    const bar = flatBar(trade.entryPrice * 1.01); // +1% > 0.7%
    const result = checkExitOnBar(trade, bar, trade.entryBar + 2, config);
    expect(result.exitReason).not.toBe('time_kill');
  });
});
