# 2026-10-04 — Confirm skip-bar after VM suspend (paper soak)

## What happened
- Promote package pending path first armed: `CONFIRM pending SOLUSD` on signal bar `2026-10-03T12:00:00Z`.
- VM suspended ~11.5h (`KrakenWS Dead for 41535s`); bot loop stalled (`stale=true`).
- On resume, loop advanced pending using the latest closed bar `2026-10-04T00:00:00Z` as confirm (skipped 16:00 and 20:00), then entered immediately:
  - `CONFIRM armed` → `CONFIRM entering` → paper fill SOLUSD @ $119.30.

## Correct T+2 path (backtest parity)
| Step | Bar | SOLUSD |
|---|---|---|
| Signal T | 2026-10-03 12:00 | o119.30 h119.83 l119.13 c119.69 |
| Confirm T+1 | 2026-10-03 16:00 | o119.69 c119.76 (bullish — would pass) |
| Enter T+2 open | 2026-10-03 20:00 | open **119.76** |

Live fill used post-resume market (~119.30) against a late “confirm”, not T+2 open.

## Fix
`advancePendingOnClosedBar` now requires the confirm bar time to equal `signalBarTime + barIntervalMs`.
- Earlier closed bar → wait
- Later closed bar (skipped window) → **drop** with reason `missed confirm bar`
- Exact T+1 → evaluate bullish_close as before

Wired `barIntervalMs` from `CANDLE_INTERVAL` (4h) into `entryQualityConfig()`.

## Soak notes
- Anomalous SOLUSD open from the skip-bar fill left running (not voided); tag as suspend artifact when it exits.
- Post-fix: a pending across suspend must log `CONFIRM drop … missed confirm bar`, not arm/enter.
- No stats baseline reset (correctness fix; no config loosen/tighten).
