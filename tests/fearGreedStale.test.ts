import { describe, expect, it } from 'vitest';

/**
 * Pure contract for wall-clock F&G refresh after VM suspend.
 * Mirrors services/fearGreedGate.js isFearGreedFetchStale.
 */
function isFearGreedFetchStale(
  lastFetchTime: number,
  now: number,
  maxAgeMs: number,
): boolean {
  if (!lastFetchTime) return true;
  return now - lastFetchTime > maxAgeMs;
}

describe('fearGreed wall-clock stale check', () => {
  const interval = 30 * 60 * 1000;

  it('is stale when never fetched or older than interval', () => {
    expect(isFearGreedFetchStale(0, 1_000_000, interval)).toBe(true);
    expect(isFearGreedFetchStale(1_000_000, 1_000_000 + interval + 1, interval)).toBe(true);
  });

  it('is fresh within the fetch interval (suspend-safe)', () => {
    expect(isFearGreedFetchStale(1_000_000, 1_000_000 + interval, interval)).toBe(false);
    expect(isFearGreedFetchStale(1_000_000, 1_000_000 + 60_000, interval)).toBe(false);
  });
});
