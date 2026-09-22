import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WS_PRICE_MAX_AGE_MS,
  isWsPriceFresh,
} from './wsPriceFreshness.ts';

describe('WS price freshness (SOLUSD phantom same-loop stop)', () => {
  const now = 1_790_079_014_409;

  it('rejects a WS quote with no update timestamp', () => {
    expect(isWsPriceFresh(99.04, null, now)).toBe(false);
    expect(isWsPriceFresh(99.04, undefined, now)).toBe(false);
  });

  it('rejects a WS quote older than the max age (post-suspend stale cache)', () => {
    const updatedAt = now - DEFAULT_WS_PRICE_MAX_AGE_MS - 1;
    expect(isWsPriceFresh(99.04, updatedAt, now)).toBe(false);
  });

  it('accepts a fresh positive WS quote', () => {
    expect(isWsPriceFresh(117.27, now - 5_000, now)).toBe(true);
  });

  it('rejects non-positive prices even if fresh', () => {
    expect(isWsPriceFresh(0, now, now)).toBe(false);
    expect(isWsPriceFresh(-1, now, now)).toBe(false);
  });
});
