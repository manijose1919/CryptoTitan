/**
 * Kraken WebSocket v2 Real-Time Data Service
 *
 * Same public API as websocketService.js (Crypto.com) so server.js
 * can swap them based on the active exchange.
 *
 * Channels:
 *   - ohlc (interval 1) - 1-minute candle updates
 *   - trade           - Real-time trade prices
 *
 * Kraken WS v2 docs: https://docs.kraken.com/api/docs/websocket-v2/
 */

import WebSocket from 'ws';

// ============================================
// STATE
// ============================================

let ws = null;
let connected = false;
let reconnectTimer = null;
let heartbeatTimer = null;
let subscribedTickers = new Set();       // Our internal ticker names (e.g. "BTCUSD")
let onCandleCallback = null;
let onTradeCallback = null;
let onConnectCallback = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 100;
const RECONNECT_BASE_MS = 5000;
const RECONNECT_MAX_MS = 60000;
const HEARTBEAT_CHECK_MS = 20000;        // Check for stale connection every 20s
const HEARTBEAT_TIMEOUT_MS = 30000;      // Consider dead if no message for 30s
const WS_URL = 'wss://ws.kraken.com/v2';

// Real-time candle buffer: ticker -> candles array
const realtimeCandles = new Map();
const MAX_BUFFERED_CANDLES = 200;

// Latest trade prices: ticker -> price, with per-ticker update times so
// consumers can reject post-suspend / zombie-connection stale quotes
// (paper SOLUSD 2026-09-22: WS still had ~99 while 4h close was ~117).
const latestPrices = new Map();
const latestPriceTimes = new Map();

// Track last message time for heartbeat detection
let lastMessageTime = 0;

function setLatestPrice(ticker, price) {
    if (!(price > 0)) return;
    latestPrices.set(ticker, price);
    latestPriceTimes.set(ticker, Date.now());
}

// ============================================
// PAIR FORMAT CONVERSION
// ============================================

/** Convert our internal ticker (BTCUSD) to Kraken WS v2 format (BTC/USD) */
function toKrakenWsPair(ticker) {
    // BTCUSD → BTC/USD, ETHUSD → ETH/USD, etc.
    // Kraken WS v2 uses standard symbols (BTC not XBT, DOGE not XDG)
    const base = ticker.replace(/USD$/, '');
    const quote = 'USD';
    return `${base}/${quote}`;
}

/** Convert Kraken WS pair (BTC/USD) back to internal format (BTCUSD) */
function fromKrakenWsPair(krakenPair) {
    // BTC/USD → BTCUSD, ETH/USD → ETHUSD
    return krakenPair.replace('/', '');
}

// ============================================
// CONNECTION MANAGEMENT
// ============================================

function connect() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        return;
    }

    // Clean up old socket listeners to prevent memory leaks on reconnect
    if (ws) {
        ws.removeAllListeners();
        try { ws.close(); } catch (e) { /* already closed */ }
        ws = null;
    }

    try {
        ws = new WebSocket(WS_URL);

        ws.on('open', () => {
            connected = true;
            reconnectAttempts = 0;
            lastMessageTime = Date.now();
            console.log('[KrakenWS] Connected to Kraken market stream');

            // Start heartbeat checker
            clearInterval(heartbeatTimer);
            heartbeatTimer = setInterval(checkHeartbeat, HEARTBEAT_CHECK_MS);

            // Re-subscribe to all tickers
            if (subscribedTickers.size > 0) {
                sendSubscriptions([...subscribedTickers]);
            }

            if (onConnectCallback) onConnectCallback();
        });

        ws.on('message', (data) => {
            lastMessageTime = Date.now();
            try {
                const msg = JSON.parse(data.toString());
                handleMessage(msg);
            } catch (e) {
                if (Math.random() < 0.01) console.warn(`[KrakenWS] Parse error: ${e.message} — data: ${String(data).slice(0, 100)}`);
            }
        });

        ws.on('close', (code, reason) => {
            connected = false;
            console.log(`[KrakenWS] Disconnected (code: ${code}). Reconnecting...`);
            clearInterval(heartbeatTimer);
            scheduleReconnect();
        });

        ws.on('error', (error) => {
            console.error(`[KrakenWS] Error: ${error.message}`);
            // 'close' event fires after error
        });

    } catch (error) {
        console.error(`[KrakenWS] Connection failed: ${error.message}`);
        scheduleReconnect();
    }
}

function scheduleReconnect() {
    if (reconnectTimer) return;
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        console.error(`[KrakenWS] Max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) reached. Resetting for 24/7 resilience.`);
        reconnectAttempts = 0;
    }

    const delay = Math.min(RECONNECT_BASE_MS * Math.pow(2, reconnectAttempts), RECONNECT_MAX_MS);
    reconnectAttempts++;
    console.log(`[KrakenWS] Reconnecting in ${(delay / 1000).toFixed(0)}s (attempt ${reconnectAttempts})`);
    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
    }, delay);
}

/** Kraken sends heartbeat messages; if we haven't received anything in a while, reconnect.
 *  Two-phase: warn at HEARTBEAT_TIMEOUT_MS, force reconnect after grace period (10s extra).
 *  This avoids killing the connection on brief network blips. */
let _heartbeatWarned = false;
const HEARTBEAT_GRACE_MS = 10000; // Extra 10s grace before force kill

function checkHeartbeat() {
    if (!connected) return;
    const elapsed = Date.now() - lastMessageTime;
    if (elapsed > HEARTBEAT_TIMEOUT_MS + HEARTBEAT_GRACE_MS) {
        // Grace period exceeded — force reconnect
        console.warn(`[KrakenWS] Dead for ${(elapsed / 1000).toFixed(0)}s — forcing reconnect`);
        _heartbeatWarned = false;
        if (ws) {
            ws.close();
            ws = null;
        }
        connected = false;
        scheduleReconnect();
    } else if (elapsed > HEARTBEAT_TIMEOUT_MS && !_heartbeatWarned) {
        // First warning — connection may be flaky but give it grace period
        console.warn(`[KrakenWS] Stale for ${(elapsed / 1000).toFixed(0)}s — will reconnect if continues`);
        _heartbeatWarned = true;
    } else if (elapsed < HEARTBEAT_TIMEOUT_MS) {
        _heartbeatWarned = false; // Reset warning if messages resume
    }
}

// ============================================
// SUBSCRIBE
// ============================================

function sendSubscriptions(tickers) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    const krakenPairs = tickers.map(t => toKrakenWsPair(t));

    // Subscribe to OHLC (1-minute candles)
    ws.send(JSON.stringify({
        method: 'subscribe',
        params: {
            channel: 'ohlc',
            symbol: krakenPairs,
            interval: 1,
        },
    }));

    // Subscribe to trades for real-time prices
    ws.send(JSON.stringify({
        method: 'subscribe',
        params: {
            channel: 'trade',
            symbol: krakenPairs,
        },
    }));

    console.log(`[KrakenWS] Subscribed to ${krakenPairs.length} pairs: ${krakenPairs.join(', ')}`);
}

// ============================================
// MESSAGE HANDLING
// ============================================

function handleMessage(msg) {
    // Heartbeat
    if (msg.channel === 'heartbeat') {
        // Kraken sends heartbeats automatically; just note receipt (lastMessageTime already updated)
        return;
    }

    // Status / system messages
    if (msg.channel === 'status') {
        if (msg.data && msg.data[0]) {
            console.log(`[KrakenWS] System status: ${msg.data[0].system} / API: ${msg.data[0].version}`);
        }
        return;
    }

    // Subscription confirmations
    if (msg.method === 'subscribe' && msg.success === true) {
        return;
    }
    if (msg.method === 'subscribe' && msg.success === false) {
        console.error(`[KrakenWS] Subscribe failed: ${msg.error}`);
        return;
    }

    // OHLC updates
    if (msg.channel === 'ohlc') {
        handleOhlcUpdate(msg);
        return;
    }

    // Trade updates
    if (msg.channel === 'trade') {
        handleTradeUpdate(msg);
        return;
    }
}

function handleOhlcUpdate(msg) {
    const data = msg.data;
    if (!data || data.length === 0) return;

    for (const candle of data) {
        if (!candle || !candle.symbol || !candle.close) continue;
        const ticker = fromKrakenWsPair(candle.symbol);
        if (!ticker || ticker === 'undefined') continue;

        const formatted = {
            t: new Date(candle.timestamp).getTime(),
            o: parseFloat(candle.open),
            h: parseFloat(candle.high),
            l: parseFloat(candle.low),
            c: parseFloat(candle.close),
            v: parseFloat(candle.volume || candle.vwap || 0),
        };
        if (isNaN(formatted.c) || isNaN(formatted.t)) continue;

        // Update buffer
        let buffer = realtimeCandles.get(ticker);
        if (!buffer) {
            buffer = [];
            realtimeCandles.set(ticker, buffer);
        }

        // Replace or append candle based on timestamp
        const existing = buffer.findIndex(c => c.t === formatted.t);
        if (existing >= 0) {
            buffer[existing] = formatted;
        } else {
            buffer.push(formatted);
            if (buffer.length > MAX_BUFFERED_CANDLES) {
                buffer.shift();
            }
        }

        // Update latest price
        setLatestPrice(ticker, formatted.c);
    }

    // Callback for each updated ticker
    if (onCandleCallback) {
        const updated = new Set();
        for (const candle of data) {
            if (!candle?.symbol) continue;
            const t = fromKrakenWsPair(candle.symbol);
            if (t && !updated.has(t)) {
                updated.add(t);
                onCandleCallback(t, realtimeCandles.get(t));
            }
        }
    }
}

function handleTradeUpdate(msg) {
    const data = msg.data;
    if (!data || data.length === 0) return;

    // Process last trade in the batch
    const lastTrade = data[data.length - 1];
    if (!lastTrade?.symbol || !lastTrade?.price) return;
    const ticker = fromKrakenWsPair(lastTrade.symbol);
    if (!ticker || ticker === 'undefined') return;
    const price = parseFloat(lastTrade.price);
    if (isNaN(price)) return;

    if (price > 0) {
        setLatestPrice(ticker, price);
    }

    if (onTradeCallback) {
        onTradeCallback(ticker, {
            price,
            quantity: parseFloat(lastTrade.qty || 0),
            side: (lastTrade.side || 'unknown').toUpperCase(),
            time: new Date(lastTrade.timestamp).getTime(),
        });
    }
}

// ============================================
// PUBLIC API (same interface as websocketService.js)
// ============================================

/**
 * Initialize WebSocket connection and subscribe to tickers
 */
export function initWebSocket(tickers, callbacks = {}) {
    onCandleCallback = callbacks.onCandle || null;
    onTradeCallback = callbacks.onTrade || null;
    onConnectCallback = callbacks.onConnect || null;

    for (const ticker of tickers) {
        subscribedTickers.add(ticker);
    }

    connect();
}

/**
 * Subscribe to additional tickers
 */
export function subscribeTickers(tickers) {
    const newTickers = [];
    for (const ticker of tickers) {
        if (!subscribedTickers.has(ticker)) {
            subscribedTickers.add(ticker);
            newTickers.push(ticker);
        }
    }

    if (newTickers.length > 0 && connected) {
        sendSubscriptions(newTickers);
    }
}

/**
 * Get buffered real-time candles for a ticker.
 * Returns array of candles { t, o, h, l, c, v } or null if no data.
 */
export function getRealtimeCandles(ticker) {
    return realtimeCandles.get(ticker) || null;
}

/**
 * Merge real-time candles with REST-fetched candles.
 * REST candles are the base, real-time candles update/extend them.
 */
export function mergeCandles(restCandles, ticker) {
    const rtCandles = realtimeCandles.get(ticker);
    if (!rtCandles || rtCandles.length === 0) return restCandles;
    if (!restCandles || restCandles.length === 0) return rtCandles;

    const merged = new Map();
    for (const c of restCandles) {
        merged.set(c.t, c);
    }
    for (const c of rtCandles) {
        merged.set(c.t, c);
    }

    return [...merged.values()].sort((a, b) => a.t - b.t).slice(-MAX_BUFFERED_CANDLES);
}

/**
 * Get latest price for a ticker (from trades or candles)
 */
export function getLatestPrice(ticker) {
    return latestPrices.get(ticker) || null;
}

/**
 * Epoch ms when getLatestPrice(ticker) was last updated, or null.
 * Adapters use this to refuse stale WS quotes after suspend/zombie TCP.
 */
export function getLatestPriceUpdatedAt(ticker) {
    return latestPriceTimes.get(ticker) ?? null;
}

/**
 * Check if WebSocket is connected
 */
export function isConnected() {
    return connected;
}

/**
 * Get WebSocket status info
 */
export function getWebSocketStatus() {
    return {
        connected,
        exchange: 'kraken',
        subscriptions: subscribedTickers.size,
        tickers: [...realtimeCandles.keys()],
        bufferedCandles: Object.fromEntries(
            [...realtimeCandles.entries()].map(([k, v]) => [k, v.length])
        ),
        reconnectAttempts,
        latestPrices: Object.fromEntries(latestPrices),
    };
}

/**
 * Close WebSocket connection
 */
export function closeWebSocket() {
    clearInterval(heartbeatTimer);
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
    if (ws) {
        ws.close();
        ws = null;
    }
    connected = false;
    subscribedTickers.clear();
    realtimeCandles.clear();
    latestPrices.clear();
    console.log('[KrakenWS] Connection closed');
}
