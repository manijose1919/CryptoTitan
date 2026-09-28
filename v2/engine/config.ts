// ============================================
// Phoenix V2 Engine Configuration
// All tunable parameters in one place
// ============================================

import type { V2Mode } from '../pipeline/types.ts';
import { resolveV2Mode } from './tradeMode.ts';

export const V2_CONFIG = {
  // --- Mode ---
  MODE: resolveV2Mode(process.env.V2_MODE, process.env.V2_LIVE_CONFIRMED) as V2Mode,

  // --- Scan ---
  SCAN_TICKERS: [
    // Kraken USD markets available to the Canadian deployment. The previous
    // concentration used unsupported mid-cap bases and could not be executed
    // by the intended account even if its backtest held up.
    'BTCUSD', 'ETHUSD', 'XRPUSD', 'BNBUSD', 'SOLUSD',
    'ADAUSD', 'DOGEUSD', 'LINKUSD', 'DOTUSD', 'AVAXUSD',
  ],
  MIN_VOLUME_24H_USD: 500_000,
  MIN_ATR_PERCENT: 1.0,  // 2026-07-21: raised from 0.3. Data mining: ATR<1% = 27.3% WR (n=132), death zone. ATR 1-2% = 51.7% WR, 2-3% = 63.5%. Minimum 1% eliminates fee-dominated noise trades.
  MAX_ATR_PERCENT: 8.0,  // Widened for 4h — normal BTC 4h ATR% is 1-4%
  MAX_SPREAD_PERCENT: 0.15,

  // --- Regime ---
  // Fresh 90d pessimistic replay on the Canadian universe: STRONG_UP +$25.31
  // vs UP -$105.33 after fees. Non-overlapping 45d halves were -$2.60/+13.91
  // for STRONG_UP vs -$65.53/-$22.71 for UP. Prefer inactivity to negative edge.
  ALLOWED_REGIMES: ['STRONG_UP'] as const,
  // 2026-07-21: UP+1h is a proven loser all-time (n=25, 40% WR, -$1.05/trade).
  // STRONG_UP+1h works (60% WR, +$0.45/trade). Restrict UP to 4h only.
  REGIME_TIMEFRAME_RESTRICT: { 'UP': ['4h'] } as Record<string, string[]>,

  // --- Signal ---
  MIN_COMPOSITE_SCORE: 60,                // Was 70 — scoring math caps at ~64 in normal STRONG_UP; 70 only fires on extreme pullbacks
  MIN_CONFIDENCE: 0.65,
  MIN_CANDLES: 50,

  // --- Fees (Kraken) ---
  FEE_TAKER_PERCENT: 0.0026,
  FEE_MAKER_PERCENT: 0.0016,
  FEE_ROUND_TRIP_MAKER: 0.0032,
  FEE_ROUND_TRIP_TAKER: 0.0052,
  PAPER_SLIPPAGE_PER_SIDE: 0.0005, // 5 bps adverse fill on every simulated entry/exit

  // Fee-aware trailing-activation floor: trail may not arm until unrealized
  // profit >= this multiple of round-trip taker fee (3 × 0.52% = 1.56%).
  // Both fixed values failed live: 2.5% armed too late (20 SLs), 1% armed
  // too early (trailing wins +$1.55 < $1.90 fee floor). Fee multiple self-scales.
  TRAIL_ACTIVATE_FEE_FLOOR_MULT: 3.0,

  // --- Position Sizing ---
  MIN_EXPECTED_RETURN: 0.008,    // 0.8% — was 0.5%, too close to fees; need meaningful edge above 0.52% round-trip
  BASE_POSITION_PERCENT: 0.40,  // 2026-05-18: 0.25→0.40. Backtest: PF 3.84→6.63, +$414→+$888 on $6K. Safe — max DD stays 0.2%.
  MAX_RISK_PER_TRADE_PERCENT: 0.015, // 2026-06-06: 0.03→0.015. Live: high-ATR trades (FET 4.5%, ZEC 3%) got $400+ positions with $40 max loss. Caps high-ATR smaller while low-ATR unaffected.
  MAX_RISK_PER_TRADE_USD: 12,    // 2026-06-30: hard $ cap layered ON TOP of the % cap. The % cap is a CEILING that floated to $38 on high-ATR names (522-trade backtest). Capping at $12 cut worst loss -$40→-$15, eliminated all 9 tail losses (>$15), -14% volatility, while net rose +$91→+$105 (combined w/ short filter). Effective risk = min(equity×1.5%, $12). NOTE: scales as an absolute $; revisit upward as the account grows.

  MAX_OPEN_POSITIONS: 3,         // Cap at 3 — data shows 4-5 adds correlation risk without enough upside (Apr 18: 5 correlated longs lost $35)
  ML_GATEKEEPER_ENABLED: false,  // Entry-time model is disabled until leakage-free temporal validation shows OOS skill.
  GATEKEEPER_AB_TEST: false,     // Random gate bypass cannot support production decisions while the underlying model is invalid.
  GATEKEEPER_AB_OFF_RATE: 0.5,   // fraction of loops where the gatekeeper is bypassed (OFF arm)
  SIZE_BY_CONFIDENCE: false,     // 2026-06-30: was true. Confidence proven NON-predictive (out-of-sample AUC 0.44 — slightly INVERSE; 3 analyses: calibration, feature reweight, scorecard edges all ~0). Sizing by a non-predictive (slightly inverse) score bet MORE on worse trades. Flat factor below is exposure-neutral and reallocates size toward the profitable .60-.70 band. Re-enable only if a recalibrated score shows OOS AUC > 0.55.
  CONFIDENCE_SIZE_FLAT: 0.70,    // exposure-neutral constant (= historical avg entry_confidence) used when SIZE_BY_CONFIDENCE is false

  // --- Re-entry Cooldown ---
  REENTRY_COOLDOWN_MS: 0,  // 2026-05-27: disabled. Backtest: 0h cooldown triples trades (357→1207) while maintaining 88% WR. Intra-bar trailing catches re-entries profitably.

  // --- Correlation Check ---
  CORRELATION_MAX_AVG: 0.70,           // reject if avg correlation with open positions > this
  CORRELATION_LOOKBACK_BARS: 20,       // 20 × 4h = ~3.3 days of return data

  // --- Trend Maturity ---
  TREND_MATURITY_PENALTY_THRESHOLD: 70,  // start penalizing composite score above this maturity
  TREND_MATURITY_MAX_PENALTY: 15,        // subtract up to 15 from composite score for exhausted trends

  // --- Short Selling ---
  SHORTS_ENABLED: false,                 // 2026-07-14: disabled. All-time timeframed shorts −$54.45/37 trades, negative on EVERY timeframe (1h −$15.72/11, 30m −$18.33/5, 4h −$20.40/21); post-baseline 4h shorts −$17.99/4 @ 25% WR. No profitable sub-segment with n≥10. Rollback: set true (SHORT_TIMEFRAMES/SHORT_ALLOWED_REGIMES below retained for that case). Review: docs/reviews/2026-07-14-sprint-review.md
  SHORT_TIMEFRAMES: ['4h'] as readonly string[],  // 2026-06-30: shorts restricted to 4h. Backtest: 1h shorts 36% WR/-$15.72, 30m shorts 40% WR/-$18.33; 4h shorts 76% WR. Dropping 1h/30m shorts added +$34 net & best sharpe over 522 trades. Lower-conviction (16-trade sample) — revisit.
  SHORT_ALLOWED_REGIMES: ['STRONG_DOWN'] as readonly string[],  // 2026-06-30: dropped DOWN. Edge diagnosis (75 trades): STRONG_DOWN shorts 74% WR/+$36; DOWN shorts 65% WR/−$42. Shorts only work in strong downtrends; plain DOWN is chop-prone. Rollback: re-add 'DOWN'.
  SHORT_FEE_ROUND_TRIP: 0.0052,          // taker both sides for shorts on Kraken
  SHORT_STOP_LOSS_ATR_MULT: 1.5,  // 2026-06-06: matched to long SL. ZEC short lost -$39.53 at 2.0x ATR (9% stop). At 1.5x would be ~-$28.
  SHORT_TAKE_PROFIT_ATR_MULT: 3.5,
  SHORT_TRAILING_ACTIVATE_PERCENT: 0.01,
  SHORT_TRAILING_GIVEBACK_PERCENT: 0.03,

  // --- Risk ---
  MAX_DAILY_LOSS_PERCENT: 0.03,
  CIRCUIT_BREAKER_COOLDOWN_MS: 15 * 60 * 1000, // 15 minutes

  // --- Order Execution ---
  MAKER_FILL_TIMEOUT_MS: 30_000,
  USE_MAKER_ORDERS: true,

  // --- Candle Timeframe ---
  CANDLE_INTERVAL: '4h' as string, // Was 15m — backtest: 15m=21%WR/-$1030, 1h=26%WR/-$1669, 4h=27%WR/-$455. 4h gives trends room past 0.52% fees.

  // --- Exit Management ---
  STOP_LOSS_ATR_MULT: 1.5,  // 2026-06-03: 2.0→1.5. Live data: SL avg -$11.13 vs trail avg +$2.13 (5.2:1 ratio). Tighter SL cuts loss size ~33%. Backtest: +$6,391→+$7,186, PF 9.07→9.50.
  TAKE_PROFIT_ATR_MULT: 4.0,       // 2026-04-29: 3.5 → 4.0 (R:R 1.4 → 1.6). Avg_win problem: at R:R 1.4 the cohort was avg_win $0.97 vs needed ~$1.10 for 59% WR break-even. Wider TP makes individual TP hits +$2.00 instead of +$1.75. Risk: historical R:R 1.6 cohort underperformed R:R 1.4 (-$10.89 vs -$1.89), but that was without working BE/trailing stops. With current trailing-active@1% catching moderate winners, wider TP may behave differently. Deliberate test under user's risk-on framing 2026-04-29.
  // 2026-09-28: 0.01→0.014 to match STRATEGY_EXIT_CONFIGS.TREND (paper/live exitManager).
  // backtestEngine still reads this knob; leaving it at 0.01 made fee-aware ablations diverge from paper trails.
  TRAILING_ACTIVATE_PERCENT: 0.014, // was 0.01; 2026-05-18 history: 0.025→0.015→0.01 for earlier engagement.

  TRAILING_GIVEBACK_PERCENT: 0.03,  // 2026-05-06 Config A: 0.25 → 0.03 — extreme tight trail. Once activated, surrender only 3% of peak gain. The trailing-exit P&L moved from +$216 (PF 1.43) to +$312 (PF 1.62) on AKT+ZEC+COMP 90d
  TIME_KILL_MS: 6 * 60 * 60 * 1000,      // 6h — was 8h; backtest shows time_kill is #1 PnL drag (-$125/128 trades). Cutting 2h earlier reduces fee bleed on stale positions.
  TIME_KILL_MIN_MOVE: 0.007,
  EXIT_CHECK_INTERVAL_MS: 15_000,

  // --- Quick-Kill (dud trade detection) ---
  QUICK_KILL_AFTER_MS: 4 * 60 * 60 * 1000,  // 4h (1 candle) — was 8h; kill duds faster to free position slots
  QUICK_KILL_MIN_GAIN: 0.006,
  QUICK_KILL_SL_ATR_MULT: 1.2,

  // --- Regime Momentum Gate ---
  REGIME_MOMENTUM_LOOKBACK: 5,            // Compare EMA20 slope over last 5 bars
  REGIME_MOMENTUM_MIN_SLOPE: -0.002,      // Reject SIDEWAYS if EMA20 slope < -0.2% (trending down)

  // --- Bot Loop ---
  BOT_LOOP_INTERVAL_MS: 60_000,            // Was 30s — 60s is plenty for 4h candles; reduces log noise + CPU

  // --- Telegram ---
  TELEGRAM_TAG: '[V2]',

  // --- Signal Scoring ---
  MIN_TRADES_FOR_SCORING: 20,

  // --- TC (Trend Composite) Indicator Thresholds ---
  TC_BUY_ZONE: 20,           // TC below this = strong buy zone
  TC_SELL_ZONE: 80,          // TC above this = sell zone / avoid
  TC_CONSENSUS_MIN: 50,      // Minimum multi-TF consensus to boost score

  // --- Multi-Timeframe Regime ---
  MTF_ENABLED: false,             // Disabled — primary timeframe is now 4h, no higher TF to compare against
  MTF_HIGHER_TIMEFRAME: '1d' as string,  // Would need daily candles if re-enabled
  MTF_ALLOWED_HIGHER_REGIMES: ['STRONG_UP', 'UP'] as readonly string[],
  MTF_POSITION_MULTIPLIER: 0.75,       // 75% of normal size for pullback entries
  MTF_REGIME_CACHE_TTL_MS: 15 * 60 * 1000,  // Cache 4h regime for 15 minutes
  MTF_MAX_15M_REGIME: ['DOWN'] as readonly string[],  // Only rescue DOWN (not STRONG_DOWN)
} as const;

// ============================================
// Multi-Timeframe Strategy Configuration
// ============================================

// Which timeframes each strategy runs on
export const STRATEGY_TIMEFRAMES: Record<string, string[]> = {
  TREND:           ['1h', '4h'],  // 2026-06-27: 1h restored. Was 4h-only since Jun 19 (1 trade in 9 days). Fee-aware floor now protects 1h wins. 30m stays out (proven loser).
  MOMENTUM:        ['1h', '4h'],
  // 2026-07-21: BREAKOUT re-enabled on 1h/4h. All-time clean data: 60% WR, +$5.45/trade (n=10).
  // Was disabled Jun 9 after a bad 12-trade stretch. Now has fee-aware floor + ATR>=1% gate
  // that didn't exist before. 15m/30m removed (too noisy). Volume 2x + N-bar-high breakout
  // is a structurally different signal from TREND's EMA/MACD scoring.
  BREAKOUT:        ['1h', '4h'],
  // MEAN_REVERSION and SCALP disabled — live data: 0% and 22% WR respectively
};

// Per-strategy exit parameters
export interface StrategyExitConfig {
  slAtrMult: number;
  tpAtrMult: number;
  trailActivatePercent: number;
  trailGivebackPercent: number;
  timeKillBars: number;      // bars to hold before time-kill
  timeKillBarsByTf?: Record<string, number>;  // per-timeframe override of timeKillBars (2026-07-14: lets 1h get a longer leash without touching 4h)
  timeKillMinMove: number;
  quickKillBars: number;     // bars before quick-kill tightens
  quickKillMinGain: number;
  quickKillSlMult: number;
  useTrailing: boolean;
}

export const STRATEGY_EXIT_CONFIGS: Record<string, StrategyExitConfig> = {
  TREND: {
    slAtrMult: 1.5, tpAtrMult: 4.0,
    // exitManager reads THIS value (not V2_CONFIG). Kept in sync with
    // V2_CONFIG.TRAILING_ACTIVATE_PERCENT so backtestEngine ablations match paper.
    trailActivatePercent: 0.014, trailGivebackPercent: 0.03,  // 2026-06-19: 0.01→0.014 (~75% of 1.8% typical TP). At 1%, trail activated in noise zone — reversals still netted below breakeven after fees. At 1.4%, minimum locked-in gross is ~1.35%.
    timeKillBars: 2, timeKillBarsByTf: { '1h': 4 }, timeKillMinMove: 0.007,  // 2026-07-14: 1h kills at 2 bars were premature — ≥60% of killed 1h trades reached trail activation within 4h (see docs/reviews/2026-07-14-sprint-review.md). 4h keeps 2 bars.
    quickKillBars: 1, quickKillMinGain: 0.006, quickKillSlMult: 1.2,
    useTrailing: true,
  },
  MOMENTUM: {
    slAtrMult: 1.5, tpAtrMult: 3.0,
    trailActivatePercent: 0.025, trailGivebackPercent: 0.05,
    timeKillBars: 4, timeKillMinMove: 0.005,
    quickKillBars: 2, quickKillMinGain: 0.006, quickKillSlMult: 1.2,
    useTrailing: true,
  },
  BREAKOUT: {
    slAtrMult: 1.5, tpAtrMult: 3.0,
    trailActivatePercent: 0.02, trailGivebackPercent: 0.04,
    timeKillBars: 8, timeKillMinMove: 0.005,
    quickKillBars: 2, quickKillMinGain: 0.004, quickKillSlMult: 1.0,
    useTrailing: true,
  },
  MEAN_REVERSION: {
    slAtrMult: 2.0, tpAtrMult: 1.5,  // tight TP — MR targets mean reversion, not trend
    trailActivatePercent: 0.01, trailGivebackPercent: 0.10,
    timeKillBars: 8, timeKillMinMove: 0.003,
    quickKillBars: 2, quickKillMinGain: 0.002, quickKillSlMult: 0.8,
    useTrailing: false,  // MR exits at TP or SL, no trailing
  },
  SCALP: {
    slAtrMult: 0.75, tpAtrMult: 1.0,
    trailActivatePercent: 0.005, trailGivebackPercent: 0.15,
    timeKillBars: 30, timeKillMinMove: 0.002,
    quickKillBars: 10, quickKillMinGain: 0.001, quickKillSlMult: 0.5,
    useTrailing: false,
  },
};

// Per-strategy cooldown (scales with timeframe)
export const STRATEGY_COOLDOWN_MS: Record<string, number> = {
  TREND:          8 * 3600 * 1000,   // 8h
  MOMENTUM:       8 * 3600 * 1000,   // 8h
  BREAKOUT:       2 * 3600 * 1000,   // 2h
  MEAN_REVERSION: 30 * 60 * 1000,    // 30min
  SCALP:          10 * 60 * 1000,    // 10min
};

// ADX routing thresholds (Average Directional Index, 0–100)
// ADX > TREND_MIN: genuinely trending → run TREND signals only
// ADX < MR_MAX: ranging / choppy → run MEAN_REVERSION signals only
// Between: dead zone, skip both (neither strategy has edge here)
export const ADX_THRESHOLDS = {
  TREND_MIN: 20,  // 2026-06-27: 25→20. Catches emerging trends earlier. Was too strict — 1 trade in 9 days at 25.
  MR_MAX: 20,
} as const;

// Convert timeframe string to milliseconds
export function timeframeToMs(tf: string): number {
  const map: Record<string, number> = {
    '1m': 60_000, '5m': 300_000, '15m': 900_000, '30m': 1_800_000,
    '1h': 3_600_000, '4h': 14_400_000, '1d': 86_400_000,
  };
  return map[tf] ?? 3_600_000;
}

// ============================================
// MOMENTUM Strategy Config (v2 — rebuilt 2026-05-06)
// ============================================
// Replaces the old "1h MACD-spike" momentum that produced 0% WR.
// New strategy: 4h candles, z-score histogram spike, higher-highs filter,
// percent-giveback trail. Backtest proved: PF 1.70-2.32 across 30/60/90d.
//
// To enable: set ENABLED: true (v2/index.ts gates engine startup on this).
// ============================================

export const MOMENTUM_CONFIG = {
  ENABLED: true,    // 2026-05-18: REBUILT — now routes through main TREND pipeline (same riskGate, exitManager, all guards). No separate engine loop.
  MIN_CONFIDENCE: 0.65,

  // Tickers — chosen via wide-ticker scan in backtest. These 7 produced
  // PF > 1 individually under v2 logic; combined PF was 1.70 (90d).
  // ZECUSD overlaps with TREND's SCAN_TICKERS — that's intentional, the two
  // strategies pick different signal patterns and rarely fire simultaneously.
  SCAN_TICKERS: V2_CONFIG.SCAN_TICKERS,

  CANDLE_INTERVAL: '4h' as string,  // 4h was the best timeframe — 1h gave PF 0 (too noisy)
  ALLOWED_REGIMES: ['STRONG_UP'] as readonly string[],  // 2026-06-30: STRONG_UP-only. Edge diagnosis (42 trades): MOMENTUM STRONG_UP 94% WR/+$82 (best setup in system); UP 8% WR/−$20; SIDEWAYS −$0.65. MOMENTUM only works in strong uptrends. Rollback: re-add 'UP','SIDEWAYS'.
  MIN_CANDLES: 50,

  // Entry filters (v2):
  HISTOGRAM_SPIKE_Z: 1.0,  // macdHist must be ≥1 std-dev above 20-bar rolling mean
  RSI_MIN: 50,
  RSI_MAX: 70,
  VOLUME_MULTIPLIER: 1.3,
  MIN_UP_BARS: 3,  // require 3+ of last 5 closes > previous

  // Position sizing:
  POSITION_SIZE_PERCENT: 0.20,
  MAX_POSITION_PERCENT: 0.30,
  MAX_OPEN_POSITIONS: 2,

  // Loop:
  LOOP_INTERVAL_MS: 60_000,
  LOOP_OFFSET_MS: 15_000,  // 15s after TREND so logs interleave cleanly
} as const;

// ============================================
// MOMENTUM Exit Config (used by momentumExitManager v2)
// Switched from histogram_decay (too sensitive, exits at first stall)
// to percent_giveback trail — same pattern as TREND/MR.
// ============================================

export const MOM_EXIT_CONFIG = {
  SL_ATR_MULT: 2.0,                    // backup ATR-based stop if swing-low not available

  // Take-profit (v2 added):
  TP_ATR_MULT: 3.0,                    // hard TP at 3× ATR

  // Break-even:
  BREAKEVEN_TRIGGER: 0.015,            // raise SL to entry+offset at +1.5% PnL
  BREAKEVEN_OFFSET: 0.001,             // BE stop sits at entry × 1.001

  // Trailing (replaces histogram_decay):
  TRAIL_ACTIVATE: 0.025,               // activate at +2.5% PnL — wait for real momentum
  TRAIL_GIVEBACK: 0.05,                // give back only 5% of peak gain when triggered

  // Quick-kill (v2 added):
  QUICK_KILL_ENABLED: true,
  QUICK_KILL_BARS: 4,                  // 4 × 4h = 16h with no progress
  QUICK_KILL_MIN_GAIN: 0.006,
  QUICK_KILL_SL_TIGHTEN: 1.2,

  // Time-kill:
  TIME_KILL_BARS: 16,                  // 16 × 4h = 2.7 days — 4h candles need more room than 1h
  TIME_KILL_MIN_MOVE: 0.005,

  // Legacy field — kept for backward compat with momentumExitManager v1 references.
  // No longer used; the new exit manager uses TRAIL_ACTIVATE/TRAIL_GIVEBACK above.
  HISTOGRAM_DECAY_THRESHOLD: 0.50,
} as const;

// ============================================
// SNIPER Strategy Config (new-coin sniper, 2026-05-06)
// ============================================
// Side-project strategy: snipe new Kraken USD listings during their early
// volatility window. Cannot be backtested (by definition new data) — paper-only
// at first; tune from live trade outcomes. Stats kept separate from TREND/MOM
// per the reporting contract in CHANGELOG.md.
// ============================================

export const SNIPER_CONFIG = {
  // Disabled: dynamic new listings can fall outside the Canadian allowlist,
  // and this strategy has no reproducible historical validation.
  ENABLED: false,

  // --- Per-exchange budgets + enable flags (2026-05-06: dual-exchange) ---
  KRAKEN_ENABLED: true,
  CRYPTOCOM_ENABLED: true,
  KRAKEN_BUDGET_USD: 500,
  CRYPTOCOM_BUDGET_USD: 500,

  // Legacy field — used by single-exchange code paths if any remain. Kept for
  // back-compat; the dual setup uses KRAKEN_BUDGET_USD / CRYPTOCOM_BUDGET_USD.
  BUDGET_USD: 500,
  STRATEGY_TAG: 'SNIPER' as const,

  // --- Detection / scan loop ---
  PAIR_REFRESH_INTERVAL_MS: 30 * 60 * 1000,  // re-fetch Kraken pair list every 30 min
  LOOP_INTERVAL_MS: 60_000,                  // entry/exit check every 60s
  LOOP_OFFSET_MS: 30_000,                    // 30s after MOMENTUM (which is +15s after TREND)

  // --- Listing eligibility window ---
  // Skip the absolute first 30 min — worst slippage, manipulation, no structure.
  // Stop sniping after 7 days — by then it's just another tradable coin.
  MIN_LISTING_AGE_MS: 30 * 60 * 1000,
  MAX_LISTING_AGE_MS: 7 * 24 * 60 * 60 * 1000,
  CANDLE_INTERVAL: '15m' as string,
  MIN_CANDLES: 20,            // need ~5h of 15m bars to compute indicators

  // --- Entry triggers (ALL must hit) ---
  RSI_MAX: 70,                // not yet overbought
  VOLUME_MULTIPLIER: 1.5,     // current bar vol >= 1.5× last 12-bar avg
  MIN_UP_BARS: 3,             // 3+ of last 5 bars closed higher than previous
  MAX_RUG_PULL_SCORE: 1,      // detector score must be < 2 (no major red flags)
  MIN_BAR_VOLUME_USD: 500,    // floor: avoid dead-listing dust

  // --- Position sizing ---
  POSITION_SIZE_PERCENT: 0.10,   // 10% of $500 = $50 per trade (small)
  MAX_POSITION_PERCENT: 0.20,    // hard cap 20% even with high confidence
  MAX_OPEN_POSITIONS: 2,         // never more than 2 sniper trades simultaneously

  // --- Exits ---
  STOP_LOSS_PERCENT: 0.03,             // -3% hard stop
  TRAIL_ACTIVATE_PERCENT: 0.05,        // start trailing at +5%
  TRAIL_GIVEBACK_PERCENT: 0.30,        // give back 30% of peak gain (wider than TREND — newcoins are wild)
  TIME_KILL_MS: 8 * 60 * 60 * 1000,    // 8h max hold

  // --- Telegram ---
  TELEGRAM_TAG: '[SNIPER]',
} as const;

// ============================================
// MEAN_REVERSION Strategy Config
// Profitable on 15m with maker fees: +$6.33, 52% WR, PF 1.73
// ============================================

export const MR_CONFIG = {
  // 2026-06-19: Rebuilt from 15m long-only (0/4 wins, -$2.80 live) to
  // 1h dual-direction with ADX<20 gate. Root causes of failure:
  //   1. 15m too noisy — reversion signal drowned in noise
  //   2. BTCUSD/ETHUSD tickers wrong — these trend; ranging MR needs the
  //      same mid-cap tickers as TREND (AKT, ZEC, FET, etc.)
  //   3. No ADX gate — was entering ranging AND trending markets
  //   4. Long-only — missed 50% of MR opportunities (overbought shorts)
  // Disabled until the rebuilt strategy has a positive fee-aware OOS sample.
  ENABLED: false,
  CANDLE_INTERVAL: '1h' as string,
  ALLOWED_REGIMES: ['SIDEWAYS'] as readonly string[],
  SCAN_TICKERS: [...V2_CONFIG.SCAN_TICKERS],

  // ADX gate — only enter when market is ranging (primary gate)
  ADX_MAX_FOR_ENTRY: 20,

  // Long entry: oversold at lower Bollinger Band
  RSI_LONG_THRESHOLD: 28,        // tightened from 30 — more extreme oversold required
  BB_LONG_THRESHOLD: 0.15,       // %B < 0.15 (near lower band)

  // Short entry: overbought at upper Bollinger Band
  // 2026-07-15: disabled — closes the gap the 2026-07-14 sprint left open. The sprint
  // turned off V2_CONFIG.SHORTS_ENABLED (TREND) assuming shorts were off cohort-wide,
  // but this flag stayed true, so MR shorts remained live (1 all-time: -$4.22, SIDEWAYS).
  // BEFORE re-enabling: MR's ALLOWED_REGIMES gate is shared by both sides (['SIDEWAYS']),
  // so shorts fire in SIDEWAYS — the sprint review's pre-registered check assumes all
  // shorts are STRONG_DOWN-only. Decide per-side regime policy first (fading overbought
  // in a range IS the MR thesis, but it has no supporting data; n=1 all-time).
  SHORTS_ENABLED: false,
  RSI_SHORT_THRESHOLD: 72,       // RSI > 72 = overbought
  BB_SHORT_THRESHOLD: 0.85,      // %B > 0.85 (near upper band)

  // Legacy field used by meanReversionSignal.ts (still referenced; points to long threshold)
  RSI_THRESHOLD: 28,
  BB_PERCENT_B_THRESHOLD: 0.15,

  MAX_ATR_PERCENT: 5.0,          // widened from 3.0 — mid-caps can ATR 4%+ on 1h
  MIN_CANDLES: 50,

  POSITION_SIZE_PERCENT: 0.40,   // matched to TREND — same risk per trade
  MAX_POSITION_PERCENT: 0.50,
  MAX_OPEN_POSITIONS: 2,         // MR can hold long + short on different tickers

  STOP_LOSS_ATR_MULT: 1.5,
  TIME_KILL_BARS: 6,             // 6 × 1h = 6h — MR trades not reverting in 6h likely won't
  TIME_KILL_MIN_MOVE: 0.003,
  QUICK_KILL_AFTER_BARS: 3,      // 3 × 1h = 3h
  QUICK_KILL_MIN_GAIN: 0.003,
  QUICK_KILL_SL_ATR_MULT: 0.8,

  USE_MAKER_ORDERS: true,
  FEE_ROUND_TRIP: 0.0032,        // Maker both sides → 0.32% RT vs TREND's 0.42%

  BOT_LOOP_INTERVAL_MS: 60_000,
  LOOP_OFFSET_MS: 30_000,        // 30s stagger from TREND loop
} as const;

// --- Exchange-specific fee configs ---

// ROUND_TRIP_REAL: maker entry + taker exit. This is the true cost when
// USE_MAKER_ORDERS=true: entries fill as maker, but every exit goes through
// placeMarketSell (taker) per tradeEngine.ts:541-548. Use this for any
// gating logic that's deciding whether expected-return covers actual fees.
export const EXCHANGE_FEES = {
  kraken: {
    TAKER_PERCENT: 0.0026,
    MAKER_PERCENT: 0.0016,
    ROUND_TRIP_TAKER: 0.0052,
    ROUND_TRIP_MAKER: 0.0032,
    ROUND_TRIP_REAL: 0.0042, // 0.16% maker entry + 0.26% taker exit
  },
  'crypto.com': {
    TAKER_PERCENT: 0.00075,
    MAKER_PERCENT: 0.00050,
    ROUND_TRIP_TAKER: 0.0015,
    ROUND_TRIP_MAKER: 0.0010,
    ROUND_TRIP_REAL: 0.00125, // 0.05% maker entry + 0.075% taker exit
  },
} as const;

/**
 * Look up the fee table for an exchange by name. Defaults to Kraken if the
 * name is unknown — callers should pass exchange.getName() so this never
 * silently picks the wrong table when running on Crypto.com.
 */
export function getExchangeFees(exchangeName: string) {
  const key = exchangeName.toLowerCase();
  if (key === 'crypto.com' || key === 'cryptocom') return EXCHANGE_FEES['crypto.com'];
  return EXCHANGE_FEES.kraken;
}

// --- Dual Exchange Competition Config ---

export const DUAL_ENGINE_CONFIG = {
  /** Enable dual-engine mode (run Kraken + Crypto.com side by side) */
  ENABLED: (process.env.DUAL_ENGINE ?? 'false') === 'true',
  /** Budget per engine in USD (each gets its own portfolio) */
  BUDGET_PER_ENGINE: 1000,
  /** Both run in paper mode during competition */
  MODE: 'paper' as const,
} as const;

// ============================================
// Pairs Trading (cross-asset cointegration)
// Deployment plan: docs/plans/2026-05-26-pairs-deployment-plan.md
// Backtest validation: v2/backtest/canonical (commit 37709b1)
//   FIL/ICP walk-forward: IS +2.79% → OOS +11.28% (fragility 4.05)
// ============================================
export type PairsMode = 'off' | 'paper' | 'live';

export const PAIRS_CONFIG = {
  /**
   * 'off'   — engine doesn't run
   * 'paper' — engine fires signals, logs decisions, simulated fills only
   * 'live'  — submits real margin orders (NOT IMPLEMENTED THIS SESSION;
   *           paper-only for now)
   */
  MODE: (process.env.PAIRS_MODE ?? 'off') as PairsMode,

  // Symbols. Keep generic 'A/B' naming so swapping pairs is a single config edit.
  SYMBOL_A: 'FILUSD',
  SYMBOL_B: 'ICPUSD',

  // Cadence + windows.
  LOOP_INTERVAL_MS: 60_000,           // every 60s
  CANDLE_INTERVAL: '1h' as const,
  ROLLING_WINDOW_BARS: 720,            // 30 days on 1h — matches backtest
  REESTIMATE_BETA_EVERY_BARS: 120,     // 5 days on 1h
  WARMUP_BARS: 720,                    // = ROLLING_WINDOW (Kraken returns 720 on this interval)

  // Signal thresholds (matches backtest 'tight' variant — the best-WF cell).
  ENTRY_Z: 1.5,
  EXIT_Z: 0.3,
  STOP_Z: 4.0,
  MAX_HOLD_BARS: 200,
  ALLOW_SHORT_SPREAD: true,           // both directions of spread divergence

  // Sizing.
  TOTAL_NOTIONAL_USD: 1000,            // total exposure cap (sum of both legs)
  LEG_NOTIONAL_USD: 500,               // per-leg notional (equal-$ hedge)
  MIN_LEG_NOTIONAL_USD: 50,            // refuse trades below this

  // Fees (Kraken; per leg per side).
  FEE_PER_LEG_TAKER: 0.0026,
  FEE_PER_LEG_MAKER: -0.0005,          // negative = rebate at tier 2

  // Slippage assumption for paper-mode fills (per leg per side).
  SLIPPAGE_PER_SIDE: 0.0005,

  // Cointegration gate. Refuse new entries if rolling ADF t-stat is weaker
  // than this threshold (less negative = weaker cointegration).
  REQUIRE_ADF_T_BELOW: -2.86,          // 5% critical value

  // Kill switches.
  MAX_DRAWDOWN_PCT_PER_TRADE: 0.03,    // 3% drawdown on the allocation
  CONSECUTIVE_LOSS_PAUSE_THRESHOLD: 3,
  PAUSE_DURATION_HOURS: 168,           // 7 days
} as const;
