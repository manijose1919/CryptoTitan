# 2026-10-20 — Confirm-mode ablation; scarcity asymmetry flip; artifact-write harden

## Soak
- `:3137` paper; open 0; pnl −$64.72; trades 6; cohort 0.
- Regimes: BTC/ETH DOWN; BNB/SOL/DOT SIDEWAYS; rest DOWN; F&G 51 Neutral.
- Suspend ~42375s: WS reconnect + dual Watchdog kick; recovered.
- `V2_LIVE_CONFIRMED=no`; shorts/arb/staking off; DCA sim-only; GUI 200.
- Paper scorecard still n=6 — keep research `static` weights.

## Locked baseline (static)
| Split | earlier | OOS | pass |
|---|---|---|---|
| 90/45 | n=7 WR43% −$10.72 PF0.466 | n=1 +$1.81 | **false** |
| 60/60 | n=4 WR75% +$3.90 PF1.718 | n=7 WR86% +$12.03 PF**3.452** | **false** (earlier n&lt;10) |

## Scarcity refresh
| Window | SU+ADX+ATR1.5–2.5 |
|---|---|
| earlier60 | **175** |
| oos60 | **161** |
| earlier90 | 328 |
| oos45 | 112 |

Calendar roll **flipped** the Oct-8/18 asymmetry (earlier was scarcer). earlier60 now has *more* in-band SU bars than oos60, yet locked earlier60 still n=4 — n-starve is **post-regime** (timeGate / score/conf / confirm), not only regime scarcity.

## Confirm-mode ablation (locked stack)
`anyPromote=false`. Stricter confirm vs paper `bullish_close`:

| mode | earlier n/PF/net | oos |
|---|---|---|
| bullish_close (paper) | 7 / 0.466 / −$10.72 | 1 / +$1.81 |
| close_above_signal | 6 / 0.455 / −$10.94 | 1 / +$1.81 |
| bullish_and_above | 6 / 0.455 / −$10.94 | 1 / +$1.81 |

Stricter confirm drops a winner, worsens earlier PF — **not promoted**. Keep `bullish_close`.

## Infra
- `/opt/cursor/artifacts` → store symlink currently unwritable (ENOENT).
- Added `scripts/researchArtifactWrite.ts`: always write `/tmp/cryptotitan-artifacts`, best-effort opt/store.

## Decision
No trading-config change. Keep locked stack + bullish_close confirm.
