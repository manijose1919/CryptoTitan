/**
 * SQLite Database Module
 * Persistent storage for trades, learning data, candle history, and settings.
 */

import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let db = null;

/**
 * Get the database instance (must call initializeDatabase first)
 */
export function getDb() {
  if (!db) {
    throw new Error('Database not initialized. Call initializeDatabase() first.');
  }
  return db;
}

/**
 * Resolve the SQLite directory. DATA_DIR isolates paper soaks from a
 * default data/trading.db that may already hold another instance's state.
 */
export function resolveDatabasePath(env = process.env) {
  const dataDir = env.DATA_DIR || join(__dirname, '..', 'data');
  return { dataDir, dbPath: join(dataDir, 'trading.db') };
}

/**
 * Initialize the SQLite database with all required tables
 */
export function initializeDatabase() {
  const { dataDir, dbPath } = resolveDatabasePath();
  mkdirSync(dataDir, { recursive: true });
  db = new Database(dbPath);

  // Enable WAL mode for better concurrent read performance
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Performance PRAGMAs for NVMe SSD
  db.pragma('mmap_size = 2147483648');   // 2GB mmap — fast on NVMe
  db.pragma('cache_size = -64000');       // 64MB page cache
  db.pragma('synchronous = NORMAL');      // Safe with WAL, faster than FULL
  db.pragma('temp_store = MEMORY');       // Temp tables in RAM

  // Create all tables
  db.exec(`
    -- Core trade history
    CREATE TABLE IF NOT EXISTS trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticker TEXT NOT NULL,
      strategy TEXT NOT NULL,
      entry_price REAL NOT NULL,
      exit_price REAL,
      quantity REAL NOT NULL,
      pnl REAL,
      pnl_percent REAL,
      outcome TEXT CHECK(outcome IN ('WIN','LOSS','BREAKEVEN')),
      reason TEXT,
      entry_time INTEGER NOT NULL,
      exit_time INTEGER,
      created_at INTEGER DEFAULT (unixepoch() * 1000)
    );

    -- Candle history for backtesting
    CREATE TABLE IF NOT EXISTS candle_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticker TEXT NOT NULL,
      timeframe TEXT NOT NULL,
      time INTEGER NOT NULL,
      open REAL NOT NULL,
      high REAL NOT NULL,
      low REAL NOT NULL,
      close REAL NOT NULL,
      volume REAL NOT NULL,
      UNIQUE(ticker, timeframe, time)
    );
    CREATE INDEX IF NOT EXISTS idx_candle_lookup
      ON candle_history(ticker, timeframe, time);

    -- AI learning trade memory
    CREATE TABLE IF NOT EXISTS trade_memory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticker TEXT NOT NULL,
      strategy TEXT NOT NULL,
      entry_price REAL,
      exit_price REAL,
      entry_time INTEGER,
      exit_time INTEGER,
      pnl REAL,
      pnl_percent REAL,
      outcome TEXT CHECK(outcome IN ('WIN','LOSS','BREAKEVEN')),
      hold_duration REAL,
      market_volatility TEXT,
      market_trend TEXT,
      market_volume TEXT,
      tc_value REAL,
      momentum_value REAL,
      whale_value REAL,
      confluence_score REAL,
      ai_analysis TEXT,
      created_at INTEGER DEFAULT (unixepoch() * 1000)
    );

    -- Learned patterns from AI analysis
    CREATE TABLE IF NOT EXISTS learned_patterns (
      id TEXT PRIMARY KEY,
      description TEXT,
      tc_range_low REAL,
      tc_range_high REAL,
      momentum_range_low REAL,
      momentum_range_high REAL,
      volatility TEXT,
      trend TEXT,
      success_rate REAL,
      sample_size INTEGER,
      recommendation TEXT,
      updated_at INTEGER DEFAULT (unixepoch() * 1000)
    );

    -- Parameter adjustment history
    CREATE TABLE IF NOT EXISTS parameter_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      params_json TEXT NOT NULL,
      win_rate REAL,
      profit_factor REAL,
      total_trades INTEGER,
      reason TEXT,
      created_at INTEGER DEFAULT (unixepoch() * 1000)
    );

    -- Trading sessions
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      start_time INTEGER NOT NULL,
      end_time INTEGER,
      initial_budget REAL,
      final_value REAL,
      total_trades INTEGER DEFAULT 0,
      win_rate REAL,
      pnl REAL,
      notes TEXT
    );

    -- Sentiment snapshots (for social sentiment storage)
    CREATE TABLE IF NOT EXISTS sentiment_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticker TEXT NOT NULL,
      source TEXT NOT NULL,
      score REAL,
      raw_data TEXT,
      created_at INTEGER DEFAULT (unixepoch() * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_sentiment_lookup
      ON sentiment_snapshots(ticker, created_at);

    -- System activity logs
    CREATE TABLE IF NOT EXISTS system_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      time INTEGER NOT NULL,
      message TEXT NOT NULL,
      type TEXT NOT NULL,
      created_at INTEGER DEFAULT (unixepoch() * 1000)
    );

    -- Key-value settings store
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER DEFAULT (unixepoch() * 1000)
    );

    -- Multi-exchange order book / price snapshots
    CREATE TABLE IF NOT EXISTS exchange_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticker TEXT NOT NULL,
      exchange TEXT NOT NULL,
      bid_total REAL,
      ask_total REAL,
      imbalance REAL,
      spread REAL,
      spread_pct REAL,
      best_bid REAL,
      best_ask REAL,
      volume_24h REAL,
      price REAL,
      timestamp INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_exchange_snap
      ON exchange_snapshots(ticker, exchange, timestamp);

    -- Derivatives data (OKX futures/perps)
    CREATE TABLE IF NOT EXISTS derivatives_data (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticker TEXT NOT NULL,
      open_interest REAL,
      oi_usd REAL,
      funding_rate REAL,
      futures_price REAL,
      spot_price REAL,
      basis REAL,
      basis_pct REAL,
      oi_change_pct REAL,
      timestamp INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_derivatives
      ON derivatives_data(ticker, timestamp);

    -- DeFi snapshots (DeFiLlama)
    CREATE TABLE IF NOT EXISTS defi_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      total_tvl REAL,
      tvl_change_24h REAL,
      dex_volume_24h REAL,
      stablecoin_mcap REAL,
      stablecoin_change REAL,
      top_chains_json TEXT,
      timestamp INTEGER NOT NULL
    );

    -- Aggregated news items (CryptoPanic + Reddit)
    CREATE TABLE IF NOT EXISTS news_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      external_id TEXT UNIQUE,
      source TEXT NOT NULL,
      title TEXT NOT NULL,
      url TEXT,
      currencies TEXT,
      sentiment_score REAL,
      published_at INTEGER,
      created_at INTEGER DEFAULT (unixepoch() * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_news_lookup
      ON news_items(currencies, published_at);

    -- Pre-computed ML feature vectors
    CREATE TABLE IF NOT EXISTS ml_features (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticker TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      features_json TEXT NOT NULL,
      label TEXT,
      label_value REAL,
      labeled_at INTEGER,
      created_at INTEGER DEFAULT (unixepoch() * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_ml_features
      ON ml_features(ticker, timestamp);

    -- Serialized ML model weights
    CREATE TABLE IF NOT EXISTS ml_models (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      model_type TEXT NOT NULL,
      model_data TEXT NOT NULL,
      accuracy REAL,
      precision_score REAL,
      recall REAL,
      f1_score REAL,
      sample_count INTEGER,
      feature_importance_json TEXT,
      config_json TEXT,
      created_at INTEGER DEFAULT (unixepoch() * 1000)
    );

    -- ML prediction log with retroactive accuracy
    CREATE TABLE IF NOT EXISTS ml_predictions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticker TEXT NOT NULL,
      model_id INTEGER,
      prediction TEXT NOT NULL,
      confidence REAL,
      features_snapshot TEXT,
      actual_outcome TEXT,
      was_correct INTEGER,
      timestamp INTEGER NOT NULL,
      resolved_at INTEGER,
      FOREIGN KEY (model_id) REFERENCES ml_models(id)
    );
    CREATE INDEX IF NOT EXISTS idx_ml_predictions
      ON ml_predictions(ticker, timestamp);
  `);

  // New coin detection and tracking tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS known_tickers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticker TEXT NOT NULL UNIQUE,
      first_seen INTEGER NOT NULL,
      last_seen INTEGER NOT NULL,
      is_active INTEGER DEFAULT 1,
      listing_metadata TEXT,
      created_at INTEGER DEFAULT (unixepoch() * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_known_tickers_ticker
      ON known_tickers(ticker);

    CREATE TABLE IF NOT EXISTS new_coin_signals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticker TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      signal_type TEXT NOT NULL,
      signal_value REAL,
      metadata TEXT,
      created_at INTEGER DEFAULT (unixepoch() * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_new_coin_signals_ticker
      ON new_coin_signals(ticker, timestamp);

    CREATE TABLE IF NOT EXISTS synthetic_labeling_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      status TEXT NOT NULL DEFAULT 'pending',
      total_pairs INTEGER DEFAULT 0,
      completed_pairs INTEGER DEFAULT 0,
      total_samples INTEGER DEFAULT 0,
      started_at INTEGER,
      completed_at INTEGER,
      error TEXT,
      created_at INTEGER DEFAULT (unixepoch() * 1000)
    );
  `);

  // Phase 1: Backend Bot Engine tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS equity_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      time INTEGER NOT NULL,
      total_value REAL NOT NULL,
      cash REAL NOT NULL,
      holdings_value REAL NOT NULL,
      open_positions INTEGER DEFAULT 0,
      pnl_percent REAL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_equity_snapshots_session
      ON equity_snapshots(session_id, time);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS session_trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      time INTEGER NOT NULL,
      type TEXT NOT NULL,
      ticker TEXT NOT NULL,
      price REAL NOT NULL,
      quantity REAL NOT NULL,
      notional REAL DEFAULT 0,
      strategy TEXT,
      reason TEXT,
      pnl REAL DEFAULT 0,
      fee REAL DEFAULT 0,
      balance_after REAL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_session_trades_session
      ON session_trades(session_id, time);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS ml_thoughts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT,
      time INTEGER NOT NULL,
      type TEXT NOT NULL,
      ticker TEXT,
      action TEXT,
      confidence REAL,
      reason TEXT,
      indicators TEXT,
      feature_importance TEXT,
      regime TEXT,
      market_speed TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_ml_thoughts_session
      ON ml_thoughts(session_id, time);
  `);

  // Migrate sessions table: add session_id, status, trading_mode columns
  // Helper: ignore "duplicate column" errors but log unexpected ones
  const safeAlter = (sql) => {
    try { db.exec(sql); } catch(e) {
      if (!e.message?.includes('duplicate column') && !e.message?.includes('already exists')) {
        console.error(`[DB MIGRATION] Unexpected error: ${e.message} — SQL: ${sql}`);
      }
    }
  };
  safeAlter(`ALTER TABLE sessions ADD COLUMN session_id TEXT`);
  safeAlter(`ALTER TABLE sessions ADD COLUMN status TEXT DEFAULT 'ACTIVE'`);
  safeAlter(`ALTER TABLE sessions ADD COLUMN trading_mode TEXT DEFAULT 'SIMULATION'`);
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_sessions_session_id ON sessions(session_id)`); } catch(e) {}
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status)`); } catch(e) {}

  // M9: schema_version table previously created + seeded but never read
  // or updated by any subsequent migration (the four post-init safeAlter
  // calls all rely on idempotent try/catch). Future contributors saw it
  // and assumed it was authoritative — it isn't. Kept as an empty stub
  // for now (with a comment) instead of dropping, so any analyst tools
  // querying it don't break. To actually use it, replace safeAlter with
  // version-gated migrations.
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      applied_at INTEGER DEFAULT (unixepoch() * 1000),
      description TEXT
    );
  `);
  try {
    db.exec(`INSERT OR IGNORE INTO schema_version (version, description) VALUES (1, 'Initial schema (note: subsequent migrations use safeAlter, this row is not authoritative)')`);
  } catch(e) {}

  // Additional indexes for performance
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_equity_snapshots_time_desc ON equity_snapshots(session_id, time DESC)`); } catch(e) {}
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_session_trades_ticker ON session_trades(session_id, ticker)`); } catch(e) {}
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_trades_strategy ON trades(strategy, created_at DESC)`); } catch(e) {}
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_trade_memory_strategy ON trade_memory(strategy, created_at DESC)`); } catch(e) {}

  // Phase 2: DCA / Grid / Swing position persistence
  db.exec(`
    CREATE TABLE IF NOT EXISTS dca_positions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      ticker TEXT NOT NULL,
      total_invested REAL DEFAULT 0,
      total_quantity REAL DEFAULT 0,
      avg_price REAL DEFAULT 0,
      buy_count INTEGER DEFAULT 0,
      last_buy_time INTEGER,
      take_profit_price REAL,
      status TEXT DEFAULT 'ACTIVE',
      created_at INTEGER DEFAULT (unixepoch() * 1000),
      updated_at INTEGER DEFAULT (unixepoch() * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_dca_positions_session
      ON dca_positions(session_id, status);

    CREATE TABLE IF NOT EXISTS grid_positions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      ticker TEXT NOT NULL,
      grid_low REAL NOT NULL,
      grid_high REAL NOT NULL,
      grid_count INTEGER DEFAULT 5,
      levels_json TEXT,
      filled_buys INTEGER DEFAULT 0,
      filled_sells INTEGER DEFAULT 0,
      total_pnl REAL DEFAULT 0,
      status TEXT DEFAULT 'ACTIVE',
      created_at INTEGER DEFAULT (unixepoch() * 1000),
      updated_at INTEGER DEFAULT (unixepoch() * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_grid_positions_session
      ON grid_positions(session_id, status);

    CREATE TABLE IF NOT EXISTS swing_positions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      ticker TEXT NOT NULL,
      entry_price REAL NOT NULL,
      quantity REAL DEFAULT 0,
      stop_loss REAL,
      take_profit REAL,
      highest_price REAL,
      trailing_stop REAL,
      confidence INTEGER DEFAULT 0,
      status TEXT DEFAULT 'ACTIVE',
      created_at INTEGER DEFAULT (unixepoch() * 1000),
      updated_at INTEGER DEFAULT (unixepoch() * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_swing_positions_session
      ON swing_positions(session_id, status);
  `);

  // ============================================
  // ML Pipeline Tables (4-Layer System)
  // ============================================
  db.exec(`
    -- System config persistence (feature flags)
    CREATE TABLE IF NOT EXISTS system_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER DEFAULT (unixepoch() * 1000)
    );

    -- Genetic strategy genomes
    CREATE TABLE IF NOT EXISTS genetic_genomes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      genome_id TEXT NOT NULL UNIQUE,
      generation INTEGER DEFAULT 0,
      genome_json TEXT NOT NULL,
      fitness REAL DEFAULT 0,
      win_rate REAL DEFAULT 0,
      trade_count INTEGER DEFAULT 0,
      root_indicator TEXT,
      created_at INTEGER DEFAULT (unixepoch() * 1000),
      updated_at INTEGER DEFAULT (unixepoch() * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_genetic_genomes_fitness
      ON genetic_genomes(fitness DESC);

    -- Genetic evolution log
    CREATE TABLE IF NOT EXISTS genetic_evolution_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      generation INTEGER NOT NULL,
      population_size INTEGER,
      best_fitness REAL,
      avg_fitness REAL,
      best_genome_id TEXT,
      mutations INTEGER DEFAULT 0,
      crossovers INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (unixepoch() * 1000)
    );

    -- Adversarial model metadata
    CREATE TABLE IF NOT EXISTS adversarial_models (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      model_type TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('BULL', 'BEAR')),
      sample_count INTEGER DEFAULT 0,
      accuracy REAL DEFAULT 0,
      last_trained_at INTEGER,
      config_json TEXT,
      created_at INTEGER DEFAULT (unixepoch() * 1000)
    );

    -- Portfolio correlation snapshots
    CREATE TABLE IF NOT EXISTS portfolio_correlation_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      matrix_json TEXT NOT NULL,
      ticker_list TEXT NOT NULL,
      avg_correlation REAL DEFAULT 0,
      hhi REAL DEFAULT 0,
      effective_positions REAL DEFAULT 0,
      created_at INTEGER DEFAULT (unixepoch() * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_correlation_snapshots_time
      ON portfolio_correlation_snapshots(created_at DESC);

    -- ML Gatekeeper decision log
    CREATE TABLE IF NOT EXISTS ml_gatekeeper_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticker TEXT NOT NULL,
      decision TEXT NOT NULL,
      ml_confidence REAL,
      tier TEXT,
      rule_strategy TEXT,
      rule_strength REAL,
      adversarial_consensus TEXT,
      correlation_multiplier REAL,
      final_size_multiplier REAL,
      reason TEXT,
      actual_outcome TEXT,
      was_correct INTEGER,
      created_at INTEGER DEFAULT (unixepoch() * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_gatekeeper_log_time
      ON ml_gatekeeper_log(created_at DESC);

    -- Per-regime ML accuracy tracking
    CREATE TABLE IF NOT EXISTS ml_regime_accuracy (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      regime TEXT NOT NULL,
      outcome TEXT NOT NULL,
      ticker TEXT,
      pnl_percent REAL,
      timestamp INTEGER DEFAULT (unixepoch() * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_regime_accuracy_regime
      ON ml_regime_accuracy(regime, timestamp DESC);
  `);

  // ============================================
  // Performance Upgrade Tables
  // ============================================
  db.exec(`
    -- On-chain data cache
    CREATE TABLE IF NOT EXISTS onchain_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticker TEXT, timestamp INTEGER, data_json TEXT,
      UNIQUE(ticker, timestamp)
    );

    -- Execution quality tracking
    CREATE TABLE IF NOT EXISTS execution_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticker TEXT, side TEXT, estimated_slippage REAL,
      actual_slippage REAL, fill_rate REAL, execution_time_ms INTEGER,
      order_type TEXT, timestamp INTEGER
    );

    -- Monte Carlo results
    CREATE TABLE IF NOT EXISTS monte_carlo_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT, n_simulations INTEGER,
      sharpe_p5 REAL, sharpe_p50 REAL, sharpe_p95 REAL,
      drawdown_p5 REAL, drawdown_p50 REAL, drawdown_p95 REAL,
      return_p5 REAL, return_p50 REAL, return_p95 REAL,
      trade_count INTEGER, created_at INTEGER
    );
  `);

  // Add regime column to ml_features (safe migration)
  safeAlter(`ALTER TABLE ml_features ADD COLUMN regime TEXT`);

  // Phase 1-8: ML Pipeline tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS tf_models (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      model_type TEXT NOT NULL,
      model_path TEXT,
      accuracy REAL,
      loss REAL,
      config_json TEXT,
      sample_count INTEGER,
      trained_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS agent_performance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_name TEXT NOT NULL,
      decision TEXT NOT NULL,
      was_correct INTEGER NOT NULL,
      confidence REAL,
      meta_weight REAL,
      ticker TEXT,
      created_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS drift_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      details_json TEXT,
      accuracy_before REAL,
      accuracy_after REAL,
      created_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS shap_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticker TEXT,
      feature_importances_json TEXT,
      prediction TEXT,
      confidence REAL,
      created_at INTEGER
    );
  `);

  // Performance indexes
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_ml_features_lookup ON ml_features(ticker, timestamp)`); } catch(e) {}
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_ml_predictions_lookup ON ml_predictions(ticker, timestamp)`); } catch(e) {}
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_trades_strategy_outcome ON trades(strategy, outcome)`); } catch(e) {}
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_execution_metrics_lookup ON execution_metrics(ticker, timestamp)`); } catch(e) {}
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_agent_performance_name ON agent_performance(agent_name, created_at)`); } catch(e) {}
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_drift_events_time ON drift_events(created_at DESC)`); } catch(e) {}
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_shap_history_ticker ON shap_history(ticker, created_at DESC)`); } catch(e) {}

  console.log(`[Database] Initialized SQLite at ${dbPath}`);
  return db;
}

/**
 * Ping the database to check if it's responsive
 * @returns {boolean}
 */
export function pingDatabase() {
  try {
    const row = getDb().prepare('SELECT 1 AS ok').get();
    return row?.ok === 1;
  } catch {
    return false;
  }
}

/**
 * Close the database connection gracefully
 */
export function closeDatabase() {
  if (db) {
    db.close();
    db = null;
    console.log('[Database] Connection closed');
  }
}

// ============================================
// PREPARED STATEMENT HELPERS
// ============================================

// --- Trades ---
export function insertTrade(trade) {
  const stmt = getDb().prepare(`
    INSERT INTO trades (ticker, strategy, entry_price, exit_price, quantity, pnl, pnl_percent, outcome, reason, entry_time, exit_time)
    VALUES (@ticker, @strategy, @entryPrice, @exitPrice, @quantity, @pnl, @pnlPercent, @outcome, @reason, @entryTime, @exitTime)
  `);
  return stmt.run(trade);
}

export function getTrades({ limit = 500, offset = 0, strategy = null } = {}) {
  if (strategy) {
    return getDb().prepare(
      'SELECT * FROM trades WHERE strategy = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
    ).all(strategy, limit, offset);
  }
  return getDb().prepare(
    'SELECT * FROM trades ORDER BY created_at DESC LIMIT ? OFFSET ?'
  ).all(limit, offset);
}

export function getTradeCount(strategy = null) {
  if (strategy) {
    return getDb().prepare('SELECT COUNT(*) as count FROM trades WHERE strategy = ?').get(strategy)?.count ?? 0;
  }
  return getDb().prepare('SELECT COUNT(*) as count FROM trades').get()?.count ?? 0;
}

// --- Trade Memory (AI Learning) ---
export function insertTradeMemory(memory) {
  const stmt = getDb().prepare(`
    INSERT INTO trade_memory (ticker, strategy, entry_price, exit_price, entry_time, exit_time, pnl, pnl_percent, outcome, hold_duration, market_volatility, market_trend, market_volume, tc_value, momentum_value, whale_value, confluence_score, ai_analysis)
    VALUES (@ticker, @strategy, @entryPrice, @exitPrice, @entryTime, @exitTime, @pnl, @pnlPercent, @outcome, @holdDuration, @marketVolatility, @marketTrend, @marketVolume, @tcValue, @momentumValue, @whaleValue, @confluenceScore, @aiAnalysis)
  `);
  return stmt.run(memory);
}

export function getTradeMemories(limit = 500) {
  return getDb().prepare(
    'SELECT * FROM trade_memory ORDER BY created_at DESC LIMIT ?'
  ).all(limit);
}

// --- Learned Patterns ---
export function upsertLearnedPattern(pattern) {
  const stmt = getDb().prepare(`
    INSERT INTO learned_patterns (id, description, tc_range_low, tc_range_high, momentum_range_low, momentum_range_high, volatility, trend, success_rate, sample_size, recommendation, updated_at)
    VALUES (@id, @description, @tcRangeLow, @tcRangeHigh, @momentumRangeLow, @momentumRangeHigh, @volatility, @trend, @successRate, @sampleSize, @recommendation, unixepoch() * 1000)
    ON CONFLICT(id) DO UPDATE SET
      description = @description,
      tc_range_low = @tcRangeLow,
      tc_range_high = @tcRangeHigh,
      momentum_range_low = @momentumRangeLow,
      momentum_range_high = @momentumRangeHigh,
      volatility = @volatility,
      trend = @trend,
      success_rate = @successRate,
      sample_size = @sampleSize,
      recommendation = @recommendation,
      updated_at = unixepoch() * 1000
  `);
  return stmt.run(pattern);
}

export function getLearnedPatterns() {
  return getDb().prepare('SELECT * FROM learned_patterns ORDER BY updated_at DESC').all();
}

// --- Parameter History ---
export function insertParameterSnapshot(snapshot) {
  const stmt = getDb().prepare(`
    INSERT INTO parameter_history (params_json, win_rate, profit_factor, total_trades, reason)
    VALUES (@paramsJson, @winRate, @profitFactor, @totalTrades, @reason)
  `);
  return stmt.run(snapshot);
}

export function getParameterHistory(limit = 50) {
  return getDb().prepare(
    'SELECT * FROM parameter_history ORDER BY created_at DESC LIMIT ?'
  ).all(limit);
}

export function getLatestParameters() {
  return getDb().prepare(
    'SELECT * FROM parameter_history ORDER BY created_at DESC LIMIT 1'
  ).get();
}

// --- Sessions ---
export function insertSession(session) {
  const stmt = getDb().prepare(`
    INSERT INTO sessions (start_time, initial_budget, notes)
    VALUES (@startTime, @initialBudget, @notes)
  `);
  return stmt.run(session);
}

export function updateSession(id, updates) {
  const stmt = getDb().prepare(`
    UPDATE sessions SET end_time = @endTime, final_value = @finalValue, total_trades = @totalTrades, win_rate = @winRate, pnl = @pnl
    WHERE id = @id
  `);
  return stmt.run({ id, ...updates });
}

export function getSessions(limit = 50) {
  return getDb().prepare(
    'SELECT * FROM sessions ORDER BY start_time DESC LIMIT ?'
  ).all(limit);
}

// --- Session History (Phase 7: Session tracking) ---
export function insertSessionRecord(sessionId, startTime, initialBudget, tradingMode, notes = '') {
  const stmt = getDb().prepare(`
    INSERT INTO sessions (session_id, start_time, initial_budget, trading_mode, status, notes)
    VALUES (?, ?, ?, ?, 'ACTIVE', ?)
  `);
  return stmt.run(sessionId, startTime, initialBudget, tradingMode, notes);
}

export function completeSession(sessionId, endTime, finalValue, totalTrades, winRate, pnl) {
  return getDb().prepare(`
    UPDATE sessions SET end_time = ?, final_value = ?, total_trades = ?, win_rate = ?, pnl = ?, status = 'COMPLETED'
    WHERE session_id = ?
  `).run(endTime, finalValue, totalTrades, winRate, pnl, sessionId);
}

export function markAbandonedSessions() {
  try {
    const fiveMinAgo = Date.now() - 5 * 60 * 1000;
    // Single query: mark sessions as abandoned if they have no recent activity
    getDb().prepare(`
      UPDATE sessions
      SET status = 'ABANDONED', end_time = ?
      WHERE status = 'ACTIVE'
        AND session_id IS NOT NULL
        AND COALESCE(
          (SELECT MAX(time) FROM session_trades WHERE session_trades.session_id = sessions.session_id),
          (SELECT MAX(time) FROM equity_snapshots WHERE equity_snapshots.session_id = sessions.session_id),
          sessions.start_time
        ) < ?
    `).run(Date.now(), fiveMinAgo);
  } catch (e) {
    console.warn('[Database] Error marking abandoned sessions:', e.message);
  }
}

export function getSessionHistory(limit = 50) {
  return getDb().prepare(`
    SELECT s.*,
      (SELECT COUNT(*) FROM session_trades st WHERE st.session_id = s.session_id) as trade_count,
      (SELECT MAX(time) FROM equity_snapshots es WHERE es.session_id = s.session_id) as last_activity,
      (SELECT total_value FROM equity_snapshots es WHERE es.session_id = s.session_id ORDER BY time DESC LIMIT 1) as last_value,
      (SELECT cash FROM equity_snapshots es WHERE es.session_id = s.session_id ORDER BY time DESC LIMIT 1) as last_cash
    FROM sessions s
    WHERE s.session_id IS NOT NULL
    ORDER BY s.start_time DESC
    LIMIT ?
  `).all(limit);
}

export function getSessionDetail(sessionId) {
  const session = getDb().prepare(
    `SELECT * FROM sessions WHERE session_id = ?`
  ).get(sessionId);
  if (!session) return null;
  const equityCurve = getDb().prepare(
    `SELECT time, total_value, cash, holdings_value, pnl_percent FROM equity_snapshots WHERE session_id = ? ORDER BY time ASC LIMIT 500`
  ).all(sessionId);
  const trades = getDb().prepare(
    `SELECT * FROM session_trades WHERE session_id = ? ORDER BY time DESC LIMIT 100`
  ).all(sessionId);
  const stats = getDb().prepare(`
    SELECT
      COUNT(*) as total_trades,
      SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) as wins,
      SUM(CASE WHEN pnl < 0 THEN 1 ELSE 0 END) as losses,
      SUM(pnl) as total_pnl,
      MAX(pnl) as best_trade,
      MIN(pnl) as worst_trade,
      SUM(fee) as total_fees
    FROM session_trades WHERE session_id = ? AND type = 'SELL'
  `).get(sessionId);
  return { session, equityCurve, trades, stats };
}

// --- Candle History ---
export function insertCandlesBatch(candles) {
  const stmt = getDb().prepare(`
    INSERT OR IGNORE INTO candle_history (ticker, timeframe, time, open, high, low, close, volume)
    VALUES (@ticker, @timeframe, @time, @open, @high, @low, @close, @volume)
  `);

  const insertMany = getDb().transaction((rows) => {
    for (const row of rows) {
      stmt.run(row);
    }
  });

  insertMany(candles);
}

export function getCandles({ ticker, timeframe, start, end, limit = 1000 } = {}) {
  let query = 'SELECT * FROM candle_history WHERE ticker = ? AND timeframe = ?';
  const params = [ticker, timeframe];

  if (start) {
    query += ' AND time >= ?';
    params.push(start);
  }
  if (end) {
    query += ' AND time <= ?';
    params.push(end);
  }

  query += ' ORDER BY time ASC LIMIT ?';
  params.push(limit);

  return getDb().prepare(query).all(...params);
}

export function getCandleCount(ticker, timeframe) {
  return getDb().prepare(
    'SELECT COUNT(*) as count FROM candle_history WHERE ticker = ? AND timeframe = ?'
  ).get(ticker, timeframe).count;
}

// --- Sentiment Snapshots ---
export function insertSentimentSnapshot(snapshot) {
  const stmt = getDb().prepare(`
    INSERT INTO sentiment_snapshots (ticker, source, score, raw_data)
    VALUES (@ticker, @source, @score, @rawData)
  `);
  return stmt.run(snapshot);
}

export function getSentimentHistory({ ticker, hours = 24 } = {}) {
  const cutoff = Date.now() - (hours * 60 * 60 * 1000);
  return getDb().prepare(
    'SELECT * FROM sentiment_snapshots WHERE ticker = ? AND created_at > ? ORDER BY created_at ASC'
  ).all(ticker, cutoff);
}

// --- System Logs ---
export function insertSystemLog(log) {
  const stmt = getDb().prepare(`
    INSERT INTO system_logs (time, message, type)
    VALUES (@time, @message, @type)
  `);
  return stmt.run(log);
}

export function getSystemLogs(limit = 100) {
  return getDb().prepare(
    'SELECT * FROM system_logs ORDER BY time DESC LIMIT ?'
  ).all(limit);
}

// --- Settings ---
export function setSetting(key, value) {
  const stmt = getDb().prepare(`
    INSERT INTO settings (key, value, updated_at)
    VALUES (?, ?, unixepoch() * 1000)
    ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = unixepoch() * 1000
  `);
  return stmt.run(key, value, value);
}

export function getSetting(key) {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

export function getAllSettings() {
  return getDb().prepare('SELECT * FROM settings ORDER BY key').all();
}

// ============================================
// MULTI-EXCHANGE DATA TABLES
// ============================================

// --- Exchange Snapshots ---
export function insertExchangeSnapshot(snap) {
  const stmt = getDb().prepare(`
    INSERT INTO exchange_snapshots (ticker, exchange, bid_total, ask_total, imbalance, spread, spread_pct, best_bid, best_ask, volume_24h, price, timestamp)
    VALUES (@ticker, @exchange, @bidTotal, @askTotal, @imbalance, @spread, @spreadPct, @bestBid, @bestAsk, @volume24h, @price, @timestamp)
  `);
  return stmt.run(snap);
}

export function insertExchangeSnapshotsBatch(snapshots) {
  const stmt = getDb().prepare(`
    INSERT INTO exchange_snapshots (ticker, exchange, bid_total, ask_total, imbalance, spread, spread_pct, best_bid, best_ask, volume_24h, price, timestamp)
    VALUES (@ticker, @exchange, @bidTotal, @askTotal, @imbalance, @spread, @spreadPct, @bestBid, @bestAsk, @volume24h, @price, @timestamp)
  `);
  const insertMany = getDb().transaction((rows) => {
    for (const row of rows) stmt.run(row);
  });
  insertMany(snapshots);
}

export function getExchangeSnapshots(ticker, hours = 1) {
  const cutoff = Date.now() - (hours * 60 * 60 * 1000);
  return getDb().prepare(
    'SELECT * FROM exchange_snapshots WHERE ticker = ? AND timestamp > ? ORDER BY timestamp DESC'
  ).all(ticker, cutoff);
}

export function getLatestExchangeSnapshot(ticker, exchange) {
  return getDb().prepare(
    'SELECT * FROM exchange_snapshots WHERE ticker = ? AND exchange = ? ORDER BY timestamp DESC LIMIT 1'
  ).get(ticker, exchange);
}

// --- Derivatives Data ---
export function insertDerivativesData(data) {
  const stmt = getDb().prepare(`
    INSERT INTO derivatives_data (ticker, open_interest, oi_usd, funding_rate, futures_price, spot_price, basis, basis_pct, oi_change_pct, timestamp)
    VALUES (@ticker, @openInterest, @oiUsd, @fundingRate, @futuresPrice, @spotPrice, @basis, @basisPct, @oiChangePct, @timestamp)
  `);
  return stmt.run(data);
}

export function getDerivativesHistory(ticker, hours = 24) {
  const cutoff = Date.now() - (hours * 60 * 60 * 1000);
  return getDb().prepare(
    'SELECT * FROM derivatives_data WHERE ticker = ? AND timestamp > ? ORDER BY timestamp DESC'
  ).all(ticker, cutoff);
}

export function getLatestDerivatives(ticker) {
  return getDb().prepare(
    'SELECT * FROM derivatives_data WHERE ticker = ? ORDER BY timestamp DESC LIMIT 1'
  ).get(ticker);
}

// --- DeFi Snapshots ---
export function insertDeFiSnapshot(snap) {
  const stmt = getDb().prepare(`
    INSERT INTO defi_snapshots (total_tvl, tvl_change_24h, dex_volume_24h, stablecoin_mcap, stablecoin_change, top_chains_json, timestamp)
    VALUES (@totalTvl, @tvlChange24h, @dexVolume24h, @stablecoinMcap, @stablecoinChange, @topChainsJson, @timestamp)
  `);
  return stmt.run(snap);
}

export function getLatestDeFiSnapshot() {
  return getDb().prepare(
    'SELECT * FROM defi_snapshots ORDER BY timestamp DESC LIMIT 1'
  ).get();
}

export function getDeFiHistory(hours = 24) {
  const cutoff = Date.now() - (hours * 60 * 60 * 1000);
  return getDb().prepare(
    'SELECT * FROM defi_snapshots WHERE timestamp > ? ORDER BY timestamp ASC'
  ).all(cutoff);
}

// --- News Items ---
export function insertNewsItem(item) {
  const stmt = getDb().prepare(`
    INSERT OR IGNORE INTO news_items (external_id, source, title, url, currencies, sentiment_score, published_at)
    VALUES (@externalId, @source, @title, @url, @currencies, @sentimentScore, @publishedAt)
  `);
  return stmt.run(item);
}

export function insertNewsItemsBatch(items) {
  const stmt = getDb().prepare(`
    INSERT OR IGNORE INTO news_items (external_id, source, title, url, currencies, sentiment_score, published_at)
    VALUES (@externalId, @source, @title, @url, @currencies, @sentimentScore, @publishedAt)
  `);
  const insertMany = getDb().transaction((rows) => {
    for (const row of rows) stmt.run(row);
  });
  insertMany(items);
}

export function getNewsItems({ ticker = null, hours = 24, limit = 50 } = {}) {
  const cutoff = Date.now() - (hours * 60 * 60 * 1000);
  if (ticker) {
    const currency = ticker.replace(/USD$/, '');
    return getDb().prepare(
      "SELECT * FROM news_items WHERE currencies LIKE ? AND created_at > ? ORDER BY published_at DESC LIMIT ?"
    ).all(`%${currency}%`, cutoff, limit);
  }
  return getDb().prepare(
    'SELECT * FROM news_items WHERE created_at > ? ORDER BY published_at DESC LIMIT ?'
  ).all(cutoff, limit);
}

// --- ML Features ---
// H2: include `regime` column in insert. The column was added by safeAlter
// at startup but never written by this insert path, leaving it NULL on every
// live-loop sample. Regime is also encoded in features_json (index 9 one-hot)
// so this is for ad-hoc SQL filtering convenience, e.g.
//   SELECT regime, COUNT(*) FROM ml_features WHERE label='WIN' GROUP BY regime
// Callers that don't have regime context can omit it (defaults to null).
export function insertMLFeatures(features) {
  const stmt = getDb().prepare(`
    INSERT INTO ml_features (ticker, timestamp, features_json, label, label_value, labeled_at, regime)
    VALUES (@ticker, @timestamp, @featuresJson, @label, @labelValue, @labeledAt, @regime)
  `);
  return stmt.run({ regime: null, ...features });
}

export function getUnlabeledFeatures(limit = 1000) {
  return getDb().prepare(
    'SELECT * FROM ml_features WHERE label IS NULL ORDER BY timestamp ASC LIMIT ?'
  ).all(limit);
}

export function getLabeledFeatures(limit = 5000) {
  return getDb().prepare(
    'SELECT * FROM ml_features WHERE label IS NOT NULL ORDER BY timestamp DESC LIMIT ?'
  ).all(limit);
}

export function labelMLFeatures(id, label, labelValue) {
  return getDb().prepare(
    'UPDATE ml_features SET label = ?, label_value = ?, labeled_at = ? WHERE id = ?'
  ).run(label, labelValue, Date.now(), id);
}

// --- ML Models ---
export function insertMLModel(model) {
  const stmt = getDb().prepare(`
    INSERT INTO ml_models (model_type, model_data, accuracy, precision_score, recall, f1_score, sample_count, feature_importance_json, config_json)
    VALUES (@modelType, @modelData, @accuracy, @precisionScore, @recall, @f1Score, @sampleCount, @featureImportanceJson, @configJson)
  `);
  return stmt.run(model);
}

export function getLatestMLModel(modelType = null) {
  if (modelType) {
    return getDb().prepare(
      'SELECT * FROM ml_models WHERE model_type = ? ORDER BY created_at DESC LIMIT 1'
    ).get(modelType);
  }
  return getDb().prepare(
    'SELECT * FROM ml_models ORDER BY created_at DESC LIMIT 1'
  ).get();
}

export function getMLModelHistory(limit = 20) {
  return getDb().prepare(
    'SELECT id, model_type, accuracy, precision_score, recall, f1_score, sample_count, created_at FROM ml_models ORDER BY created_at DESC LIMIT ?'
  ).all(limit);
}

// --- ML Predictions ---
export function insertMLPrediction(pred) {
  const stmt = getDb().prepare(`
    INSERT INTO ml_predictions (ticker, model_id, prediction, confidence, features_snapshot, timestamp)
    VALUES (@ticker, @modelId, @prediction, @confidence, @featuresSnapshot, @timestamp)
  `);
  return stmt.run(pred);
}

export function resolveMLPrediction(id, actualOutcome, wasCorrect) {
  return getDb().prepare(
    'UPDATE ml_predictions SET actual_outcome = ?, was_correct = ?, resolved_at = ? WHERE id = ?'
  ).run(actualOutcome, wasCorrect ? 1 : 0, Date.now(), id);
}

export function getMLPredictions({ ticker = null, limit = 100, unresolvedOnly = false } = {}) {
  let query = 'SELECT * FROM ml_predictions WHERE 1=1';
  const params = [];
  if (ticker) { query += ' AND ticker = ?'; params.push(ticker); }
  if (unresolvedOnly) { query += ' AND actual_outcome IS NULL'; }
  query += ' ORDER BY timestamp DESC LIMIT ?';
  params.push(limit);
  return getDb().prepare(query).all(...params);
}

export function getMLAccuracyStats() {
  return getDb().prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN was_correct = 1 THEN 1 ELSE 0 END) as correct,
      AVG(confidence) as avg_confidence,
      ROUND(CAST(SUM(CASE WHEN was_correct = 1 THEN 1 ELSE 0 END) AS REAL) / NULLIF(COUNT(CASE WHEN was_correct IS NOT NULL THEN 1 END), 0) * 100, 2) as accuracy_pct
    FROM ml_predictions WHERE actual_outcome IS NOT NULL
  `).get();
}

// --- Cleanup old data ---
export function cleanupOldData(daysToKeep = 90) { // Batch 5A: extended from 30→90 days (200GB NVMe)
  const cutoff = Date.now() - (daysToKeep * 24 * 60 * 60 * 1000);
  const results = {};
  // Best-effort per table — `IF EXISTS` not available in SQLite DELETE,
  // so wrap each in try/catch. A missing table won't block the others.
  const sweep = (key, sql) => {
    try { results[key] = getDb().prepare(sql).run(cutoff).changes; }
    catch (e) { results[key] = `skip:${e.message}`; }
  };
  sweep('exchangeSnapshots', 'DELETE FROM exchange_snapshots WHERE timestamp < ?');
  sweep('derivativesData', 'DELETE FROM derivatives_data WHERE timestamp < ?');
  sweep('defiSnapshots', 'DELETE FROM defi_snapshots WHERE timestamp < ?');
  sweep('newsItems', 'DELETE FROM news_items WHERE created_at < ?');
  sweep('mlFeatures', 'DELETE FROM ml_features WHERE created_at < ?');
  sweep('mlPredictions', 'DELETE FROM ml_predictions WHERE timestamp < ?');
  sweep('equitySnapshots', 'DELETE FROM equity_snapshots WHERE time < ?');
  sweep('sessionTrades', 'DELETE FROM session_trades WHERE time < ?');
  sweep('mlThoughts', 'DELETE FROM ml_thoughts WHERE time < ?');
  // M10: also retire ML monitoring tables that grow ~17K rows/day at 5s
  // loop interval (per memory). Without these, db bloat over time + slow
  // backups + slow queries.
  sweep('mlGatekeeperLog', 'DELETE FROM ml_gatekeeper_log WHERE created_at < ?');
  sweep('shapHistory', 'DELETE FROM shap_history WHERE created_at < ?');
  sweep('agentPerformance', 'DELETE FROM agent_performance WHERE created_at < ?');
  sweep('driftEvents', 'DELETE FROM drift_events WHERE created_at < ?');
  sweep('systemLogs', 'DELETE FROM system_logs WHERE created_at < ?');
  // V2 pairs monitoring tables grow one row per 60s engine loop forever
  // (heartbeat snapshots + alert log). Both store ms timestamps via Date.now().
  // v2_pairs_trades is NOT swept — it's the trade audit record.
  sweep('v2PairsState', 'DELETE FROM v2_pairs_state WHERE loop_at < ?');
  sweep('v2PairsAlerts', 'DELETE FROM v2_pairs_alerts WHERE created_at < ?');
  console.log(`[Database] Cleanup: removed old data older than ${daysToKeep} days`, results);
  return results;
}

// --- Equity Snapshots ---
export function insertEquitySnapshot(snapshot) {
  return getDb().prepare(`
    INSERT INTO equity_snapshots (session_id, time, total_value, cash, holdings_value, open_positions, pnl_percent)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(snapshot.session_id, snapshot.time, snapshot.total_value, snapshot.cash,
         snapshot.holdings_value, snapshot.open_positions, snapshot.pnl_percent);
}

export function getEquitySnapshots(sessionId, limit = 500) {
  return getDb().prepare(`
    SELECT * FROM equity_snapshots WHERE session_id = ? ORDER BY time ASC LIMIT ?
  `).all(sessionId, limit);
}

export function getLatestEquitySnapshot(sessionId) {
  return getDb().prepare(`
    SELECT * FROM equity_snapshots WHERE session_id = ? ORDER BY time DESC LIMIT 1
  `).get(sessionId);
}

// --- Session Trades ---
export function insertSessionTrade(trade) {
  return getDb().prepare(`
    INSERT INTO session_trades (session_id, time, type, ticker, price, quantity, notional, strategy, reason, pnl, fee, balance_after)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(trade.session_id, trade.time, trade.type, trade.ticker, trade.price, trade.quantity,
         trade.notional || 0, trade.strategy || '', trade.reason || '', trade.pnl || 0,
         trade.fee || 0, trade.balance_after || 0);
}

export function getSessionTrades(sessionId, limit = 500) {
  return getDb().prepare(`
    SELECT * FROM session_trades WHERE session_id = ? ORDER BY time DESC LIMIT ?
  `).all(sessionId, limit);
}

export function getSessionTradeStats(sessionId) {
  return getDb().prepare(`
    SELECT
      COUNT(*) as total_trades,
      SUM(CASE WHEN type = 'BUY' THEN 1 ELSE 0 END) as buys,
      SUM(CASE WHEN type = 'SELL' THEN 1 ELSE 0 END) as sells,
      SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) as wins,
      SUM(CASE WHEN pnl < 0 THEN 1 ELSE 0 END) as losses,
      SUM(pnl) as total_pnl,
      AVG(CASE WHEN pnl != 0 THEN pnl ELSE NULL END) as avg_pnl,
      MAX(pnl) as best_trade,
      MIN(pnl) as worst_trade,
      SUM(fee) as total_fees
    FROM session_trades WHERE session_id = ? AND type = 'SELL'
  `).get(sessionId);
}

// --- ML Thoughts ---
export function insertMLThought(thought) {
  return getDb().prepare(`
    INSERT INTO ml_thoughts (session_id, time, type, ticker, action, confidence, reason, indicators, feature_importance, regime, market_speed)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(thought.session_id || '', thought.time || Date.now(), thought.type, thought.ticker || '',
         thought.action || '', thought.confidence || 0, thought.reason || '',
         JSON.stringify(thought.indicators || {}), JSON.stringify(thought.feature_importance || {}),
         thought.regime || '', thought.market_speed || '');
}

export function getMLThoughts(sessionId, limit = 200) {
  return getDb().prepare(`
    SELECT * FROM ml_thoughts WHERE session_id = ? ORDER BY time DESC LIMIT ?
  `).all(sessionId || '', limit);
}

// ============================================
// HISTORICAL TRAINING (TIME MACHINE) TABLES
// ============================================

export function initializeTrainingTables() {
  const d = getDb();
  d.exec(`
    -- Cached OHLCV data from Kraken
    CREATE TABLE IF NOT EXISTS historical_candles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticker TEXT NOT NULL,
      timeframe TEXT NOT NULL,
      time INTEGER NOT NULL,
      open REAL NOT NULL,
      high REAL NOT NULL,
      low REAL NOT NULL,
      close REAL NOT NULL,
      volume REAL NOT NULL,
      UNIQUE(ticker, timeframe, time)
    );
    CREATE INDEX IF NOT EXISTS idx_hist_candle_lookup
      ON historical_candles(ticker, timeframe, time);

    -- Daily Fear & Greed Index
    CREATE TABLE IF NOT EXISTS historical_fear_greed (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL UNIQUE,
      value INTEGER NOT NULL,
      classification TEXT
    );

    -- Daily DeFi TVL
    CREATE TABLE IF NOT EXISTS historical_defi_tvl (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL UNIQUE,
      tvl REAL NOT NULL
    );

    -- Download progress tracking (resume support)
    CREATE TABLE IF NOT EXISTS historical_download_progress (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      ticker TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      total_expected INTEGER DEFAULT 0,
      total_downloaded INTEGER DEFAULT 0,
      last_timestamp INTEGER DEFAULT 0,
      error TEXT,
      updated_at INTEGER DEFAULT (unixepoch() * 1000),
      UNIQUE(source, ticker)
    );

    -- Training run metadata
    CREATE TABLE IF NOT EXISTS training_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'pending',
      config_json TEXT,
      start_time INTEGER,
      end_time INTEGER,
      current_step INTEGER DEFAULT 0,
      total_steps INTEGER DEFAULT 0,
      current_date TEXT,
      total_trades INTEGER DEFAULT 0,
      win_rate REAL DEFAULT 0,
      total_pnl REAL DEFAULT 0,
      max_drawdown REAL DEFAULT 0,
      sharpe_ratio REAL DEFAULT 0,
      final_equity REAL DEFAULT 0,
      learned_state_json TEXT,
      strategy_weights_json TEXT,
      error TEXT,
      created_at INTEGER DEFAULT (unixepoch() * 1000)
    );

    -- Per-run trade history
    CREATE TABLE IF NOT EXISTS training_trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      time INTEGER NOT NULL,
      type TEXT NOT NULL,
      ticker TEXT NOT NULL,
      strategy TEXT,
      price REAL NOT NULL,
      quantity REAL NOT NULL,
      pnl REAL DEFAULT 0,
      pnl_percent REAL DEFAULT 0,
      fee REAL DEFAULT 0,
      balance_after REAL DEFAULT 0,
      regime TEXT,
      composite_score REAL DEFAULT 0,
      entry_features_json TEXT,
      exit_features_json TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_training_trades_run
      ON training_trades(run_id, time);

    -- Per-run equity curve snapshots
    CREATE TABLE IF NOT EXISTS training_equity (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      time INTEGER NOT NULL,
      total_value REAL NOT NULL,
      cash REAL NOT NULL,
      holdings_value REAL DEFAULT 0,
      open_positions INTEGER DEFAULT 0,
      drawdown REAL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_training_equity_run
      ON training_equity(run_id, time);

    -- Labeled feature vectors from simulated trades
    CREATE TABLE IF NOT EXISTS training_ml_samples (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      ticker TEXT NOT NULL,
      time INTEGER NOT NULL,
      features_json TEXT NOT NULL,
      label TEXT,
      label_value REAL,
      strategy TEXT,
      regime TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_training_ml_run
      ON training_ml_samples(run_id, time);

    -- Walk-forward validation runs
    CREATE TABLE IF NOT EXISTS walk_forward_runs (
      id TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL,
      status TEXT DEFAULT 'pending',
      config_json TEXT,
      total_folds INTEGER DEFAULT 0,
      completed_folds INTEGER DEFAULT 0,
      aggregate_results_json TEXT,
      best_fold_id TEXT
    );

    -- Walk-forward individual folds
    CREATE TABLE IF NOT EXISTS walk_forward_folds (
      id TEXT PRIMARY KEY,
      wf_run_id TEXT NOT NULL,
      fold_number INTEGER NOT NULL,
      train_start INTEGER,
      train_end INTEGER,
      test_start INTEGER,
      test_end INTEGER,
      train_run_id TEXT,
      test_run_id TEXT,
      train_pnl REAL,
      test_pnl REAL,
      train_trades INTEGER,
      test_trades INTEGER,
      train_win_rate REAL,
      test_win_rate REAL,
      overfitting_ratio REAL,
      learned_state_json TEXT,
      status TEXT DEFAULT 'pending',
      FOREIGN KEY (wf_run_id) REFERENCES walk_forward_runs(id)
    );
    CREATE INDEX IF NOT EXISTS idx_wf_folds_run
      ON walk_forward_folds(wf_run_id, fold_number);
    -- Monte Carlo stress test results
    CREATE TABLE IF NOT EXISTS monte_carlo_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      iterations INTEGER NOT NULL,
      median_pnl REAL,
      p5_pnl REAL,
      p95_pnl REAL,
      probability_of_profit REAL,
      histogram_json TEXT,
      created_at INTEGER DEFAULT (unixepoch() * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_mc_run ON monte_carlo_results(run_id);

    -- Sensitivity analysis results
    CREATE TABLE IF NOT EXISTS sensitivity_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      results_json TEXT,
      fragile_params TEXT,
      created_at INTEGER DEFAULT (unixepoch() * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_sens_run ON sensitivity_results(run_id);

    -- Cross-pair validation results
    CREATE TABLE IF NOT EXISTS cross_pair_results (
      result_id INTEGER PRIMARY KEY AUTOINCREMENT,
      train_pairs TEXT,
      test_pairs TEXT,
      train_run_id TEXT,
      test_run_id TEXT,
      train_pnl REAL,
      test_pnl REAL,
      generalization_ratio REAL,
      created_at INTEGER DEFAULT (unixepoch() * 1000)
    );

    -- Regime-specific training results
    CREATE TABLE IF NOT EXISTS regime_training_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      regime TEXT NOT NULL,
      run_id TEXT,
      pnl REAL,
      win_rate REAL,
      trades INTEGER,
      created_at INTEGER DEFAULT (unixepoch() * 1000)
    );
  `);

  // Add training_type column to training_runs (safe migration)
  try {
    d.exec(`ALTER TABLE training_runs ADD COLUMN training_type TEXT DEFAULT 'standard'`);
  } catch(e) {
    if (!e.message?.includes('duplicate column') && !e.message?.includes('already exists')) {
      console.error(`[DB MIGRATION] Unexpected error: ${e.message}`);
    }
  }

  console.log('[Database] Historical training tables initialized');
}

// --- Historical Candles ---
export function insertHistoricalCandlesBatch(candles) {
  const stmt = getDb().prepare(`
    INSERT OR IGNORE INTO historical_candles (ticker, timeframe, time, open, high, low, close, volume)
    VALUES (@ticker, @timeframe, @time, @open, @high, @low, @close, @volume)
  `);
  const insertMany = getDb().transaction((rows) => {
    for (const row of rows) stmt.run(row);
  });
  insertMany(candles);
}

export function getHistoricalCandles(ticker, timeframe, startTime, endTime, limit = 50000) {
  return getDb().prepare(`
    SELECT time, open, high, low, close, volume FROM historical_candles
    WHERE ticker = ? AND timeframe = ? AND time >= ? AND time <= ?
    ORDER BY time ASC LIMIT ?
  `).all(ticker, timeframe, startTime, endTime, limit);
}

export function getHistoricalCandleCount(ticker, timeframe) {
  return getDb().prepare(
    'SELECT COUNT(*) as count FROM historical_candles WHERE ticker = ? AND timeframe = ?'
  ).get(ticker, timeframe)?.count ?? 0;
}

export function getHistoricalCandleRange(ticker, timeframe) {
  return getDb().prepare(`
    SELECT MIN(time) as earliest, MAX(time) as latest
    FROM historical_candles WHERE ticker = ? AND timeframe = ?
  `).get(ticker, timeframe);
}

// --- Historical Fear & Greed ---
export function insertFearGreedBatch(entries) {
  const stmt = getDb().prepare(`
    INSERT OR IGNORE INTO historical_fear_greed (date, value, classification)
    VALUES (@date, @value, @classification)
  `);
  const insertMany = getDb().transaction((rows) => {
    for (const row of rows) stmt.run(row);
  });
  insertMany(entries);
}

export function getFearGreedForDate(dateStr) {
  return getDb().prepare(
    'SELECT value, classification FROM historical_fear_greed WHERE date = ?'
  ).get(dateStr);
}

export function getFearGreedCount() {
  return getDb().prepare('SELECT COUNT(*) as count FROM historical_fear_greed').get()?.count ?? 0;
}

// --- Historical DeFi TVL ---
export function insertDefiTvlBatch(entries) {
  const stmt = getDb().prepare(`
    INSERT OR IGNORE INTO historical_defi_tvl (date, tvl)
    VALUES (@date, @tvl)
  `);
  const insertMany = getDb().transaction((rows) => {
    for (const row of rows) stmt.run(row);
  });
  insertMany(entries);
}

export function getDefiTvlForDate(dateStr) {
  return getDb().prepare(
    'SELECT tvl FROM historical_defi_tvl WHERE date = ?'
  ).get(dateStr);
}

export function getDefiTvlCount() {
  return getDb().prepare('SELECT COUNT(*) as count FROM historical_defi_tvl').get()?.count ?? 0;
}

// --- Download Progress ---
export function upsertDownloadProgress(source, ticker, status, totalExpected, totalDownloaded, lastTimestamp, error = null) {
  return getDb().prepare(`
    INSERT INTO historical_download_progress (source, ticker, status, total_expected, total_downloaded, last_timestamp, error, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch() * 1000)
    ON CONFLICT(source, ticker) DO UPDATE SET
      status = ?, total_expected = ?, total_downloaded = ?, last_timestamp = ?, error = ?, updated_at = unixepoch() * 1000
  `).run(source, ticker || '', status, totalExpected, totalDownloaded, lastTimestamp, error,
         status, totalExpected, totalDownloaded, lastTimestamp, error);
}

export function getDownloadProgress() {
  return getDb().prepare(
    'SELECT * FROM historical_download_progress ORDER BY source, ticker'
  ).all();
}

export function clearDownloadProgress() {
  return getDb().prepare('DELETE FROM historical_download_progress').run();
}

// --- Training Runs ---
export function insertTrainingRun(run) {
  return getDb().prepare(`
    INSERT INTO training_runs (run_id, status, config_json, start_time, total_steps)
    VALUES (?, ?, ?, ?, ?)
  `).run(run.run_id, run.status || 'pending', JSON.stringify(run.config || {}),
         run.start_time || Date.now(), run.total_steps || 0);
}

// Allowlist of updatable columns (from the training_runs CREATE TABLE).
// Caller-supplied keys are interpolated into SQL, so anything outside this
// set is rejected to prevent SQL injection via object keys.
const TRAINING_RUN_COLUMNS = new Set([
  'status', 'config_json', 'start_time', 'end_time', 'current_step',
  'total_steps', 'current_date', 'total_trades', 'win_rate', 'total_pnl',
  'max_drawdown', 'sharpe_ratio', 'final_equity', 'learned_state_json',
  'strategy_weights_json', 'error',
]);

export function updateTrainingRun(runId, updates) {
  const fields = [];
  const values = [];
  for (const [key, val] of Object.entries(updates)) {
    const col = key.replace(/([A-Z])/g, '_$1').toLowerCase();
    if (!TRAINING_RUN_COLUMNS.has(col)) {
      throw new Error(`updateTrainingRun: invalid column '${col}'`);
    }
    fields.push(`${col} = ?`);
    values.push(typeof val === 'object' ? JSON.stringify(val) : val);
  }
  values.push(runId);
  return getDb().prepare(`UPDATE training_runs SET ${fields.join(', ')} WHERE run_id = ?`).run(...values);
}

export function getTrainingRun(runId) {
  return getDb().prepare('SELECT * FROM training_runs WHERE run_id = ?').get(runId);
}

export function getTrainingRuns(limit = 20) {
  return getDb().prepare(
    'SELECT * FROM training_runs ORDER BY created_at DESC LIMIT ?'
  ).all(limit);
}

// --- Training Trades ---
export function insertTrainingTrade(trade) {
  return getDb().prepare(`
    INSERT INTO training_trades (run_id, time, type, ticker, strategy, price, quantity, pnl, pnl_percent, fee, balance_after, regime, composite_score, entry_features_json, exit_features_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(trade.run_id, trade.time, trade.type, trade.ticker, trade.strategy || '',
         trade.price, trade.quantity, trade.pnl || 0, trade.pnl_percent || 0,
         trade.fee || 0, trade.balance_after || 0, trade.regime || '',
         trade.composite_score || 0, trade.entry_features_json || '{}', trade.exit_features_json || '{}');
}

export function insertTrainingTradesBatch(trades) {
  const stmt = getDb().prepare(`
    INSERT INTO training_trades (run_id, time, type, ticker, strategy, price, quantity, pnl, pnl_percent, fee, balance_after, regime, composite_score, entry_features_json, exit_features_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertMany = getDb().transaction((rows) => {
    for (const t of rows) {
      const regimeStr = typeof t.regime === 'object' ? JSON.stringify(t.regime) : (t.regime || '');
      stmt.run(t.run_id, t.time, t.type, t.ticker, t.strategy || '',
        t.price, t.quantity, t.pnl || 0, t.pnl_percent || 0,
        t.fee || 0, t.balance_after || 0, regimeStr,
        t.composite_score || 0, t.entry_features_json || '{}', t.exit_features_json || '{}');
    }
  });
  insertMany(trades);
}

export function getTrainingTrades(runId, limit = 500) {
  return getDb().prepare(
    'SELECT * FROM training_trades WHERE run_id = ? ORDER BY time DESC LIMIT ?'
  ).all(runId, limit);
}

export function getTrainingTradeStats(runId) {
  return getDb().prepare(`
    SELECT
      COUNT(*) as total_trades,
      SUM(CASE WHEN type = 'SELL' THEN 1 ELSE 0 END) as sells,
      SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) as wins,
      SUM(CASE WHEN pnl < 0 THEN 1 ELSE 0 END) as losses,
      SUM(pnl) as total_pnl,
      AVG(CASE WHEN pnl != 0 THEN pnl ELSE NULL END) as avg_pnl,
      MAX(pnl) as best_trade,
      MIN(pnl) as worst_trade,
      SUM(fee) as total_fees
    FROM training_trades WHERE run_id = ? AND type = 'SELL'
  `).get(runId);
}

// --- Training Equity ---
export function insertTrainingEquity(snapshot) {
  return getDb().prepare(`
    INSERT INTO training_equity (run_id, time, total_value, cash, holdings_value, open_positions, drawdown)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(snapshot.run_id, snapshot.time, snapshot.total_value, snapshot.cash,
         snapshot.holdings_value || 0, snapshot.open_positions || 0, snapshot.drawdown || 0);
}

export function insertTrainingEquityBatch(snapshots) {
  const stmt = getDb().prepare(`
    INSERT INTO training_equity (run_id, time, total_value, cash, holdings_value, open_positions, drawdown)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const insertMany = getDb().transaction((rows) => {
    for (const s of rows) {
      stmt.run(s.run_id, s.time, s.total_value, s.cash,
        s.holdings_value || 0, s.open_positions || 0, s.drawdown || 0);
    }
  });
  insertMany(snapshots);
}

export function getTrainingEquity(runId, limit = 2000) {
  return getDb().prepare(
    'SELECT * FROM training_equity WHERE run_id = ? ORDER BY time ASC LIMIT ?'
  ).all(runId, limit);
}

// --- Training ML Samples ---
export function insertTrainingMLSample(sample) {
  return getDb().prepare(`
    INSERT INTO training_ml_samples (run_id, ticker, time, features_json, label, label_value, strategy, regime)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(sample.run_id, sample.ticker, sample.time, sample.features_json,
         sample.label || null, sample.label_value || null, sample.strategy || '', sample.regime || '');
}

export function insertTrainingMLSamplesBatch(samples) {
  const stmt = getDb().prepare(`
    INSERT INTO training_ml_samples (run_id, ticker, time, features_json, label, label_value, strategy, regime)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertMany = getDb().transaction((rows) => {
    for (const s of rows) {
      const regimeStr = typeof s.regime === 'object' ? JSON.stringify(s.regime) : (s.regime || '');
      stmt.run(s.run_id, s.ticker, s.time, s.features_json,
        s.label || null, s.label_value || null, s.strategy || '', regimeStr);
    }
  });
  insertMany(samples);
}

export function getTrainingMLSamples(runId, limit = 5000) {
  return getDb().prepare(
    'SELECT * FROM training_ml_samples WHERE run_id = ? ORDER BY time ASC LIMIT ?'
  ).all(runId, limit);
}

export function getTrainingMLSampleCount(runId) {
  return getDb().prepare(
    'SELECT COUNT(*) as count FROM training_ml_samples WHERE run_id = ?'
  ).get(runId)?.count ?? 0;
}

// ============================================
// WALK-FORWARD VALIDATION TABLES
// ============================================

export function insertWalkForwardRun(run) {
  return getDb().prepare(`
    INSERT INTO walk_forward_runs (id, created_at, status, config_json, total_folds, completed_folds)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(run.id, run.created_at || Date.now(), run.status || 'pending',
         JSON.stringify(run.config || {}), run.total_folds || 0, run.completed_folds || 0);
}

// Allowlist of updatable columns (from the walk_forward_runs CREATE TABLE).
const WALK_FORWARD_RUN_COLUMNS = new Set([
  'status', 'config_json', 'total_folds', 'completed_folds',
  'aggregate_results_json', 'best_fold_id',
]);

export function updateWalkForwardRun(id, updates) {
  const fields = [];
  const values = [];
  for (const [key, val] of Object.entries(updates)) {
    const col = key.replace(/([A-Z])/g, '_$1').toLowerCase();
    if (!WALK_FORWARD_RUN_COLUMNS.has(col)) {
      throw new Error(`updateWalkForwardRun: invalid column '${col}'`);
    }
    fields.push(`${col} = ?`);
    values.push(typeof val === 'object' && val !== null ? JSON.stringify(val) : val);
  }
  values.push(id);
  return getDb().prepare(`UPDATE walk_forward_runs SET ${fields.join(', ')} WHERE id = ?`).run(...values);
}

export function getWalkForwardRun(id) {
  return getDb().prepare('SELECT * FROM walk_forward_runs WHERE id = ?').get(id);
}

export function getWalkForwardRuns(limit = 20) {
  return getDb().prepare(
    'SELECT * FROM walk_forward_runs ORDER BY created_at DESC LIMIT ?'
  ).all(limit);
}

export function insertWalkForwardFold(fold) {
  return getDb().prepare(`
    INSERT INTO walk_forward_folds (id, wf_run_id, fold_number, train_start, train_end, test_start, test_end, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(fold.id, fold.wf_run_id, fold.fold_number,
         fold.train_start, fold.train_end, fold.test_start, fold.test_end,
         fold.status || 'pending');
}

// Allowlist of updatable columns (from the walk_forward_folds CREATE TABLE).
const WALK_FORWARD_FOLD_COLUMNS = new Set([
  'wf_run_id', 'fold_number', 'train_start', 'train_end', 'test_start',
  'test_end', 'train_run_id', 'test_run_id', 'train_pnl', 'test_pnl',
  'train_trades', 'test_trades', 'train_win_rate', 'test_win_rate',
  'overfitting_ratio', 'learned_state_json', 'status',
]);

export function updateWalkForwardFold(id, updates) {
  const fields = [];
  const values = [];
  for (const [key, val] of Object.entries(updates)) {
    const col = key.replace(/([A-Z])/g, '_$1').toLowerCase();
    if (!WALK_FORWARD_FOLD_COLUMNS.has(col)) {
      throw new Error(`updateWalkForwardFold: invalid column '${col}'`);
    }
    fields.push(`${col} = ?`);
    values.push(typeof val === 'object' && val !== null ? JSON.stringify(val) : val);
  }
  values.push(id);
  return getDb().prepare(`UPDATE walk_forward_folds SET ${fields.join(', ')} WHERE id = ?`).run(...values);
}

export function getWalkForwardFolds(wfRunId) {
  return getDb().prepare(
    'SELECT * FROM walk_forward_folds WHERE wf_run_id = ? ORDER BY fold_number ASC'
  ).all(wfRunId);
}

export function getWalkForwardFold(id) {
  return getDb().prepare('SELECT * FROM walk_forward_folds WHERE id = ?').get(id);
}

export function getTrainingMLSamplesByTimeRange(runId, startTime, endTime) {
  return getDb().prepare(
    'SELECT * FROM training_ml_samples WHERE run_id = ? AND time >= ? AND time <= ? ORDER BY time ASC'
  ).all(runId, startTime, endTime);
}

// ============================================
// DCA Position CRUD
// ============================================

export function saveDCAPosition(sessionId, ticker, data) {
  return getDb().prepare(`
    INSERT INTO dca_positions (session_id, ticker, total_invested, total_quantity, avg_price, buy_count, last_buy_time, take_profit_price, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')
  `).run(sessionId, ticker, data.totalInvested || 0, data.totalQuantity || 0, data.avgPrice || 0, data.buyCount || 0, data.lastBuyTime || Date.now(), data.takeProfitPrice || 0);
}

export function getDCAPositions(sessionId) {
  return getDb().prepare(
    'SELECT * FROM dca_positions WHERE session_id = ? AND status = ?'
  ).all(sessionId, 'ACTIVE');
}

export function updateDCAPosition(id, data) {
  return getDb().prepare(`
    UPDATE dca_positions SET total_invested = ?, total_quantity = ?, avg_price = ?, buy_count = ?, last_buy_time = ?, take_profit_price = ?, updated_at = ?
    WHERE id = ?
  `).run(data.totalInvested, data.totalQuantity, data.avgPrice, data.buyCount, data.lastBuyTime || Date.now(), data.takeProfitPrice || 0, Date.now(), id);
}

export function closeDCAPosition(id) {
  return getDb().prepare(
    'UPDATE dca_positions SET status = ?, updated_at = ? WHERE id = ?'
  ).run('CLOSED', Date.now(), id);
}

// ============================================
// Grid Position CRUD
// ============================================

export function saveGridState(sessionId, ticker, data) {
  return getDb().prepare(`
    INSERT INTO grid_positions (session_id, ticker, grid_low, grid_high, grid_count, levels_json, filled_buys, filled_sells, total_pnl, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')
  `).run(sessionId, ticker, data.gridLow, data.gridHigh, data.gridCount || 5, JSON.stringify(data.levels || []), data.filledBuys || 0, data.filledSells || 0, data.totalPnl || 0);
}

export function getGridStates(sessionId) {
  return getDb().prepare(
    'SELECT * FROM grid_positions WHERE session_id = ? AND status = ?'
  ).all(sessionId, 'ACTIVE');
}

export function updateGridState(id, data) {
  return getDb().prepare(`
    UPDATE grid_positions SET filled_buys = ?, filled_sells = ?, total_pnl = ?, levels_json = ?, updated_at = ?
    WHERE id = ?
  `).run(data.filledBuys || 0, data.filledSells || 0, data.totalPnl || 0, JSON.stringify(data.levels || []), Date.now(), id);
}

export function closeGridState(id) {
  return getDb().prepare(
    'UPDATE grid_positions SET status = ?, updated_at = ? WHERE id = ?'
  ).run('CLOSED', Date.now(), id);
}

// ============================================
// Swing Position CRUD
// ============================================

export function saveSwingPosition(sessionId, ticker, data) {
  return getDb().prepare(`
    INSERT INTO swing_positions (session_id, ticker, entry_price, quantity, stop_loss, take_profit, highest_price, trailing_stop, confidence, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')
  `).run(sessionId, ticker, data.entryPrice, data.quantity || 0, data.stopLoss || 0, data.takeProfit || 0, data.highestPrice || data.entryPrice, data.trailingStop || 0, data.confidence || 0);
}

export function getSwingPositions(sessionId) {
  return getDb().prepare(
    'SELECT * FROM swing_positions WHERE session_id = ? AND status = ?'
  ).all(sessionId, 'ACTIVE');
}

export function updateSwingPosition(id, data) {
  return getDb().prepare(`
    UPDATE swing_positions SET highest_price = ?, trailing_stop = ?, stop_loss = ?, take_profit = ?, updated_at = ?
    WHERE id = ?
  `).run(data.highestPrice || 0, data.trailingStop || 0, data.stopLoss || 0, data.takeProfit || 0, Date.now(), id);
}

export function closeSwingPosition(id) {
  return getDb().prepare(
    'UPDATE swing_positions SET status = ?, updated_at = ? WHERE id = ?'
  ).run('CLOSED', Date.now(), id);
}

// ============================================
// Bulk close all active positions for session
// ============================================

export function closeAllPositionsForSession(sessionId) {
  const now = Date.now();
  getDb().prepare('UPDATE dca_positions SET status = ?, updated_at = ? WHERE session_id = ? AND status = ?').run('CLOSED', now, sessionId, 'ACTIVE');
  getDb().prepare('UPDATE grid_positions SET status = ?, updated_at = ? WHERE session_id = ? AND status = ?').run('CLOSED', now, sessionId, 'ACTIVE');
  getDb().prepare('UPDATE swing_positions SET status = ?, updated_at = ? WHERE session_id = ? AND status = ?').run('CLOSED', now, sessionId, 'ACTIVE');
}

// ============================================
// ML PIPELINE TABLES (4-Layer System)
// ============================================

// --- Genetic Genomes ---
export function insertGeneticGenome(genome) {
  return getDb().prepare(`
    INSERT OR REPLACE INTO genetic_genomes (genome_id, generation, genome_json, fitness, win_rate, trade_count, root_indicator, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(genome.genome_id, genome.generation || 0, genome.genome_json,
         genome.fitness || 0, genome.win_rate || 0, genome.trade_count || 0,
         genome.root_indicator || '', Date.now());
}

export function getGeneticGenomes(limit = 50) {
  return getDb().prepare(
    'SELECT * FROM genetic_genomes ORDER BY fitness DESC LIMIT ?'
  ).all(limit);
}

export function clearGeneticGenomes() {
  return getDb().prepare('DELETE FROM genetic_genomes').run();
}

export function insertGeneticEvolutionLog(log) {
  return getDb().prepare(`
    INSERT INTO genetic_evolution_log (generation, population_size, best_fitness, avg_fitness, best_genome_id, mutations, crossovers)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(log.generation, log.population_size || 0, log.best_fitness || 0,
         log.avg_fitness || 0, log.best_genome_id || '', log.mutations || 0, log.crossovers || 0);
}

// --- Adversarial Models ---
export function insertAdversarialModel(model) {
  return getDb().prepare(`
    INSERT INTO adversarial_models (model_type, role, sample_count, accuracy, last_trained_at, config_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(model.model_type || 'ensemble', model.role, model.sample_count || 0,
         model.accuracy || 0, model.last_trained_at || Date.now(),
         JSON.stringify(model.config || {}));
}

export function getLatestAdversarialModels() {
  return getDb().prepare(`
    SELECT * FROM adversarial_models ORDER BY created_at DESC LIMIT 2
  `).all();
}

// --- Portfolio Correlation Snapshots ---
export function insertCorrelationSnapshot(snapshot) {
  return getDb().prepare(`
    INSERT INTO portfolio_correlation_snapshots (matrix_json, ticker_list, avg_correlation, hhi, effective_positions)
    VALUES (?, ?, ?, ?, ?)
  `).run(JSON.stringify(snapshot.matrix), snapshot.ticker_list,
         snapshot.avg_correlation || 0, snapshot.hhi || 0, snapshot.effective_positions || 0);
}

export function getLatestCorrelationSnapshot() {
  return getDb().prepare(
    'SELECT * FROM portfolio_correlation_snapshots ORDER BY created_at DESC LIMIT 1'
  ).get();
}

// --- ML Gatekeeper Log ---
export function insertGatekeeperDecision(decision) {
  return getDb().prepare(`
    INSERT INTO ml_gatekeeper_log (ticker, decision, ml_confidence, tier, rule_strategy, rule_strength, adversarial_consensus, correlation_multiplier, final_size_multiplier, reason)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(decision.ticker, decision.decision, decision.ml_confidence || 0,
         decision.tier || '', decision.rule_strategy || '', decision.rule_strength || 0,
         decision.adversarial_consensus || '', decision.correlation_multiplier || 1,
         decision.final_size_multiplier || 1, decision.reason || '');
}

export function resolveGatekeeperDecision(id, actualOutcome, wasCorrect) {
  return getDb().prepare(
    'UPDATE ml_gatekeeper_log SET actual_outcome = ?, was_correct = ? WHERE id = ?'
  ).run(actualOutcome, wasCorrect ? 1 : 0, id);
}

export function getGatekeeperStats(limit = 200) {
  return getDb().prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN decision = 'PROCEED' THEN 1 ELSE 0 END) as allowed,
      SUM(CASE WHEN decision = 'BLOCK' THEN 1 ELSE 0 END) as blocked,
      SUM(CASE WHEN was_correct = 1 THEN 1 ELSE 0 END) as correct,
      SUM(CASE WHEN was_correct = 0 THEN 1 ELSE 0 END) as incorrect,
      AVG(ml_confidence) as avg_confidence,
      ROUND(CAST(SUM(CASE WHEN was_correct = 1 THEN 1 ELSE 0 END) AS REAL) / NULLIF(COUNT(CASE WHEN was_correct IS NOT NULL THEN 1 END), 0) * 100, 2) as accuracy_pct
    FROM (SELECT * FROM ml_gatekeeper_log ORDER BY created_at DESC LIMIT ?)
  `).get(limit);
}

export function getRecentGatekeeperDecisions(limit = 100) {
  return getDb().prepare(
    'SELECT * FROM ml_gatekeeper_log ORDER BY created_at DESC LIMIT ?'
  ).all(limit);
}

// ============================================
// EXECUTION METRICS
// ============================================

export function insertExecutionMetric(metric) {
  return getDb().prepare(`
    INSERT INTO execution_metrics (ticker, side, estimated_slippage, actual_slippage, fill_rate, execution_time_ms, order_type, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(metric.ticker, metric.side, metric.estimated_slippage || 0,
         metric.actual_slippage || 0, metric.fill_rate || 1, metric.execution_time_ms || 0,
         metric.order_type || 'MARKET', metric.timestamp || Date.now());
}

export function getExecutionMetrics(ticker = null, limit = 100) {
  if (ticker) {
    return getDb().prepare(
      'SELECT * FROM execution_metrics WHERE ticker = ? ORDER BY timestamp DESC LIMIT ?'
    ).all(ticker, limit);
  }
  return getDb().prepare(
    'SELECT * FROM execution_metrics ORDER BY timestamp DESC LIMIT ?'
  ).all(limit);
}

// ============================================
// ON-CHAIN SNAPSHOTS
// ============================================

export function insertOnChainSnapshot(ticker, timestamp, dataJson) {
  return getDb().prepare(`
    INSERT OR REPLACE INTO onchain_snapshots (ticker, timestamp, data_json)
    VALUES (?, ?, ?)
  `).run(ticker, timestamp, dataJson);
}

export function getLatestOnChainSnapshot(ticker) {
  return getDb().prepare(
    'SELECT * FROM onchain_snapshots WHERE ticker = ? ORDER BY timestamp DESC LIMIT 1'
  ).get(ticker);
}

// ============================================
// MONTE CARLO RESULTS
// ============================================

export function insertMonteCarloResult(result) {
  return getDb().prepare(`
    INSERT INTO monte_carlo_results (session_id, n_simulations, sharpe_p5, sharpe_p50, sharpe_p95, drawdown_p5, drawdown_p50, drawdown_p95, return_p5, return_p50, return_p95, trade_count, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(result.session_id || '', result.n_simulations || 0,
         result.sharpe_p5 || 0, result.sharpe_p50 || 0, result.sharpe_p95 || 0,
         result.drawdown_p5 || 0, result.drawdown_p50 || 0, result.drawdown_p95 || 0,
         result.return_p5 || 0, result.return_p50 || 0, result.return_p95 || 0,
         result.trade_count || 0, Date.now());
}

export function getLatestMonteCarloResult() {
  return getDb().prepare(
    'SELECT * FROM monte_carlo_results ORDER BY created_at DESC LIMIT 1'
  ).get();
}

// ============================================
// DATABASE MAINTENANCE
// ============================================

/**
 * Run daily maintenance: cleanup old data, ANALYZE tables, vacuum
 */
export function runMaintenance() {
  try {
    const d = getDb();
    const ninetyDaysAgo = Date.now() - (90 * 24 * 60 * 60 * 1000); // Batch 5A: 30→90 days

    // Delete old candle_history >90 days
    const candleDeleted = d.prepare('DELETE FROM candle_history WHERE time < ?').run(ninetyDaysAgo).changes;

    // Cleanup other old data (90 days)
    const results = cleanupOldData(90);

    // Run ANALYZE for query planner optimization
    d.exec('ANALYZE');

    console.log(`[Database] Maintenance complete: ${candleDeleted} old candles deleted, ANALYZE run`, results);
    return { candleDeleted, ...results };
  } catch (e) {
    console.warn('[Database] Maintenance error:', e.message);
    return null;
  }
}

// ============================================
// KNOWN TICKERS (New Coin Detection)
// ============================================

export function upsertKnownTicker(ticker, metadata = null) {
  const now = Date.now();
  return getDb().prepare(`
    INSERT INTO known_tickers (ticker, first_seen, last_seen, listing_metadata)
    VALUES (@ticker, @now, @now, @metadata)
    ON CONFLICT(ticker) DO UPDATE SET last_seen = @now, is_active = 1
  `).run({ ticker, now, metadata: metadata ? JSON.stringify(metadata) : null });
}

export function getKnownTickers() {
  return getDb().prepare('SELECT * FROM known_tickers WHERE is_active = 1').all();
}

export function getNewTickersSince(timestamp) {
  return getDb().prepare('SELECT * FROM known_tickers WHERE first_seen > ?').all(timestamp);
}

// ============================================
// NEW COIN SIGNALS
// ============================================

export function insertNewCoinSignal(ticker, signalType, signalValue, metadata = null) {
  return getDb().prepare(`
    INSERT INTO new_coin_signals (ticker, timestamp, signal_type, signal_value, metadata)
    VALUES (?, ?, ?, ?, ?)
  `).run(ticker, Date.now(), signalType, signalValue, metadata ? JSON.stringify(metadata) : null);
}

export function getNewCoinSignals(ticker, limit = 50) {
  return getDb().prepare('SELECT * FROM new_coin_signals WHERE ticker = ? ORDER BY timestamp DESC LIMIT ?').all(ticker, limit);
}

// ============================================
// SYNTHETIC LABELING JOBS
// ============================================

export function createLabelingJob() {
  const result = getDb().prepare(`INSERT INTO synthetic_labeling_jobs (status, started_at) VALUES ('running', ?)`).run(Date.now());
  return result.lastInsertRowid;
}

// Allowlist of updatable columns (from the synthetic_labeling_jobs CREATE TABLE).
const LABELING_JOB_COLUMNS = new Set([
  'status', 'total_pairs', 'completed_pairs', 'total_samples',
  'started_at', 'completed_at', 'error',
]);

export function updateLabelingJob(id, updates) {
  const sets = [];
  const values = {};
  for (const [key, val] of Object.entries(updates)) {
    const snakeKey = key.replace(/[A-Z]/g, m => '_' + m.toLowerCase());
    if (!LABELING_JOB_COLUMNS.has(snakeKey)) {
      throw new Error(`updateLabelingJob: invalid column '${snakeKey}'`);
    }
    sets.push(`${snakeKey} = @${key}`);
    values[key] = val;
  }
  values.id = id;
  getDb().prepare(`UPDATE synthetic_labeling_jobs SET ${sets.join(', ')} WHERE id = @id`).run(values);
}

export function getLabelingJobStatus(id) {
  return getDb().prepare('SELECT * FROM synthetic_labeling_jobs WHERE id = ?').get(id);
}

export function getLatestLabelingJob() {
  return getDb().prepare('SELECT * FROM synthetic_labeling_jobs ORDER BY id DESC LIMIT 1').get();
}

// ============================================
// BULK ML FEATURE INSERTION
// ============================================

export function insertMLFeaturesBatch(samples) {
  const d = getDb();
  // H2: include regime column (see insertMLFeatures comment above).
  const insert = d.prepare(`
    INSERT INTO ml_features (ticker, timestamp, features_json, label, label_value, labeled_at, regime)
    VALUES (@ticker, @timestamp, @featuresJson, @label, @labelValue, @labeledAt, @regime)
  `);
  const batchInsert = d.transaction((rows) => {
    for (const row of rows) insert.run({ regime: null, ...row });
  });
  batchInsert(samples);
}
