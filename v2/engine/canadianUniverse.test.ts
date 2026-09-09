import { describe, expect, it } from 'vitest';
import { BEARISH_CONFIG } from './bearishServices.ts';
import { MOMENTUM_CONFIG, MR_CONFIG, PAIRS_CONFIG, SNIPER_CONFIG, V2_CONFIG } from './config.ts';
import {
  CANADIAN_USD_BASES,
  isCanadianUsdTicker,
  resolvePairsRuntimeMode,
} from './canadianUniverse.ts';

describe('Canadian USD universe', () => {
  it('rejects USDT/USDC and unknown bases', () => {
    expect(isCanadianUsdTicker('BTCUSD')).toBe(true);
    expect(isCanadianUsdTicker('BTCUSDT')).toBe(false);
    expect(isCanadianUsdTicker('ETHUSDC')).toBe(false);
    expect(isCanadianUsdTicker('FILUSD')).toBe(false);
    expect(isCanadianUsdTicker('ICPUSD')).toBe(false);
    expect(isCanadianUsdTicker('ZECUSD')).toBe(false);
  });

  it('keeps the main scan list to the ten CAD USD pairs only', () => {
    expect([...V2_CONFIG.SCAN_TICKERS].sort()).toEqual(
      CANADIAN_USD_BASES.map((base) => `${base}USD`).sort(),
    );
    for (const ticker of V2_CONFIG.SCAN_TICKERS) {
      expect(isCanadianUsdTicker(ticker)).toBe(true);
    }
    expect(V2_CONFIG.ALLOWED_REGIMES).toEqual(['STRONG_UP']);
    expect(V2_CONFIG.ML_GATEKEEPER_ENABLED).toBe(false);
    expect(SNIPER_CONFIG.ENABLED).toBe(false);
    expect(MR_CONFIG.ENABLED).toBe(false);
  });

  it('keeps momentum, MR, and DCA tickers inside the CAD allowlist', () => {
    for (const ticker of MOMENTUM_CONFIG.SCAN_TICKERS) {
      expect(isCanadianUsdTicker(ticker)).toBe(true);
    }
    for (const ticker of MR_CONFIG.SCAN_TICKERS) {
      expect(isCanadianUsdTicker(ticker)).toBe(true);
    }
    for (const ticker of BEARISH_CONFIG.DCA_TICKERS) {
      expect(isCanadianUsdTicker(ticker)).toBe(true);
    }
  });

  it('refuses to run FIL/ICP pairs even if PAIRS_MODE is paper or live', () => {
    expect(isCanadianUsdTicker(PAIRS_CONFIG.SYMBOL_A)).toBe(false);
    expect(isCanadianUsdTicker(PAIRS_CONFIG.SYMBOL_B)).toBe(false);
    expect(PAIRS_CONFIG.MODE).toBe('off');
    expect(resolvePairsRuntimeMode('paper', undefined, PAIRS_CONFIG.SYMBOL_A, PAIRS_CONFIG.SYMBOL_B)).toBe('off');
    expect(resolvePairsRuntimeMode('live', 'yes', PAIRS_CONFIG.SYMBOL_A, PAIRS_CONFIG.SYMBOL_B)).toBe('off');
  });
});
