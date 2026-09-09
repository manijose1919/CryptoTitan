// ============================================
// Phoenix V2 Kraken Adapter
// Thin wrapper around existing Kraken adapter
// ============================================

import type { ExchangeAdapter, OrderResult } from './types.ts';
import { V2_CONFIG } from '../engine/config.ts';
import { assertLiveOrdersAllowed } from '../engine/tradeMode.ts';

// --- Lazy-loaded references ---

let _adapter: any = null;
let _wsService: any = null;

/**
 * Dynamically import existing Kraken adapter + WebSocket service.
 * Must be called once before using krakenV2.
 */
export async function initKrakenAdapter(): Promise<void> {
  const [adapterModule, wsModule] = await Promise.all([
    import('../../services/exchangeAdapters/krakenAdapter.js'),
    import('../../services/krakenWebsocketService.js'),
  ]);
  _adapter = adapterModule.krakenAdapter;
  _wsService = wsModule;
}

function getAdapter(): any {
  if (!_adapter) throw new Error('Kraken adapter not initialized — call initKrakenAdapter() first');
  return _adapter;
}

// --- Status Mapping ---

function mapKrakenStatus(status: string): OrderResult['status'] {
  switch (status) {
    case 'closed': return 'filled';
    case 'open': return 'pending';
    case 'canceled':
    case 'cancelled':
    case 'expired': return 'cancelled';
    case 'partial': return 'partial';
    default: return 'pending';
  }
}

// --- ExchangeAdapter Implementation ---

export const krakenV2: ExchangeAdapter = {
  getName(): string {
    return 'kraken';
  },

  async getLatestPrice(ticker: string): Promise<number> {
    // Try WebSocket first (cached, faster)
    if (_wsService?.getLatestPrice) {
      const wsPrice = _wsService.getLatestPrice(ticker);
      if (wsPrice && wsPrice > 0) return wsPrice;
    }
    // Fallback: REST candles, last close.
    // krakenAdapter.getCandles returns rows shaped {t,o,h,l,c,v} — abbreviated
    // keys. Earlier code read `.close` (long form) which is always undefined
    // here, causing pnlPercent=NaN in checkExits and every exit branch
    // (SL/TP/trail/time-kill) to silently fail. The defensive `c ?? close ?? 0`
    // matches the cryptocom adapter's pattern and accepts either shape.
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
    const result = await adapter.placePostOnlyBuy(ticker, price, quantity, 'v2');
    const fee = price * quantity * V2_CONFIG.FEE_MAKER_PERCENT;
    return {
      orderId: result.orderId || '',
      ticker,
      side: 'buy',
      price,
      quantity: result.volume ?? quantity,
      status: 'pending',
      fee,
      orderType: 'maker',
    };
  },

  async placeMakerSell(ticker: string, price: number, quantity: number): Promise<OrderResult> {
    assertLiveOrdersAllowed();
    const adapter = getAdapter();
    const result = await adapter.placePostOnlySell(ticker, price, quantity, 'v2');
    const fee = price * quantity * V2_CONFIG.FEE_MAKER_PERCENT;
    return {
      orderId: result.orderId || '',
      ticker,
      side: 'sell',
      price,
      quantity: result.volume ?? quantity,
      status: 'pending',
      fee,
      orderType: 'maker',
    };
  },

  async placeMarketSell(ticker: string, quantity: number): Promise<OrderResult> {
    assertLiveOrdersAllowed();
    const adapter = getAdapter();
    const result = await adapter.placeSellOrder(ticker, quantity, 'v2', null);
    const avgPrice = result.avgPrice || result.filledPrice || 0;
    const fee = avgPrice * (result.filledQuantity ?? quantity) * V2_CONFIG.FEE_TAKER_PERCENT;
    return {
      orderId: result.orderId || '',
      ticker,
      side: 'sell',
      price: avgPrice,
      quantity: result.filledQuantity ?? quantity,
      status: 'filled',
      fee,
      orderType: 'taker',
    };
  },

  async placeStopLoss(ticker: string, quantity: number, stopPrice: number): Promise<OrderResult> {
    assertLiveOrdersAllowed();
    const adapter = getAdapter();
    const result = await adapter.placeStopLoss(ticker, quantity, stopPrice, 'v2');
    return {
      orderId: result.orderId || '',
      ticker,
      side: 'sell',
      price: stopPrice,
      quantity: result.volume ?? quantity,
      status: 'pending',
      fee: 0,
      orderType: 'taker',
    };
  },

  async cancelOrder(orderId: string): Promise<boolean> {
    assertLiveOrdersAllowed();
    const adapter = getAdapter();
    try {
      const result = await adapter.cancelOrder(orderId, 'v2');
      return result.success === true;
    } catch {
      return false;
    }
  },

  async getOrderStatus(orderId: string): Promise<OrderResult> {
    const adapter = getAdapter();
    const result = await adapter.getOrderStatus(orderId, 'v2');
    return {
      orderId: result.orderId || orderId,
      ticker: '',
      side: 'buy',
      price: result.avgPrice || 0,
      quantity: result.filledQty || 0,
      status: mapKrakenStatus(result.status),
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
