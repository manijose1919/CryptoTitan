# 2026-10-20 midday — TimeGate re-test after scarcity flip

## Soak
- `:3137` paper; open 0; pnl −$64.72; trades 6; cohort 0.
- Regimes: mostly DOWN; BNB/DOT SIDEWAYS; AVAX STRONG_DOWN; F&G 50 Neutral.
- Suspend ~41922s: WS reconnect + V2 benign skip; `V2_LIVE_CONFIRMED=no`; GUI 200.

## Context
Overnight scarcity flip: earlier60 SU+ADX+ATR (175) ≥ oos60 (161). Re-ask whether TimeGate relax clears **both** 90/45 and 60/60 under locked stack.

## Results (static weights)

| variant | 90/45 earlier | 90/45 OOS | 90/45 | 60/60 earlier | 60/60 OOS | 60/60 |
|---|---|---|---|---|---|---|
| paper_live | n=7 PF0.47 −$10.72 | n=1 +$1.81 | fail | n=4 PF1.72 | n=7 PF3.45 | fail |
| **no_overnight** | n=15 PF**1.24** +$5.83 | n=4 WR100% +$18.40 | **pass\*** | n=**8** PF2.37 | n=12 PF1.93 | **fail (n)** |
| **timegate_off** | n=15 PF**1.24** +$5.83 | n=5 WR100% +$38.07 | **pass\*** | n=**8** PF2.37 | n=14 PF2.27 | **fail (n)** |

\*Pass after correcting research `meetsBar`: `pf=null` (all winners / Infinity) must count as clearing PF>1.1 — previously `(pf ?? 0) > 1.1` false-negatived all-win OOS.

## Interpretation
- Scarcity flip helped TimeGate-off packages clear **90/45** (earlier n=15 PF≥1.24).
- **60/60 earlier n=8** still binds (need ≥10) — same structural miss as 2026-10-08 overnight stress (n=6–9).
- `no_overnight` ≈ `timegate_off` on earlier; TG-off adds OOS trades only.
- **Do not promote** overnight unblock or TG-off — dual-split bar requires 60/60 earlier n≥10.

## Code
- `scripts/edge-timegate-scarcity-flip-9045.ts`
- `meetsBar` null-PF fix in this script + locked baseline

## Decision
No trading-config change. Keep paper TimeGate (incl. overnight blocks). Continue soak.
