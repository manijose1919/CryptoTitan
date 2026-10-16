import { describe, expect, it, afterEach } from 'vitest';
import {
  getSignalWeightMode,
  resolveSignalWeight,
  setSignalWeightMode,
} from './signalGenerator.ts';

describe('signal weight mode', () => {
  afterEach(() => {
    setSignalWeightMode('adaptive');
  });

  it('defaults to adaptive unless V2_SIGNAL_WEIGHT_MODE=static', () => {
    expect(getSignalWeightMode()).toBe('adaptive');
  });

  it('static mode ignores proven/negative scorecard verdicts', () => {
    const verdicts = new Map([
      ['bb_percent_b', 'negative'],
      ['macd_cross', 'proven'],
    ]);
    expect(resolveSignalWeight('bb_lower_touch', 40, verdicts, 'static')).toBe(40);
    expect(resolveSignalWeight('macd_cross', 40, verdicts, 'static')).toBe(40);
  });

  it('adaptive mode prunes negative and boosts proven', () => {
    const verdicts = new Map([
      ['bb_percent_b', 'negative'],
      ['macd_cross', 'proven'],
    ]);
    expect(resolveSignalWeight('bb_lower_touch', 40, verdicts, 'adaptive')).toBe(0);
    expect(resolveSignalWeight('macd_cross', 40, verdicts, 'adaptive')).toBe(60);
  });

  it('setSignalWeightMode switches runtime mode', () => {
    setSignalWeightMode('static');
    expect(getSignalWeightMode()).toBe('static');
  });
});
