# 2026-10-05 — ADX≥20 stack search + UP rollback

## Paper soak
- mode=paper, watchdog kicked again (~41294s); cohort still n=1 contaminated SOL +$0.86.
- DOGE/LINK scan-PASS; ADX 17/13 &lt; 20 → no TREND signals.
- Added rate-limited `[V2] ADX block` soak log.

## Question
Under paper `minAdx=20`, does any confirm/regime/ATR variant clear robust 90/45?

## Protocol
- `scripts/edge-adx20-stack-9045.ts` + `scripts/edge-strong-confirm-adx20-9045.ts`
- Every ablation has `minAdx=20`
- Bar: OOS PF&gt;1.1 & net&gt;0 & earlier PF≥0.9 & earlier n≥10

## Results (90/45, all ADX≥20)

| Stack | Earlier n/PF | OOS n/PF/net | Pass |
|---|---|---|---|
| promote (UP+confirm+chase+minATR1.5+MAX2.5) | 12 / 0.71 | 12 / 0.87 / −$3.70 | no |
| UP variants (no chase / no minATR / MAX3 / confirm modes) | ≤13 / ≤0.75 | ≤15 / ≤0.87 | no |
| STRONG_UP bare (no confirm) | 17 / 0.95 | 23 / 0.26 / −$86 | no |
| **STRONG_UP + confirm + chase + MAX2.5** | **6 / 1.25** | **7 / 3.77 / +$13.58** | **no (n)** |
| STRONG_UP + confirm + MAX2.5 (no chase) | 7 / 1.32 | 7 / 3.77 / +$13.58 | no (n) |
| STRONG_UP + confirm + MAX3/8 | 6–7 / ~1.25 | 9 / 0.57 / −$14 | no |

60/60 stress on best STRONG_UP+confirm: earlier PF 0.65 (fails); OOS still strong.

## Decision
1. **Roll paper `ALLOWED_REGIMES` back to `['STRONG_UP']`** — UP under ADX≥20 is the expectancy drag; evidence-backed tighten (not a casual loosen).
2. Keep confirm + chase≤0.80 + MAX_ATR=2.5 + MIN_ATR=1.5 + paper ADX≥20.
3. No ADX20 stack clears n≥10 yet; STRONG_UP+confirm is the only PF-positive family — continue searching for n≥10 without re-adding UP.
4. Stats baseline reset on deploy (material regime change).
