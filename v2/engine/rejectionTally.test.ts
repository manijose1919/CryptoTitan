import { describe, expect, it } from 'vitest';
import { tallyFailed } from './rejectionTally.ts';

describe('tallyFailed', () => {
  it('counts only failed scan/signal results for health counters', () => {
    expect(tallyFailed([])).toBe(0);
    expect(tallyFailed([{ passed: true }, { passed: false }, { passed: false }])).toBe(2);
  });
});
