// ============================================
// Phoenix V2 Entry Point
// Boots the V2 engine and exports router + controls
// ============================================

import { initV2Engine, startV2Engine, stopV2Engine, getV2Status } from './engine/tradeEngine.ts';
import { initKrakenAdapter, krakenV2 } from './exchange/krakenAdapter.ts';
import { initCryptoComAdapter, cryptoComV2 } from './exchange/cryptoComV2Adapter.ts';
import { initDualEngine, startDualEngine, stopDualEngine, getDualStatus } from './engine/dualExchangeEngine.ts';
import { initBearishServices, startBearishServices, stopBearishServices, getBearishStatus, BEARISH_CONFIG } from './engine/bearishServices.ts';
import { describeBearishBootSummary } from './engine/bearishBootSummary.ts';
import { initMREngine, startMREngine, stopMREngine, getMRStatus } from './engine/meanReversionEngine.ts';
import { stopBreakoutEngine, getBreakoutStatus } from './engine/breakoutEngine.ts';
import { stopMomentumEngine, getMomentumStatus } from './engine/momentumEngine.ts';
import { buildKrakenSniper, buildCryptocomSniper, stopSniperEngine, getSniperStatus } from './engine/sniperEngine.ts';
import { initPairsEngine, startPairsEngine, stopPairsEngine, getPairsStatus } from './pairs/pairsEngine.ts';
import { v2Router } from './dashboard/attributionAPI.ts';
import { V2_CONFIG, MR_CONFIG, MOMENTUM_CONFIG, SNIPER_CONFIG, PAIRS_CONFIG } from './engine/config.ts';

export { v2Router, getV2Status, stopV2Engine, getDualStatus, stopDualEngine, getBearishStatus, stopBearishServices, getMRStatus, stopMREngine, getBreakoutStatus, stopBreakoutEngine, getMomentumStatus, stopMomentumEngine, getSniperStatus, stopSniperEngine, getPairsStatus, stopPairsEngine };

export async function bootV2(initialBudget = 1000): Promise<void> {
  console.log(`[V2] Booting Phoenix V2 in ${V2_CONFIG.MODE} mode...`);
  try {
    await initKrakenAdapter();
    initV2Engine(krakenV2, initialBudget);
    startV2Engine();
    console.log('[V2] Phoenix V2 engine running');

    // Boot bearish services (shorts, staking, arb, DCA) alongside V2
    try {
      initBearishServices(krakenV2);
      startBearishServices();
      console.log(`[V2] Bearish wrappers: ${describeBearishBootSummary(BEARISH_CONFIG)}`);
    } catch (err: any) {
      console.warn(`[V2] Bearish services failed to start: ${err.message}`);
    }

    // Boot Mean Reversion engine (15m, maker orders, independent loop)
    if (MR_CONFIG.ENABLED) {
      try {
        initMREngine(krakenV2, initialBudget);
        startMREngine();
        console.log('[V2] Mean Reversion engine running (15m, maker fees)');
      } catch (err: any) {
        console.warn(`[V2] Mean Reversion engine failed to start: ${err.message}`);
      }
    }

    // Breakout engine DISABLED — backtested 180 days: 341 trades, 28% WR, -$33 net
    // Re-enable when strategy is reworked
    console.log('[V2] Breakout engine disabled (unprofitable in backtest)');

    // Momentum engine v2 (rebuilt 2026-05-06, enabled 2026-05-18)
    // Original (1h, 1.5x histogram-ratio entry, histogram_decay exit):
    //   0% WR over 7 trades — entry math compared macd-hist (price-acceleration)
    //   to abs price-changes (different scales, near-random output).
    // v2 (4h, z-score spike vs 20-bar stdev, higher-highs filter, RSI 50-70,
    //     percent-giveback trail, 3x ATR TP, swing-low stop):
    //   PF 1.70 / 90d, 1.85 / 60d, 1.92 / 30d on
    //   ZECUSD,RUNEUSD,FLOWUSD,ENAUSD,KASUSD,ICPUSD,WIFUSD
    // ENABLED since 2026-05-18 (MOMENTUM_CONFIG.ENABLED=true in engine/config.ts).
    // MOMENTUM routes through the main TREND pipeline (Stage 2b in tradeEngine),
    // reusing the same riskGate and exitManager — there is no separate engine loop.
    // MOMENTUM_CONFIG.ENABLED gates signal detection in tradeEngine.
    if (MOMENTUM_CONFIG.ENABLED) {
      console.log('[V2] Momentum signals enabled (routed through main pipeline, not separate engine)');
    } else {
      console.log('[V2] Momentum signals disabled (MOMENTUM_CONFIG.ENABLED=false)');
    }

    // Dual-exchange sniper (kraken + cryptocom, 2026-05-06)
    // ISOLATED side-project. Trades tagged strategy='SNIPER_KRAKEN' or
    // 'SNIPER_CRYPTOCOM'. Day-trading uses krakenV2 for TREND/MOM and never
    // touches cryptocom or sniper budget pools. Each engine has its own loop,
    // candle cache, detector namespace, and budget — they cannot interfere
    // with each other or with day-trading.
    if (SNIPER_CONFIG.ENABLED) {
      // --- Kraken sniper ---
      if (SNIPER_CONFIG.KRAKEN_ENABLED) {
        try {
          const k = buildKrakenSniper(krakenV2, SNIPER_CONFIG.KRAKEN_BUDGET_USD);
          await k.init();
          k.start();
          console.log(`[V2] Sniper KRAKEN running (15m, $${SNIPER_CONFIG.KRAKEN_BUDGET_USD} isolated budget, strategy=SNIPER_KRAKEN)`);
        } catch (err: unknown) {
          console.warn(`[V2] Sniper KRAKEN failed to start: ${(err as Error).message}`);
        }
      } else {
        console.log('[V2] Sniper KRAKEN disabled (SNIPER_CONFIG.KRAKEN_ENABLED=false).');
      }

      // --- Crypto.com sniper ---
      if (SNIPER_CONFIG.CRYPTOCOM_ENABLED) {
        try {
          // Init the V2 cryptocom adapter only if not already loaded by dual-engine path.
          await initCryptoComAdapter();
          const c = buildCryptocomSniper(cryptoComV2, SNIPER_CONFIG.CRYPTOCOM_BUDGET_USD);
          await c.init();
          c.start();
          console.log(`[V2] Sniper CRYPTOCOM running (15m, $${SNIPER_CONFIG.CRYPTOCOM_BUDGET_USD} isolated budget, strategy=SNIPER_CRYPTOCOM)`);
        } catch (err: unknown) {
          console.warn(`[V2] Sniper CRYPTOCOM failed to start: ${(err as Error).message}`);
        }
      } else {
        console.log('[V2] Sniper CRYPTOCOM disabled (SNIPER_CONFIG.CRYPTOCOM_ENABLED=false).');
      }
    } else {
      console.log('[V2] Sniper master switch off (SNIPER_CONFIG.ENABLED=false).');
    }

    // Pairs trading engine (cross-asset cointegration, paper-only this session).
    // Gated by PAIRS_MODE env: 'off' | 'paper'. 'live' is refused for now.
    // Deployment plan: docs/plans/2026-05-26-pairs-deployment-plan.md
    if (PAIRS_CONFIG.MODE !== 'off') {
      try {
        initPairsEngine();
        startPairsEngine();
        console.log(`[V2] Pairs engine running (${PAIRS_CONFIG.MODE} mode, ${PAIRS_CONFIG.SYMBOL_A}/${PAIRS_CONFIG.SYMBOL_B})`);
      } catch (err: any) {
        console.warn(`[V2] Pairs engine failed to start: ${err.message}`);
      }
    } else {
      console.log('[V2] Pairs engine disabled (PAIRS_MODE=off).');
    }
  } catch (err: any) {
    console.error(`[V2] Boot failed: ${err.message}`);
  }
}

/**
 * Boot the dual-exchange competition engine.
 * Runs Kraken vs Crypto.com in paper mode with identical TC signals.
 */
export async function bootDualEngine(): Promise<void> {
  console.log('[DUAL] Booting Kraken vs Crypto.com competition...');
  try {
    // Initialize both exchange adapters
    await Promise.all([
      initKrakenAdapter(),
      initCryptoComAdapter(),
    ]);

    initDualEngine(krakenV2, cryptoComV2);
    startDualEngine();
    console.log('[DUAL] Competition engine running (paper mode)');
  } catch (err: any) {
    console.error(`[DUAL] Boot failed: ${err.message}`);
  }
}
