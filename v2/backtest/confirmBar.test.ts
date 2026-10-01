import { describe, expect, it } from 'vitest';
import { passesConfirmBar } from './backtestEngine.ts';
import type { Candle } from '../pipeline/types.ts';

function bar(partial: Partial<Candle> & Pick<Candle, 'open' | 'high' | 'low' | 'close'>): Candle {
  return { time: 0, volume: 1, ...partial };
}

describe('passesConfirmBar', () => {
  const signal = bar({ open: 100, high: 105, low: 99, close: 104 });

  it('bullish_close accepts green confirm bar for longs', () => {
    const confirm = bar({ open: 104, high: 106, low: 103, close: 105.5 });
    expect(passesConfirmBar(signal, confirm, 'bullish_close', 'long').ok).toBe(true);
  });

  it('bullish_close rejects red confirm bar for longs', () => {
    const confirm = bar({ open: 104, high: 105, low: 100, close: 101 });
    const r = passesConfirmBar(signal, confirm, 'bullish_close', 'long');
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/not bullish/);
  });

  it('close_above_signal accepts confirm close above signal close', () => {
    const confirm = bar({ open: 103, high: 106, low: 102, close: 105 });
    expect(passesConfirmBar(signal, confirm, 'close_above_signal', 'long').ok).toBe(true);
  });

  it('close_above_signal rejects confirm close at/below signal close', () => {
    const confirm = bar({ open: 104, high: 105, low: 100, close: 103 });
    const r = passesConfirmBar(signal, confirm, 'close_above_signal', 'long');
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/confirm close/);
  });

  it('bullish_close requires bearish bar for shorts', () => {
    const confirm = bar({ open: 104, high: 105, low: 100, close: 101 });
    expect(passesConfirmBar(signal, confirm, 'bullish_close', 'short').ok).toBe(true);
    const green = bar({ open: 100, high: 106, low: 99, close: 105 });
    expect(passesConfirmBar(signal, green, 'bullish_close', 'short').ok).toBe(false);
  });
});
