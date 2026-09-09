/** Kraken USD bases tradable on a Canadian account. Never USDT/USDC. */
export const CANADIAN_USD_BASES = [
  'BTC', 'ETH', 'XRP', 'BNB', 'SOL', 'ADA', 'DOGE', 'LINK', 'DOT', 'AVAX',
] as const;

export type CanadianUsdBase = (typeof CANADIAN_USD_BASES)[number];

const BASE_SET = new Set<string>(CANADIAN_USD_BASES);

export function isCanadianUsdTicker(ticker: string): boolean {
  if (!ticker || ticker.includes('USDT') || ticker.includes('USDC')) {
    return false;
  }
  if (!ticker.endsWith('USD')) {
    return false;
  }
  const base = ticker.slice(0, -3);
  return BASE_SET.has(base);
}

export type PairsRuntimeMode = 'off' | 'paper' | 'live';

/**
 * Pairs stay off unless both legs are CAD USD pairs. Unconfirmed live
 * never becomes live. Non-CAD symbols (FIL/ICP) cannot be enabled by env.
 */
export function resolvePairsRuntimeMode(
  requestedMode: string | undefined,
  liveConfirmation: string | undefined,
  symbolA: string,
  symbolB: string,
): PairsRuntimeMode {
  if (!isCanadianUsdTicker(symbolA) || !isCanadianUsdTicker(symbolB)) {
    return 'off';
  }
  if (requestedMode === 'off' || requestedMode === undefined) {
    return 'off';
  }
  if (requestedMode === 'live') {
    return liveConfirmation === 'yes' ? 'live' : 'paper';
  }
  if (requestedMode === 'paper') {
    return 'paper';
  }
  return 'off';
}
