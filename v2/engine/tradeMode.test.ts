import { describe, expect, it } from 'vitest';
import { resolveV2Mode } from './tradeMode.ts';

describe('V2 mode safety interlock', () => {
  it('downgrades unconfirmed live mode to paper', () => {
    expect(resolveV2Mode('live', undefined)).toBe('paper');
    expect(resolveV2Mode('live', 'no')).toBe('paper');
  });

  it('requires an exact explicit confirmation for live mode', () => {
    expect(resolveV2Mode('live', 'yes')).toBe('live');
  });

  it('preserves non-live modes', () => {
    expect(resolveV2Mode('paper', undefined)).toBe('paper');
    expect(resolveV2Mode('shadow', undefined)).toBe('shadow');
  });

  it('does not treat case variants or unknown values as live', () => {
    expect(resolveV2Mode('LIVE', 'yes')).toBe('paper');
    expect(resolveV2Mode('live', 'YES')).toBe('paper');
    expect(resolveV2Mode(undefined, 'yes')).toBe('paper');
    expect(resolveV2Mode('paper-prod', 'yes')).toBe('paper');
  });
});
