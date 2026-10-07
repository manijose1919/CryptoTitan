// Ambient declarations for the plain-JavaScript modules in services/.
// These modules are live (serverV2.ts imports several directly at boot; v2/
// code imports others) but are written in plain JS, not TypeScript. This file
// types the import boundary without rewriting any of the 13 files.
//
// Why wildcard specifiers instead of exact relative paths:
// TypeScript's `declare module` rejects relative specifiers outright
// (TS2436 "Ambient module declaration cannot specify relative module name",
// and TS2439 for `export * from` inside one). That was confirmed empirically
// while building this file — `declare module './services/database.js'` does
// not compile, with or without skipLibCheck. Each of these modules is
// imported under two different relative specifiers (root-relative from
// serverV2.ts, `../../`-relative from v2/), so a single non-relative
// wildcard pattern (`*/services/x.js`) is used instead: TypeScript's
// wildcard module matching (normally used for things like `declare module
// '*.svg'`) matches any specifier ENDING in the given suffix, which covers
// both relative forms with one declaration — and, unlike two separate
// `declare module` blocks joined by `export * from`, it also carries
// `default` exports correctly (`export * from` never re-exports `default`).
//
// Accepted trade-off of the wildcard form: `*/services/x.js` matches ANY
// specifier ending in that suffix, so a future dependency exposing e.g.
// `some-package/services/database.js` would silently pick up these types
// instead of its own. That risk was weighed and accepted — the suffixes here
// are specific to this codebase (`whaleFlowTracker.js`, `krakenAdapter.js`,
// `fearGreedGate.js`, …), and this is an application, not a published library
// whose consumers could be affected. If a collision ever does occur, the fix
// is to convert the colliding module to TypeScript rather than to widen this
// file further.
//
// Types are derived from each module's actual exports (read directly from
// the .js source), not guessed. Where a function is not called from any
// currently type-checked file, or its real return shape is data read out of
// SQLite / an external API, it is typed `unknown` rather than `any` — the
// point of this file is to remove implicit `any`, not relabel it.

// ============================================================
// services/database.js
// ============================================================
declare module '*/services/database.js' {
  export interface SqliteStatement {
    run(...params: unknown[]): unknown;
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
    iterate(...params: unknown[]): IterableIterator<unknown>;
    pluck(toggle?: boolean): SqliteStatement;
  }

  export interface SqliteDatabase {
    prepare(sql: string): SqliteStatement;
    exec(sql: string): SqliteDatabase;
    pragma(sql: string, options?: unknown): unknown;
    transaction(fn: (...args: unknown[]) => unknown): (...args: unknown[]) => unknown;
    close(): void;
  }

  export function getDb(): SqliteDatabase;
  export function initializeDatabase(): void;
  export function pingDatabase(): unknown;
  export function closeDatabase(): void;

  export function insertTrade(...args: unknown[]): unknown;
  export function getTrades(...args: unknown[]): unknown;
  export function getTradeCount(...args: unknown[]): unknown;
  export function insertTradeMemory(...args: unknown[]): unknown;
  export function getTradeMemories(...args: unknown[]): unknown;
  export function upsertLearnedPattern(...args: unknown[]): unknown;
  export function getLearnedPatterns(...args: unknown[]): unknown;
  export function insertParameterSnapshot(...args: unknown[]): unknown;
  export function getParameterHistory(...args: unknown[]): unknown;
  export function getLatestParameters(...args: unknown[]): unknown;
  export function insertSession(...args: unknown[]): unknown;
  export function updateSession(...args: unknown[]): unknown;
  export function getSessions(...args: unknown[]): unknown;
  export function insertSessionRecord(...args: unknown[]): unknown;
  export function completeSession(...args: unknown[]): unknown;
  export function markAbandonedSessions(...args: unknown[]): unknown;
  export function getSessionHistory(...args: unknown[]): unknown;
  export function getSessionDetail(...args: unknown[]): unknown;
  export function insertCandlesBatch(...args: unknown[]): unknown;
  export function getCandles(...args: unknown[]): unknown;
  export function getCandleCount(...args: unknown[]): unknown;
  export function insertSentimentSnapshot(...args: unknown[]): unknown;
  export function getSentimentHistory(...args: unknown[]): unknown;
  export function insertSystemLog(...args: unknown[]): unknown;
  export function getSystemLogs(...args: unknown[]): unknown;
  export function setSetting(...args: unknown[]): unknown;
  export function getSetting(...args: unknown[]): unknown;
  export function getAllSettings(...args: unknown[]): unknown;
  export function insertExchangeSnapshot(...args: unknown[]): unknown;
  export function insertExchangeSnapshotsBatch(...args: unknown[]): unknown;
  export function getExchangeSnapshots(...args: unknown[]): unknown;
  export function getLatestExchangeSnapshot(...args: unknown[]): unknown;
  export function insertDerivativesData(...args: unknown[]): unknown;
  export function getDerivativesHistory(...args: unknown[]): unknown;
  export function getLatestDerivatives(...args: unknown[]): unknown;
  export function insertDeFiSnapshot(...args: unknown[]): unknown;
  export function getLatestDeFiSnapshot(...args: unknown[]): unknown;
  export function getDeFiHistory(...args: unknown[]): unknown;
  export function insertNewsItem(...args: unknown[]): unknown;
  export function insertNewsItemsBatch(...args: unknown[]): unknown;
  export function getNewsItems(...args: unknown[]): unknown;
  export function insertMLFeatures(...args: unknown[]): unknown;
  export function getUnlabeledFeatures(...args: unknown[]): unknown;
  export function getLabeledFeatures(...args: unknown[]): unknown;
  export function labelMLFeatures(...args: unknown[]): unknown;
  export function insertMLModel(...args: unknown[]): unknown;
  export function getLatestMLModel(...args: unknown[]): unknown;
  export function getMLModelHistory(...args: unknown[]): unknown;
  export function insertMLPrediction(...args: unknown[]): unknown;
  export function resolveMLPrediction(...args: unknown[]): unknown;
  export function getMLPredictions(...args: unknown[]): unknown;
  export function getMLAccuracyStats(...args: unknown[]): unknown;
  export function cleanupOldData(...args: unknown[]): unknown;
  export function insertEquitySnapshot(...args: unknown[]): unknown;
  export function getEquitySnapshots(...args: unknown[]): unknown;
  export function getLatestEquitySnapshot(...args: unknown[]): unknown;
  export function insertSessionTrade(...args: unknown[]): unknown;
  export function getSessionTrades(...args: unknown[]): unknown;
  export function getSessionTradeStats(...args: unknown[]): unknown;
  export function insertMLThought(...args: unknown[]): unknown;
  export function getMLThoughts(...args: unknown[]): unknown;
  export function initializeTrainingTables(...args: unknown[]): unknown;
  export function insertHistoricalCandlesBatch(...args: unknown[]): unknown;
  export function getHistoricalCandles(...args: unknown[]): unknown;
  export function getHistoricalCandleCount(...args: unknown[]): unknown;
  export function getHistoricalCandleRange(...args: unknown[]): unknown;
  export function insertFearGreedBatch(...args: unknown[]): unknown;
  export function getFearGreedForDate(...args: unknown[]): unknown;
  export function getFearGreedCount(...args: unknown[]): unknown;
  export function insertDefiTvlBatch(...args: unknown[]): unknown;
  export function getDefiTvlForDate(...args: unknown[]): unknown;
  export function getDefiTvlCount(...args: unknown[]): unknown;
  export function upsertDownloadProgress(...args: unknown[]): unknown;
  export function getDownloadProgress(...args: unknown[]): unknown;
  export function clearDownloadProgress(...args: unknown[]): unknown;
  export function insertTrainingRun(...args: unknown[]): unknown;
  export function updateTrainingRun(...args: unknown[]): unknown;
  export function getTrainingRun(...args: unknown[]): unknown;
  export function getTrainingRuns(...args: unknown[]): unknown;
  export function insertTrainingTrade(...args: unknown[]): unknown;
  export function insertTrainingTradesBatch(...args: unknown[]): unknown;
  export function getTrainingTrades(...args: unknown[]): unknown;
  export function getTrainingTradeStats(...args: unknown[]): unknown;
  export function insertTrainingEquity(...args: unknown[]): unknown;
  export function insertTrainingEquityBatch(...args: unknown[]): unknown;
  export function getTrainingEquity(...args: unknown[]): unknown;
  export function insertTrainingMLSample(...args: unknown[]): unknown;
  export function insertTrainingMLSamplesBatch(...args: unknown[]): unknown;
  export function getTrainingMLSamples(...args: unknown[]): unknown;
  export function getTrainingMLSampleCount(...args: unknown[]): unknown;
  export function insertWalkForwardRun(...args: unknown[]): unknown;
  export function updateWalkForwardRun(...args: unknown[]): unknown;
  export function getWalkForwardRun(...args: unknown[]): unknown;
  export function getWalkForwardRuns(...args: unknown[]): unknown;
  export function insertWalkForwardFold(...args: unknown[]): unknown;
  export function updateWalkForwardFold(...args: unknown[]): unknown;
  export function getWalkForwardFolds(...args: unknown[]): unknown;
  export function getWalkForwardFold(...args: unknown[]): unknown;
  export function getTrainingMLSamplesByTimeRange(...args: unknown[]): unknown;
  export function saveDCAPosition(...args: unknown[]): unknown;
  export function getDCAPositions(...args: unknown[]): unknown;
  export function updateDCAPosition(...args: unknown[]): unknown;
  export function closeDCAPosition(...args: unknown[]): unknown;
  export function saveGridState(...args: unknown[]): unknown;
  export function getGridStates(...args: unknown[]): unknown;
  export function updateGridState(...args: unknown[]): unknown;
  export function closeGridState(...args: unknown[]): unknown;
  export function saveSwingPosition(...args: unknown[]): unknown;
  export function getSwingPositions(...args: unknown[]): unknown;
  export function updateSwingPosition(...args: unknown[]): unknown;
  export function closeSwingPosition(...args: unknown[]): unknown;
  export function closeAllPositionsForSession(...args: unknown[]): unknown;
  export function insertGeneticGenome(...args: unknown[]): unknown;
  export function getGeneticGenomes(...args: unknown[]): unknown;
  export function clearGeneticGenomes(...args: unknown[]): unknown;
  export function insertGeneticEvolutionLog(...args: unknown[]): unknown;
  export function insertAdversarialModel(...args: unknown[]): unknown;
  export function getLatestAdversarialModels(...args: unknown[]): unknown;
  export function insertCorrelationSnapshot(...args: unknown[]): unknown;
  export function getLatestCorrelationSnapshot(...args: unknown[]): unknown;

  export interface GatekeeperDecisionInput {
    ticker: string;
    decision: string;
    ml_confidence?: number;
    tier?: string;
    rule_strategy?: string;
    rule_strength?: number;
    adversarial_consensus?: string;
    correlation_multiplier?: number;
    final_size_multiplier?: number;
    reason?: string;
  }
  export function insertGatekeeperDecision(decision: GatekeeperDecisionInput): unknown;
  export function resolveGatekeeperDecision(...args: unknown[]): unknown;
  export function getGatekeeperStats(...args: unknown[]): unknown;
  export function getRecentGatekeeperDecisions(...args: unknown[]): unknown;

  export function insertExecutionMetric(...args: unknown[]): unknown;
  export function getExecutionMetrics(...args: unknown[]): unknown;
  export function insertOnChainSnapshot(...args: unknown[]): unknown;
  export function getLatestOnChainSnapshot(...args: unknown[]): unknown;
  export function insertMonteCarloResult(...args: unknown[]): unknown;
  export function getLatestMonteCarloResult(...args: unknown[]): unknown;
  export function runMaintenance(...args: unknown[]): unknown;
  export function upsertKnownTicker(...args: unknown[]): unknown;
  export function getKnownTickers(...args: unknown[]): unknown;
  export function getNewTickersSince(...args: unknown[]): unknown;
  export function insertNewCoinSignal(...args: unknown[]): unknown;
  export function getNewCoinSignals(...args: unknown[]): unknown;
  export function createLabelingJob(...args: unknown[]): unknown;
  export function updateLabelingJob(...args: unknown[]): unknown;
  export function getLabelingJobStatus(...args: unknown[]): unknown;
  export function getLatestLabelingJob(...args: unknown[]): unknown;
  export function insertMLFeaturesBatch(...args: unknown[]): unknown;
}

// ============================================================
// services/fearGreedGate.js
// ============================================================
declare module '*/services/fearGreedGate.js' {
  export function initFearGreedGate(): Promise<void>;
  export function isFearGreedFetchStale(now?: number, maxAgeMs?: number): boolean;
  export function refreshFearGreedIfStale(now?: number, maxAgeMs?: number): Promise<boolean>;
  export function getPositionMultiplier(): number;
  export function shouldBlockEntry(): { block: boolean; reason: string };

  export interface FearGreedStatus {
    index: number;
    classification: string;
    trend: number;
    positionMultiplier: number;
    isBlocking: boolean;
    lastFetchTime: number;
    nextFetch: number;
    blended: boolean;
    sources: unknown;
    alternativeMeRaw: number;
  }
  export function getFearGreedStatus(): FearGreedStatus;
  export function getFearGreedIndex(): number;
  export function getAlternativeMeRaw(): number;

  const _default: {
    initFearGreedGate: typeof initFearGreedGate;
    isFearGreedFetchStale: typeof isFearGreedFetchStale;
    refreshFearGreedIfStale: typeof refreshFearGreedIfStale;
    getPositionMultiplier: typeof getPositionMultiplier;
    shouldBlockEntry: typeof shouldBlockEntry;
    getFearGreedStatus: typeof getFearGreedStatus;
    getFearGreedIndex: typeof getFearGreedIndex;
    getAlternativeMeRaw: typeof getAlternativeMeRaw;
  };
  export default _default;
}

// ============================================================
// services/krakenWebsocketService.js (primary / Kraken)
// services/websocketService.js (secondary / Crypto.com)
// Same shape — Kraken's is the one with real usage; Crypto.com's mirrors it.
// ============================================================
declare module '*/services/krakenWebsocketService.js' {
  export interface WsCallbacks {
    onCandle?: (...args: unknown[]) => void;
    onTrade?: (...args: unknown[]) => void;
    onConnect?: () => void;
  }
  export function initWebSocket(tickers: string[], callbacks?: WsCallbacks): void;
  export function subscribeTickers(tickers: string[]): void;
  export function getRealtimeCandles(ticker: string): Array<Record<string, number>> | null;
  export function mergeCandles(restCandles: unknown[] | null, ticker: string): unknown[];
  export function getLatestPrice(ticker: string): number | null;
  export function getLatestPriceUpdatedAt(ticker: string): number | null;
  export function isConnected(): boolean;
  export function getWebSocketStatus(): Record<string, unknown>;
  export function closeWebSocket(): void;
}

declare module '*/services/websocketService.js' {
  export interface WsCallbacks {
    onCandle?: (...args: unknown[]) => void;
    onTrade?: (...args: unknown[]) => void;
    onConnect?: () => void;
  }
  export function initWebSocket(tickers: string[], callbacks?: WsCallbacks): void;
  export function subscribeTickers(tickers: string[]): void;
  export function getRealtimeCandles(ticker: string): Array<Record<string, number>> | null;
  export function mergeCandles(restCandles: unknown[] | null, ticker: string): unknown[];
  export function getLatestPrice(ticker: string): number | null;
  export function getLatestPriceUpdatedAt(ticker: string): number | null;
  export function isConnected(): boolean;
  export function getWebSocketStatus(): Record<string, unknown>;
  export function closeWebSocket(): void;
}

// ============================================================
// services/telegramService.js
// ============================================================
declare module '*/services/telegramService.js' {
  export function initTelegram(): void;
  export function isEnabled(): boolean;
  export function getStatus(): Record<string, unknown>;

  export interface TelegramTradeAlert {
    type: string;
    ticker: string;
    price: number;
    strategy: string;
    pnl?: number;
  }
  export function alertTradeExecution(trade: TelegramTradeAlert): void;
  export function alertDrawdown(percent: number, currentValue: number): void;
  export function alertSessionSummary(summary: Record<string, unknown>): void;
  export function alertWhaleMovement(ticker: string, direction: string, size: number): void;
  export function alertCircuitBreaker(reason: string): void;
  export function alertRegimeTransition(from: string, to: string, ticker?: string): void;
  export function alertMLDegradation(accuracy: number, threshold: number, details?: string): void;
  export function alertConcentrationRisk(ticker: string, pct: number): void;
  export function sendTestMessage(): Promise<{ success: boolean; error?: string; data?: unknown }>;

  const _default: {
    initTelegram: typeof initTelegram;
    isEnabled: typeof isEnabled;
    getStatus: typeof getStatus;
    alertTradeExecution: typeof alertTradeExecution;
    alertDrawdown: typeof alertDrawdown;
    alertSessionSummary: typeof alertSessionSummary;
    alertWhaleMovement: typeof alertWhaleMovement;
    alertCircuitBreaker: typeof alertCircuitBreaker;
    sendTestMessage: typeof sendTestMessage;
    alertRegimeTransition: typeof alertRegimeTransition;
    alertMLDegradation: typeof alertMLDegradation;
    alertConcentrationRisk: typeof alertConcentrationRisk;
  };
  export default _default;
}

// ============================================================
// services/mlGatekeeper.js
// ============================================================
declare module '*/services/mlGatekeeper.js' {
  export interface MLCandle {
    o: number;
    h: number;
    l: number;
    c: number;
    v: number;
  }
  export interface MLGateDecision {
    proceed: boolean;
    confidence: number;
    tier: string;
    sizeMultiplier: number;
    reason: string;
    mlPrediction: unknown;
    adversarialConsensus: unknown;
  }
  export function init(engine: unknown, advBrains?: unknown): void;
  export function setAdversarialBrains(brains: unknown): void;
  export function evaluateEntry(
    ticker: string,
    candles: MLCandle[],
    ruleStrategy: string,
    ruleStrength: number,
    options?: Record<string, unknown>,
  ): MLGateDecision;
  export function recordOutcome(ticker: string, tier: string, wasCorrect: boolean): unknown;
  export function getGatekeeperStats(): unknown;
}

// ============================================================
// services/mlPredictionService.js
// ============================================================
declare module '*/services/mlPredictionService.js' {
  export interface MLEngineStatus {
    accuracy: number;
    sampleCount?: number;
    isTrained?: boolean;
    [key: string]: unknown;
  }
  export interface MLEngine {
    isTrained?: boolean;
    getModelStatus(): MLEngineStatus;
    [key: string]: unknown;
  }

  export function initializeML(): Promise<void>;
  export function shouldTradeML(...args: unknown[]): Promise<unknown>;
  export function recordTradeOutcome(...args: unknown[]): Promise<unknown>;
  export function trainModel(...args: unknown[]): Promise<unknown>;
  export function checkRetrainNeeded(...args: unknown[]): unknown;
  export function getMLEngine(): MLEngine | null;
  export function getMLStatus(...args: unknown[]): unknown;
  export function getFeatureImportanceReport(...args: unknown[]): unknown;
  export function getMLAccuracyStats(...args: unknown[]): unknown;
  export function getMLAdvice(...args: unknown[]): Promise<unknown>;
}

// ============================================================
// services/systemConfig.js
// ============================================================
declare module '*/services/systemConfig.js' {
  export function initSystemConfig(): void;
  export function getFlag(name: string): unknown;
  export function setFlag(name: string, value: unknown): void;
  export function getAllFlags(): Record<string, unknown>;
  export function setFlags(updates: Record<string, unknown>): void;
  export function resetToDefaults(): void;
  export function killAll(): void;
  export function isMLGatekeeperEnabled(): unknown;
  export function isGeneticEnabled(): unknown;
  export function isCorrelationEnabled(): unknown;
  export function isAdversarialEnabled(): unknown;
  export const DEFAULT_FLAGS: Record<string, unknown>;
}

// ============================================================
// services/derivativesIntelligence.js
// ============================================================
declare module '*/services/derivativesIntelligence.js' {
  export function startDerivativesPolling(): void;
  export function stopDerivativesPolling(): void;
  export function getDerivativesSignal(ticker: string): unknown;
  export function getDerivativesMLFeatures(ticker: string): unknown;
  export function shouldBlockLongEntry(ticker: string): unknown;
  export function shouldFavorShortEntry(ticker: string): unknown;
  export function getAllDerivativesData(): unknown;
  export function getDerivativesStatus(): unknown;
  export function getLiquidationLevels(ticker: string): unknown;
  export function predictCascadeRisk(ticker: string): unknown;

  const _default: {
    startDerivativesPolling: typeof startDerivativesPolling;
    stopDerivativesPolling: typeof stopDerivativesPolling;
    getDerivativesSignal: typeof getDerivativesSignal;
    getDerivativesMLFeatures: typeof getDerivativesMLFeatures;
    shouldBlockLongEntry: typeof shouldBlockLongEntry;
    shouldFavorShortEntry: typeof shouldFavorShortEntry;
    getAllDerivativesData: typeof getAllDerivativesData;
    getDerivativesStatus: typeof getDerivativesStatus;
    getLiquidationLevels: typeof getLiquidationLevels;
    predictCascadeRisk: typeof predictCascadeRisk;
  };
  export default _default;
}

// ============================================================
// services/whaleFlowTracker.js
// ============================================================
declare module '*/services/whaleFlowTracker.js' {
  export function startWhaleFlowPolling(): void;
  export function stopWhaleFlowPolling(): void;
  export function getWhaleFlowSignal(ticker: string): unknown;
  export function getWhaleFlowMLFeatures(ticker: string): unknown;
  export function getWhaleFlowStatus(): unknown;

  const _default: {
    startWhaleFlowPolling: typeof startWhaleFlowPolling;
    stopWhaleFlowPolling: typeof stopWhaleFlowPolling;
    getWhaleFlowSignal: typeof getWhaleFlowSignal;
    getWhaleFlowMLFeatures: typeof getWhaleFlowMLFeatures;
    getWhaleFlowStatus: typeof getWhaleFlowStatus;
  };
  export default _default;
}

// ============================================================
// services/newCoinDetector.js
// ============================================================
declare module '*/services/newCoinDetector.js' {
  export function acknowledgeKnownTickers(tickers: string[], exchange?: string): unknown;
  export function getNewCoinRules(): unknown;
  export function initialize(): unknown;
  export function detectNewListings(currentTickers: string[], exchange?: string): unknown;
  export function updateNewCoinSignals(
    ticker: string,
    price: number,
    volume: number,
    spread: number,
    exchange?: string,
  ): unknown;
  export function markRugPullExit(ticker: string, exchange?: string): unknown;
  export function isNewListing(ticker: string, exchange?: string): unknown;
  export function getActiveNewListings(exchange?: string): unknown;
  export function getStats(): unknown;

  const _default: {
    acknowledgeKnownTickers: typeof acknowledgeKnownTickers;
    getNewCoinRules: typeof getNewCoinRules;
    initialize: typeof initialize;
    detectNewListings: typeof detectNewListings;
    updateNewCoinSignals: typeof updateNewCoinSignals;
    markRugPullExit: typeof markRugPullExit;
    isNewListing: typeof isNewListing;
    getActiveNewListings: typeof getActiveNewListings;
    getStats: typeof getStats;
  };
  export default _default;
}

// ============================================================
// services/exchangeAdapters/krakenAdapter.js
// ============================================================
declare module '*/services/exchangeAdapters/krakenAdapter.js' {
  export function setKrakenSessionManager(sm: unknown): void;
  export function krakenPublicRequest(...args: unknown[]): Promise<unknown>;
  export function krakenPrivateRequest(...args: unknown[]): Promise<unknown>;

  export interface KrakenAdapterInstance {
    getName(): string;
    formatTicker(ticker: string): string;
    parseTicker(pair: string): string;
    getCandles(ticker: string, timeframe?: string, limit?: number): Promise<Array<Record<string, number>>>;
    getInstruments(): Promise<{ data: Array<Record<string, unknown>> }>;
    getBalance(sessionId?: string): Promise<unknown>;
    placeBuyOrder(ticker: string, notional: number, sessionId?: string): Promise<unknown>;
    placeSellOrder(ticker: string, quantity: number, sessionId?: string, instrumentSpecs?: unknown): Promise<unknown>;
    getFeePercent(): number;
    getMakerFeePercent(): number;
    placeLimitBuyOrder(ticker: string, price: number, volume: number, sessionId?: string): Promise<unknown>;
    placeLimitSellOrder(ticker: string, price: number, volume: number, sessionId?: string): Promise<unknown>;
    getOpenOrders(sessionId?: string): Promise<unknown>;
    cancelOrder(orderId: string, sessionId?: string): Promise<unknown>;
    getOrderStatus(orderId: string, sessionId?: string): Promise<unknown>;
    placeStopLoss(ticker: string, volume: number, stopPrice: number, sessionId?: string): Promise<unknown>;
    placeTakeProfit(ticker: string, volume: number, limitPrice: number, sessionId?: string): Promise<unknown>;
    placeTrailingStop(ticker: string, volume: number, trailOffset: number, sessionId?: string): Promise<unknown>;
    placeStopLossLimit(ticker: string, volume: number, stopPrice: number, limitPrice: number, sessionId?: string): Promise<unknown>;
    getOrderBook(ticker: string, depth?: number): Promise<{ bids?: unknown[]; asks?: unknown[] }>;
    cancelAllOrdersAfter(timeout: number, sessionId?: string): Promise<unknown>;
    placePostOnlyBuy(ticker: string, price: number, volume: number, sessionId?: string): Promise<unknown>;
    placePostOnlySell(ticker: string, price: number, volume: number, sessionId?: string): Promise<unknown>;
    placeMarginLimit(ticker: string, side: string, price: number, volume: number, leverage: number, sessionId?: string, opts?: unknown): Promise<unknown>;
    placeMarginMarket(ticker: string, side: string, volume: number, leverage: number, sessionId?: string): Promise<unknown>;
    getOpenMarginPositions(sessionId?: string): Promise<unknown>;
    getMarginLevel(sessionId?: string): Promise<unknown>;
    placeBracketOrder(ticker: string, side: string, volume: number, entryPrice: number, stopLossPrice: number, sessionId?: string, opts?: unknown): Promise<unknown>;
  }

  export class KrakenAdapter implements KrakenAdapterInstance {
    getName(): string;
    formatTicker(ticker: string): string;
    parseTicker(pair: string): string;
    getCandles(ticker: string, timeframe?: string, limit?: number): Promise<Array<Record<string, number>>>;
    getInstruments(): Promise<{ data: Array<Record<string, unknown>> }>;
    getBalance(sessionId?: string): Promise<unknown>;
    placeBuyOrder(ticker: string, notional: number, sessionId?: string): Promise<unknown>;
    placeSellOrder(ticker: string, quantity: number, sessionId?: string, instrumentSpecs?: unknown): Promise<unknown>;
    getFeePercent(): number;
    getMakerFeePercent(): number;
    placeLimitBuyOrder(ticker: string, price: number, volume: number, sessionId?: string): Promise<unknown>;
    placeLimitSellOrder(ticker: string, price: number, volume: number, sessionId?: string): Promise<unknown>;
    getOpenOrders(sessionId?: string): Promise<unknown>;
    cancelOrder(orderId: string, sessionId?: string): Promise<unknown>;
    getOrderStatus(orderId: string, sessionId?: string): Promise<unknown>;
    placeStopLoss(ticker: string, volume: number, stopPrice: number, sessionId?: string): Promise<unknown>;
    placeTakeProfit(ticker: string, volume: number, limitPrice: number, sessionId?: string): Promise<unknown>;
    placeTrailingStop(ticker: string, volume: number, trailOffset: number, sessionId?: string): Promise<unknown>;
    placeStopLossLimit(ticker: string, volume: number, stopPrice: number, limitPrice: number, sessionId?: string): Promise<unknown>;
    getOrderBook(ticker: string, depth?: number): Promise<{ bids?: unknown[]; asks?: unknown[] }>;
    cancelAllOrdersAfter(timeout: number, sessionId?: string): Promise<unknown>;
    placePostOnlyBuy(ticker: string, price: number, volume: number, sessionId?: string): Promise<unknown>;
    placePostOnlySell(ticker: string, price: number, volume: number, sessionId?: string): Promise<unknown>;
    placeMarginLimit(ticker: string, side: string, price: number, volume: number, leverage: number, sessionId?: string, opts?: unknown): Promise<unknown>;
    placeMarginMarket(ticker: string, side: string, volume: number, leverage: number, sessionId?: string): Promise<unknown>;
    getOpenMarginPositions(sessionId?: string): Promise<unknown>;
    getMarginLevel(sessionId?: string): Promise<unknown>;
    placeBracketOrder(ticker: string, side: string, volume: number, entryPrice: number, stopLossPrice: number, sessionId?: string, opts?: unknown): Promise<unknown>;
  }

  export const krakenAdapter: KrakenAdapterInstance;
}

// ============================================================
// services/exchangeAdapters/cryptocomAdapter.js
// ============================================================
declare module '*/services/exchangeAdapters/cryptocomAdapter.js' {
  export function setSessionManager(sm: unknown): void;
  export function paramsToStr(obj: unknown, level?: number): string;
  export function generateSignature(method: string, id: unknown, apiKey: string, secretKey: string, params: unknown, nonce: number): string;
  export function makePublicRequest(method: string, params?: unknown): Promise<unknown>;
  export function makeSignedRequest(method: string, params?: unknown, sessionId?: string | null): Promise<unknown>;

  export interface CryptoComAdapterInstance {
    getName(): string;
    formatTicker(ticker: string): string;
    parseTicker(pair: string): string;
    getCandles(ticker: string, timeframe?: string, limit?: number): Promise<Array<Record<string, number>>>;
    getInstruments(): Promise<{ data: Array<Record<string, unknown>> }>;
    getBalance(sessionId?: string): Promise<unknown>;
    placeBuyOrder(ticker: string, notional: number, sessionId?: string): Promise<unknown>;
    placeSellOrder(ticker: string, quantity: number, sessionId?: string, instrumentSpecs?: unknown): Promise<unknown>;
    getFeePercent(): number;
    getMakerFeePercent(): number;
    placeLimitBuyOrder(ticker: string, price: number, quantity: number, sessionId?: string): Promise<unknown>;
    placeLimitSellOrder(ticker: string, price: number, quantity: number, sessionId?: string): Promise<unknown>;
    placeStopLoss(ticker: string, quantity: number, stopPrice: number, sessionId?: string): Promise<unknown>;
    placeTakeProfit(ticker: string, quantity: number, limitPrice: number, sessionId?: string): Promise<unknown>;
    cancelOrder(orderId: string, tickerOrSessionId?: string, sessionId?: string | null): Promise<unknown>;
    getOpenOrders(ticker?: string, sessionId?: string): Promise<unknown>;
    getOrderStatus(orderId: string, sessionId?: string | null): Promise<unknown>;
    getOrderBook(ticker: string, depth?: number): Promise<{ bids?: unknown[]; asks?: unknown[] }>;
  }

  export class CryptoComAdapter implements CryptoComAdapterInstance {
    getName(): string;
    formatTicker(ticker: string): string;
    parseTicker(pair: string): string;
    getCandles(ticker: string, timeframe?: string, limit?: number): Promise<Array<Record<string, number>>>;
    getInstruments(): Promise<{ data: Array<Record<string, unknown>> }>;
    getBalance(sessionId?: string): Promise<unknown>;
    placeBuyOrder(ticker: string, notional: number, sessionId?: string): Promise<unknown>;
    placeSellOrder(ticker: string, quantity: number, sessionId?: string, instrumentSpecs?: unknown): Promise<unknown>;
    getFeePercent(): number;
    getMakerFeePercent(): number;
    placeLimitBuyOrder(ticker: string, price: number, quantity: number, sessionId?: string): Promise<unknown>;
    placeLimitSellOrder(ticker: string, price: number, quantity: number, sessionId?: string): Promise<unknown>;
    placeStopLoss(ticker: string, quantity: number, stopPrice: number, sessionId?: string): Promise<unknown>;
    placeTakeProfit(ticker: string, quantity: number, limitPrice: number, sessionId?: string): Promise<unknown>;
    cancelOrder(orderId: string, tickerOrSessionId?: string, sessionId?: string | null): Promise<unknown>;
    getOpenOrders(ticker?: string, sessionId?: string): Promise<unknown>;
    getOrderStatus(orderId: string, sessionId?: string | null): Promise<unknown>;
    getOrderBook(ticker: string, depth?: number): Promise<{ bids?: unknown[]; asks?: unknown[] }>;
  }

  export const cryptoComAdapter: CryptoComAdapterInstance;
}
