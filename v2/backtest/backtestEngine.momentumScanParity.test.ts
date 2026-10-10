import { describe, expect, it } from 'vitest';
import { isMomentumScanEligible } from './backtestEngine.ts';

describe('isMomentumScanEligible (paper strategyRunner parity)', () => {
  it('requires scan PASS and ADX together', () => {
    expect(isMomentumScanEligible(true, true)).toBe(true);
    expect(isMomentumScanEligible(false, true)).toBe(false);
    expect(isMomentumScanEligible(true, false)).toBe(false);
    expect(isMomentumScanEligible(false, false)).toBe(false);
  });
});
