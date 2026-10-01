# 2026-10-01 — Confirm-bar robust 90/45 + pre-entry exit fix (no promote)

## Bugs fixed
`confirmMode` pushed trades into `openTrades` before `entryBar`, and exit checks ran on the intervening bar → **holdBars=-1** stop-outs (seen on ADA in earlier90 autopsy). Fix: skip exits until `bar >= entryBar`; refund never-filled reservations at series end (`isPositionLiveOnBar`). Prior confirm-bar fill stats are superseded by the re-runs below.

## Robust 90/45 ablations
Protocol: 90d earlier / 45d OOS; bar = OOS PF>1.1 & net>0 & earlier PF≥0.9 & **earlier n≥10**.
Runner: `scripts/edge-confirm-robust-9045.ts`.

| Ablation | Earlier n | Earlier PF | OOS PF | OOS net | Pass |
|---|---|---|---|---|---|
| baseline MAX8 | 29 | 0.510 | 0.484 | −$76.29 | no |
| fragile stack (MAX2.5+bullish+chase) | 8 | 0.668 | 3.742 | +$29.90 | no (n&PF) |
| strong confirm (bullish_and_above) | 8 | 0.668 | 3.742 | +$29.90 | no (identical set) |
| + minATR%≥1.5 | 6 | **1.247** | 2.595 | +$17.33 | no (n=6) |
| atr band [1.5,2.5] | 6 | 1.247 | 2.595 | +$17.33 | no |
| MAX3.0 + bullish + chase | 8 | 0.668 | 1.053 | +$2.03 | no |
| strong + minATR | 6 | 1.247 | 2.595 | +$17.33 | no |

**anyPromote = false.**

### Earlier90 autopsy (fragile stack, post-fix)
- time_kill 3 / −$7.41; stop_loss 1 / −$6.94; trailing 4 / +$7.79
- No holdBars&lt;0 after fix. Remaining drag is fee-bleed time_kills + one mid-hold stop.

## Re-validated confirm windows (post-fix)
- 45/45 stack still numeric-pass (OOS PF 3.742 / +$29.90, earlier PF 1.428, **n=4**) — still fragile.
- Long-window: 90/45 **fail** (earlier PF 0.668); 60/60 barely pass (earlier PF 0.918, n=7).

## Decision
Do **not** promote to paper. Confirm+MAX_ATR stacks remain OOS-strong but cannot clear a non-fragile earlier window. Next research should target earlier time_kill / stop structure under confirm fills (exit knobs), or a different family — only if pre-registered. Paper `MAX_ATR_PERCENT` stays 8; no confirmMode in scanner.

## Paper soak
- `:3137` paper, open 0, trades 4, pnl −$52.60, no STRONG_UP, no new fills.
- Brief stale=true at cycle open; heartbeat recovered (loopCount/lastLoopAt advancing).
