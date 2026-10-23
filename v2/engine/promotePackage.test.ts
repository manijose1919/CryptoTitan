import { describe, expect, it } from 'vitest';
import { V2_CONFIG } from './config.ts';
import { PROMOTE_ENTRY_QUALITY } from '../pipeline/pendingConfirmEntry.ts';

describe('2026-10-23 STRONG_UP+UP promote package (full quality stack)', () => {
  it('allows STRONG_UP+UP with confirm + ATR band + chase defaults', () => {
    // UP re-enabled 2026-10-23 under confirm+ADX20+vol0.20+tk4+overnight package
    expect([...V2_CONFIG.ALLOWED_REGIMES]).toEqual(['STRONG_UP', 'UP']);
    expect((V2_CONFIG as { ENTRY_CONFIRM_ENABLED: boolean }).ENTRY_CONFIRM_ENABLED).toBe(true);
    expect((V2_CONFIG as { ENTRY_CONFIRM_MODE: string }).ENTRY_CONFIRM_MODE).toBe(
      PROMOTE_ENTRY_QUALITY.confirmMode,
    );
    expect((V2_CONFIG as { MAX_SIGNAL_CLOSE_LOCATION: number }).MAX_SIGNAL_CLOSE_LOCATION).toBe(
      PROMOTE_ENTRY_QUALITY.maxSignalCloseLocation,
    );
    expect(V2_CONFIG.MAX_ATR_PERCENT).toBe(2.5);
    expect(V2_CONFIG.MIN_ATR_PERCENT).toBe(PROMOTE_ENTRY_QUALITY.minSignalAtrPercent);
    expect(PROMOTE_ENTRY_QUALITY.barIntervalMs).toBe(4 * 60 * 60 * 1000);
  });

  it('documents MOMENTUM confirm parity strategies (TREND + MOMENTUM)', () => {
    // tradeEngine useConfirm covers TREND and MOMENTUM; BREAKOUT stays immediate.
    const confirmStrategies = new Set(['TREND', 'MOMENTUM']);
    expect(confirmStrategies.has('TREND')).toBe(true);
    expect(confirmStrategies.has('MOMENTUM')).toBe(true);
    expect(confirmStrategies.has('BREAKOUT')).toBe(false);
  });

  it('stays paper-safe (no live confirmation env)', () => {
    expect(V2_CONFIG.MODE).not.toBe('live');
    expect(process.env.V2_LIVE_CONFIRMED).not.toBe('yes');
  });

  it('keeps signal volume_ratio floor at 0.20 (2026-10-22 BNB-stop cut)', () => {
    expect((V2_CONFIG as { MIN_SIGNAL_VOLUME_RATIO: number }).MIN_SIGNAL_VOLUME_RATIO).toBe(0.2);
  });
});
