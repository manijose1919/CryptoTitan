import { describe, expect, it } from 'vitest';
import {
  advancePendingOnClosedBar,
  createPendingFromSignal,
  isEntryBarOpen,
  PROMOTE_ENTRY_QUALITY,
} from './pendingConfirmEntry.ts';
import type { Candle } from './types.ts';

function bar(time: number, o: number, h: number, l: number, c: number): Candle {
  return { time, open: o, high: h, low: l, close: c, volume: 1 };
}

describe('pendingConfirmEntry (promote package)', () => {
  // Unit times use a 1000ms bar so fixtures stay small; promote default is 4h.
  const cfg = { ...PROMOTE_ENTRY_QUALITY, barIntervalMs: 1000 };

  it('rejects chase signal bars (close near high)', () => {
    const signal = bar(1000, 100, 110, 100, 109); // closeLoc=0.9
    const r = createPendingFromSignal('ETHUSD', signal, 2, 2.0, cfg);
    expect(r.ok).toBe(false);
  });

  it('rejects low atr% signals', () => {
    const signal = bar(1000, 100, 105, 99, 102); // closeLoc mid
    const r = createPendingFromSignal('ETHUSD', signal, 2, 1.2, cfg);
    expect(r.ok).toBe(false);
  });

  it('arms entry after bullish confirm and drops on red confirm', () => {
    const signal = bar(1000, 100, 105, 99, 102);
    const created = createPendingFromSignal('ETHUSD', signal, 2, 2.0, cfg);
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const red = bar(2000, 102, 103, 100, 100.5);
    const dropped = advancePendingOnClosedBar(created.pending, red, cfg);
    expect(dropped.action).toBe('drop');
    expect(dropped.pending).toBeNull();

    const created2 = createPendingFromSignal('ETHUSD', signal, 2, 2.0, cfg);
    if (!created2.ok) return;
    const green = bar(2000, 102, 106, 101, 105);
    const armed = advancePendingOnClosedBar(created2.pending, green, cfg);
    expect(armed.action).toBe('arm_entry');
    expect(armed.pending?.status).toBe('ready_enter');
    expect(isEntryBarOpen(armed.pending!, 2000)).toBe(true);
  });

  it('drops pending if entry bar closes without a fill', () => {
    const signal = bar(1000, 100, 105, 99, 102);
    const created = createPendingFromSignal('ETHUSD', signal, 2, 2.0, cfg);
    if (!created.ok) return;
    const green = bar(1000 + cfg.barIntervalMs, 102, 106, 101, 105);
    const armed = advancePendingOnClosedBar(created.pending, green, cfg);
    expect(armed.pending).not.toBeNull();
    const entryClosed = bar(1000 + 2 * cfg.barIntervalMs, 105, 107, 104, 106);
    const missed = advancePendingOnClosedBar(armed.pending!, entryClosed, cfg);
    expect(missed.action).toBe('drop');
    expect(missed.pending).toBeNull();
  });

  it('drops await_confirm when a later bar skips the T+1 confirm window', () => {
    // Reproduce post-suspend soak bug: signal 12:00, wake on 00:00 (+3 bars).
    const liveCfg = PROMOTE_ENTRY_QUALITY; // 4h
    const interval = liveCfg.barIntervalMs;
    const signal = bar(1_000_000, 100, 105, 99, 102);
    const created = createPendingFromSignal('SOLUSD', signal, 2, 2.0, liveCfg);
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const skipped = bar(1_000_000 + 3 * interval, 102, 108, 101, 107); // bullish but late
    const missed = advancePendingOnClosedBar(created.pending, skipped, liveCfg);
    expect(missed.action).toBe('drop');
    expect(missed.pending).toBeNull();
    expect(missed.reason).toMatch(/missed confirm bar/);
  });

  it('waits when closed bar is before the expected confirm time', () => {
    const signal = bar(1000, 100, 105, 99, 102);
    const created = createPendingFromSignal('SOLUSD', signal, 2, 2.0, cfg);
    if (!created.ok) return;
    const tooEarly = bar(1000 + 500, 102, 103, 101, 102.5);
    const waited = advancePendingOnClosedBar(created.pending, tooEarly, cfg);
    expect(waited.action).toBe('wait');
    expect(waited.pending).not.toBeNull();
  });
});
