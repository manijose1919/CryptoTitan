import { describe, expect, it } from 'vitest';
import { DEFAULT_FLAGS } from '../services/systemConfig.js';

describe('systemConfig paper-first defaults', () => {
  it('does not enable the unvalidated ML gatekeeper or surge sniper by default', () => {
    expect(DEFAULT_FLAGS.ML_GATEKEEPER_ENABLED).toBe(false);
    expect(DEFAULT_FLAGS.SNIPER_MODE_ENABLED).toBe(false);
  });
});
