/**
 * Shared WS quote freshness check.
 * Stale websocket caches (esp. after host suspend) must not drive exits:
 * paper SOLUSD 2026-09-22 entered at 4h close ~117 then same-loop
 * stop-loss'd on a WS quote of ~99 (holdMs=1) for −$35.
 */
export const DEFAULT_WS_PRICE_MAX_AGE_MS = 60_000;

export function isWsPriceFresh(
  price: number | null | undefined,
  updatedAtMs: number | null | undefined,
  nowMs: number,
  maxAgeMs: number = DEFAULT_WS_PRICE_MAX_AGE_MS,
): boolean {
  if (price == null || !(price > 0)) return false;
  if (updatedAtMs == null || !Number.isFinite(updatedAtMs)) return false;
  const age = nowMs - updatedAtMs;
  if (age < 0) return false;
  return age <= maxAgeMs;
}
