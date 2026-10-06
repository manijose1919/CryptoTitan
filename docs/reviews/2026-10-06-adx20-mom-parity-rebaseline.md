# 2026-10-06 — STRONG_UP+ADX20 re-baseline after MOMENTUM ADX parity

## Context
MOMENTUM now honors `minAdx` in paper + backtest. Re-measure the live paper stack and light knobs.

## Protocol
- Runner: `scripts/edge-strong-adx20-mom-parity-9045.ts`
- Artifact: `/opt/cursor/artifacts/edge-strong-adx20-mom-parity-9045.json`
- Windows: 90d earlier / 45d OOS; CAD10; 4h; 0.52% RT; 5bps; pessimistic
- Fixed: STRONG_UP, MAX_ATR=2.5, minAdx=20
- Bar: OOS PF>1.1 & net>0 & earlier PF≥0.9 & earlier n≥10

## Results

| Ablation | Earlier n/PF/net | OOS n/PF/net | Pass |
|---|---|---|---|
| paper live (MOM on) | 5 / 0.86 / −$1.45 | 8 / 4.19 / +$15.63 | no |
| same, MOMENTUM off | 5 / 0.86 / −$1.45 | 5 / 2.38 / +$6.74 | no |
| no minSignalAtr | 5 / 0.86 / −$1.45 | 8 / 4.19 / +$15.63 | no |
| timeKillBars→3 | 5 / 0.53 / −$7.98 | 8 / 4.19 / +$15.63 | no |
| timeKillMinMove→1% | 5 / 0.71 / −$3.70 | 8 / 4.19 / +$15.63 | no |
| chase≤0.85 | 6 / 0.93 / −$0.70 | 8 / 4.19 / +$15.63 | no |
| close_above_signal | 5 / 0.86 / −$1.45 | 8 / 4.19 / +$15.63 | no |

**anyPromote = false.**

## Notes
- Earlier half identical with MOMENTUM on/off → ADX-gated MOMENTUM did **not** change earlier sample; OOS gains +3 trades / +$8.89 with MOMENTUM on (keep enabled).
- Exit knobs still hurt earlier PF; chase 0.85 raises earlier n to 6 but PF still &lt;0.9.
- Window drift vs prior n=6/PF1.25 baseline (no minSignalAtr in some older runners) — still n-starved under current paper filters.
- Contaminated live AVAX open remains excluded from cohort.

## Decision
No paper config change. Keep STRONG_UP + confirm + chase≤0.80 + MAX2.5 + minATR1.5 + ADX≥20 + MOMENTUM on (ADX-gated).
