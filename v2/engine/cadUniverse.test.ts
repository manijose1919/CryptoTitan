import { describe, expect, it } from 'vitest';
import { V2_CONFIG, MOMENTUM_CONFIG, SNIPER_CONFIG, MR_CONFIG, PAIRS_CONFIG } from './config.ts';

const CAD_BASES = new Set([
  'BTC', 'ETH', 'XRP', 'BNB', 'SOL', 'ADA', 'DOGE', 'LINK', 'DOT', 'AVAX',
]);

function assertCadUsdPair(ticker: string): void {
  expect(ticker.endsWith('USD'), `${ticker} must be a USD pair`).toBe(true);
  expect(ticker.includes('USDT'), `${ticker} must not use USDT`).toBe(false);
  expect(ticker.includes('USDC'), `${ticker} must not use USDC`).toBe(false);
  const base = ticker.slice(0, -3);
  expect(CAD_BASES.has(base), `${ticker} base ${base} is outside the Canadian allowlist`).toBe(true);
}

describe('Canadian trading universe', () => {
  it('keeps the main scanner on the ten approved Kraken USD pairs only', () => {
    expect(V2_CONFIG.SCAN_TICKERS).toHaveLength(10);
    for (const ticker of V2_CONFIG.SCAN_TICKERS) {
      assertCadUsdPair(ticker);
    }
  });

  it('keeps momentum on the same CAD USD allowlist', () => {
    for (const ticker of MOMENTUM_CONFIG.SCAN_TICKERS) {
      assertCadUsdPair(ticker);
    }
  });

  it('keeps unsupported engines off so they cannot leak non-CAD pairs into live decisions', () => {
    expect(SNIPER_CONFIG.ENABLED).toBe(false);
    expect(MR_CONFIG.ENABLED).toBe(false);
    expect(PAIRS_CONFIG.MODE).toBe('off');
    expect(V2_CONFIG.ALLOWED_REGIMES).toEqual(['STRONG_UP']);
    expect(V2_CONFIG.PAPER_SLIPPAGE_PER_SIDE).toBe(0.0005);
  });
});
