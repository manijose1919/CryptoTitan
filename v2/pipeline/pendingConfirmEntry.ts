// ============================================
// Pending confirmation-bar entries (paper promote package)
// Signal bar T → confirm T+1 → enter at T+2 open.
// Pure state machine — tradeEngine owns persistence across loops.
// ============================================

import type { Candle } from './types.ts';

export type ConfirmMode = 'bullish_close' | 'close_above_signal' | 'bullish_and_above';

export interface EntryQualityConfig {
  confirmMode: ConfirmMode;
  maxSignalCloseLocation: number;
  minSignalAtrPercent: number;
  /** Signal→confirm must be exactly one bar; skips (e.g. VM suspend) drop. */
  barIntervalMs: number;
}

/** Promote-candidate defaults (2026-10-02 robust 90/45 clear). */
export const PROMOTE_ENTRY_QUALITY: EntryQualityConfig = {
  confirmMode: 'bullish_close',
  maxSignalCloseLocation: 0.8,
  minSignalAtrPercent: 1.5,
  barIntervalMs: 4 * 60 * 60 * 1000,
};

export type PendingStatus = 'await_confirm' | 'ready_enter';

export interface PendingConfirmEntry {
  ticker: string;
  side: 'long' | 'short';
  signalBarTime: number;
  signalClose: number;
  signalOpen: number;
  signalHigh: number;
  signalLow: number;
  atr: number;
  atrPercent: number;
  status: PendingStatus;
  confirmBarTime?: number;
}

function passesChase(
  signalBar: Candle,
  maxCloseLoc: number,
  side: 'long' | 'short',
): { ok: boolean; reason?: string } {
  const range = signalBar.high - signalBar.low;
  if (range <= 0) return { ok: true };
  const closeLoc = (signalBar.close - signalBar.low) / range;
  if (side === 'long' && closeLoc > maxCloseLoc) {
    return { ok: false, reason: `chase closeLoc ${closeLoc.toFixed(2)} > ${maxCloseLoc}` };
  }
  if (side === 'short' && closeLoc < (1 - maxCloseLoc)) {
    return { ok: false, reason: `chase closeLoc ${closeLoc.toFixed(2)} < ${(1 - maxCloseLoc).toFixed(2)}` };
  }
  return { ok: true };
}

function passesConfirm(
  signalBar: Candle,
  confirmBar: Candle,
  mode: ConfirmMode,
  side: 'long' | 'short',
): { ok: boolean; reason?: string } {
  const needBullish = mode === 'bullish_close' || mode === 'bullish_and_above';
  const needAbove = mode === 'close_above_signal' || mode === 'bullish_and_above';
  if (needBullish) {
    const bullish = confirmBar.close > confirmBar.open;
    const bearish = confirmBar.close < confirmBar.open;
    if (side === 'long' && !bullish) return { ok: false, reason: 'confirm bar not bullish' };
    if (side === 'short' && !bearish) return { ok: false, reason: 'confirm bar not bearish' };
  }
  if (needAbove) {
    if (side === 'long' && !(confirmBar.close > signalBar.close)) {
      return { ok: false, reason: 'confirm close ≤ signal close' };
    }
    if (side === 'short' && !(confirmBar.close < signalBar.close)) {
      return { ok: false, reason: 'confirm close ≥ signal close' };
    }
  }
  return { ok: true };
}

export function passesSignalQuality(
  signalBar: Candle,
  atrPercent: number,
  cfg: EntryQualityConfig,
  side: 'long' | 'short' = 'long',
): { ok: boolean; reason?: string } {
  if (atrPercent < cfg.minSignalAtrPercent) {
    return { ok: false, reason: `atr% ${atrPercent.toFixed(2)} < min ${cfg.minSignalAtrPercent}` };
  }
  return passesChase(signalBar, cfg.maxSignalCloseLocation, side);
}

export function createPendingFromSignal(
  ticker: string,
  signalBar: Candle,
  atr: number,
  atrPercent: number,
  cfg: EntryQualityConfig,
  side: 'long' | 'short' = 'long',
): { ok: true; pending: PendingConfirmEntry } | { ok: false; reason: string } {
  const q = passesSignalQuality(signalBar, atrPercent, cfg, side);
  if (!q.ok) return { ok: false, reason: q.reason ?? 'signal quality' };
  return {
    ok: true,
    pending: {
      ticker,
      side,
      signalBarTime: signalBar.time,
      signalClose: signalBar.close,
      signalOpen: signalBar.open,
      signalHigh: signalBar.high,
      signalLow: signalBar.low,
      atr,
      atrPercent,
      status: 'await_confirm',
    },
  };
}

/**
 * Advance pending state when a new closed bar arrives.
 * - await_confirm + exact next bar → ready_enter (or drop on failed confirm)
 * - await_confirm + skipped bar(s) → drop (missed confirm window; backtest uses T+1 only)
 * - ready_enter + entry bar closed without fill → drop
 */
export function advancePendingOnClosedBar(
  pending: PendingConfirmEntry,
  closedBar: Candle,
  cfg: EntryQualityConfig,
): { pending: PendingConfirmEntry | null; action: 'wait' | 'drop' | 'arm_entry' | 'enter_now'; reason?: string } {
  if (closedBar.time <= pending.signalBarTime) {
    return { pending, action: 'wait' };
  }

  if (pending.status === 'await_confirm') {
    const expectedConfirmTime = pending.signalBarTime + cfg.barIntervalMs;
    if (closedBar.time < expectedConfirmTime) {
      return { pending, action: 'wait' };
    }
    if (closedBar.time > expectedConfirmTime) {
      return {
        pending: null,
        action: 'drop',
        reason: `missed confirm bar (got ${new Date(closedBar.time).toISOString()}, expected ${new Date(expectedConfirmTime).toISOString()})`,
      };
    }
    const signalBar: Candle = {
      time: pending.signalBarTime,
      open: pending.signalOpen,
      high: pending.signalHigh,
      low: pending.signalLow,
      close: pending.signalClose,
      volume: 0,
    };
    const conf = passesConfirm(signalBar, closedBar, cfg.confirmMode, pending.side);
    if (!conf.ok) {
      return { pending: null, action: 'drop', reason: conf.reason ?? 'confirm failed' };
    }
    return {
      pending: {
        ...pending,
        status: 'ready_enter',
        confirmBarTime: closedBar.time,
      },
      action: 'arm_entry',
    };
  }

  // ready_enter: if a bar after confirm closes, entry window was missed.
  if (pending.confirmBarTime != null && closedBar.time > pending.confirmBarTime) {
    return { pending: null, action: 'drop', reason: 'missed entry bar open' };
  }
  return { pending, action: 'enter_now' };
}

/** True when confirm just closed — entry is at the open of the forming next bar. */
export function isEntryBarOpen(
  pending: PendingConfirmEntry,
  latestClosedBarTime: number,
): boolean {
  return (
    pending.status === 'ready_enter'
    && pending.confirmBarTime != null
    && latestClosedBarTime === pending.confirmBarTime
  );
}
