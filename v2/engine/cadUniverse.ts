/**
 * Canadian Kraken USD allowlist helpers.
 * Bases match V2_CONFIG.SCAN_TICKERS — USD quote only, never USDT/USDC.
 */

export const CAD_USD_BASES = [
  'BTC', 'ETH', 'XRP', 'BNB', 'SOL', 'ADA', 'DOGE', 'LINK', 'DOT', 'AVAX',
] as const;

const CAD_BASE_SET = new Set<string>(CAD_USD_BASES);

/** Normalize exchange symbols (BTC_USD, btcusd) to BTCUSD. */
export function normalizeUsdTicker(raw: string): string {
  return String(raw).trim().toUpperCase().replace(/_/g, '');
}

/**
 * True only for allowlisted CAD bases with a plain USD quote.
 * Rejects USDT/USDC and any base outside the ten-name Canadian set.
 */
export function isCadUsdTicker(raw: string): boolean {
  const ticker = normalizeUsdTicker(raw);
  if (!ticker || ticker.endsWith('USDT') || ticker.endsWith('USDC')) return false;
  if (!ticker.endsWith('USD')) return false;
  const base = ticker.slice(0, -3);
  return CAD_BASE_SET.has(base);
}
