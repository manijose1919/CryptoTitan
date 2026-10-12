# 2026-10-12 — ATR-cooldown near-miss diag (no promote)

## Motivation
Soak repeatedly shows STRONG_UP names rejected at ATR%~2.7 > MAX 2.5 (DOT/ADA). Raising MAX already failed (2026-10-06). Alternate: wait for ATR to cool into [1.5, 2.5] within K bars while SU+ADX holds — without loosening the ceiling.

## Method
`scripts/edge-atr-cooldown-diag.ts` — count near-misses and look-ahead cool-ins; require score/conf + chase + bullish_close confirm for “confirm-eligible”.

## Results (end = 2026-10-12 UTC)

| Window | SU+ADX | inBand | nearMiss ATR>2.5 | cool≤12 bars | cool+confirm |
|---|---|---|---|---|---|
| earlier90 | 606 | 310 | 144 | 8 | **0** |
| oos45 | 372 | 150 | 154 | 13 | **0** |

Cool-ins exist but **none** clear chase/confirm/score under the locked stack. Delayed entry would not add n.

## Locked baseline refresh (scan-parity)
Still fails promote: earlier90 PF 0.455 n=6; earlier60 n=3; OOS45 PF 2.04 n=4.

## Decision
**Shelve ATR-cooldown.** Do not raise MAX_ATR. Keep locked stack; wait for in-band STRONG_UP+ADX coincidence (or find a different n path that is not ATR/regime loosen).
