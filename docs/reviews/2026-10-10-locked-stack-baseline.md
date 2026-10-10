# 2026-10-10 — Locked-stack baseline refresh (calendar roll)

## Stack
`STRONG_UP + bullish_close confirm + chase≤0.80 + MAX_ATR=2.5 + minATR≥1.5 + ADX≥20 + confirmMomentum`
CAD10, 4h, pessimistic bar sequence, fee RT + paper slippage.

## Script
`scripts/edge-locked-stack-baseline-9045.ts` → `/opt/cursor/artifacts/edge-locked-stack-baseline-9045.json`

## Results (end = 2026-10-10 UTC midnight)

| Split | Window | n | WR | net | PF | Pass |
|-------|--------|---|----|-----|----|------|
| 90/45 earlier | 90d → −45d | 6 | 0.33 | −$10.94 | 0.455 | no |
| 90/45 OOS | last 45d | 6 | 0.83 | +$17.13 | 4.496 | — |
| 60/60 earlier | 60d → −60d | 3 | 0.67 | +$3.73 | 1.692 | no |
| 60/60 OOS | last 60d | 11 | 0.91 | +$28.62 | 6.792 | — |

Promotion bar (OOS PF>1.1 & net>0 & earlier PF≥0.9 & earlier n≥10): **fail both splits**.

## Read
- OOS remains strong as the calendar rolls (especially 60d OOS n=11 PF≈6.8).
- Earlier half is still the gate: 90/45 earlier is PF-negative; 60/60 earlier clears PF but **n=3**.
- Matches regime-scarcity finding (2026-10-08): earlier60 STRONG_UP+ADX+ATR bar count ~2.5× lower than oos60 — structural n ceiling under this stack.

## Soak context
- `:3137` paper: open 0, risk-off HTF (no STRONG_UP), shorts off / DCA sim.
- Post-suspend WS + watchdog path validated earlier this cycle; status now exposes `loopInProgress` / `loopStartedAt` for monitors.

## Decision
No trading-config change. Do not promote. Keep locked stack; next profitability work must raise **earlier n** without casual risk loosening (or wait for regime supply).
