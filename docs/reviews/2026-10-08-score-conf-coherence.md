# 2026-10-08 — Score vs confidence gate coherence

## Question
Funnel attributes −94 earlier bars to “score/conf”. Feature probes showed `MIN_COMPOSITE_SCORE` 55/65 identical to live. Is `MIN_CONFIDENCE=0.65` the binding gate (making score60 + TimeGate `scoreBoost` dead letters)?

## Results (`edge-score-conf-coherence-9045`)

| Ablation | Earlier n/PF/net | OOS n/PF/net | Pass |
|---|---|---|---|
| paper live (score60 + conf0.65) | 6 / 0.46 / −$10.94 | 7 / 4.85 / +$18.88 | no |
| conf→0.60 (align score60) | **10** / 0.47 / −$12.35 | 13 / 6.87 / +$28.76 | no (earlier PF) |
| conf→0.55 (boost parity) | 11 / 0.52 / −$11.01 | 13 / 6.87 | no |
| score→65 (match conf) | 6 / 0.46 (= live) | 7 / 4.85 | no |
| score55 + conf0.55 | 17 / 0.36 / −$30.87 | 13 / 6.87 | no |

**anyPromote = false.**

## Interpretation
- Hypothesis **confirmed**: `MIN_CONFIDENCE=0.65` binds at composite≥65. Raising score to 65 is a no-op; lowering score alone was already a no-op (2026-10-07).
- TimeGate `scoreBoost` (threshold 60→55) cannot admit scores 55–64 while confidence still requires 0.65 — boost is a **dead letter** for TREND entries under current config.
- Aligning conf→0.60 recovers earlier n to the bar (≥10) and lifts OOS, but **earlier PF stays ~0.47** — recovered trades are earlier-half losers. Do not promote.

## Funnel split (score vs conf)
Earlier after timeGate (110): `scoreFailComposite=79` (all also fail conf) + `score_confidence`-only **15** → 94 total. Pure confidence fails (scores ~60–64) are the only band conf→0.60 can unlock.

## Quality combos on conf-recovered band

| Ablation | Earlier n/PF/net | OOS n/PF | Pass |
|---|---|---|---|
| conf0.60 + chase≤0.75 | 9 / 0.61 | 13 / 6.87 | no |
| conf0.55 + chase≤0.75 | 10 / 0.68 / −$5.62 | 13 / 6.87 | no |
| conf0.55 + chase≤0.70 | 10 / 0.68 | 12 / 6.68 | no (= chase0.75) |
| conf0.60 + chase≤0.75 + range≤2.0 | 7 / 0.86 | 13 / 6.87 | no |
| **conf0.55 + chase≤0.75 + range≤2.0** | **8 / 0.965 / −$0.43** | 13 / 6.87 | no — **PF clears, n short by 2** |

## Decision
No paper config change yet. Keep live `MIN_CONFIDENCE=0.65`. Closest structural miss is conf0.55+chase0.75+range≤2.0 (earlier PF 0.965, n=8). Neighborhood probe next (`edge-conf-range-neighborhood-9045`) before any promote/stress.
