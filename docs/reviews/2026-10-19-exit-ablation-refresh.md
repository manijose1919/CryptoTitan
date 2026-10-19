# 2026-10-19 — Locked baseline + exit-knob refresh (post-parity)

## Soak
- `:3137` paper; open 0; pnl −$64.72; trades 6; cohort 0.
- Regimes: BTC SIDEWAYS, rest DOWN; F&G 51 Neutral.
- Dual interlock OK (`V2_LIVE_CONFIRMED=no`); shorts/arb/staking off; DCA sim-only; GUI 200.
- Suspend recoveries: WS Dead→Connected + V2 benign skip (recovery loop in flight). No live paths.

## Locked baseline (static weights)
| Split | earlier | OOS | pass |
|---|---|---|---|
| 90/45 | n=7 WR43% −$10.72 PF0.466 | n=1 +$1.81 | **false** |
| 60/60 | n=4 WR75% +$3.90 PF1.717 | n=7 WR86% +$12.24 PF**3.477** | **false** (earlier n&lt;10) |

60/60 OOS strengthened vs 2026-10-18 (PF 1.56→3.48) but promote still blocked on earlier n.

## Autopsy (earlier90)
Unchanged structure vs 2026-10-16: time_kill×2 (−$5.18), stop×1 BNB (−$9.48), trailing×4 (+$3.95). OOS45: LINK trailing +$1.81.

## Exit ablations (static weights; same stack)
`anyPromote=false`. Longer time-kill / looser min-move **hurt** earlier PF. Tighter trail giveback (0.03→0.02) micro-lifts earlier PF 0.466→0.475 — not actionable. SL 1.5→1.2 worsens earlier (PF 0.32).

| id | earlier PF | earlier net | note |
|---|---|---|---|
| paper_live | 0.466 | −$10.72 | baseline |
| tk_3 / tk_4 | 0.352 | −$17.21 | worse |
| trail_gb_02 | 0.475 | −$10.53 | tiny; still fail n/PF |
| sl_atr_12 | 0.320 | −$19.84 | worse |

## Code hygiene
- `edge-exit-adx20-confirm-9045.ts` now forces `setSignalWeightMode('static')` + best-effort store mirror.

## Decision
No trading-config change. Keep locked exits; soak for STRONG_UP in-band sample.
