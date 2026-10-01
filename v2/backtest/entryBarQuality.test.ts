import { describe, expect, it } from 'vitest';
import { passesEntryBarQuality, passesSignalAtrBand } from './backtestEngine.ts';
import type { Candle } from '../pipeline/types.ts';

function bar( partial: Partial<Candle> & Pick<Candle, 'open' | 'high' | 'low' | 'close'>): Candle {
  return { time: 0, volume: 1, ...partial };
}

describe('passesEntryBarQuality', () => {
  it('rejects long chase when close is near the high', () => {
    const signal = bar({ open: 100, high: 110, low: 100, close: 109 }); // closeLoc=0.9
    const r = passesEntryBarQuality(signal, 2, { maxSignalCloseLocation: 0.8 }, 'long');
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/chase/);
  });

  it('allows pullback close in lower half of range', () => {
    const signal = bar({ open: 105, high: 110, low: 100, close: 102 }); // closeLoc=0.2
    const r = passesEntryBarQuality(signal, 2, { maxSignalCloseLocation: 0.8 }, 'long');
    expect(r.ok).toBe(true);
  });

  it('rejects chaotic wide-range signal bars', () => {
    const signal = bar({ open: 100, high: 110, low: 100, close: 105 }); // range=10, atr=4 → 2.5x
    const r = passesEntryBarQuality(signal, 4, { maxSignalRangeAtrMult: 2.0 }, 'long');
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/range\/ATR/);
  });
});

describe('passesSignalAtrBand', () => {
  it('rejects below min atr%', () => {
    const r = passesSignalAtrBand(1.2, { minSignalAtrPercent: 1.5 });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/min/);
  });

  it('rejects above max atr%', () => {
    const r = passesSignalAtrBand(3.1, { maxSignalAtrPercent: 2.5 });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/max/);
  });

  it('allows in-band atr%', () => {
    expect(passesSignalAtrBand(2.0, { minSignalAtrPercent: 1.5, maxSignalAtrPercent: 2.5 }).ok).toBe(true);
  });
});
