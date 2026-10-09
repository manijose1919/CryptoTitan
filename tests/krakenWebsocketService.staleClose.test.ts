import { describe, expect, it } from 'vitest';
import { isStaleSocketEvent } from '../services/krakenWebsocketService.js';

describe('KrakenWS stale socket close guard', () => {
  it('treats a replaced socket close as stale', () => {
    const current = { id: 'new' };
    const dying = { id: 'old' };
    expect(isStaleSocketEvent(current, dying)).toBe(true);
  });

  it('treats the current socket close as live', () => {
    const current = { id: 'live' };
    expect(isStaleSocketEvent(current, current)).toBe(false);
  });

  it('is not stale when either side is null', () => {
    const current = { id: 'live' };
    expect(isStaleSocketEvent(null, current)).toBe(false);
    expect(isStaleSocketEvent(current, null)).toBe(false);
    expect(isStaleSocketEvent(null, null)).toBe(false);
  });
});
