/**
 * System Configuration Service
 * Feature flags + central config for the 4-layer ML pipeline.
 * Persisted to SQLite settings table with runtime toggling.
 */

import { getSetting, setSetting } from './database.js';

// Default flags — used when no persisted value exists
const DEFAULT_FLAGS = {
  // System A: ML Gatekeeper — disabled until leakage-free OOS skill exists.
  // V2 entry gating uses V2_CONFIG.ML_GATEKEEPER_ENABLED (also false); this
  // default must stay false so /api/config/flags and evaluateEntry agree.
  ML_GATEKEEPER_ENABLED: false,
  ML_GATEKEEPER_MODE: 'HARD_GATE',       // 'ADVISORY' | 'SOFT_GATE' | 'HARD_GATE'
  ML_MIN_CONFIDENCE_TO_BLOCK: 52,
  ML_MIN_CONFIDENCE_TO_OVERRIDE: 55,
  ML_AUTO_DOWNGRADE_THRESHOLD: 0.48,      // Auto-downgrade to ADVISORY if accuracy < 48% over window
  ML_AUTO_DOWNGRADE_WINDOW: 100,

  // System B: Genetic Strategy Evolution — ON
  GENETIC_ENABLED: true,
  GENETIC_POPULATION_SIZE: 100,
  GENETIC_MAX_DEPTH: 6,
  GENETIC_MIN_TRADES_TO_ACTIVATE: 0,      // No minimum — active immediately
  GENETIC_MUTATION_RATE: 0.10,
  GENETIC_ELITISM_COUNT: 5,
  GENETIC_TOP_K_SIGNALS: 5,

  // System C: Portfolio Correlation Engine
  CORRELATION_ENGINE_ENABLED: true,
  CORRELATION_BLOCK_THRESHOLD: 0.90,
  CORRELATION_REDUCE_THRESHOLD: 0.75,
  CORRELATION_MAX_CLUSTER_ALLOC: 0.40,
  CORRELATION_UPDATE_INTERVAL_MS: 300000,

  // System D: Adversarial Dual-Brain — ON, no minimum samples
  ADVERSARIAL_ENABLED: true,
  ADVERSARIAL_MIN_MARGIN: 10,             // Lower margin threshold — more aggressive
  ADVERSARIAL_MIN_SAMPLES: 0,             // No minimum — active as soon as trained

  // Performance Upgrades — ML & Analytics
  FEATURE_SELECTION_ENABLED: true,
  LSTM_ENABLED: true,
  REGIME_MODELS_ENABLED: true,
  ONCHAIN_DATA_ENABLED: true,
  SHAP_ENABLED: true,
  HYPERPARAM_TUNING_ENABLED: true,
  MONTE_CARLO_ENABLED: true,
  SMART_EXECUTION_ENABLED: true,
  PORTFOLIO_OPTIMIZER_ENABLED: true,
  CONTINUOUS_BACKTEST_ENABLED: false,  // DISABLED — blocks event loop (buildFeatureVector per trade)

  // Phase 1: TF.js LSTM
  TF_ENABLED: true,
  TF_LSTM_HIDDEN_UNITS: 128,
  TF_DROPOUT_RATE: 0.3,
  TF_LEARNING_RATE: 0.001,
  TF_MAX_EPOCHS: 50,

  // Phase 2: Temporal Fusion Transformer
  TFT_ENABLED: true,
  TFT_ATTENTION_HEADS: 4,
  TFT_HIDDEN_DIM: 32,
  TFT_HORIZONS: 3,    // 1h, 4h, 24h

  // Phase 3: Deep RL Agent
  RL_AGENT_ENABLED: true,
  RL_CLIP_RATIO: 0.2,
  RL_TRAINING_EPISODES: 100,

  // Phase 4: Multi-Agent War Room
  MULTI_AGENT_ENABLED: true,
  META_LEARNER_ALPHA: 0.1,

  // Phase 5: Synthetic Data
  SYNTHETIC_DATA_ENABLED: true,     // Enabled — augments training with TimeGAN samples
  SYNTHETIC_MULTIPLIER: 3,
  SYNTHETIC_QUALITY_THRESHOLD: 0.35,

  // Phase 6: Online Learning
  ONLINE_LEARNING_ENABLED: true,
  DRIFT_DETECTION_ENABLED: true,
  ROLLBACK_ENABLED: true,

  // Phase 7: SHAP Enhancements
  SHAP_DRIFT_TRACKING_ENABLED: true,
  CALIBRATION_METHOD: 'isotonic',   // 'isotonic' | 'platt' | 'none'

  // Phase 8: Advanced Features
  FEATURE_INTERACTIONS_ENABLED: true,
  MTF_FEATURES_ENABLED: true,
  WAVELET_FEATURES_ENABLED: true,

  // Execution: prefer post-only maker orders (0.16% vs 0.26% per side on Kraken)
  PREFER_MAKER_ORDERS: true,

  // Simulation Accuracy: make SIM mode behave like real trading
  // When enabled: order-book slippage, simulated native SL, fill latency, partial fills
  SIMULATION_ACCURACY: true,

  // Phase 1-5: Surge Sniper Mode — off; V2 SNIPER_CONFIG.ENABLED is also false
  // (dynamic listings can leave the Canadian USD allowlist).
  SNIPER_MODE_ENABLED: false,
  SNIPER_TP: 0.025,                  // 2.5% take-profit for SNIPER entries
  SNIPER_SL: 0.015,                  // 1.5% stop-loss for SNIPER entries
  SNIPER_MAX_HOLD: 2,                // Max hold time in hours for SNIPER positions
  MICRO_BURST_THRESHOLD: 5,          // Volume burst detection: current 5s vol > Nx avg
};

// In-memory cache of current flags (seeded from defaults, overwritten by DB on init)
let SYSTEM_FLAGS = { ...DEFAULT_FLAGS };
let initialized = false;

/**
 * Initialize: load persisted flags from SQLite settings table
 */
export function initSystemConfig() {
  if (initialized) return;

  try {
    const stored = getSetting('system_flags');
    if (stored) {
      const parsed = JSON.parse(stored);
      // Merge: defaults first, then stored overrides (so new flags get defaults)
      SYSTEM_FLAGS = { ...DEFAULT_FLAGS, ...parsed };
    }
    initialized = true;
    console.log('[SystemConfig] Initialized with flags:', Object.keys(SYSTEM_FLAGS).length, 'keys');
  } catch (e) {
    console.warn('[SystemConfig] Could not load persisted flags:', e.message);
    initialized = true;
  }
}

/**
 * Get a single flag value
 */
export function getFlag(name) {
  if (!initialized) initSystemConfig();
  return SYSTEM_FLAGS[name] !== undefined ? SYSTEM_FLAGS[name] : DEFAULT_FLAGS[name];
}

/**
 * Set a single flag value (persists to DB)
 */
export function setFlag(name, value) {
  if (!initialized) initSystemConfig();
  SYSTEM_FLAGS[name] = value;
  persistFlags();
  console.log(`[SystemConfig] Flag ${name} = ${JSON.stringify(value)}`);
}

/**
 * Get all current flags
 */
export function getAllFlags() {
  if (!initialized) initSystemConfig();
  return { ...SYSTEM_FLAGS };
}

/**
 * Set multiple flags at once
 */
export function setFlags(updates) {
  if (!initialized) initSystemConfig();
  for (const [key, value] of Object.entries(updates)) {
    if (key in DEFAULT_FLAGS) {
      SYSTEM_FLAGS[key] = value;
    }
  }
  persistFlags();
}

/**
 * Reset all flags to defaults
 */
export function resetToDefaults() {
  SYSTEM_FLAGS = { ...DEFAULT_FLAGS };
  persistFlags();
  console.log('[SystemConfig] Reset all flags to defaults');
}

/**
 * Global kill switch — disable all 4 systems
 */
export function killAll() {
  SYSTEM_FLAGS.ML_GATEKEEPER_ENABLED = false;
  SYSTEM_FLAGS.GENETIC_ENABLED = false;
  SYSTEM_FLAGS.CORRELATION_ENGINE_ENABLED = false;
  SYSTEM_FLAGS.ADVERSARIAL_ENABLED = false;
  persistFlags();
  console.log('[SystemConfig] KILL ALL — all 4 systems disabled');
}

/**
 * Persist current flags to SQLite
 */
function persistFlags() {
  try {
    setSetting('system_flags', JSON.stringify(SYSTEM_FLAGS));
  } catch (e) {
    console.warn('[SystemConfig] Could not persist flags:', e.message);
  }
}

/**
 * Convenience: check if a system is enabled
 */
export function isMLGatekeeperEnabled() { return getFlag('ML_GATEKEEPER_ENABLED'); }
export function isGeneticEnabled() { return getFlag('GENETIC_ENABLED'); }
export function isCorrelationEnabled() { return getFlag('CORRELATION_ENGINE_ENABLED'); }
export function isAdversarialEnabled() { return getFlag('ADVERSARIAL_ENABLED'); }

export { DEFAULT_FLAGS };
