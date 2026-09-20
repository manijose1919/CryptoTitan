import { describe, expect, it, vi } from 'vitest';
import { checkExits, type ExitMutators } from './exitManager.ts';
import type { V2Trade } from './types.ts';
import type { ExchangeAdapter } from '../exchange/types.ts';

function baseLongTrade(overrides: Partial<V2Trade> = {}): V2Trade {
  // Reproduce paper DOTUSD (3bc03cfb): after >1×4h bar underwater, quick-kill
  // computed entry - 0.6×ATR ≈ 1.118 while spot was 1.1055 — stop through market.
  const entry = 1.1369682;
  const atrPercent = 2.7874364921596673;
  const initialStop = entry - (entry * atrPercent / 100) * 1.5;
  return {
    id: 'qk-clamp-long',
    ticker: 'DOTUSD',
    side: 'long',
    status: 'open',
    entryPrice: entry,
    entryTime: Date.now() - (5 * 60 * 60 * 1000), // past TREND quickKillBars×4h
    entryOrderType: 'maker',
    quantity: 246.27,
    positionSizeUsd: 280,
    exitPrice: null,
    exitTime: null,
    exitReason: null,
    pnlGross: null,
    pnlNet: null,
    feesPaid: 0,
    holdDurationMs: null,
    initialStop,
    currentStop: initialStop,
    takeProfitTarget: entry * 1.11,
    trailingActivated: false,
    entrySignals: {} as V2Trade['entrySignals'],
    entryRegime: 'STRONG_UP',
    entryConfidence: 0.76,
    atrPercent,
    peakPrice: entry,
    strategy: 'TREND',
    timeframe: '4h',
    decisionLog: [],
    createdAt: Date.now(),
    ...overrides,
  };
}

function mockExchange(price: number): ExchangeAdapter {
  return {
    getLatestPrice: vi.fn(async () => price),
  } as unknown as ExchangeAdapter;
}

function memoryMutators(): ExitMutators & { stops: number[] } {
  const stops: number[] = [];
  return {
    stops,
    setStop: (_id, newStop, trade) => {
      stops.push(newStop);
      trade.currentStop = newStop;
    },
    setTrailingActivated: (_id, trade) => {
      trade.trailingActivated = true;
    },
    setPeakPrice: (_id, newPeak, trade) => {
      trade.peakPrice = newPeak;
    },
  };
}

describe('exitManager quick-kill stop clamp', () => {
  it('does not raise a long stop through/above currentPrice (DOTUSD paper soak)', async () => {
    const trade = baseLongTrade();
    const currentPrice = 1.1055; // below the would-be quick-kill stop ~1.118
    const mutators = memoryMutators();

    const [result] = await checkExits([trade], mockExchange(currentPrice), mutators);

    expect(result.shouldExit).toBe(false);
    // Must not persist a stop on the wrong side of the market.
    for (const stop of mutators.stops) {
      expect(stop).toBeLessThan(currentPrice);
    }
    expect(result.newStop).toBeLessThan(currentPrice);
    expect(trade.currentStop).toBeLessThan(currentPrice);
  });

  it('does not lower a short stop through/below currentPrice', async () => {
    const entry = 100;
    const atrPercent = 2.8;
    const initialStop = entry + (entry * atrPercent / 100) * 1.5;
    const trade = baseLongTrade({
      id: 'qk-clamp-short',
      side: 'short',
      entryPrice: entry,
      initialStop,
      currentStop: initialStop,
      takeProfitTarget: entry * 0.89,
      atrPercent,
      peakPrice: entry,
    });
    const currentPrice = 102.5; // above the would-be short quick-kill stop
    const mutators = memoryMutators();

    const [result] = await checkExits([trade], mockExchange(currentPrice), mutators);

    expect(result.shouldExit).toBe(false);
    for (const stop of mutators.stops) {
      expect(stop).toBeGreaterThan(currentPrice);
    }
    expect(result.newStop).toBeGreaterThan(currentPrice);
    expect(trade.currentStop).toBeGreaterThan(currentPrice);
  });
});
