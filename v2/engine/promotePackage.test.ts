import { describe, expect, it } from 'vitest';
import { V2_CONFIG } from './config.ts';
import { PROMOTE_ENTRY_QUALITY } from '../pipeline/pendingConfirmEntry.ts';

describe('2026-10-03 UP+confirm promote package config', () => {
  it('keeps allow-UP tied to confirm + ATR band + chase defaults', () => {
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
    // UP still restricted off 1h
    expect(V2_CONFIG.REGIME_TIMEFRAME_RESTRICT.UP).toEqual(['4h']);
  });

  it('stays paper-safe (no live confirmation env)', () => {
    expect(V2_CONFIG.MODE).not.toBe('live');
    expect(process.env.V2_LIVE_CONFIRMED).not.toBe('yes');
  });
});
