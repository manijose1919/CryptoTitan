# 2026-10-08 — Anchor quality × overnight TimeGate (no promote)

## Setup
- **Anchor:** `MIN_CONFIDENCE=0.55` + chase≤0.75 + rangeAtr≤2.0 (closest miss: earlier PF 0.965 n=8).
- **Overnight unblock:** `BLOCKED_HOURS=[13,20]` (drop 0–7 UTC); Friday kept.
- Stack fixed: STRONG_UP + ADX≥20 + confirmMomentum + MAX2.5 + minATR1.5.

## Results (`edge-anchor-overnight-9045`)

| Variant | 90/45 earlier | 90/45 OOS | 90/45 | 60/60 earlier | 60/60 |
|---|---|---|---|---|---|
| paper live | 6 / 0.46 | 7 / 4.85 | fail | — | — |
| anchor only | 8 / 0.97 | 13 / 6.87 | fail (n) | — | — |
| overnight only | 13 / 1.18 | 11 / 2.53 | **pass** | 6 / 3.21 | **fail (n)** |
| **anchor + overnight** | **17 / 1.92** | **19 / 3.96** | **pass** | **8 / 7.61** | **fail (n)** |
| range2+chase0.75+overnight (conf0.65) | 9 / 1.83 | 11 / 2.53 | fail (n) | — | — |
| conf0.55+chase0.75+overnight (no range) | 19 / 1.50 | 19 / 3.96 | **pass** | 8 / 7.61 | **fail (n)** |

## Interpretation
- Combining quality anchor with overnight unblock is the **strongest 90/45** package yet (earlier PF 1.92 n=17, OOS PF 3.96).
- Robust **60/60 still fails earlier n** (8 &lt; 10) despite excellent PF — same structural starve as overnight-only (earlier60 n=6).
- Keeping conf0.65 with range+overnight does not clear earlier90 n≥10.
- Dropping range while keeping conf0.55+overnight clears 90/45 but same 60/60 n=8.

## TimeGate fully off + anchor (`edge-anchor-tgoff-stress`)

| Split | Earlier | OOS | Pass |
|---|---|---|---|
| 90/45 | n=18 PF=1.87 net=+$17 | n=22 PF=1.95 net=+$31 | **yes** |
| **60/60** | **n=9** PF=8.48 net=+$23.54 | n=27 PF=1.57 net=+$25.34 | **no** (n short by 1) |

Closest 60/60 miss of the cycle — still fails the bar. Full TimeGate disable is also too large a paper change to ship for a one-trade miss.

## Decision
**Do not promote.** 60/60 earlier-n remains binding even with TimeGate off (n=9). No paper trading-config change — keep overnight TimeGate + conf 0.65 + chase≤0.80. Shelve further entry-loosen packages this cycle; next: soak / exit-quality / wait for more STRONG_UP sample.
