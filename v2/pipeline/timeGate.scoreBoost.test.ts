import { describe, expect, it } from 'vitest';
import { TIME_GATE_CONFIG, checkTimeGate } from './timeGate.ts';
import { V2_CONFIG } from '../engine/config.ts';

/**
 * Documents the live interaction between TimeGate scoreBoost and MIN_CONFIDENCE.
 * Research 2026-10-08: boost lowers the composite-score floor but confidence
 * still requires composite≥65, so boost is a dead letter for TREND entries.
 */
describe('TimeGate scoreBoost vs MIN_CONFIDENCE (dead letter)', () => {
  it('boosted hours return BOOST_AMOUNT', () => {
    // 12 UTC is in BOOSTED_HOURS
    const noon = Date.UTC(2026, 5, 15, 12, 0, 0); // Mon 2026-06-15 12:00 UTC
    const r = checkTimeGate(noon);
    expect(r.allow).toBe(true);
    expect(r.scoreBoost).toBe(TIME_GATE_CONFIG.BOOST_AMOUNT);
    expect(TIME_GATE_CONFIG.BOOST_AMOUNT).toBe(5);
  });

  it('score 62 passes composite floor with boost but fails MIN_CONFIDENCE', () => {
    const compositeScore = 62;
    const scoreBoost = TIME_GATE_CONFIG.BOOST_AMOUNT;
    const scoreFloor = V2_CONFIG.MIN_COMPOSITE_SCORE - scoreBoost; // 60 - 5 = 55
    const confidence = compositeScore / 100;

    expect(compositeScore >= scoreFloor).toBe(true);
    expect(confidence >= V2_CONFIG.MIN_CONFIDENCE).toBe(false);
    // Binding gate under current paper config:
    expect(V2_CONFIG.MIN_CONFIDENCE).toBe(0.65);
    expect(V2_CONFIG.MIN_COMPOSITE_SCORE).toBe(60);
  });

  it('score 65 is the effective floor while MIN_CONFIDENCE=0.65', () => {
    const compositeScore = 65;
    const confidence = compositeScore / 100;
    expect(confidence >= V2_CONFIG.MIN_CONFIDENCE).toBe(true);
    // Without confidence, score60+boost would admit 55–64 — those stay blocked today.
    expect(64 / 100 >= V2_CONFIG.MIN_CONFIDENCE).toBe(false);
  });
});
