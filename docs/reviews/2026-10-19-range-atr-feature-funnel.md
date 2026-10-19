# 2026-10-19 midday — Dual-watchdog kick; rangeATR isolate; feature/funnel refresh

## Soak
- `:3137` paper; open 0; pnl −$64.72; trades 6; cohort 0.
- Regimes: BTC SIDEWAYS, rest DOWN; F&G 51 Neutral.
- Suspend ~41988s / ~42005s: WS reconnect + **V2 + Bearish Watchdog kick**; brief `stale=true` then cleared.
- `V2_LIVE_CONFIRMED=no`; shorts/arb/staking off; DCA sim-only; GUI 200.

## Funnel (locked stack, static weights)
| Window | bars | SU | ADX | timeGate | scoreOk | chase | confirm | entryEligible |
|---|---|---|---|---|---|---|---|---|
| earlier90 | 4890 | 346 | 323 | 134 | 18 | 16 | 7 | **7** |
| oos45 | 2190 | 119 | 112 | 52 | 7 | 6 | 1 | **1** |

After STRONG_UP, **timeGate** then **score/conf** still dominate n-starve (ADX −23 earlier).

## Feature autopsy (earlier90 L vs oos45 W)
- BNB stop still the dollar drag (−$9.48) at **volume_ratio 0.16** / conf 0.653 (known; vol-floor already failed promote).
- Mean gaps are **not** actionable tighten levers (oosW volume even lower than earlierL mean; tc_value gap −10 on n=1 OOS).
- holdBars=0 trailing winners remain net+ (LINK/ADA) — do not blanket-block entry-bar trails.

## rangeATR isolate (locked stack, conf stays 0.65)
`anyPromote=false`.

| id | earlier n/PF/net | oos |
|---|---|---|
| paper_live | 7 / 0.466 / −$10.72 | 1 / +$1.81 |
| range_2.5 | same as live | same |
| range_2.0 | 5 / 0.628 / −$5.53 | 1 / +$1.81 |
| range_1.75 | 5 / 0.628 / −$5.53 | 1 / +$1.81 |

range≤2.0 drops 2 trades and lifts PF slightly but **keeps BNB stop** and fails n≥10 / earlier PF≥0.9 — **not promoted**.

## Code
- `scripts/edge-range-atr-locked-9045.ts` (new)
- Feature autopsy forces static weights + store-mirror best-effort

## Decision
No trading-config change. Keep locked stack; soak for STRONG_UP sample.
