import { describe, expect, it, afterEach } from 'vitest';
import {
  resolveV2Mode,
  isLiveTradingConfirmed,
  assertLiveOrdersAllowed,
} from './tradeMode.ts';

describe('live trading interlock', () => {
  const prevMode = process.env.V2_MODE;
  const prevConfirm = process.env.V2_LIVE_CONFIRMED;

  afterEach(() => {
    if (prevMode === undefined) delete process.env.V2_MODE;
    else process.env.V2_MODE = prevMode;
    if (prevConfirm === undefined) delete process.env.V2_LIVE_CONFIRMED;
    else process.env.V2_LIVE_CONFIRMED = prevConfirm;
  });

  it('resolveV2Mode still downgrades unconfirmed live to paper', () => {
    expect(resolveV2Mode('live', undefined)).toBe('paper');
    expect(resolveV2Mode('live', 'no')).toBe('paper');
    expect(resolveV2Mode('live', 'yes')).toBe('live');
  });

  it('isLiveTradingConfirmed requires both live mode and confirmation', () => {
    process.env.V2_MODE = 'paper';
    process.env.V2_LIVE_CONFIRMED = 'no';
    expect(isLiveTradingConfirmed()).toBe(false);

    process.env.V2_MODE = 'live';
    process.env.V2_LIVE_CONFIRMED = 'no';
    expect(isLiveTradingConfirmed()).toBe(false);

    process.env.V2_MODE = 'live';
    process.env.V2_LIVE_CONFIRMED = 'yes';
    expect(isLiveTradingConfirmed()).toBe(true);
  });

  it('assertLiveOrdersAllowed throws unless dual-confirmed live', () => {
    process.env.V2_MODE = 'paper';
    process.env.V2_LIVE_CONFIRMED = 'no';
    expect(() => assertLiveOrdersAllowed()).toThrow(/Live exchange orders blocked/);

    process.env.V2_MODE = 'live';
    process.env.V2_LIVE_CONFIRMED = 'yes';
    expect(() => assertLiveOrdersAllowed()).not.toThrow();
  });
});
