// ============================================
// Phoenix V2 Crypto.com Adapter
// Thin wrapper around existing Crypto.com adapter
// Uses USD pairs (Canada compliant — no USDT/USDC)
// ============================================

import type { ExchangeAdapter, OrderResult } from './types.ts';
import { assertLiveOrdersAllowed } from '../engine/tradeMode.ts';

// --- Fee Constants (Crypto.com) ---

const CRYPTO_COM_FEES = {
  TAKER_PERCENT: 0.00075,   // 0.075% per side
  MAKER_PERCENT: 0.00050,   // 0.050% per side (estimated)
  ROUND_TRIP_TAKER: 0.0015, // 0.15% round-trip
  ROUND_TRIP_MAKER: 0.0010, // 0.10% round-trip
} as const;

// --- Lazy-loaded references ---

let _adapter: any = null;
let _wsService: any = null;

/**
 * Dynamically import existing Crypto.com adapter + WebSocket service.
 * Must be called once before using cryptoComV2.
 */
export async function initCryptoComAdapter(): Promise<void> {
  const [adapterModule, wsModule] = await Promise.all([
    import('../../services/exchangeAdapters/cryptocomAdapter.js'),
    import('../../services/websocketService.js').catch(() => null),
  ]);
  _adapter = adapterModule.cryptoComAdapter;
  _wsService = wsModule;
}

function getAdapter(): any {
  if (!_adapter) throw new Error('Crypto.com adapter not initialized — call initCryptoComAdapter() first');
  return _adapter;
}

// --- Status Mapping ---

function mapCryptoComStatus(status: string): OrderResult['status'] {
  switch (status?.toLowerCase()) {
    case 'filled':
    case 'closed': return 'filled';
    case 'new':
    case 'open':
    case 'pending_new': return 'pending';
    case 'canceled':
    case 'cancelled':
    case 'expired':
    case 'rejected': return 'cancelled';
    case 'partially_filled': return 'partial';
    default: return 'pending';
  }
}

// --- ExchangeAdapter Implementation ---

export const cryptoComV2: ExchangeAdapter = {
  getName(): string {
    return 'crypto.com';
  },

  async getLatestPrice(ticker: string): Promise<number> {
    // Try WebSocket first (cached, faster)
    if (_wsService?.getLatestPrice) {
      const wsPrice = _wsService.getLatestPrice(ticker);
      if (wsPrice && wsPrice > 0) return wsPrice;
    }
    // Fallback: REST candles, last close
    const adapter = getAdapter();
    const candles = await adapter.getCandles(ticker, '1m', 1);
    if (candles && candles.length > 0) {
      const last = candles[candles.length - 1];
      return last.c ?? last.close ?? 0;
    }
    throw new Error(`Cannot get price for ${ticker}`);
  },

  async placeMakerBuy(ticker: string, price: number, quantity: number): Promise<OrderResult> {
    assertLiveOrdersAllowed();
    const adapter = getAdapter();
    const result = await adapter.placeLimitBuyOrder(ticker, price, quantity, null);
    const fee = price * quantity * CRYPTO_COM_FEES.MAKER_PERCENT;
    return {
      orderId: result.orderId || '',
      ticker,
      side: 'buy',
      price,
      quantity,
      status: 'pending',
      fee,
      orderType: 'maker',
    };
  },

  async placeMakerSell(ticker: string, price: number, quantity: number): Promise<OrderResult> {
    assertLiveOrdersAllowed();
    const adapter = getAdapter();
    const result = await adapter.placeLimitSellOrder(ticker, price, quantity, null);
    const fee = price * quantity * CRYPTO_COM_FEES.MAKER_PERCENT;
    return {
      orderId: result.orderId || '',
      ticker,
      side: 'sell',
      price,
      quantity,
      status: 'pending',
      fee,
      orderType: 'maker',
    };
  },

  async placeMarketSell(ticker: string, quantity: number): Promise<OrderResult> {
    assertLiveOrdersAllowed();
    const adapter = getAdapter();
    const result = await adapter.placeSellOrder(ticker, quantity, null, null);
    const avgPrice = result.avgPrice || result.filledPrice || 0;
    const filledQty = result.filledQuantity ?? quantity;
    const fee = avgPrice * filledQty * CRYPTO_COM_FEES.TAKER_PERCENT;
    return {
      orderId: result.orderId || '',
      ticker,
      side: 'sell',
      price: avgPrice,
      quantity: filledQty,
      status: 'filled',
      fee,
      orderType: 'taker',
    };
  },

  async placeStopLoss(ticker: string, quantity: number, stopPrice: number): Promise<OrderResult> {
    assertLiveOrdersAllowed();
    const adapter = getAdapter();
    const result = await adapter.placeStopLoss(ticker, quantity, stopPrice, null);
    return {
      orderId: result.orderId || '',
      ticker,
      side: 'sell',
      price: stopPrice,
      quantity,
      status: 'pending',
      fee: 0,
      orderType: 'taker',
    };
  },

  async cancelOrder(orderId: string): Promise<boolean> {
    assertLiveOrdersAllowed();
    const adapter = getAdapter();
    try {
      // Crypto.com cancelOrder needs ticker — pass empty, adapter will use order's instrument
      const result = await adapter.cancelOrder(orderId, '', null);
      return result.success === true;
    } catch {
      return false;
    }
  },

  async getOrderStatus(orderId: string): Promise<OrderResult> {
    const adapter = getAdapter();
    const result = await adapter.getOrderStatus(orderId, null);
    return {
      orderId: result.orderId || orderId,
      ticker: '',
      side: 'buy',
      price: result.avgPrice || 0,
      quantity: result.filledQty || 0,
      status: mapCryptoComStatus(result.status),
      fee: result.fee || 0,
      orderType: 'maker',
    };
  },

  async getBestBid(ticker: string): Promise<number> {
    const adapter = getAdapter();
    const book = await adapter.getOrderBook(ticker, 1);
    if (book.bids && book.bids.length > 0) {
      return parseFloat(book.bids[0][0]);
    }
    throw new Error(`No bids for ${ticker}`);
  },

  async getBestAsk(ticker: string): Promise<number> {
    const adapter = getAdapter();
    const book = await adapter.getOrderBook(ticker, 1);
    if (book.asks && book.asks.length > 0) {
      return parseFloat(book.asks[0][0]);
    }
    throw new Error(`No asks for ${ticker}`);
  },
};

/** Get Crypto.com fee constants for use in config/risk calculations */
export function getCryptoComFees() {
  return CRYPTO_COM_FEES;
}
