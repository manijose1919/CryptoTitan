import { describe, expect, it } from 'vitest';
import { V2_CONFIG, MOMENTUM_CONFIG, SNIPER_CONFIG, MR_CONFIG, PAIRS_CONFIG } from './config.ts';
import { isCadUsdTicker, CAD_USD_BASES } from './cadUniverse.ts';

function assertCadUsdPair(ticker: string): void {
  expect(isCadUsdTicker(ticker), `${ticker} must pass isCadUsdTicker`).toBe(true);
}

describe('Canadian trading universe', () => {
  it('keeps the main scanner on the ten approved Kraken USD pairs only', () => {
    expect(V2_CONFIG.SCAN_TICKERS).toHaveLength(10);
    expect([...V2_CONFIG.SCAN_TICKERS].sort()).toEqual(
      [...CAD_USD_BASES].map((b) => `${b}USD`).sort(),
    );
    for (const ticker of V2_CONFIG.SCAN_TICKERS) {
      assertCadUsdPair(ticker);
    }
  });

  it('keeps momentum on the same CAD USD allowlist', () => {
    for (const ticker of MOMENTUM_CONFIG.SCAN_TICKERS) {
      assertCadUsdPair(ticker);
    }
  });

  it('rejects USDT/USDC and non-allowlist bases even if quote looks like USD', () => {
    expect(isCadUsdTicker('BTCUSDT')).toBe(false);
    expect(isCadUsdTicker('ETHUSDC')).toBe(false);
    expect(isCadUsdTicker('FILUSD')).toBe(false);
    expect(isCadUsdTicker('ICPUSD')).toBe(false);
    expect(isCadUsdTicker('BTC_USD')).toBe(true);
    expect(isCadUsdTicker('solusd')).toBe(true);
  });

  it('keeps unsupported engines off so they cannot leak non-CAD pairs into live decisions', () => {
    expect(SNIPER_CONFIG.ENABLED).toBe(false);
    expect(MR_CONFIG.ENABLED).toBe(false);
    expect(PAIRS_CONFIG.MODE).toBe('off');
    // 2026-10-03 promote package: UP allowed only with ENTRY_CONFIRM_ENABLED
    expect(V2_CONFIG.ALLOWED_REGIMES).toEqual(['STRONG_UP', 'UP']);
    expect((V2_CONFIG as { ENTRY_CONFIRM_ENABLED?: boolean }).ENTRY_CONFIRM_ENABLED).toBe(true);
    expect(V2_CONFIG.MAX_ATR_PERCENT).toBe(2.5);
    expect(V2_CONFIG.MIN_ATR_PERCENT).toBe(1.5);
    expect(V2_CONFIG.PAPER_SLIPPAGE_PER_SIDE).toBe(0.0005);
  });
});
