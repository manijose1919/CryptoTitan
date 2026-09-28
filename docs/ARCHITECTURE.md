# Architecture

This document is for someone who is going to modify **CryptoTitan** (CryptoGod v2.0). It covers how
the process is run, what happens at boot, what each module in `v2/` is responsible for, how data moves
through the system, and how a change reaches a server. Runtime posture (paper-only, CAD ticker
allowlist, live interlock) is summarized in the [README](../README.md).

Predecessor (discontinued): [CryptoGod architecture](https://github.com/manijose1919/cryptoGod/blob/master/docs/ARCHITECTURE.md).

---

## Process model

The system is **one Node process**. There is no worker pool, no queue broker, and no separate
scheduler; the trading loop, the HTTP API and the WebSocket client all live in the same event loop.

It is managed by PM2 (`ecosystem.config.cjs`):

| Setting | Value |
|---|---|
| Process name | `canuck-node` |
| Script | `serverV2.ts` |
| Interpreter | `node` with `node_args: --experimental-strip-types` |
| Exec mode | `fork`, `instances: 1` |
| Port | `3033` |
| `V2_MODE` | `paper` |
| `PAIRS_MODE` | `off` |
| `max_memory_restart` | `2G` |

`fork` mode with a single instance is deliberate. The engine holds in-memory candle buffers and open
position state, and SQLite is opened by a single writer; running under `cluster` would duplicate the
trade loop and corrupt attribution.

### Running TypeScript without a build step

`--experimental-strip-types` lets Node execute `.ts` files directly by erasing type annotations at
load time. It does not perform type checking and it does not resolve extensions the way a bundler
would, which has two consequences you will run into immediately:

1. **Every relative import inside `v2/` must carry an explicit `.ts` extension** — for example
   `import { V2_CONFIG } from './engine/config.ts'`. Node resolves the specifier literally; omit the
   extension and the import fails at runtime.
2. **`tsconfig.json` sets `"allowImportingTsExtensions": true`** so that `tsc --noEmit` accepts those
   specifiers rather than flagging them. This is only legal alongside `"noEmit": true`, which is why
   type checking is a separate command and the server is never compiled.

Type safety is therefore enforced by `npx tsc --noEmit` in CI, not by the runtime. A type error will
not stop the server from starting.

The frontend is different: it *is* built, by Vite, into `dist/`.

---

## Boot sequence

`serverV2.ts` exposes a single `start()` function whose stages are numbered in the source. Order
matters — each stage is a prerequisite of the next.

1. **Database** — `initializeDatabase()` opens `data/trading.db` and applies the schema. Everything
   downstream assumes the tables exist.
2. **Telegram** — `initTelegram()`. Brought up early so that failures in later stages can be alerted.
3. **On-chain pollers** — derivatives intelligence and whale-flow tracking start polling. These are
   optional dynamic imports; if the module is absent the poller is silently skipped.
4. **Fear & Greed gate** — `await initFearGreedGate()`. Awaited, and placed after stage 3 on purpose:
   the gate reads the on-chain modules and would otherwise initialise against empty data.
5. **Kraken WebSocket** — `initKrakenWS(V2_TICKERS, …)` subscribes and begins filling candle buffers.
   This is fire-and-forget; the engine tolerates cold buffers and simply rejects scans until enough
   candles have accumulated (`MIN_CANDLES`).
6. **ML pipeline** — `await initML()`. Loads the prediction service and, if a trained model exists,
   the gatekeeper. When no model has been trained the gatekeeper stays disabled and the risk gate
   proceeds without it, which is the intended degraded mode rather than a failure.
7. **V2 engine** — `await bootV2(budget)`, where `budget` is `process.env.V2_BUDGET` defaulting to
   `1000`. This is where each strategy engine is conditionally started; see below.
8. **HTTP listen** — the Express app binds to `PORT` (3033) and a Telegram start-up alert is sent.

`bootV2()` (in `v2/index.ts`) wraps each optional engine in its own `try/catch`. A strategy engine
that fails to start logs a warning and the rest of the system continues — a mean-reversion boot
failure must not take the main TREND loop down with it.

Shutdown is graceful: the handler stops each engine before closing the HTTP server.

---

## The V2 engine, module by module

### `v2/engine/`

The stateful core.

- **`tradeEngine.ts`** — the main loop. Owns the scan cadence, runs the TREND pipeline (with momentum
  as an in-line stage rather than a separate loop), and holds engine status that `/api/v2/status`
  reports.
- **`config.ts`** — every tunable parameter in one file. See *Configuration* below.
- **`candleManager.ts`** — in-memory OHLC buffers per ticker and timeframe, fed by the WebSocket
  stream and backfilled from REST.
- **`positionManager.ts`** — open-position bookkeeping, shared by the strategy engines.
- **`strategyRunner.ts`** — per-ticker strategy dispatch and the ADX gate that separates TREND from
  mean reversion.
- **`meanReversionEngine.ts`**, **`sniperEngine.ts`**, **`breakoutEngine.ts`**,
  **`momentumEngine.ts`** — engines with (or, for breakout and momentum, formerly with) their own
  loops. Breakout is not started. Momentum's separate loop is no longer used; the strategy runs
  inside the main pipeline.
- **`bearishServices.ts`** — shorts, staking, arbitrage and DCA, started as a group.
- **`dualExchangeEngine.ts`** — the A/B harness that runs identical signals against both exchange
  adapters to measure the fee differential. Off unless `DUAL_ENGINE=true`.

### `v2/pipeline/`

Stateless (or near-stateless) stages. Each takes an input and returns a decision, which is what makes
them straightforward to unit test.

- **`marketScanner.ts`** — volume, spread, candle-count, ATR-band and regime filtering. The rejection
  reasons it produces are what the ATR/regime analysis in `docs/reviews/` counted.
- **`signalGenerator.ts`** plus `momentumSignal.ts`, `meanReversionSignal.ts`, `sniperSignal.ts`,
  `breakoutSignal.ts`, `scalpSignal.ts` — candidate generation and scoring.
- **`riskGate.ts`** — position sizing and the final veto. Consumes the Fear & Greed gate and the ML
  gatekeeper.
- **`timeGate.ts`** — time-of-day and cooldown restrictions.
- **`executor.ts`** — order placement through an adapter.
- **`exitManager.ts`** plus the `*ExitManager.ts` variants — take profit, stop loss, break-even,
  trailing stop, time-based kill.
- **`types.ts`** — the shared shapes (`V2Mode`, signals, decisions) that tie the stages together.

### `v2/exchange/`

`krakenAdapter.ts` and `cryptoComV2Adapter.ts` implement the interface in `types.ts`. The pipeline
only ever talks to that interface, which is what makes paper mode a swap at the adapter boundary
rather than a set of `if (paper)` branches scattered through the engine.

### `v2/indicators/`

`indicators.ts` (shared math — RMA, ATR, ADX, RSI, MACD), `tcIndicator.ts` (the composite trend
indicator), `supportResistance.ts`, `trendDashboard.ts`. Pure functions; the natural place to add a
test when changing signal behaviour.

### `v2/attribution/`

`attributionStore.ts`, `postTradeAnalyzer.ts`, `signalScorecard.ts`. Records *why* each trade was
taken so that closed trades can later be sliced by regime, timeframe, ATR band or strategy. This is
the machinery that makes the evidence-based decisions in the README possible.

### `v2/backtest/`

`backtestEngine.ts`, `backtestReport.ts`, `candleCache.ts`, plus `canonical/` and `multiStrategy/`
sweep harnesses. Driven from `scripts/backtest-v2.ts` and `scripts/backtest-multi-strategy.ts`.

### `v2/pairs/`

A self-contained cointegration strategy: `cointegration.ts` and `statsImpl.ts` (ADF test, hedge-ratio
estimation), `pairsEngine.ts` (loop), `pairsExecutor.ts`, `pairsMonitor.ts`, `pairsAlerts.ts`,
`schema.ts` (its own tables), `smokeTest.ts`.

### `v2/dashboard/`

`attributionAPI.ts` is the Express `Router` mounted for all `/api/v2/*` endpoints.
`monitorSummary.ts` builds the payload for `GET /api/v2/monitor/summary` — a pure function so it can
be unit tested (`monitorSummary.test.ts`) without a running engine.

---

## Data flow

```
Kraken WS v2 tick
  → candleManager buffers (per ticker, per timeframe)
    → marketScanner            reject: volume / spread / candles / ATR band / regime
      → signalGenerator        emit candidate: score, confidence, side, timeframe
        → timeGate             reject: cooldown, time-of-day
        → riskGate             size the position; veto on Fear & Greed or ML gatekeeper
          → executor           adapter.placeOrder()  (simulated in paper mode)
            → positionManager  open position held in memory
              → exitManager    TP / SL / break-even / trailing / time kill
                → SQLite       v2_trades row written on close
                  → attributionAPI → React dashboard and /monitor
```

Two points worth internalising before changing anything:

- **Rejections are as important as fills.** The scanner's rejection reasons are surfaced on
  `/api/v2/status` and are frequently the only evidence available when the engine is not trading. A
  refactor that stops recording *why* a scan was rejected removes the ability to diagnose a drought.
- **The exit manager owns realised PnL.** Entry logic changes are cheap to reason about; exit logic
  changes silently redistribute results across the whole cohort.

---

## Persistence

SQLite through `better-sqlite3`, at `data/trading.db`, opened with `journal_mode = WAL` so that
reporting scripts can read while the engine writes. Access goes through `services/database.js`; there
is no ORM and queries are written directly.

The engine's own trade history lives in `v2_trades` (entry and exit prices, side, strategy, timeframe,
entry regime, ATR percent, gross and net PnL, exit reason). Almost every analysis in `docs/reviews/`
is a `GROUP BY` over that one table.

### `stats_baseline_time`

A row in the `settings` table holding an epoch-milliseconds timestamp. It is read in
`v2/dashboard/attributionAPI.ts` and used to scope reporting to the *current* configuration cohort:
primary statistics filter on `WHERE entry_time >= <baseline>`, and trades from before it are treated
as legacy background data.

The rule around it matters more than the mechanism. After a change that alters trade-level expected
outcomes — R:R, allowed regimes, the ticker set, exit timers, position sizing, a strategy being
enabled or disabled — the baseline is reset so that post-change performance cannot be flattered or
smeared by pre-change trades. It is deliberately *not* reset for bug fixes that restore intended
behaviour, for each of several small tweaks in a tuning sprint, or for behaviour-preserving changes.
Open positions from before a reset keep running on their original configuration and are tracked as
background data rather than force-closed. The engine's running `totalPnlNet` continues to aggregate
everything; only reports filter. See `CLAUDE.md` for the full rule.

---

## Configuration

### `v2/engine/config.ts`

The single source of tunable truth. It exports `V2_CONFIG` (mode, scan tickers, volume/ATR/spread
floors, allowed regimes, signal thresholds, fees, shorts toggle), `MOMENTUM_CONFIG`, `MR_CONFIG`,
`SNIPER_CONFIG`, `PAIRS_CONFIG`, `DUAL_ENGINE_CONFIG`, `EXCHANGE_FEES`, `STRATEGY_TIMEFRAMES`,
`STRATEGY_EXIT_CONFIGS`, `STRATEGY_COOLDOWN_MS` and `ADX_THRESHOLDS`.

Values in this file carry dated inline comments recording the evidence behind them and, where
relevant, the rollback. Preserve that convention: a bare number in this file is much harder to revisit
six weeks later than a number with the sample size that justified it.

### Environment variables

| Variable | Read by | Effect |
|---|---|---|
| `V2_MODE` | `V2_CONFIG.MODE` | `shadow` (default when unset), `paper` (deployed), or a live request |
| `V2_LIVE_CONFIRMED` | `resolveV2Mode()` | Must equal `yes` in addition to `V2_MODE=live`; otherwise mode is downgraded to paper |
| `V2_BUDGET` | `serverV2.ts` | Starting budget passed to `bootV2()`; defaults to `1000` |
| `PAIRS_MODE` | `PAIRS_CONFIG.MODE` | `off` (deployed default), `paper`, `live` |
| `PAIRS_LIVE_CONFIRMED` | pairs deployment protocol | Second required confirmation for live pairs trading |
| `DUAL_ENGINE` | `DUAL_ENGINE_CONFIG.ENABLED` | `true` starts the Kraken-vs-Crypto.com A/B harness |
| `PORT` | `serverV2.ts` | HTTP port, `3033` in the PM2 config |
| `VPS_HOST` | `monitor.sh`, `scripts/push-deploy.sh`, `deploy/deploy.ps1` | Deployment target; the scripts refuse to run when it is unset |

`ecosystem.config.cjs` sets `V2_MODE` and `PAIRS_MODE` explicitly, so the deployed process never
inherits a default for either.

**Live safety interlocks.** Main-engine live trading requires *two* independent settings:
`V2_MODE=live` and `V2_LIVE_CONFIRMED=yes`. Pairs trading follows the same pattern and requires
`PAIRS_MODE=live` and `PAIRS_LIVE_CONFIRMED=yes`. With only the first, the mode is downgraded to
paper. This is intentional friction — a single mistyped environment variable or a copied PM2 config
should not be able to move a strategy from simulation to real margin orders. The deployment protocol
(`docs/plans/2026-05-26-pairs-deployment-plan.md`, `docs/runbooks/pairs-runbook.md`) requires 30 days
of paper data before that second flag is considered at all.

---

## Deployment

The repository has **two git remotes and they do different jobs**:

- **`origin`** — GitHub. The audit trail and backup. Pushing here changes nothing that is running.
- **`vps`** — a bare repository on the server. Its `post-receive` hook checks the working tree out,
  runs `npm install`, builds the frontend with `npx vite build`, and restarts the PM2 process.
  **This push is the deploy.**

Pushing only to `origin` is the most common way to believe a fix has shipped when it has not. Use the
script rather than two manual pushes:

```bash
export VPS_HOST=<host>          # or put it in .env.local
bash scripts/push-deploy.sh     # current branch
bash scripts/push-deploy.sh master
```

`scripts/push-deploy.sh` refuses to run with a dirty working tree, pushes to both remotes, waits for
`/api/v2/status` to come back online, and then compares the bare repository's `master` SHA against the
SHA it pushed — turning a partially failed deploy into a non-zero exit rather than a false success. It
detects whether it is running on the server itself (local bare-repo path) or remotely (over SSH to
`$VPS_HOST`).

The server address is not committed. `VPS_HOST` must be exported or present in `.env.local`;
`monitor.sh`, `scripts/push-deploy.sh` and `deploy/deploy.ps1` all fail immediately with an explicit
message when it is missing.

`monitor.sh` runs on a cron and emails on: an unreachable health endpoint, `isRunning=false`, memory
above 500 MB, a loop taking longer than 60 s, a loop counter that has stopped advancing, an untrained
ML engine, and an unexpected restart. Repeat alerts for the same condition are suppressed for 15
minutes.

`CHANGELOG.md` is the handoff record between whoever is working locally and whoever is working on the
server. Material changes get an entry describing the commits, the files, the reasoning, and what to
watch afterwards; read the recent entries before assuming your local checkout matches what is running.

---

## Known constraints

These are not incidental — they shape what strategies can look like.

**USD pairs only.** The exchange accounts are Canadian, and USDT/USDC pairs are unavailable. Every
symbol is quoted in USD (`BTCUSD`, `ETHUSD`, `AKTUSD`); a `USDT` suffix anywhere in the codebase is a
bug. This also restricts the tradeable universe, which is why `SCAN_TICKERS` is a short, explicitly
curated list rather than a screen over everything.

**Kraken fees dominate small moves.** From `EXCHANGE_FEES` in `v2/engine/config.ts`:

| | Kraken | Crypto.com |
|---|---|---|
| Taker, per side | 0.26% | 0.075% |
| Maker, per side | 0.16% | 0.050% |
| Round trip, taker both sides | 0.52% | 0.15% |
| Round trip, maker in / taker out | 0.42% | 0.125% |

The last row is the number that matters in practice: entries can be placed as maker orders, but exits
go through a market sell, so the realistic round-trip cost on Kraken is 0.42%. Any profit target
below that is a guaranteed loss regardless of win rate, and this is the mechanism behind the
observation in `docs/reviews/2026-07-23-atr-floor-and-shorts-analysis.md` that ATR bands with a
win rate above 53% still netted approximately nothing. Fee awareness belongs in the gating logic, not
in the post-hoc PnL calculation.
