/**
 * WebSocket Real-Time Data Service
 *
 * Connects to Crypto.com Exchange WebSocket for instant price updates.
 * Falls back to REST polling if WebSocket disconnects.
 *
 * Channels:
 *   - candlestick.1m.{instrument} - 1-minute candle updates
 *   - trade.{instrument} - Real-time trades
 */

import WebSocket from 'ws';

// ============================================
// STATE
// ============================================

let ws = null;
let connected = false;
let reconnectTimer = null;
let heartbeatTimer = null;
let subscriptions = new Set();
let onCandleCallback = null;
let onTradeCallback = null;
let onConnectCallback = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 100; // Increased for 24/7 operation
const RECONNECT_BASE_MS = 5000;     // Start at 5s
const RECONNECT_MAX_MS = 60000;     // Cap at 60s
const HEARTBEAT_INTERVAL_MS = 10000;  // Reduced from 15s for faster disconnect detection
const WS_URL = 'wss://stream.crypto.com/exchange/v1/market';

// Real-time candle buffer: ticker -> candles array
const realtimeCandles = new Map();
const MAX_BUFFERED_CANDLES = 200;

// Latest trade prices
const latestPrices = new Map();
const latestPriceTimes = new Map();

function setLatestPrice(ticker, price) {
  if (!(price > 0)) return;
  latestPrices.set(ticker, price);
  latestPriceTimes.set(ticker, Date.now());
}

// Latency tracking
let lastHeartbeatSentAt = 0;
let latencyMs = 0;
const latencyHistory = [];  // Rolling window of last 100 latency measurements
const MAX_LATENCY_HISTORY = 100;

// H14: Track time of last incoming message for stale-connection detection.
// Without this, a TCP zombie keeps `connected=true` and latency frozen at the
// last value while no candles flow → bot decides on stale prices. Mirrors
// KrakenWS's checkHeartbeat pattern (services/krakenWebsocketService.js:152).
let lastMessageTime = 0;
let _staleWarned = false;
const STALE_TIMEOUT_MS = 30000;  // 30s with no message = stale
const STALE_GRACE_MS = 10000;    // 10s grace before forcing reconnect
const STALE_CHECK_MS = 5000;     // Check every 5s
let staleCheckTimer = null;

// ============================================
// CONNECTION MANAGEMENT
// ============================================

function connect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }

  // Clean up old socket listeners to prevent memory leaks
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
      lastMessageTime = Date.now();  // H14: seed for stale detector
      _staleWarned = false;
      console.log('[WebSocket] Connected to Crypto.com market stream');

      // Start heartbeat
      clearInterval(heartbeatTimer);
      heartbeatTimer = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);

      // H14: Start stale-connection detector
      clearInterval(staleCheckTimer);
      staleCheckTimer = setInterval(checkStaleConnection, STALE_CHECK_MS);

      // Re-subscribe to all channels
      if (subscriptions.size > 0) {
        const channels = [...subscriptions];
        sendSubscribe(channels);
      }

      if (onConnectCallback) onConnectCallback();
    });

    ws.on('message', (data) => {
      lastMessageTime = Date.now();  // H14: any inbound message resets stale timer
      try {
        const msg = JSON.parse(data.toString());
        handleMessage(msg);
      } catch (e) {
        console.warn('[WebSocket] Message parse error:', e.message);
      }
    });

    ws.on('close', (code, reason) => {
      connected = false;
      console.log(`[WebSocket] Disconnected (code: ${code}). Reconnecting...`);
      clearInterval(heartbeatTimer);
      clearInterval(staleCheckTimer);  // H14
      scheduleReconnect();
    });

    ws.on('error', (error) => {
      console.error(`[WebSocket] Error: ${error.message}`);
      // Don't reconnect here - 'close' event will fire after error
    });

  } catch (error) {
    console.error(`[WebSocket] Connection failed: ${error.message}`);
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    console.error(`[WebSocket] Max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) reached. Resetting counter for 24/7 resilience.`);
    reconnectAttempts = 0; // Reset for 24/7 operation - never truly give up
  }

  // Exponential backoff: 5s → 10s → 20s → 40s → 60s cap
  const delay = Math.min(RECONNECT_BASE_MS * Math.pow(2, reconnectAttempts), RECONNECT_MAX_MS);
  reconnectAttempts++;
  console.log(`[WebSocket] Reconnecting in ${(delay / 1000).toFixed(0)}s (attempt ${reconnectAttempts})`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delay);
}

function sendHeartbeat() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    lastHeartbeatSentAt = Date.now();
    ws.send(JSON.stringify({
      id: lastHeartbeatSentAt,
      method: 'public/heartbeat',
    }));
  }
}

// H14: Detect stale TCP connections that keep readyState=OPEN but stop
// delivering messages. Without this, bot trades on prices last updated
// minutes ago while latency tracking shows the same old value forever.
function checkStaleConnection() {
  if (!connected) return;
  const elapsed = Date.now() - lastMessageTime;
  if (elapsed > STALE_TIMEOUT_MS + STALE_GRACE_MS) {
    console.warn(`[WebSocket] Stale connection (${(elapsed / 1000).toFixed(0)}s without messages) — forcing reconnect`);
    _staleWarned = false;
    if (ws) {
      try { ws.close(); } catch {}
      ws = null;
    }
    connected = false;
    clearInterval(heartbeatTimer);
    clearInterval(staleCheckTimer);
    scheduleReconnect();
  } else if (elapsed > STALE_TIMEOUT_MS && !_staleWarned) {
    console.warn(`[WebSocket] No messages for ${(elapsed / 1000).toFixed(0)}s — will force reconnect if it continues`);
    _staleWarned = true;
  } else if (elapsed < STALE_TIMEOUT_MS) {
    _staleWarned = false;
  }
}

function sendSubscribe(channels) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      id: Date.now(),
      method: 'subscribe',
      params: { channels },
    }));
    console.log(`[WebSocket] Subscribed to ${channels.length} channels`);
  }
}

// ============================================
// MESSAGE HANDLING
// ============================================

function handleMessage(msg) {
  // Heartbeat response
  if (msg.method === 'public/heartbeat') {
    // Track latency from heartbeat round-trip
    if (lastHeartbeatSentAt > 0) {
      latencyMs = Date.now() - lastHeartbeatSentAt;
      latencyHistory.push(latencyMs);
      if (latencyHistory.length > MAX_LATENCY_HISTORY) {
        latencyHistory.shift();
      }
    }
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        id: msg.id,
        method: 'public/respond-heartbeat',
      }));
    }
    return;
  }

  // Subscription confirmation
  if (msg.method === 'subscribe' && msg.code === 0) {
    return;
  }

  // Candlestick update
  if (msg.result?.channel?.startsWith('candlestick.')) {
    handleCandlestickUpdate(msg.result);
    return;
  }

  // Trade update
  if (msg.result?.channel?.startsWith('trade.')) {
    handleTradeUpdate(msg.result);
    return;
  }
}

function handleCandlestickUpdate(result) {
  const channel = result.channel; // e.g. "candlestick.1m.BTC_USD"
  const parts = channel.split('.');
  if (parts.length < 3) return;

  const instrument = parts.slice(2).join('.'); // Handle instrument names with dots
  const ticker = instrument.replace('_', '');  // BTC_USD -> BTCUSD

  const data = result.data;
  if (!data || data.length === 0) return;

  for (const candle of data) {
    const formatted = {
      t: candle.t,
      o: parseFloat(candle.o),
      h: parseFloat(candle.h),
      l: parseFloat(candle.l),
      c: parseFloat(candle.c),
      v: parseFloat(candle.v),
    };

    // Update buffer
    let buffer = realtimeCandles.get(ticker);
    if (!buffer) {
      buffer = [];
      realtimeCandles.set(ticker, buffer);
    }

    // Replace or append candle based on timestamp (O(1) lookup)
    const existingIdx = buffer.length > 0 ? buffer.findIndex(c => c.t === formatted.t) : -1;
    if (existingIdx >= 0) {
      buffer[existingIdx] = formatted;
    } else {
      buffer.push(formatted);
      // Trim from front if over limit
      while (buffer.length > MAX_BUFFERED_CANDLES) {
        buffer.shift();
      }
    }

    // Update latest price
    setLatestPrice(ticker, formatted.c);
  }

  if (onCandleCallback) {
    onCandleCallback(ticker, realtimeCandles.get(ticker));
  }
}

function handleTradeUpdate(result) {
  const channel = result.channel;
  const parts = channel.split('.');
  if (parts.length < 2) return;

  const instrument = parts.slice(1).join('.');
  const ticker = instrument.replace('_', '');
  const data = result.data;

  if (data && data.length > 0) {
    const lastTrade = data[data.length - 1];
    const price = parseFloat(lastTrade.p || lastTrade.price || 0);
    if (price > 0) {
      setLatestPrice(ticker, price);
    }

    if (onTradeCallback) {
      onTradeCallback(ticker, {
        price,
        quantity: parseFloat(lastTrade.q || lastTrade.quantity || 0),
        side: lastTrade.s || lastTrade.side || 'UNKNOWN',
        time: lastTrade.t || Date.now(),
      });
    }
  }
}

// ============================================
// PUBLIC API
// ============================================

/**
 * Initialize WebSocket connection and subscribe to tickers
 */
export function initWebSocket(tickers, callbacks = {}) {
  onCandleCallback = callbacks.onCandle || null;
  onTradeCallback = callbacks.onTrade || null;
  onConnectCallback = callbacks.onConnect || null;

  // Build subscription channels
  for (const ticker of tickers) {
    const instrument = ticker.replace(/USD$/, '_USD');
    subscriptions.add(`candlestick.1m.${instrument}`);
    subscriptions.add(`trade.${instrument}`);
  }

  connect();
}

/**
 * Subscribe to additional tickers
 */
export function subscribeTickers(tickers) {
  const newChannels = [];
  for (const ticker of tickers) {
    const instrument = ticker.replace(/USD$/, '_USD');
    const candleChannel = `candlestick.1m.${instrument}`;
    const tradeChannel = `trade.${instrument}`;

    if (!subscriptions.has(candleChannel)) {
      subscriptions.add(candleChannel);
      newChannels.push(candleChannel);
    }
    if (!subscriptions.has(tradeChannel)) {
      subscriptions.add(tradeChannel);
      newChannels.push(tradeChannel);
    }
  }

  if (newChannels.length > 0 && connected) {
    sendSubscribe(newChannels);
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

  // Build a map by timestamp for efficient merge
  const merged = new Map();
  for (const c of restCandles) {
    merged.set(c.t, c);
  }
  // Real-time candles override REST candles (more current)
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
  const avgLatency = latencyHistory.length > 0
    ? latencyHistory.reduce((a, b) => a + b, 0) / latencyHistory.length
    : 0;
  return {
    connected,
    subscriptions: subscriptions.size,
    tickers: [...realtimeCandles.keys()],
    bufferedCandles: Object.fromEntries(
      [...realtimeCandles.entries()].map(([k, v]) => [k, v.length])
    ),
    reconnectAttempts,
    latestPrices: Object.fromEntries(latestPrices),
    latencyMs,
    avgLatencyMs: Math.round(avgLatency),
    latencySamples: latencyHistory.length,
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
  latencyHistory.length = 0;
  console.log('[WebSocket] Connection closed');
}
