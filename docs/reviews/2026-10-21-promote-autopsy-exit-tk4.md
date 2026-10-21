# 2026-10-21 midday — Promote autopsy + timeKillBars 4 promote

## Soak
- `:3137` paper; open 0; pre-promote pnl −$64.72 / 6 trades (excluded via baseline reset).
- ~41945s VM suspend: dual Watchdog kick + Kraken WS Dead→reconnect; `V2_LIVE_CONFIRMED=no`; GUI 200.
- Regimes: BTC/BNB UP (blocked — STRONG_UP-only); rest SIDEWAYS/DOWN; F&G ~58 Neutral.
- Fixed missed `stats_baseline_time` → promote restart epoch (cohort 0).

## Autopsy (promote package, static weights)
Overnight **entry** hours 0–7 are **not** the drag (earlier90 overnight n=3 WR100% +$16.41).  
Earlier drag is **time_kill** (earlier90 n=5 WR20% −$10.87) vs trailing (n=12 WR83% +$36.98).  
Note: entry hour 20 in buckets is confirm-lag (signal typically hour 12), not a TimeGate miss.

| window | overnight pnl | time_kill pnl | trailing pnl |
|---|---|---|---|
| earlier90 | +$16.41 | −$10.87 | +$36.98 |
| oos45 | +$1.69 | −$1.38 | +$20.86 |
| earlier60 | +$6.20 | −$5.67 | +$15.19 |
| oos60 | −$3.18 | −$1.43 | +$24.16 |

## Exit ablations under promote stack
All tested knobs still dual-pass (paper already clears). Best lift: **timeKillBars 2→4**.

| id | 90/45 earlier PF/net | 90/45 OOS PF/net | 60/60 earlier PF/net | 60/60 OOS PF/net | Σ net |
|---|---|---|---|---|---|
| paper_live | 1.59 / +$16.62 | 1.73 / +$8.80 | 1.71 / +$9.52 | 1.67 / +$11.62 | +$46.56 |
| **tk_4** | **1.90 / +$25.85** | **2.38 / +$14.76** | **4.23 / +$25.20** | **2.11 / +$17.81** | **+$83.62** |
| tk_3 | 1.90 / +$25.85 | 1.52 / +$7.16 | 4.23 / +$25.20 | 1.52 / +$9.90 | +$68.11 |
| trail_gb_02 | 1.62 / +$17.41 | 1.75 / +$9.09 | 1.74 / +$9.91 | 1.69 / +$12.00 | +$48.41 |
| sl_atr_12 | 1.24 / +$8.54 | 2.04 / +$10.64 | 1.44 / +$7.08 | 1.87 / +$13.53 | +$39.79 |

tk_4 collapses earlier time_kills (5→1 / 3→0) into trailing; OOS improves vs paper and vs tk_3.

## Decision
**Promote** `STRATEGY_EXIT_CONFIGS.TREND.timeKillBars` 2→4 (1h override remains 4). Keep overnight unblock + conf0.60 + chase0.85. Do not tighten SL / conf from this autopsy.

## Code / artifacts
- `scripts/edge-promote-trade-autopsy-9045.ts` → `edge-promote-trade-autopsy-9045.json`
- `scripts/edge-exit-promote-stack-9045.ts` → `edge-exit-promote-stack-9045.json`
