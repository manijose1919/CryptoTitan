// ============================================
// Phoenix V2 Bearish Services Orchestrator
// Runs shorts, staking, arb, basis, and extreme-fear DCA
// independently of the V2 long-only trading loop.
// ============================================

import { V2_CONFIG } from './config.ts';
import { isLiveTradingConfirmed } from './tradeMode.ts';
import { describeBearishBootSummary } from './bearishBootSummary.ts';
import { getDb } from '../../services/database.js';
import { shortSellingEngine } from '../../core/shortSellingEngine.ts';
import { stakingEngine } from '../../core/stakingEngine.ts';
import { arbitrageEngine } from '../../core/arbitrageEngine.ts';
import { detectRegime } from '../indicators/indicators.ts';
import type { Candle } from '../pipeline/types.ts';
import type { ExchangeAdapter } from '../exchange/types.ts';

// Candle fetcher — reuse V1 Kraken adapter (same as tradeEngine)
async function fetchCandles(ticker: string): Promise<Candle[] | null> {
  try {
    const mod = await import('../../services/exchangeAdapters/krakenAdapter.js');
    const adapter = mod.krakenAdapter;
    const raw = await adapter.getCandles(ticker, V2_CONFIG.CANDLE_INTERVAL, 100);
    if (!raw || raw.length === 0) return null;
    // Normalize to V2 Candle format
    return raw.map((c: any) => ({
      open: c.o ?? c.open,
      high: c.h ?? c.high,
      low: c.l ?? c.low,
      close: c.c ?? c.close,
      volume: c.v ?? c.volume ?? 0,
      time: c.t ?? c.time ?? 0,
    }));
  } catch { return null; }
}

// ─── Config ────────────────────────────────────────────────

const BEARISH_CONFIG = {
  // How often to run bearish evaluation (separate from V2's 30s loop)
  EVAL_INTERVAL_MS: 60_000,        // 1 minute — shorts need timely evaluation
  // Disabled until each service has its own validated edge and an explicit
  // live interlock. Staking can call a real exchange API and must never start
  // implicitly when the day-trading engine is in paper mode.
  SHORT_ENABLED: false,
  STAKING_ENABLED: false,
  ARB_ENABLED: false,
  DCA_FEAR_ENABLED: true,

  // Extreme Fear DCA
  DCA_FEAR_THRESHOLD: 20,          // Was 15 — raised to catch "Fear" not just "Extreme Fear"; F&G 15-20 is still deeply fearful
  DCA_TICKERS: ['BTCUSD', 'ETHUSD', 'SOLUSD'] as string[],  // Blue chips + SOL at discount
  DCA_AMOUNT_USD: 10,              // $10 per buy (sim by default; real requires dual live interlock)
  DCA_COOLDOWN_MS: 4 * 60 * 60 * 1000, // Max 1 buy per ticker per 4 hours
  DCA_MAX_DAILY_BUYS: 9,           // Was 6 — bumped to 3 rounds/day (3 tickers × 3 rounds); DCA is the most profitable strategy
  DCA_SIM_ONLY: true,              // Sim-only. Real buys also require V2_MODE=live + V2_LIVE_CONFIRMED=yes.
};

// ─── State ─────────────────────────────────────────────────

let timer: ReturnType<typeof setInterval> | null = null;
let exchange: ExchangeAdapter | null = null;
let running = false;
let evalInProgress = false;

// DCA tracking
// M21: in-memory map; seeded from v2_dca_buys on first evaluateDCA call so
// PM2 restarts don't allow back-to-back DCA buys on the same ticker.
const dcaLastBuy: Map<string, number> = new Map();
let dcaCooldownLoaded = false;
let dcaBuysToday = 0;
let dcaDayReset = 0;

// Short persistence
const shortPersistenceLoaded = { value: false };

// Stats
const bearishStats = {
  evalCount: 0,
  shortEvals: 0,
  shortOpened: 0,
  shortClosed: 0,
  dcaBuys: 0,
  arbScans: 0,
  stakingChecks: 0,
  /** Duration of last evaluate() in ms (often 0 when work is sub-ms). */
  lastEvalTime: 0,
  /** Wall-clock ms when last evaluate() finished — for soak/stale monitors. */
  lastEvalAt: 0,
};

// ─── Short Position Persistence ────────────────────────────

function initShortTables(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS v2_short_positions (
      id TEXT PRIMARY KEY,
      exchange TEXT NOT NULL,
      ticker TEXT NOT NULL,
      quantity REAL NOT NULL,
      entry_price REAL NOT NULL,
      entry_time INTEGER NOT NULL,
      leverage REAL NOT NULL DEFAULT 1,
      stop_loss_price REAL NOT NULL,
      take_profit_price REAL NOT NULL,
      highest_price REAL NOT NULL,
      lowest_price REAL NOT NULL,
      margin_used REAL NOT NULL,
      liquidation_price REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      exit_price REAL,
      exit_time INTEGER,
      pnl REAL,
      exit_reason TEXT
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS v2_short_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticker TEXT NOT NULL,
      pnl REAL NOT NULL,
      closed_at INTEGER NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS v2_dca_buys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticker TEXT NOT NULL,
      price REAL NOT NULL,
      amount_usd REAL NOT NULL,
      quantity REAL NOT NULL,
      fear_greed_index INTEGER NOT NULL,
      simulated INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS v2_short_balance (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      balance REAL NOT NULL DEFAULT 1000,
      initial_balance REAL NOT NULL DEFAULT 1000,
      updated_at INTEGER NOT NULL
    )
  `);

  // Seed balance row if empty
  const row = db.prepare('SELECT balance FROM v2_short_balance WHERE id = 1').get() as { balance: number } | undefined;
  if (!row) {
    db.prepare('INSERT INTO v2_short_balance (id, balance, initial_balance, updated_at) VALUES (1, 1000, 1000, ?)').run(Date.now());
  }
}

// M22: rate-limited warn instead of silent swallow on persist failures.
// Combined with M21, a DB outage during fear-DCA loses both the buy record
// AND the cooldown state — silent failure here was the worst case.
let _lastBearishPersistErrLog = 0;
function _logPersistErr(label: string, err: unknown): void {
  const now = Date.now();
  if (now - _lastBearishPersistErrLog < 60_000) return;
  _lastBearishPersistErrLog = now;
  console.warn(`[BearishServices] ${label} persist failed: ${(err as Error).message}`);
}

function persistShortBalance(balance: number): void {
  try {
    const db = getDb();
    db.prepare('UPDATE v2_short_balance SET balance = ?, updated_at = ? WHERE id = 1').run(balance, Date.now());
  } catch (err) { _logPersistErr('shortBalance', err); }
}

function loadShortBalance(): number {
  try {
    const db = getDb();
    const row = db.prepare('SELECT balance FROM v2_short_balance WHERE id = 1').get() as { balance: number } | undefined;
    return row?.balance ?? 1000;
  } catch { return 1000; }
}

function persistShortTrade(ticker: string, pnl: number): void {
  try {
    const db = getDb();
    db.prepare('INSERT INTO v2_short_history (ticker, pnl, closed_at) VALUES (?, ?, ?)').run(ticker, pnl, Date.now());
  } catch (err) { _logPersistErr('shortTrade', err); }
}

function loadShortHistory(): { time: number; pnl: number; ticker: string }[] {
  try {
    const db = getDb();
    const rows = db.prepare('SELECT ticker, pnl, closed_at as time FROM v2_short_history ORDER BY closed_at DESC LIMIT 500').all() as any[];
    return rows.map(r => ({ ticker: r.ticker, pnl: r.pnl, time: r.time }));
  } catch { return []; }
}

function persistDCABuy(ticker: string, price: number, amountUsd: number, quantity: number, fgIndex: number): void {
  try {
    const db = getDb();
    db.prepare('INSERT INTO v2_dca_buys (ticker, price, amount_usd, quantity, fear_greed_index, simulated, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(ticker, price, amountUsd, quantity, fgIndex, BEARISH_CONFIG.DCA_SIM_ONLY ? 1 : 0, Date.now());
  } catch (err) { _logPersistErr('dcaBuy', err); }
}

// ─── Short Selling Wrapper (uses V2 regime data) ───────────

async function evaluateShorts(): Promise<void> {
  if (!exchange || !BEARISH_CONFIG.SHORT_ENABLED) return;

  // Restore balance from DB on first run
  if (!shortPersistenceLoaded.value) {
    const savedBalance = loadShortBalance();
    if (savedBalance !== 1000) {
      (shortSellingEngine as any).simBalance = savedBalance;
      console.log(`[Bearish] Restored short sim balance: $${savedBalance.toFixed(2)}`);
    }
    // Restore trade history
    const history = loadShortHistory();
    if (history.length > 0) {
      (shortSellingEngine as any).tradeHistory = history;
      console.log(`[Bearish] Restored ${history.length} short trade history records`);
    }
    shortPersistenceLoaded.value = true;
  }

  const prevBalance = (shortSellingEngine as any).simBalance as number;

  for (const ticker of V2_CONFIG.SCAN_TICKERS) {
    try {
      const price = await exchange.getLatestPrice(ticker);
      if (!price || price <= 0) continue;

      // Get 15m candles for regime detection
      const candles = await fetchCandles(ticker);
      if (!candles || candles.length < 50) continue;

      const regime = detectRegime(candles);
      bearishStats.shortEvals++;

      // Calculate indicators for short evaluation
      const closes = candles.map(c => c.close);

      // TC score (simplified — use last candle's relative position)
      const ema20 = closes.slice(-20).reduce((s, c) => s + c, 0) / 20;
      const ema50 = closes.slice(-50).reduce((s, c) => s + c, 0) / 50;
      const tcScore = ema20 > ema50 ? 60 : ema20 < ema50 * 0.995 ? 20 : 40;

      // RSI 14
      let rsiValue = 50;
      if (closes.length >= 15) {
        let avgGain = 0, avgLoss = 0;
        for (let i = closes.length - 14; i < closes.length; i++) {
          const diff = closes[i] - closes[i - 1];
          if (diff > 0) avgGain += diff; else avgLoss -= diff;
        }
        avgGain /= 14; avgLoss /= 14;
        rsiValue = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
      }

      // 5-bar momentum
      const priceChange5 = closes.length >= 6
        ? ((closes[closes.length - 1] - closes[closes.length - 6]) / closes[closes.length - 6]) * 100
        : 0;

      // EMA slope: (ema20 - ema50) / ema50 as percentage
      const emaSlope = ema50 > 0 ? ((ema20 - ema50) / ema50) * 100 : 0;

      // Bollinger Band %B
      let bbPercentB = 0.5;
      if (closes.length >= 20) {
        const sma20 = ema20; // Close enough approximation
        const stdev = Math.sqrt(closes.slice(-20).reduce((s, c) => s + (c - sma20) ** 2, 0) / 20);
        const bbUpper = sma20 + 2 * stdev;
        const bbLower = sma20 - 2 * stdev;
        bbPercentB = bbUpper !== bbLower ? (closes[closes.length - 1] - bbLower) / (bbUpper - bbLower) : 0.5;
      }

      // 20-bar price change
      const priceChange20 = closes.length >= 21
        ? ((closes[closes.length - 1] - closes[closes.length - 21]) / closes[closes.length - 21]) * 100
        : 0;

      const shortEval = shortSellingEngine.evaluateShortEntry(
        ticker, 'kraken', price, regime.regime,
        0.5, // Base confidence (no ML for shorts yet)
        tcScore, rsiValue, priceChange5,
        { emaSlope, bbPercentB, priceChange20 },
      );

      if (shortEval.shouldShort && shortEval.size) {
        shortSellingEngine.openShort(ticker, 'kraken', price, shortEval.size, shortEval.reason);
        bearishStats.shortOpened++;
        console.log(`[Bearish] SHORT opened: ${ticker} @ $${price.toFixed(2)} — ${shortEval.reason}`);
      }
    } catch { /* skip ticker */ }
  }

  // Check exits on existing positions
  const positions = shortSellingEngine.getPositions();
  if (positions.length > 0) {
    const priceMap = new Map<string, number>();
    for (const pos of positions) {
      try {
        const p = await exchange.getLatestPrice(pos.ticker);
        if (p) priceMap.set(`${pos.exchange}:${pos.ticker}`, p);
      } catch { /* skip */ }
    }
    if (priceMap.size > 0) {
      const beforeCount = shortSellingEngine.getPositions().length;
      shortSellingEngine.checkExits(priceMap);
      const afterCount = shortSellingEngine.getPositions().length;
      if (afterCount < beforeCount) {
        bearishStats.shortClosed += (beforeCount - afterCount);
      }
    }
  }

  // Persist balance if changed
  const newBalance = (shortSellingEngine as any).simBalance as number;
  if (newBalance !== prevBalance) {
    persistShortBalance(newBalance);
    // Persist new trade history entries
    const history = (shortSellingEngine as any).tradeHistory as { time: number; pnl: number; ticker: string }[];
    if (history.length > 0) {
      const latest = history[history.length - 1];
      persistShortTrade(latest.ticker, latest.pnl);
    }
  }
}

// ─── Extreme Fear DCA ──────────────────────────────────────

async function evaluateFearDCA(): Promise<void> {
  if (!exchange || !BEARISH_CONFIG.DCA_FEAR_ENABLED) return;

  // Get raw Alternative.me Fear & Greed index (not blended — DCA should trigger on real retail fear)
  let fgIndex: number;
  try {
    const fg = await import('../../services/fearGreedGate.js');
    const getRaw = fg.getAlternativeMeRaw || fg.default?.getAlternativeMeRaw;
    const getBlended = fg.getFearGreedIndex || fg.default?.getFearGreedIndex;
    fgIndex = getRaw ? (getRaw() ?? 50) : (getBlended ? (getBlended() ?? 50) : 50);
  } catch { return; }

  if (fgIndex >= BEARISH_CONFIG.DCA_FEAR_THRESHOLD) return;

  // Reset daily counter
  const today = Math.floor(Date.now() / 86400000);
  if (today !== dcaDayReset) {
    dcaBuysToday = 0;
    dcaDayReset = today;
  }

  // M21: seed dcaLastBuy from DB on first call so PM2 restart doesn't bypass
  // the cooldown. We pull most-recent created_at per ticker from v2_dca_buys.
  if (!dcaCooldownLoaded) {
    try {
      const db = getDb();
      const rows = db.prepare(
        `SELECT ticker, MAX(created_at) AS last FROM v2_dca_buys GROUP BY ticker`
      ).all() as Array<{ ticker: string; last: number }>;
      for (const r of rows) {
        if (r.ticker && Number.isFinite(r.last)) dcaLastBuy.set(r.ticker, r.last);
      }
      dcaCooldownLoaded = true;
    } catch {
      // Best-effort — if v2_dca_buys doesn't exist yet, just proceed with empty map.
      dcaCooldownLoaded = true;
    }
  }

  if (dcaBuysToday >= BEARISH_CONFIG.DCA_MAX_DAILY_BUYS) return;

  for (const ticker of BEARISH_CONFIG.DCA_TICKERS) {
    // Check cooldown
    const lastBuy = dcaLastBuy.get(ticker) || 0;
    if (Date.now() - lastBuy < BEARISH_CONFIG.DCA_COOLDOWN_MS) continue;

    try {
      const price = await exchange.getLatestPrice(ticker);
      if (!price || price <= 0) continue;

      // Graduated DCA: buy more when fear is deeper
      // F&G 15-20: 1x base, 10-14: 1.25x, 5-9: 1.5x, 0-4: 2x
      const fearMultiplier = fgIndex <= 4 ? 2.0 : fgIndex <= 9 ? 1.5 : fgIndex <= 14 ? 1.25 : 1.0;
      const buyAmount = Math.round(BEARISH_CONFIG.DCA_AMOUNT_USD * fearMultiplier);

      // Kraken price precision: BTC=1 decimal, ETH/SOL/etc=2 decimals, small coins=4+
      const priceDecimals = price > 10000 ? 1 : price > 10 ? 2 : price > 1 ? 4 : 6;
      const qtyDecimals = price > 10000 ? 8 : price > 10 ? 6 : price > 1 ? 4 : 2;
      const buyPrice = parseFloat((price * 0.999).toFixed(priceDecimals));
      const quantity = parseFloat((buyAmount / price).toFixed(qtyDecimals));

      // Real DCA requires BOTH DCA_SIM_ONLY=false AND the dual live interlock.
      // Flipping only the sim flag must never place exchange orders in paper.
      const allowRealDca = !BEARISH_CONFIG.DCA_SIM_ONLY && isLiveTradingConfirmed();
      if (!allowRealDca) {
        if (!BEARISH_CONFIG.DCA_SIM_ONLY && !isLiveTradingConfirmed()) {
          console.warn(
            `[Bearish] DCA BUY forced to sim — live interlock not confirmed ` +
            `(V2_MODE=${process.env.V2_MODE ?? ''} V2_LIVE_CONFIRMED=${process.env.V2_LIVE_CONFIRMED ?? ''})`,
          );
        }
        console.log(
          `[Bearish] DCA BUY (sim): ${ticker} $${buyAmount} @ $${price.toFixed(2)}`,
          `(${quantity} units, F&G=${fgIndex}, ${fearMultiplier}x)`
        );
      } else {
        try {
          const mod = await import('../../services/exchangeAdapters/krakenAdapter.js');
          const krakenAdapter = mod.krakenAdapter;
          await krakenAdapter.placePostOnlyBuy(ticker, buyPrice, quantity);
          console.log(
            `[Bearish] DCA BUY (REAL): ${ticker} $${buyAmount} @ $${price.toFixed(2)}`,
            `(${quantity.toFixed(6)} units, F&G=${fgIndex}, ${fearMultiplier}x)`
          );
        } catch (err: any) {
          console.error(`[Bearish] DCA real buy failed for ${ticker}: ${err.message}`);
          continue;
        }
      }

      persistDCABuy(ticker, price, buyAmount, quantity, fgIndex);
      dcaLastBuy.set(ticker, Date.now());
      dcaBuysToday++;
      bearishStats.dcaBuys++;

      if (dcaBuysToday >= BEARISH_CONFIG.DCA_MAX_DAILY_BUYS) break;
    } catch { /* skip ticker */ }
  }
}

// ─── Staking Wrapper ───────────────────────────────────────

function startStaking(): void {
  if (!BEARISH_CONFIG.STAKING_ENABLED) return;

  // Register the V2 exchange adapter with the staking engine
  // The staking engine will call getBalance() to find idle assets
  try {
    // Import adapters from V1 (staking needs real exchange adapters, not V2 wrappers)
    import('../../services/exchangeAdapters/krakenAdapter.js').then(mod => {
      if (mod.krakenAdapter) {
        stakingEngine.registerAdapter('kraken', mod.krakenAdapter);
        console.log('[Bearish] Registered Kraken adapter with staking engine');
      }
    }).catch(() => {});

    import('../../services/exchangeAdapters/cryptocomAdapter.js').then(async (mod) => {
      if (mod.cryptoComAdapter) {
        // Skip Crypto.com staking entirely if credentials aren't configured.
        // Checking env upfront avoids the otherwise-unavoidable [Crypto.com]
        // "Authentication not configured" warning emitted by the adapter when
        // getBalance() runs without keys (logged once per process via
        // _noCredsWarn / _authWarn, but PM2 restarts repeatedly reset that).
        if (!process.env.SESSION_API_KEY || !process.env.SESSION_SECRET_KEY) {
          console.log('[Bearish] Crypto.com staking skipped — no SESSION_API_KEY/SESSION_SECRET_KEY in env');
          return;
        }
        // Credentials present — validate they work before registering
        try {
          await mod.cryptoComAdapter.getBalance();
          stakingEngine.registerAdapter('crypto.com', mod.cryptoComAdapter);
          console.log('[Bearish] Registered Crypto.com adapter with staking engine');
        } catch {
          console.log('[Bearish] Skipping Crypto.com staking (auth failed — credentials present but invalid)');
        }
      }
    }).catch(() => {});

    stakingEngine.start();
    console.log('[Bearish] Staking engine started');
  } catch (err: any) {
    console.warn(`[Bearish] Staking start failed: ${err.message}`);
  }
}

// ─── Arbitrage Wrapper ─────────────────────────────────────

function startArbitrage(): void {
  if (!BEARISH_CONFIG.ARB_ENABLED) return;

  try {
    // Register both exchange adapters + WS services
    Promise.all([
      import('../../services/exchangeAdapters/krakenAdapter.js'),
      import('../../services/exchangeAdapters/cryptocomAdapter.js'),
      import('../../services/krakenWebsocketService.js'),
      import('../../services/websocketService.js'),
    ]).then(([krakenMod, ccMod, krakenWs, ccWs]) => {
      const kraken = krakenMod.krakenAdapter || krakenMod.default || krakenMod;
      const cc = ccMod.cryptoComAdapter || ccMod.default || ccMod;
      const kws = krakenWs.default || krakenWs;
      const cws = ccWs.default || ccWs;

      if (kraken) arbitrageEngine.registerAdapter('kraken', kraken);
      if (cc) arbitrageEngine.registerAdapter('crypto.com', cc);
      if (kws) arbitrageEngine.registerWsService('kraken', kws);
      if (cws) arbitrageEngine.registerWsService('crypto.com', cws);

      // Set common tickers (available on both exchanges)
      arbitrageEngine.setCommonTickers([
        'BTCUSD', 'ETHUSD', 'SOLUSD', 'XRPUSD', 'ADAUSD',
        'LINKUSD', 'DOTUSD', 'AVAXUSD', 'DOGEUSD',
      ]);

      arbitrageEngine.start();
      console.log('[Bearish] Arbitrage engine started');
    }).catch((err) => {
      console.warn(`[Bearish] Arbitrage setup failed: ${err.message}`);
    });
  } catch (err: any) {
    console.warn(`[Bearish] Arbitrage start failed: ${err.message}`);
  }
}

// ─── Main Evaluation Loop ──────────────────────────────────

async function evaluate(): Promise<void> {
  if (evalInProgress) return;
  evalInProgress = true;

  const start = Date.now();
  bearishStats.evalCount++;

  try {
    // Run shorts evaluation (uses V2 regime data)
    await evaluateShorts();

    // Run extreme fear DCA
    await evaluateFearDCA();

    bearishStats.lastEvalTime = Date.now() - start;
    bearishStats.lastEvalAt = Date.now();

    // Log summary every 10 evaluations
    if (bearishStats.evalCount % 10 === 1) {
      const shortStatus = shortSellingEngine.getStatus();
      console.log(
        `[Bearish] Eval #${bearishStats.evalCount} (${bearishStats.lastEvalTime}ms):`,
        `shorts=${shortStatus.openPositions} open, $${shortStatus.simPnl.toFixed(2)} P&L,`,
        `DCA buys=${bearishStats.dcaBuys},`,
        `short evals=${bearishStats.shortEvals}, opened=${bearishStats.shortOpened}, closed=${bearishStats.shortClosed}`
      );
    }
  } catch (err: any) {
    console.error(`[Bearish] Eval error: ${err.message}`);
  } finally {
    evalInProgress = false;
  }
}

// ─── Public API ────────────────────────────────────────────

export function initBearishServices(adapter: ExchangeAdapter): void {
  exchange = adapter;
  initShortTables();
  console.log('[Bearish] Services initialized');
}

export function startBearishServices(): void {
  if (running) return;
  running = true;

  // Start staking and arb as background services (they have their own intervals)
  startStaking();
  startArbitrage();

  // Start bearish evaluation loop (shorts + DCA)
  evaluate(); // Run immediately
  timer = setInterval(() => evaluate(), BEARISH_CONFIG.EVAL_INTERVAL_MS);

  console.log(
    `[Bearish] Services started (${describeBearishBootSummary(BEARISH_CONFIG)}; ` +
    `eval every ${BEARISH_CONFIG.EVAL_INTERVAL_MS / 1000}s)`,
  );
}

export function stopBearishServices(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  running = false;
  stakingEngine.stop();
  arbitrageEngine.stop();
  console.log('[Bearish] All services stopped');
}

export function getBearishStatus() {
  const shortStatus = {
    ...shortSellingEngine.getStatus(),
    enabled: BEARISH_CONFIG.SHORT_ENABLED,
  };
  const stakingStatus = {
    ...stakingEngine.getStatus(),
    enabled: BEARISH_CONFIG.STAKING_ENABLED,
  };

  let arbStatus: any = {};
  try { arbStatus = arbitrageEngine.getStatus(); } catch { /* */ }
  arbStatus = { ...arbStatus, enabled: BEARISH_CONFIG.ARB_ENABLED };

  // Load DCA history from DB
  let dcaHistory: any[] = [];
  try {
    const db = getDb();
    dcaHistory = db.prepare('SELECT * FROM v2_dca_buys ORDER BY created_at DESC LIMIT 50').all() as any[];
  } catch { /* */ }

  return {
    running,
    config: BEARISH_CONFIG,
    stats: bearishStats,
    shorts: shortStatus,
    staking: stakingStatus,
    arbitrage: arbStatus,
    dca: {
      buysToday: dcaBuysToday,
      totalBuys: bearishStats.dcaBuys,
      history: dcaHistory,
      lastBuyTimes: Object.fromEntries(dcaLastBuy),
    },
  };
}

export { BEARISH_CONFIG };
