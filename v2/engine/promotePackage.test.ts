import { describe, expect, it } from 'vitest';
import { V2_CONFIG } from './config.ts';
import { PROMOTE_ENTRY_QUALITY } from '../pipeline/pendingConfirmEntry.ts';

describe('2026-10-05 STRONG_UP+confirm package (ADX-parity rollback)', () => {
  it('keeps STRONG_UP-only with confirm + ATR band + chase defaults', () => {
    // UP removed 2026-10-05: promote+ADX20 failed robust 90/45
    expect([...V2_CONFIG.ALLOWED_REGIMES]).toEqual(['STRONG_UP']);
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

  it('stays paper-safe (no live confirmation env)', () => {
    expect(V2_CONFIG.MODE).not.toBe('live');
    expect(process.env.V2_LIVE_CONFIRMED).not.toBe('yes');
  });
});
