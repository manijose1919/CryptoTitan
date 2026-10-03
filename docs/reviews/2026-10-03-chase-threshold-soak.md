# 2026-10-03 — Chase threshold under promote package (soak + ablation)

## Paper soak (:3137)
- Promote package live; `mode=paper`, stale=false, open=0, post-baseline trades=0.
- First TREND signal: **SOLUSD/4h score=0.75**, repeatedly `CONFIRM reject: chase closeLoc 0.89 > 0.8`.
- Scanner: SOL PASS (UP, ATR%≈1.56); BTC/BNB ATR&lt;1.5; DOT/AVAX ATR&gt;2.5; others SIDEWAYS/DOWN.
- MIN_ATR=1.5 is **not** the soak bottleneck for SOL — chase is. BTC/BNB sit well below 1.5 (≈0.9), so not a near-miss.

## Question
Does loosening chase to 0.85/0.90 (to admit live 0.89 rejects) clear robust 90/45 with better OOS than paper’s 0.80?

## Protocol
- Runner: `scripts/edge-chase-threshold-9045.ts`
- Package fixed: UP+STRONG_UP, MAX_ATR=2.5, bullish_close, minATR≥1.5
- Bar: OOS PF&gt;1.1 & net&gt;0 & earlier PF≥0.9 & earlier n≥10

## Results (90/45)

| Ablation | Earlier n/PF/net | OOS n/PF/net | Pass |
|---|---|---|---|
| chase≤0.75 | 18 / 1.396 / +$11.35 | 22 / 2.03 / +$36.40 | yes |
| **chase≤0.80 (live)** | **20 / 1.199 / +$6.79** | **22 / 2.03 / +$36.40** | **yes** |
| chase≤0.85 | 21 / 1.221 / +$7.54 | 22 / 2.03 / +$36.40 | yes |
| chase≤0.90 | 22 / 1.241 / +$8.22 | 22 / 2.03 / +$36.40 | yes |
| no chase (ctrl) | 22 / 1.241 / +$8.22 | 24 / 2.298 / +$45.91 | yes |

## Decision
**Keep chase≤0.80 on paper.** OOS is identical for 0.75–0.90 — loosening does not improve OOS on this window; it only adds earlier trades. Live 0.89 reject is the filter working as designed.

`chase_off` also clears and shows a slightly better OOS (+2 trades), but removing chase is a risk-gate loosen without a structural reason to prefer it over the promoted package. Revisit only if soak stays fill-starved across multiple 4h bars *and* a pre-registered stress split still favors off/0.90.

## Observability fix
`CONFIRM reject` logs were rate-limited (`loopCount % 5 === 1`), hiding rejects while the same 4h bar re-signaled every minute. Always log CONFIRM reject/pending/drop/armed/entering.
