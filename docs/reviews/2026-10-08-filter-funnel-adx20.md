# 2026-10-08 — Filter funnel under paper ADX20+confirm stack

## Soak
- `:3137` paper; open 0; cohort 0 (contaminated AVAX excluded); market risk-off (DOWN/STRONG_DOWN/SIDEWAYS).
- Watchdog after suspend; F&G fresh; shorts off / DCA sim.

## Question
Where does n die under STRONG_UP + ATR1.5–2.5 + ADX≥20 + score + chase≤0.80 + bullish_close confirm?

## Funnel (`edge-funnel-adx20-9045`)

### Earlier 90d (4410 ticker-bars)

| Stage | Count | Δ vs prior |
|---|---|---|
| bars | 4410 | — |
| scanPass / STRONG_UP / ATR band | 282 | regime filters most |
| ADX≥20 | 268 | −14 |
| timeGate | 110 | **−158** |
| score/conf | 16 | **−94** |
| chase≤0.80 | 14 | −2 |
| confirm | 6 | −8 |
| entryEligible | **6** | — |

### OOS 45d (2190 bars)
scanPass 158 → ADX 150 → timeGate 69 → score 11 → chase 9 → confirm/entry **5**.

## Interpretation
- After STRONG_UP, **timeGate** then **score/conf** dominate attrition — not ADX (only −14 earlier).
- Confirm/chase are small final cuts (expected).
- Regime UP alone accounts for ~933 earlier scan rejects (known: UP+ADX fails promote — do not re-add bare UP).
- Feature probes (2026-10-07): `MIN_COMPOSITE_SCORE` 55/65 identical to live — score knob not binding for filled trades. Likely because `MIN_CONFIDENCE=0.65` requires composite ≥65 regardless of score threshold / TimeGate boost.

## Follow-up
1. TimeGate ablation + 60/60 stress — **no promote** (see [`2026-10-08-timegate-overnight-stress.md`](2026-10-08-timegate-overnight-stress.md)).
2. Next: score vs confidence gate coherence (boost dead letter?) under the same stack.
