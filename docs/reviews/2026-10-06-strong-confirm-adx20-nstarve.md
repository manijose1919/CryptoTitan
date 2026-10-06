# 2026-10-06 — STRONG_UP+confirm+ADX20 still n-starved

## Paper soak
- UP rollback live (`ALLOWED_REGIMES=['STRONG_UP']`); baseline `1791204246680`; cohort 0.
- Watchdog kicked again (~40910s) after suspend; loops recovered.
- **ADAUSD STRONG_UP** but ATR% ≈2.66–2.74 &gt; MAX 2.5 — correctly rejected (only STRONG_UP name this cycle).
- No new fills; mode=paper; SHORT=off; DCA=sim.

## Question
Can fine MAX_ATR (2.6–2.8), longer windows, or scanner minATR=1.0 clear robust n≥10 under STRONG_UP+confirm+ADX≥20+MAX2.5?

## Results

### MAX_ATR grid (`edge-strong-maxatr-adx20-9045`, 90/45)

| MAX_ATR | Earlier n/PF | OOS n/PF/net | Pass |
|---|---|---|---|
| 2.5 (live) | 6 / 1.25 | 8 / 4.19 / +$15.63 | no (n) |
| 2.6 / 2.7 | 6 / 1.25 | 8 / 4.19 / +$15.63 | no (identical) |
| 2.75 / 2.8 | 6 / 1.25 | 9 / 1.15 / +$2.71 | no (OOS PF collapse vs 2.5) |
| 2.6 no chase | 7 / 1.32 | 8 / 4.19 | no (n) |

Raising MAX to cover live ADA (~2.66) **adds no historical edge** at 2.6–2.7 and **hurts OOS** at 2.75+.

### Long window / scanner minATR (`edge-strong-confirm-adx20-longwindow`)

| Window / minATR | Earlier n/PF | OOS n/PF/net | Pass |
|---|---|---|---|
| 90/45 · 1.5 | 6 / 1.25 | 8 / 4.19 / +$15.63 | no |
| 120/60 · 1.5 | 6 / 1.25 | 13 / 2.79 / +$19.39 | no (earlier n) |
| 150/75 · 1.5 | 4 / 0.89 | 13 / 2.75 | no |
| 90/45 · 1.0 | 8 / 0.67 | 10 / 5.86 | no (earlier PF) |
| 120/60 · 1.0 | 8 / 0.67 | 16 / 3.93 | no (earlier PF) |

OOS remains strong; **earlier half stays the gate** (n or PF).

## Decision
**No paper config change.** Keep STRONG_UP + confirm + chase≤0.80 + MAX_ATR=2.5 + MIN_ATR=1.5 + ADX≥20.
- Do not raise MAX_ATR for ADA near-miss.
- Do not lower scanner minATR (earlier PF collapses).
- Next research: alternate exits / signal features under this stack that raise earlier n without UP or ATR-ceiling loosen — or accept low fill rate until STRONG_UP+ADX coincidences increase.
