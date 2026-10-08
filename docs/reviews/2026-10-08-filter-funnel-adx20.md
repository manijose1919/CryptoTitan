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
| score/conf | 16 | **−94** (composite fail 79 + conf-only 15) |
| chase≤0.80 | 14 | −2 |
| confirm | 6 | −8 |
| entryEligible | **6** | — |

### OOS 45d (2190 bars)
scanPass 158 → ADX 150 → timeGate 69 → score 11 → chase 9 → confirm/entry **5**.  
Score split: composite fail 44 + conf-only 14.

## Interpretation
- After STRONG_UP, **timeGate** then **score/conf** dominate attrition — not ADX (only −14 earlier).
- Confirm/chase are small final cuts (expected).
- Regime UP alone accounts for ~933 earlier scan rejects (known: UP+ADX fails promote — do not re-add bare UP).
- Split confirms `MIN_CONFIDENCE=0.65` binds: 15 earlier bars pass score floor but fail conf; score60 + TimeGate boost are dead letters for those (see [`2026-10-08-score-conf-coherence.md`](2026-10-08-score-conf-coherence.md)).

## Follow-up
1. TimeGate ablation + 60/60 stress — **no promote** (see [`2026-10-08-timegate-overnight-stress.md`](2026-10-08-timegate-overnight-stress.md)).
2. Score/conf coherence — **no promote** (conf→0.60 recovers n, earlier PF~0.47).
