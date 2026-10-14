import { describe, expect, it } from 'vitest';
import {
  isStaleSocketEvent,
  buildWsHealthSnapshot,
} from '../services/krakenWebsocketService.js';

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

describe('KrakenWS health snapshot', () => {
  it('reports lastConnectedAt and message age for soak monitors', () => {
    const snap = buildWsHealthSnapshot({
      connected: true,
      lastConnectedAt: 1_000,
      lastMessageTime: 1_500,
      now: 2_000,
    });
    expect(snap).toEqual({
      connected: true,
      lastConnectedAt: 1_000,
      lastMessageAgeMs: 500,
    });
  });

  it('returns null message age when no messages yet', () => {
    const snap = buildWsHealthSnapshot({
      connected: false,
      lastConnectedAt: null,
      lastMessageTime: 0,
      now: 9_999,
    });
    expect(snap.lastMessageAgeMs).toBeNull();
    expect(snap.lastConnectedAt).toBeNull();
  });
});
