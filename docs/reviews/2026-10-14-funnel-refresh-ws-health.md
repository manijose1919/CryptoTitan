# 2026-10-14 midday — Funnel refresh + WS health fields

## Soak (:3137)
- ~41812s suspend: V2 recovered via setInterval wake; watchdog **benign skip** (`recovery loop already in flight`). Bearish eval advanced without kick (interval wake). WS Dead→Connected, **no 1006**.
- mode=paper; open 0; cohort 0; BTC SIDEWAYS / rest DOWN; F&G ~48 Neutral.
- GUI `/` 200. Shorts off / DCA sim.
- Candle cache CAD10 4h: **0 gaps** (799 bars each, Jun 3→Oct 14).

## Funnel refresh (`edge-funnel-adx20-9045`)
Post-SU+ATR compressors (earlier90 → entryEligible **6**):

| Stage | earlier90 | oos45 |
|---|---|---|
| strongUp / atrBand | 326 | 132 |
| adxOk | 309 | 125 |
| timeGate | 127 | 59 |
| scoreOk | 16 | 11 |
| chaseOk | 14 | 8 |
| confirm / entryEligible | **6** | **3** |

TimeGate + score/conf remain the binding n compressors after regime/ATR (TimeGate-off and conf-tighten already failed promote). Autopsy unchanged: earlier drag = time_kill×2 + stop×1; OOS all trailing +$1.72.

## Scarcity refresh
earlier90 SU+ADX+ATR=315 vs oos45=125 — supply still asymmetric vs 60/60 (earlier60 band=114 vs oos60=214).

## Code
- `buildWsHealthSnapshot` + `/api/health` fields `wsLastConnectedAt`, `wsLastMessageAgeMs`.
- `closeWebSocket` now clears `latestPriceTimes` / `lastMessageTime` (stale-quote hygiene).

## Decision
No trading-config change. Locked stack; wait for STRONG_UP in-band fills.
