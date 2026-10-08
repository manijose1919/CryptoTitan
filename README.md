# CryptoTitan

![Version](https://img.shields.io/badge/version-2.0-blue)
![Lineage](https://img.shields.io/badge/successor%20of-CryptoGod-lightgrey)
![CI](https://github.com/manijose1919/CryptoTitan/actions/workflows/ci.yml/badge.svg)
![License](https://img.shields.io/badge/license-Proprietary-red)
![Node](https://img.shields.io/badge/node-20%2B-green)
![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue)
![Mode](https://img.shields.io/badge/default-paper--only-blue)

**CryptoTitan is the official v2.0 continuation of [CryptoGod](https://github.com/manijose1919/cryptoGod).**  
CryptoGod is **discontinued** for further development; new work happens here.

Canadian-universe, paper-first cryptocurrency daytrading engine. It streams Kraken USD markets, scans a fixed ticker set, and manages simulated positions through a single Node process plus a React monitoring dashboard.

This codebase is a hard fork of the CryptoGod engine, retargeted for a **Canadian Kraken USD account**, with dual live interlock, adverse paper slippage, and gap-aware stop fills. It is **not** a proven profitable live system. The current configuration exists to gather a forward paper sample under conservative fills, not to trade real capital.

| | |
|---|---|
| **This repo (active)** | https://github.com/manijose1919/CryptoTitan |
| **CryptoGod (discontinued lineage)** | https://github.com/manijose1919/cryptoGod |
| **Historical CryptoGod docs** | [cryptoGod `docs/`](https://github.com/manijose1919/cryptoGod/tree/master/docs) |

## Risk notice

> This software can place orders on a live cryptocurrency exchange. When live mode is enabled it will buy and sell real assets with real money, automatically, without a human in the loop. Cryptocurrency trading can result in total loss of capital.
>
> Nothing in this repository is financial advice. Fee-aware replay under paper exit parity currently shows a **negative** Canadian-universe edge (see Evidence; OOS PF ≈ 0.50). That is not an edge. Paper profits, if they appear later, still do not predict live returns. The software is provided without warranty; see [`LICENSE`](LICENSE). You are solely responsible for anything it does with your money.

## Current operating posture

| Control | Value |
|---|---|
| Default / deployed mode | `V2_MODE=paper` |
| Live interlock | `V2_MODE=live` **and** `V2_LIVE_CONFIRMED=yes`; otherwise the engine stays **paper** |
| Universe | Ten Kraken USD pairs only: BTC, ETH, XRP, BNB, SOL, ADA, DOGE, LINK, DOT, AVAX |
| Regime gate | `STRONG_UP` only |
| Paper fills | 5 bps adverse slippage per side; gap-aware stop fills |
| Fees modelled | Kraken taker 0.26% per side (0.52% round-trip) |
| Trail arm floor | Unrealized gain ≥ 3× RT taker ≈ **1.56%** before trail activates |
| ML gatekeeper | **Off** (training path stores exit-time features; no leakage-free OOS skill) |
| Pairs / sniper / mean reversion | **Off** |
| Shorts / staking / arb | **Off**; DCA remains simulation-only |
| Runtime flag mutation | `POST /api/config/flag` requires `ADMIN_API_KEY` |

Do **not** set `V2_LIVE_CONFIRMED=yes` without an explicit human dual-confirmation and a pre-registered promotion rule that this sample has not met.

## Evidence (corrected replay)

Same-bar close fills were **not causal** and must not be used for promotion.

Fee-aware next-bar-open replay with **paper exit parity** (`STRATEGY_EXIT_CONFIGS.TREND` bar×tf timers + fee-floored trail), 5 bps/side, `STRONG_UP` only, 4h, CAD10, 0.52% RT taker, pessimistic bars — refreshed **2026-09-29**:

| Window | Trades | Net | Profit factor | Notes |
|---|---|---|---|---|
| Earlier 45d (2026-07-01 → 2026-08-15) | 13 | −$9.14 | 0.67 | WR 46% |
| OOS 45d (2026-08-15 → 2026-09-29) | 39 | −$74.23 | **0.50** | WR 54%; avg win ~$3.5 / avg loss ~$8.2 |
| Full 90d | 69 | −$117.35 | 0.53 | Under parity protocol |

Older near-breakeven windows (e.g. PF≈1.02 on 2026-09-09) predate exit/entry parity and must **not** be used for promotion.

Locked ablations under this protocol (exits 2026-09-29, entry/regime 2026-09-29) — including tighter score/confidence/volume, SL 1.2, longer time-kill, and deliberately loosening to `UP` — **all failed** the bar (OOS PF>1.1, net>0, earlier PF≥0.9). Adding `UP` made the earlier half much worse (PF 0.23).

Loss autopsy (2026-09-30): OOS drag is **stop_loss** (−$112, avgR≈−1, often holdBars=0), while trailing exits are net **positive**. ATR 2.5–4% band is the worst. Cap `MAX_ATR` at 2.5 lifts OOS to PF≈0.95 / −$3.59 but **fails** the earlier-half gate — not promoted.

Confirm-bar research (2026-10-01/02): T+2 entry after a confirmation bar. Fixed a pre-entry exit bug (`holdBars=-1`). **Paper promote (2026-10-03):** allow UP **with** MAX_ATR=2.5 + bullish_close confirm + chase + minATR≥1.5 — cleared robust 90/45 (earlier n=20 PF≈1.20 / OOS PF≈1.95) and 60/60. Wired into paper `tradeEngine` pending-confirm path. Bare allow_UP still fails — do not disable confirm while UP is allowed. See [`docs/reviews/2026-10-02-up-confirm-promote-candidate.md`](docs/reviews/2026-10-02-up-confirm-promote-candidate.md).

Soak (2026-10-03): first promote-package signal (SOLUSD) chase-rejected at closeLoc 0.89. Chase-threshold ablation under the package: 0.75–0.90 and chase-off all clear 90/45, but OOS is identical for 0.75–0.90 — **keep chase≤0.80**. See [`docs/reviews/2026-10-03-chase-threshold-soak.md`](docs/reviews/2026-10-03-chase-threshold-soak.md).

Soak (2026-10-04): VM suspend left a pending confirm that armed on a skipped bar and filled SOLUSD late. Pending confirm now drops if the T+1 bar is missed (`signal + barInterval`). See [`docs/reviews/2026-10-04-confirm-skip-bar-suspend.md`](docs/reviews/2026-10-04-confirm-skip-bar-suspend.md). Wall-clock loop watchdog kicks stale loops after suspend. minATR ablation under the package: keep 1.5 (1.0–1.5 identical on 90/45). See [`docs/reviews/2026-10-04-minatr-and-loop-watchdog.md`](docs/reviews/2026-10-04-minatr-and-loop-watchdog.md).

**ADX parity (2026-10-05):** paper `ADX≥20` was missing from promote-package backtests. With `minAdx=20`, that package **fails** robust 90/45 — keep paper ADX; treat prior clear as optimistic. See [`docs/reviews/2026-10-05-adx-parity-and-sol-exit.md`](docs/reviews/2026-10-05-adx-parity-and-sol-exit.md). **UP rolled back** to STRONG_UP-only after ADX20 stack search (UP trades are the drag; STRONG_UP+confirm PF-positive but n-starved). See [`docs/reviews/2026-10-05-adx20-stack-search.md`](docs/reviews/2026-10-05-adx20-stack-search.md). Follow-up (2026-10-06): MAX_ATR 2.6–2.8 and longer windows still fail n≥10 / earlier PF — keep MAX 2.5 / minATR 1.5. See [`docs/reviews/2026-10-06-strong-confirm-adx20-nstarve.md`](docs/reviews/2026-10-06-strong-confirm-adx20-nstarve.md).

**MOMENTUM ADX + confirm (2026-10-06):** MOMENTUM skipped the paper ADX gate and filled AVAXUSD while TREND was blocked (ADX 15.2). MOMENTUM now shares `ADX≥20` with TREND **and** pending-confirm (research: earlier flat, OOS PF/net up). Contaminated open AVAX — exclude from cohort. See [`docs/reviews/2026-10-06-momentum-adx-parity.md`](docs/reviews/2026-10-06-momentum-adx-parity.md), [`docs/reviews/2026-10-06-momentum-confirm-parity.md`](docs/reviews/2026-10-06-momentum-confirm-parity.md).

**2026-10-07:** Feature probes under that stack still fail promote (earlier n/PF); chase≤0.75 closest (PF 0.89). Fear & Greed now wall-clock refreshes after VM suspend. Contaminated AVAX MOMENTUM exited trailing **−$12.99** — excluded from cohort KPIs. BREAKOUT now shares ADX≥20. See [`docs/reviews/2026-10-07-avax-contaminated-exit.md`](docs/reviews/2026-10-07-avax-contaminated-exit.md), [`docs/reviews/2026-10-07-adx20-confirmmom-features.md`](docs/reviews/2026-10-07-adx20-confirmmom-features.md).

**2026-10-08:** Filter funnel under ADX20+confirm — after STRONG_UP, **timeGate** then **score/conf** dominate n-starve (ADX only −14). Overnight TimeGate unblock clears 90/45 but **fails 60/60** (earlier n=6) — **not promoted**; keep overnight blocks. Score/conf coherence: `MIN_CONFIDENCE=0.65` binds (score60 + TimeGate boost dead letters); conf→0.60 recovers n≥10 but earlier PF~0.47 — **not promoted**. See [`docs/reviews/2026-10-08-filter-funnel-adx20.md`](docs/reviews/2026-10-08-filter-funnel-adx20.md), [`docs/reviews/2026-10-08-timegate-overnight-stress.md`](docs/reviews/2026-10-08-timegate-overnight-stress.md), [`docs/reviews/2026-10-08-score-conf-coherence.md`](docs/reviews/2026-10-08-score-conf-coherence.md).

**Decision:** stay paper-only. Do not cherry-pick tickers. Do not enable UP without confirm. Stats baseline reset on `:3137` when this package was deployed.

Older CryptoGod figures (mid-cap universes, same-bar fills, enabled MR/sniper) are **not** transferable to this fork.

## Architecture

```mermaid
flowchart TD
    KWS[Kraken WebSocket v2] --> CM[Candle Manager]
    CM --> MS[Market Scanner]
    MS --> SG[Signal Generator]
    SG --> RG[Risk Gate]
    FG[Fear and Greed Gate] --> RG
    RG --> EX[Paper executor]
    EX --> EM[Exit Manager]
    EM --> DB[(SQLite WAL)]
    EX --> DB
    DB --> API[Express API]
    API --> UI[React Dashboard]
    API --> MON[/monitor read-only/]
    EX --> TG[Telegram Alerts]
```

The ML gatekeeper is present in the tree but **not** in the live decision path while `ML_GATEKEEPER_ENABLED` is false.

### Loop

The main loop lives in `v2/engine/tradeEngine.ts`:

1. **Scan** — `v2/pipeline/marketScanner.ts` walks `V2_CONFIG.SCAN_TICKERS`. Tickers fail for volume, spread, candle count, ATR band, or a regime outside `ALLOWED_REGIMES` (`STRONG_UP`).
2. **Signal** — `v2/pipeline/signalGenerator.ts` (plus momentum routed through the same TREND pipeline).
3. **Risk gate** — `v2/pipeline/riskGate.ts`. Fear & Greed can veto. The ML gatekeeper is skipped.
4. **Execute** — `v2/pipeline/executor.ts`. Paper mode simulates fills against live prices with adverse slippage. Real Kraken orders require the dual live interlock.
5. **Exit** — `v2/pipeline/exitManager.ts`: take profit, stop, break-even, trail, time kill. Closed trades land in `v2_trades`.

### Strategy engines

| Engine | State | Reason |
|---|---|---|
| TREND (4h long-only) | **On** | Canadian USD universe, `STRONG_UP` only |
| Momentum | **On** (signals into TREND) | Same ticker/regime constraints |
| Mean reversion | **Off** | No positive fee-aware OOS on this universe |
| Sniper | **Off** | Dynamic listings can leave the CAD allowlist; no reproducible history |
| Pairs (FIL/ICP) | **Off** (`PAIRS_MODE=off`) | Unsupported CAD pair set |
| Shorts / staking / arb | **Off** | Prior negative or unvalidated; staking must not hit a real API in paper |
| Breakout | **Off** | Historical 180d: 28% WR, negative net |
| Dual-exchange A/B | **Off** | Env-gated |

## Canadian market constraints

- Trade **USD** pairs only (`BTCUSD`, never `BTCUSDT` / `USDC`).
- Allowed bases: BTC, ETH, XRP, BNB, SOL, ADA, DOGE, LINK, DOT, AVAX.
- Main engine is **long-only**. Shorts stay disabled until a separate, leakage-free validation exists.

## Tech stack

| Layer | Choice |
|---|---|
| Runtime | Node 20+ with `--experimental-strip-types` (no server transpile) |
| Language | TypeScript 5.7, `strict: true` |
| Server | Express 4; `ws` for Kraken WebSocket v2 |
| Persistence | SQLite via `better-sqlite3`, WAL, `data/trading.db` |
| ML (offline only) | TensorFlow.js train / `onnxruntime-node` infer — **not** used as an entry gate |
| Frontend | React 18, React Router 7, Zustand, TanStack Query, Recharts, TailwindCSS |
| Build / test | Vite 6, Vitest 4, ESLint |
| Process | PM2 (`ecosystem.config.cjs`, fork, process `canuck-node`) |

## Quickstart (paper)

Prerequisites: Node.js 20+.

```bash
git clone https://github.com/manijose1919/CryptoTitan.git
cd CryptoTitan
npm install

cp .env.example .env
# Keep V2_MODE=paper and V2_LIVE_CONFIRMED=no
npm run dev                 # backend :3033 + Vite :3000
```

Use `http://localhost:3000` in the browser (Vite proxies `/api`). Read-only monitor: `http://localhost:3033/monitor`.

```bash
npm start          # backend only
npm run build      # production frontend into dist/
npm test           # vitest run
npm run typecheck  # tsc --noEmit
npm run lint       # eslint (repo-wide still has pre-existing errors; CI uses typecheck + build + test)
```

Unconfirmed live (`V2_MODE=live` without `V2_LIVE_CONFIRMED=yes`) boots **paper**. That is intentional.

## Configuration

| Variable | Required for paper | Effect |
|---|---|---|
| `V2_MODE` | yes (`paper`) | `shadow` / `paper` / requested `live` |
| `V2_LIVE_CONFIRMED` | keep `no` | Must be `yes` **and** `V2_MODE=live` for real orders |
| `V2_BUDGET` | optional | Starting paper budget (default 1000) |
| `PAIRS_MODE` | `off` | FIL/ICP pairs engine |
| `KRAKEN_API_KEY` / `KRAKEN_SECRET` | market data; not for paper fills | Private keys never belong in git |
| `ADMIN_API_KEY` | recommended | Protects runtime flag mutation |
| `TELEGRAM_*` | optional | Alerts |
| `VPS_HOST` | only for deploy scripts | Scripts refuse to run if unset |

Full template: [`.env.example`](.env.example). Tunables: [`v2/engine/config.ts`](v2/engine/config.ts). PM2: [`ecosystem.config.cjs`](ecosystem.config.cjs).

## Project layout

```
serverV2.ts            Process entry — SQLite, Telegram, pollers, Kraken WS, V2 boot, HTTP
ecosystem.config.cjs   PM2: canuck-node, paper, PAIRS_MODE=off

v2/                    Trading engine
  engine/              Loop, candles, positions, config, live interlock, paper accounting
  pipeline/            Scanner, signals, risk, executor, exits
  exchange/            Kraken / Crypto.com adapters
  backtest/            Next-bar-open fills + slippage (do not use same-bar scripts for promotion)
  pairs/               Disabled cointegration engine
  dashboard/           V2 API + /monitor summary

services/              Backend .js and frontend .ts
components/            React dashboard
public/monitor.html    Standalone read-only page
tests/                 Vitest
docs/                  Architecture, specs, plans, reviews
CHANGELOG.md           Bidirectional ship record
```

## Operations

- Material trading-config changes belong in [`CHANGELOG.md`](CHANGELOG.md) and, on a real VPS deploy, may require a `stats_baseline_time` reset (see [`CLAUDE.md`](CLAUDE.md)). **This paper-hardening branch has not been deployed; do not reset yet.**
- Where a `vps` remote exists, `bash scripts/push-deploy.sh` pushes GitHub and the deploy remote together. CryptoTitan may not have a VPS remote until one is provisioned.
- Promotion to live requires, at minimum: leakage-free OOS expectancy after fees and slippage, a pre-registered rule, dual env confirmation, and a human sign-off. This README does not grant that sign-off.

## Documentation

- [`docs/README.md`](docs/README.md) — index of specs, plans, reviews, runbooks
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — boot sequence, modules, persistence, deploy
- [`CHANGELOG.md`](CHANGELOG.md) — what shipped and what to monitor
- [`CLAUDE.md`](CLAUDE.md) — engineering and operational rules
- [CryptoGod docs (historical)](https://github.com/manijose1919/cryptoGod/tree/master/docs) — discontinued predecessor audit trail

## License

Proprietary — all rights reserved. See [`LICENSE`](LICENSE). Viewing and evaluation only; no permission to use, copy, modify, or distribute without written consent.
