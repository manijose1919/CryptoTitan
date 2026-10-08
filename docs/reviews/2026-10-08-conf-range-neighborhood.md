# 2026-10-08 — conf+range neighborhood (no promote)

## Anchor
`MIN_CONFIDENCE=0.55` + chase≤0.75 + `maxSignalRangeAtrMult≤2.0` under ADX20+confirmMomentum:
earlier **n=8 PF=0.965** net −$0.43 / OOS n=13 PF=6.87 — PF clears, n short by 2.

## Neighborhood (`edge-conf-range-neighborhood-9045`)

| Variant | Earlier n/PF/net | OOS | Pass |
|---|---|---|---|
| anchor range≤2.0 | 8 / **0.965** / −$0.43 | 13 / 6.87 | no (n) |
| range≤2.1 | 9 / 0.844 / −$2.24 | 13 / 6.87 | no — PF cliff |
| range≤2.25 / 2.5 | 10 / 0.683 | 13 / 6.87 | no |
| chase 0.78/0.80 @ range2 | 9 / 0.675 | 13 / 6.87 | no |
| conf 0.57/0.58 @ range2 | 7 / 0.858 | 13 / 6.87 | no (worse n) |
| conf0.60 chase0.75 range2.1 | 8 / 0.75 | 13 / 6.87 | no |

**anyPromote = false.** Softening range past 2.0 buys n but collapses earlier PF below 0.9. Chase loosen at range2 also hurts PF. Tighter conf than 0.55 reduces n further.

## Decision
No promote from neighborhood nudges. Next: pair **anchor quality package** with overnight TimeGate unblock (independent n source that cleared 90/45 alone) and re-check 90/45 then 60/60.
