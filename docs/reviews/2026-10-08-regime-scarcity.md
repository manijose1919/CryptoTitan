# 2026-10-08 — Regime scarcity explains 60/60 n ceiling

## Soak
- `:3137` paper; open 0; cohort 0; risk-off (DOWN/STRONG_DOWN/SIDEWAYS).
- Watchdog kicked after ~10h suspend; WS reconnect + F&G refresh OK. No live paths.

## Question
Why do even aggressive entry packages (anchor + TimeGate off) stall at earlier60 n≈8–9?

## Counts (`edge-regime-scarcity-diag`, CAD10 4h ticker-bars)

| Window | bars | STRONG_UP | SU+ADX≥20 | SU+ADX+ATR1.5–2.5 | UP | UP+ADX≥20 |
|---|---|---|---|---|---|---|
| **earlier60** | 3110 | 255 | 227 | **121** | 639 | 380 |
| **oos60** | 3110 | 715 | 703 | **307** | 947 | 635 |
| earlier90 | 4430 | 569 | 538 | 277 | 937 | 559 |
| oos45 | 2210 | 384 | 376 | 150 | 697 | 440 |

## Interpretation
- earlier60 has **~2.5× fewer** STRONG_UP+ADX+ATR bars than oos60 (121 vs 307) before timeGate/score/confirm.
- That structural asymmetry — not only gate stacking — caps earlier60 trade count near the n≥10 bar.
- 90/45 can still pass (earlier90 has 277 SU+ADX+ATR) while 60/60 fails — matches overnight/anchor stress results.
- UP+ADX is plentiful in earlier60 (380) but UP+ADX promote already failed (2026-10-05) — do not re-add bare UP.

## Also shipped
- Unit test `v2/pipeline/timeGate.scoreBoost.test.ts` documenting scoreBoost dead letter under `MIN_CONFIDENCE=0.65`.
- Comment on `TIME_GATE_CONFIG.BOOST_AMOUNT` pointing at coherence review.

## Decision
No trading-config change. Keep locked stack; soak until STRONG_UP sample grows. Prefer 90/45 + 60/60 both clear before any entry promote.
