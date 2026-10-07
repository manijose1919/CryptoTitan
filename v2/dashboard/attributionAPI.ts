// ============================================
// Phoenix V2 Dashboard API
// Express router for /api/v2 routes
// ============================================

import { Router } from 'express';
import type { Request, Response } from 'express';

import { buildMonitorSummary } from './monitorSummary.ts';
import { filterCohortTrades } from './cohortScope.ts';
import { getOpenTrades, getClosedTrades, getSignalScores, getOpenTradesByStrategy, getClosedTradesByStrategy } from '../attribution/attributionStore.ts';
import { getScorecard } from '../attribution/signalScorecard.ts';
import { recomputeAllScores } from '../attribution/postTradeAnalyzer.ts';
import { getV2Status } from '../engine/tradeEngine.ts';
import { getDualStatus, getDualTrades, initDualEngine, startDualEngine, stopDualEngine } from '../engine/dualExchangeEngine.ts';
import { getBearishStatus, stopBearishServices, startBearishServices, initBearishServices } from '../engine/bearishServices.ts';
import { getSniperStatus, getKrakenSniperStatus, getCryptocomSniperStatus } from '../engine/sniperEngine.ts';
import { initKrakenAdapter, krakenV2 } from '../exchange/krakenAdapter.ts';
import { initCryptoComAdapter, cryptoComV2 } from '../exchange/cryptoComV2Adapter.ts';
import { getPairsStatus, forceClosePairsTrade } from '../pairs/pairsEngine.ts';
import { getDb } from '../../services/database.js';
// @ts-expect-error JS module without types
import { requireAdminAuth } from '../../middleware/adminAuth.js';

export const v2Router = Router();

// --- GET /status ---
v2Router.get('/status', (_req: Request, res: Response) => {
  try {
    const status = getV2Status();
    res.json(status);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// Map a raw v2_trades row to the subset of V2Trade fields buildMonitorSummary reads.
function mapTradeRow(r: Record<string, unknown>) {
  return {
    id: (r.id as string) ?? '',
    ticker: r.ticker as string,
    strategy: (r.strategy as string) ?? 'UNKNOWN',
    side: (r.side as string) ?? 'long',
    entryPrice: r.entry_price as number,
    exitPrice: (r.exit_price as number) ?? null,
    entryTime: r.entry_time as number,
    exitTime: (r.exit_time as number) ?? null,
    pnlNet: (r.pnl_net as number) ?? 0,
    exitReason: (r.exit_reason as string) ?? null,
    quantity: (r.quantity as number) ?? 0,
    initialStop: (r.initial_stop as number) ?? 0,
    positionSizeUsd: (r.position_size_usd as number) ?? 0,
    currentStop: (r.current_stop as number) ?? 0,
    takeProfitTarget: (r.take_profit_target as number) ?? 0,
  };
}

// --- GET /monitor/summary --- read-only composite for the monitoring GUI
v2Router.get('/monitor/summary', (_req: Request, res: Response) => {
  try {
    const status = getV2Status();
    const openTrades = getOpenTrades();

    const db = getDb();
    const baselineRow = db
      .prepare("SELECT value FROM settings WHERE key = 'stats_baseline_time'")
      .get() as { value?: string } | undefined;
    const rawBaseline = baselineRow?.value;
    const parsedBaseline = Number(rawBaseline);
    // Treat absent, NULL, empty and non-numeric alike: Number(null) and Number('')
    // are both 0 (finite), so Number.isFinite alone would silently report an
    // all-time cohort as "since baseline" with no warning shown.
    const baselineMissing =
      rawBaseline == null || rawBaseline === '' || !Number.isFinite(parsedBaseline);
    const baselineTs = baselineMissing ? 0 : parsedBaseline;

    const cols = "ticker, strategy, side, entry_price, exit_price, entry_time, exit_time, " +
      "pnl_net, exit_reason, quantity, initial_stop, position_size_usd, current_stop, take_profit_target ";

    // Main-pipeline cohort (TREND+MOMENTUM+BREAKOUT) — headline KPIs + equity.
    // Sniper/MR excluded. Contaminated soak IDs filtered in filterCohortTrades.
    const mainRows = db
      .prepare(
        "SELECT id, " + cols +
        "FROM v2_trades WHERE status = 'closed' AND strategy IN ('TREND','MOMENTUM','BREAKOUT') " +
        "AND entry_time >= @baselineTs ORDER BY exit_time DESC"
      )
      .all({ baselineTs }) as Record<string, unknown>[];
    const cohortClosedTrend = filterCohortTrades(mainRows.map(mapTradeRow) as any);

    // All-strategy recent closed — feeds the capped closed-trades table only.
    // LIMIT must stay in sync with RECENT_CLOSED_LIMIT in monitorSummary.ts.
    // Contaminated trades remain visible here for soak forensics.
    const recentRows = db
      .prepare(
        "SELECT id, " + cols +
        "FROM v2_trades WHERE status = 'closed' AND entry_time >= @baselineTs ORDER BY exit_time DESC LIMIT 25"
      )
      .all({ baselineTs }) as Record<string, unknown>[];
    const recentClosedAll = recentRows.map(mapTradeRow) as any;

    const summary = buildMonitorSummary({
      status, openTrades, cohortClosedTrend, recentClosedAll,
      baselineTs, baselineMissing, now: Date.now(),
    });
    res.json(summary);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// --- GET /trades --- DAY-TRADING ONLY (TREND + MOMENTUM)
// Sniper trades are returned by /api/v2/sniper/trades. Keeping these endpoints
// separate enforces the reporting contract: sniper P&L is never aggregated
// with day-trading P&L. Pass ?all=1 for backward compat with old callers.
v2Router.get('/trades', (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string, 10) || 50;
    if (req.query.all === '1') {
      const open = getOpenTrades();
      const closed = getClosedTrades(limit);
      res.json({ open, closed, includesSniper: true });
      return;
    }
    const openTrend = getOpenTradesByStrategy('TREND');
    const openMom = getOpenTradesByStrategy('MOMENTUM');
    const closedTrend = getClosedTradesByStrategy('TREND', limit);
    const closedMom = getClosedTradesByStrategy('MOMENTUM', limit);
    res.json({
      open: [...openTrend, ...openMom],
      closed: [...closedTrend, ...closedMom],
      strategies: ['TREND', 'MOMENTUM'],
    });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// --- GET /scorecard ---
v2Router.get('/scorecard', (_req: Request, res: Response) => {
  try {
    const scorecard = getScorecard();
    res.json(scorecard);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// --- GET /signal-scores ---
v2Router.get('/signal-scores', (_req: Request, res: Response) => {
  try {
    const scores = getSignalScores();
    res.json(scores);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// --- POST /recompute-scores ---
v2Router.post('/recompute-scores', requireAdminAuth, (_req: Request, res: Response) => {
  try {
    recomputeAllScores();
    const scorecard = getScorecard();
    res.json({ status: 'ok', scorecard });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// ============================================
// SNIPER endpoints (new-coin sniper, side-project, isolated stats)
// ============================================
// IMPORTANT: These endpoints return ONLY trades tagged strategy='SNIPER'.
// Reports must NEVER aggregate sniper P&L with TREND/MOMENTUM (day-trading).
// See CHANGELOG.md "Reporting Contract for Day-Trading vs Sniper" entry.

// Helper — compute scorecard for a given strategy tag (or set of tags)
function buildScorecard(tags: string[]): Record<string, unknown> {
  const open: ReturnType<typeof getOpenTradesByStrategy> = [];
  const closed: ReturnType<typeof getClosedTradesByStrategy> = [];
  for (const tag of tags) {
    open.push(...getOpenTradesByStrategy(tag));
    closed.push(...getClosedTradesByStrategy(tag, 1000));
  }
  if (closed.length === 0) {
    return { trades: 0, open: open.length, message: 'No closed trades yet — paper-only, accumulating data.' };
  }
  let wins = 0, totalWin = 0, totalLoss = 0, totalPnl = 0;
  for (const t of closed) {
    const pnl = t.pnlNet ?? 0;
    totalPnl += pnl;
    if (pnl > 0) { wins++; totalWin += pnl; }
    else { totalLoss += Math.abs(pnl); }
  }
  const wr = (wins / closed.length) * 100;
  const pf = totalLoss > 0 ? totalWin / totalLoss : (totalWin > 0 ? Infinity : 0);
  return {
    trades: closed.length,
    open: open.length,
    winRate: wr.toFixed(1),
    profitFactor: isFinite(pf) ? pf.toFixed(2) : 'inf',
    totalPnl: totalPnl.toFixed(2),
    avgWin: wins > 0 ? (totalWin / wins).toFixed(4) : '0',
    avgLoss: (closed.length - wins) > 0 ? (totalLoss / (closed.length - wins)).toFixed(4) : '0',
  };
}

// --- Combined sniper status (both exchanges) ---
v2Router.get('/sniper/status', (_req: Request, res: Response) => {
  try {
    res.json(getSniperStatus());
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// --- Per-exchange sniper status ---
v2Router.get('/sniper/kraken/status', (_req: Request, res: Response) => {
  try {
    res.json(getKrakenSniperStatus() ?? { error: 'kraken sniper not running' });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});
v2Router.get('/sniper/cryptocom/status', (_req: Request, res: Response) => {
  try {
    res.json(getCryptocomSniperStatus() ?? { error: 'cryptocom sniper not running' });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// --- Sniper trades (combined or per-exchange) ---
v2Router.get('/sniper/trades', (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string, 10) || 50;
    const exchange = req.query.exchange as string | undefined;
    const tags = exchange === 'kraken' ? ['SNIPER_KRAKEN']
      : exchange === 'cryptocom' ? ['SNIPER_CRYPTOCOM']
      : ['SNIPER_KRAKEN', 'SNIPER_CRYPTOCOM', 'SNIPER']; // 'SNIPER' covers any pre-dual legacy trades
    const open: ReturnType<typeof getOpenTradesByStrategy> = [];
    const closed: ReturnType<typeof getClosedTradesByStrategy> = [];
    for (const tag of tags) {
      open.push(...getOpenTradesByStrategy(tag));
      closed.push(...getClosedTradesByStrategy(tag, limit));
    }
    res.json({ open, closed });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// --- Sniper scorecards: combined + per-exchange ---
// Reports must produce TWO separate sections per exchange when possible.
v2Router.get('/sniper/scorecard', (_req: Request, res: Response) => {
  try {
    res.json({
      isolated: true,
      note: 'Sniper stats are isolated from TREND/MOMENTUM. Never aggregate.',
      kraken: buildScorecard(['SNIPER_KRAKEN']),
      cryptocom: buildScorecard(['SNIPER_CRYPTOCOM']),
      legacy: buildScorecard(['SNIPER']),  // any pre-dual-exchange sniper trades
    });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

v2Router.get('/sniper/kraken/scorecard', (_req: Request, res: Response) => {
  try {
    res.json({ isolated: true, ...buildScorecard(['SNIPER_KRAKEN']) });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

v2Router.get('/sniper/cryptocom/scorecard', (_req: Request, res: Response) => {
  try {
    res.json({ isolated: true, ...buildScorecard(['SNIPER_CRYPTOCOM']) });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// --- GET /dual/status --- Dual Exchange Competition Status
v2Router.get('/dual/status', (_req: Request, res: Response) => {
  try {
    const status = getDualStatus();
    res.json(status);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// --- GET /dual/trades/:exchange --- Trades for a specific exchange
v2Router.get('/dual/trades/:exchange', (req: Request, res: Response) => {
  try {
    const exchange = req.params.exchange;
    const trades = getDualTrades(exchange);
    res.json(trades);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// --- POST /dual/start --- Start dual engine via API
v2Router.post('/dual/start', requireAdminAuth, async (_req: Request, res: Response) => {
  try {
    await Promise.all([initKrakenAdapter(), initCryptoComAdapter()]);
    initDualEngine(krakenV2, cryptoComV2);
    startDualEngine();
    res.json({ status: 'started', message: 'Kraken vs Crypto.com competition running (paper mode)' });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// --- POST /dual/stop --- Stop dual engine
v2Router.post('/dual/stop', requireAdminAuth, (_req: Request, res: Response) => {
  try {
    stopDualEngine();
    const status = getDualStatus();
    res.json({ status: 'stopped', finalStatus: status });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// --- Bearish Services ---

v2Router.get('/bearish/status', (_req: Request, res: Response) => {
  try {
    const status = getBearishStatus();
    res.json(status);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

v2Router.post('/bearish/stop', requireAdminAuth, (_req: Request, res: Response) => {
  try {
    stopBearishServices();
    res.json({ status: 'stopped' });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

v2Router.post('/bearish/start', requireAdminAuth, async (_req: Request, res: Response) => {
  try {
    await initKrakenAdapter();
    initBearishServices(krakenV2);
    startBearishServices();
    res.json({ status: 'started' });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// --- Pairs Trading ---

v2Router.get('/pairs/status', (_req: Request, res: Response) => {
  try {
    const status = getPairsStatus();
    res.json(status);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// Recent pairs trades (closed + open).
v2Router.get('/pairs/trades', (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(String(req.query.limit ?? '50'), 10), 500);
    const status = String(req.query.status ?? 'all');
    let sql = `SELECT * FROM v2_pairs_trades`;
    const args: unknown[] = [];
    if (status === 'open' || status === 'closed') {
      sql += ` WHERE status = ?`;
      args.push(status);
    }
    sql += ` ORDER BY entry_time DESC LIMIT ?`;
    args.push(limit);
    const rows = getDb().prepare(sql).all(...args);
    res.json({ count: rows.length, trades: rows });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// Recent state snapshots (z-score, β, adf drift). Default last 200.
v2Router.get('/pairs/state', (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(String(req.query.limit ?? '200'), 10), 2000);
    const rows = getDb().prepare(
      `SELECT * FROM v2_pairs_state ORDER BY loop_at DESC LIMIT ?`,
    ).all(limit);
    res.json({ count: rows.length, snapshots: rows });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// PnL summary (paper + live aggregated separately).
v2Router.get('/pairs/pnl', (_req: Request, res: Response) => {
  try {
    const rows = getDb().prepare(`
      SELECT mode,
             COUNT(*) as trades,
             SUM(CASE WHEN pnl_net > 0 THEN 1 ELSE 0 END) as wins,
             ROUND(SUM(pnl_net), 2) as total_pnl,
             ROUND(AVG(pnl_net), 3) as avg_pnl,
             ROUND(SUM(fees_paid), 2) as total_fees
      FROM v2_pairs_trades
      WHERE status = 'closed'
      GROUP BY mode
    `).all();
    res.json({ summary: rows });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// Force-close any currently open pairs trade. Confirmed via explicit body
// flag to prevent accidental fetches from triggering a real close.
// Admin-gated: closes positions (real money in live mode).
v2Router.post('/pairs/force-close', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    if (req.body?.confirm !== 'yes') {
      res.status(400).json({ error: 'confirmation required: body must include { "confirm": "yes" }' });
      return;
    }
    const reason = String(req.body?.reason ?? 'manual_force_close').slice(0, 100);
    const result = await forceClosePairsTrade(reason);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});

// Recent alerts (entry/exit/pause/drawdown/adf/margin/drift). Default 50.
v2Router.get('/pairs/alerts', (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(String(req.query.limit ?? '50'), 10), 500);
    const rows = getDb().prepare(
      `SELECT id, created_at, severity, kind, message, data_json
       FROM v2_pairs_alerts
       ORDER BY created_at DESC
       LIMIT ?`,
    ).all(limit);
    res.json({ count: rows.length, alerts: rows });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
  }
});
