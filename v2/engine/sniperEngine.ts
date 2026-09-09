// ============================================
// SNIPER Engine v2 (new-coin sniper, 2026-05-06)
// ============================================
// Side-project engine: snipes new exchange listings during their early
// volatility window. Factory pattern — each call to createSniperEngine()
// returns a closure-scoped instance, so we can run KRAKEN + CRYPTOCOM
// in parallel from the same code with fully isolated state.
//
// Trades are tagged strategy='SNIPER_<EXCHANGE>' (e.g. SNIPER_KRAKEN,
// SNIPER_CRYPTOCOM) so reports never mix with TREND/MOMENTUM stats AND
// can compare per-exchange sniper performance.
// ============================================

import type { Candle, V2Trade } from '../pipeline/types.ts';
import type { ExchangeAdapter } from '../exchange/types.ts';
import type { NewCoinDetector } from '../pipeline/sniperSignal.ts';
import { detectSniperEntry } from '../pipeline/sniperSignal.ts';
import { checkSniperExits } from '../pipeline/sniperExitManager.ts';
import {
  insertTrade,
  closeTrade,
  getOpenTradesByStrategy,
} from '../attribution/attributionStore.ts';
import { loadPortfolio } from './positionManager.ts';
import { SNIPER_CONFIG, getExchangeFees } from './config.ts';
import { isCadUsdTicker, normalizeUsdTicker } from './cadUniverse.ts';
import { randomUUID } from 'node:crypto';

const WARMUP_THRESHOLD = 20;

export interface SniperEngineHandle {
  init: () => Promise<void>;
  start: () => void;
  stop: () => void;
  getStatus: () => Record<string, unknown>;
}

/**
 * Build a sniper engine bound to a specific exchange. The returned handle has
 * its own loop, candle cache, detector reference, stats, and budget. Multiple
 * handles can run side-by-side without sharing state.
 *
 * @param exchange      Lowercase identifier ('kraken' / 'cryptocom') — matches the
 *                      detector's namespace key and the krakenAdapter / cryptoComAdapter import path.
 * @param adapter       The V2 ExchangeAdapter for this exchange (krakenV2 or cryptoComV2).
 * @param adapterPath   Path to the JS adapter module (for getInstruments + getCandles).
 * @param strategyTag   The strategy value to tag trades with ('SNIPER_KRAKEN' / 'SNIPER_CRYPTOCOM').
 * @param budget        Independent USD budget for this engine.
 * @param logTag        Log prefix ('SNIPER-KRAKEN' / 'SNIPER-CRYPTOCOM').
 */
export function createSniperEngine(
  exchange: string,
  adapter: ExchangeAdapter,
  adapterPath: string,
  strategyTag: string,
  budget: number,
  logTag: string,
): SniperEngineHandle {
  let loopTimer: ReturnType<typeof setInterval> | null = null;
  let pairRefreshTimer: ReturnType<typeof setInterval> | null = null;
  let isRunning = false;
  let loopInProgress = false;
  let detector: NewCoinDetector | null = null;
  let detectorModule: Record<string, unknown> | null = null;
  let lastPairRefresh = 0;

  const stats = {
    loopCount: 0,
    pairRefreshCount: 0,
    newListingsDetected: 0,
    tradesOpened: 0,
    tradesClosed: 0,
    totalPnl: 0,
  };

  const candleCache = new Map<string, Candle[]>();

  async function fetchCandles(ticker: string): Promise<Candle[] | null> {
    try {
      const mod = await import(adapterPath);
      // adapterPath exports the adapter as default named export — fall back to
      // a few common names so we don't have to hard-code per-exchange.
      const adapterObj = (mod.krakenAdapter ?? mod.cryptoComAdapter ?? mod.default) as
        | { getCandles: (t: string, tf: string, n: number) => Promise<Record<string, number>[]> }
        | undefined;
      if (!adapterObj?.getCandles) return null;
      const raw = await adapterObj.getCandles(ticker, SNIPER_CONFIG.CANDLE_INTERVAL, 80);
      if (!raw || raw.length === 0) return null;
      const candles: Candle[] = raw.map((c) => ({
        open: c.o ?? c.open,
        high: c.h ?? c.high,
        low: c.l ?? c.low,
        close: c.c ?? c.close,
        volume: c.v ?? c.volume ?? 0,
        time: c.t ?? c.time ?? 0,
      }));
      candleCache.set(ticker, candles);
      return candles;
    } catch {
      return null;
    }
  }

  async function refreshPairList(): Promise<void> {
    if (!detectorModule) return;
    try {
      const mod = await import(adapterPath);
      const adapterObj = (mod.krakenAdapter ?? mod.cryptoComAdapter ?? mod.default) as
        | { getInstruments: () => Promise<{ data?: Array<{ instrument_name: string }> }> }
        | undefined;
      if (!adapterObj?.getInstruments) {
        console.warn(`[${logTag}] adapter.getInstruments unavailable — pair refresh skipped`);
        return;
      }
      const result = await adapterObj.getInstruments();
      const rawData = (result?.data ?? []) as Array<Record<string, unknown>>;

      // Per-exchange ticker filtering:
      //   * Kraken: krakenAdapter wraps each instrument as {instrument_name: 'BTCUSD', ...}
      //   * Crypto.com: native API returns {symbol: 'BTC_USD', inst_type: 'CCY_PAIR', quote_ccy: 'USD', ...}
      //     for spot, plus perpetuals (inst_type: 'PERPETUAL_SWAP', symbol: 'BTCUSD-PERP'),
      //     USDT pairs, etc. Always filter to the Canadian USD allowlist.
      let tickers: string[];
      if (exchange === 'cryptocom') {
        tickers = rawData
          .filter((i) =>
            i.inst_type === 'CCY_PAIR'
            && i.quote_ccy === 'USD'
            && typeof i.symbol === 'string'
            && isCadUsdTicker(i.symbol as string),
          )
          .map((i) => normalizeUsdTicker(i.symbol as string));
      } else {
        tickers = rawData
          .map((i) => i.instrument_name as string)
          .filter((n) => typeof n === 'string' && isCadUsdTicker(n))
          .map((n) => normalizeUsdTicker(n));
      }

      // First refresh: warmup acknowledge to prevent flagging the entire
      // exchange's pair universe as "new listings".
      if (lastPairRefresh === 0) {
        const ackFn = detectorModule.acknowledgeKnownTickers as
          | ((t: string[], ex?: string) => number) | undefined;
        if (ackFn) {
          const acked = ackFn(tickers, exchange);
          console.log(`[${logTag}] Warmup: acknowledged ${acked}/${tickers.length} pair(s) on ${exchange}`);
        }
      }

      const detectFn = detectorModule.detectNewListings as
        | ((t: string[], ex?: string) => string[]) | undefined;
      const newlyDetected = detectFn ? detectFn(tickers, exchange) : [];

      // Defense: implausible burst → silent ack instead of trading.
      if (newlyDetected.length > WARMUP_THRESHOLD) {
        console.warn(`[${logTag}] Implausible new-listing burst (${newlyDetected.length}) — treating as warmup`);
        const ackFn = detectorModule.acknowledgeKnownTickers as
          | ((t: string[], ex?: string) => number) | undefined;
        if (ackFn) ackFn(newlyDetected, exchange);
        stats.pairRefreshCount++;
        lastPairRefresh = Date.now();
        return;
      }

      stats.pairRefreshCount++;
      stats.newListingsDetected += newlyDetected.length;
      lastPairRefresh = Date.now();
      if (newlyDetected.length > 0) {
        console.log(`[${logTag}] Pair refresh (${exchange}): ${newlyDetected.length} new — ${newlyDetected.join(', ')}`);
      }
    } catch (err: unknown) {
      console.warn(`[${logTag}] Pair refresh failed: ${(err as Error).message}`);
    }
  }

  async function updateListingSignals(): Promise<void> {
    if (!detectorModule || !detector) return;
    const updateFn = detectorModule.updateNewCoinSignals as
      | ((t: string, p: number, v: number, s: number, ex?: string) => unknown)
      | undefined;
    if (!updateFn) return;

    for (const listing of detector.getActiveNewListings()) {
      const candles = candleCache.get(listing.ticker);
      if (!candles || candles.length === 0) continue;
      const last = candles[candles.length - 1];
      updateFn(listing.ticker, last.close, last.volume * last.close, 0, exchange);
    }
  }

  async function runLoop(): Promise<void> {
    if (loopInProgress) return;
    loopInProgress = true;
    stats.loopCount++;

    try {
      if (!detector) return;

      const activeListings = detector.getActiveNewListings();
      for (const listing of activeListings) {
        await fetchCandles(listing.ticker);
      }

      await updateListingSignals();

      // Exits first
      const openSniper = getOpenTradesByStrategy(strategyTag);
      if (openSniper.length > 0) {
        const exitResults = await checkSniperExits(openSniper, adapter, detector);
        const fees = getExchangeFees(adapter.getName());
        for (const r of exitResults) {
          if (!r.shouldExit) continue;
          const t = r.trade;
          const pnlGross = (r.exitPrice - t.entryPrice) * t.quantity;
          const totalFees = t.positionSizeUsd * fees.ROUND_TRIP_REAL;
          const pnlNet = pnlGross - totalFees;
          closeTrade(t.id, r.exitPrice, r.exitReason as never ?? 'unknown', totalFees);
          stats.tradesClosed++;
          stats.totalPnl += pnlNet;
          console.log(`[${logTag}] Trade closed: ${t.ticker} @ $${r.exitPrice.toFixed(6)} reason=${r.exitReason} PnL=$${pnlNet.toFixed(4)}`);
        }
      }

      // Entries
      const currentSniper = getOpenTradesByStrategy(strategyTag);
      if (currentSniper.length >= SNIPER_CONFIG.MAX_OPEN_POSITIONS) {
        if (stats.loopCount % 10 === 0) {
          console.log(`[${logTag}] Loop #${stats.loopCount}: max positions (${currentSniper.length}/${SNIPER_CONFIG.MAX_OPEN_POSITIONS})`);
        }
        return;
      }

      // Portfolio is filtered by strategyTag — guarantees budget isolation
      // from TREND/MOMENTUM and from the OTHER sniper engine.
      const portfolio = loadPortfolio(budget, strategyTag);

      for (const listing of activeListings) {
        const ticker = listing.ticker;
        if (currentSniper.some(t => t.ticker === ticker)) continue;

        const candles = candleCache.get(ticker);
        if (!candles || candles.length < SNIPER_CONFIG.MIN_CANDLES) continue;

        const signal = detectSniperEntry(candles, ticker, detector);
        if (!signal) continue;

        const equity = portfolio.totalEquity;
        let posSize = equity * SNIPER_CONFIG.POSITION_SIZE_PERCENT * signal.confidence;
        if (posSize > equity * SNIPER_CONFIG.MAX_POSITION_PERCENT) {
          posSize = equity * SNIPER_CONFIG.MAX_POSITION_PERCENT;
        }
        if (posSize > portfolio.availableCapital) posSize = portfolio.availableCapital;
        if (posSize < 5) continue;

        const price = signal.signals.close_price as number;
        const sl = price * (1 - SNIPER_CONFIG.STOP_LOSS_PERCENT);
        const tp = price * 2;

        const qty = posSize / price;
        const fees = getExchangeFees(adapter.getName());
        const entryFeeEstimate = posSize * fees.MAKER_PERCENT;

        const trade: V2Trade = {
          id: randomUUID(),
          ticker,
          side: 'long',
          status: 'open' as never,
          entryPrice: price,
          entryTime: Date.now(),
          entryOrderType: 'maker',
          quantity: qty,
          positionSizeUsd: posSize,
          exitPrice: null,
          exitTime: null,
          exitReason: null,
          pnlGross: null,
          pnlNet: null,
          feesPaid: entryFeeEstimate,
          holdDurationMs: null,
          initialStop: sl,
          currentStop: sl,
          takeProfitTarget: tp,
          trailingActivated: false,
          entrySignals: signal.signals,
          entryRegime: signal.regime as never,
          entryConfidence: signal.confidence,
          atrPercent: signal.signals.atr_percent as number,
          peakPrice: price,
          peakHistogram: 0,
          strategy: strategyTag,
          decisionLog: [],
          createdAt: Date.now(),
        };

        insertTrade(trade);
        stats.tradesOpened++;
        console.log(
          `[${logTag}] Trade opened: ${ticker} @ $${price.toFixed(6)} `
          + `SL=$${sl.toFixed(6)} size=$${posSize.toFixed(2)} `
          + `age=${(signal.signals.sniper_age_hours as number).toFixed(1)}h `
          + `rug=${signal.signals.sniper_rug_score} `
          + `conf=${signal.confidence.toFixed(2)}`,
        );
        break;
      }

      if (stats.loopCount % 10 === 0) {
        console.log(
          `[${logTag}] Loop #${stats.loopCount}: ${activeListings.length} listings, `
          + `${currentSniper.length} open, opened=${stats.tradesOpened}, closed=${stats.tradesClosed}, PnL=$${stats.totalPnl.toFixed(2)}`,
        );
      }
    } catch (err: unknown) {
      console.error(`[${logTag}] Loop error: ${(err as Error).message}`);
    } finally {
      loopInProgress = false;
    }
  }

  return {
    async init(): Promise<void> {
      try {
        detectorModule = (await import('../../services/newCoinDetector.js')) as unknown as Record<string, unknown>;
        const initFn = detectorModule.initialize as (() => void) | undefined;
        if (initFn && exchange === 'kraken') {
          // Only Kraken's namespace is initialized from DB; cryptocom relies on warmup-ack.
          initFn();
        }
        detector = {
          isNewListing: (t: string) =>
            (detectorModule!.isNewListing as (t: string, ex?: string) => boolean)(t, exchange),
          getActiveNewListings: () =>
            (detectorModule!.getActiveNewListings as (ex?: string) => Array<{
              ticker: string;
              firstSeen: number;
              rugPullScore: number;
              isOnCooldown: boolean;
            }>)(exchange),
        };
      } catch (err: unknown) {
        console.warn(`[${logTag}] Detector load failed — engine will idle: ${(err as Error).message}`);
        detector = null;
      }

      console.log(
        `[${logTag}] Sniper engine initialized: exchange=${exchange}, budget=$${budget}, `
        + `strategy=${strategyTag}, interval=${SNIPER_CONFIG.CANDLE_INTERVAL}, `
        + `max-positions=${SNIPER_CONFIG.MAX_OPEN_POSITIONS}, detector=${detector ? 'loaded' : 'unavailable'}`,
      );
    },

    start(): void {
      if (isRunning) return;
      isRunning = true;
      setTimeout(async () => {
        await refreshPairList();
        await runLoop();
        loopTimer = setInterval(runLoop, SNIPER_CONFIG.LOOP_INTERVAL_MS);
        pairRefreshTimer = setInterval(refreshPairList, SNIPER_CONFIG.PAIR_REFRESH_INTERVAL_MS);
      }, SNIPER_CONFIG.LOOP_OFFSET_MS);
      console.log(`[${logTag}] Sniper engine started (offset=${SNIPER_CONFIG.LOOP_OFFSET_MS}ms, loop=${SNIPER_CONFIG.LOOP_INTERVAL_MS}ms, pair-refresh=${SNIPER_CONFIG.PAIR_REFRESH_INTERVAL_MS}ms)`);
    },

    stop(): void {
      if (loopTimer) clearInterval(loopTimer);
      if (pairRefreshTimer) clearInterval(pairRefreshTimer);
      loopTimer = null;
      pairRefreshTimer = null;
      isRunning = false;
      console.log(`[${logTag}] Sniper engine stopped`);
    },

    getStatus(): Record<string, unknown> {
      const listings = detector?.getActiveNewListings() ?? [];
      return {
        exchange,
        strategyTag,
        running: isRunning,
        enabled: SNIPER_CONFIG.ENABLED,
        detectorLoaded: detector != null,
        lastPairRefresh,
        activeListings: listings.length,
        listingsSample: listings.slice(0, 5).map((l) => ({
          ticker: l.ticker,
          ageHours: ((Date.now() - l.firstSeen) / 3600000).toFixed(1),
          rugScore: l.rugPullScore,
          onCooldown: l.isOnCooldown,
        })),
        ...stats,
        openPositions: getOpenTradesByStrategy(strategyTag).length,
        budget,
      };
    },
  };
}

// ============================================
// Singleton handles for boot wiring
// ============================================
// v2/index.ts boots both. Other code that needs to query status uses these.

let krakenSniper: SniperEngineHandle | null = null;
let cryptocomSniper: SniperEngineHandle | null = null;

export function buildKrakenSniper(adapter: ExchangeAdapter, budget: number): SniperEngineHandle {
  krakenSniper = createSniperEngine(
    'kraken',
    adapter,
    '../../services/exchangeAdapters/krakenAdapter.js',
    'SNIPER_KRAKEN',
    budget,
    'SNIPER-KRAKEN',
  );
  return krakenSniper;
}

export function buildCryptocomSniper(adapter: ExchangeAdapter, budget: number): SniperEngineHandle {
  cryptocomSniper = createSniperEngine(
    'cryptocom',
    adapter,
    '../../services/exchangeAdapters/cryptocomAdapter.js',
    'SNIPER_CRYPTOCOM',
    budget,
    'SNIPER-CRYPTOCOM',
  );
  return cryptocomSniper;
}

export function getKrakenSniperStatus(): Record<string, unknown> | null {
  return krakenSniper?.getStatus() ?? null;
}

export function getCryptocomSniperStatus(): Record<string, unknown> | null {
  return cryptocomSniper?.getStatus() ?? null;
}

/**
 * Combined sniper status — both engines, isolated stats.
 * Reports must NEVER aggregate these into a single PF/PnL with TREND/MOMENTUM.
 */
export function getSniperStatus(): Record<string, unknown> {
  return {
    kraken: getKrakenSniperStatus(),
    cryptocom: getCryptocomSniperStatus(),
  };
}

export function stopSniperEngine(): void {
  if (krakenSniper) krakenSniper.stop();
  if (cryptocomSniper) cryptocomSniper.stop();
}
