import { describe, expect, it } from 'vitest';
import { TIME_GATE_CONFIG, checkTimeGate } from './timeGate.ts';
import { V2_CONFIG } from '../engine/config.ts';

/**
 * TimeGate scoreBoost vs MIN_CONFIDENCE after 2026-10-21 promote (conf 0.60).
 * At conf 0.65 boost was a dead letter; at 0.60 scores 55–59 can pass with boost.
 */
describe('TimeGate scoreBoost vs MIN_CONFIDENCE', () => {
  it('boosted hours return BOOST_AMOUNT', () => {
    const noon = Date.UTC(2026, 5, 15, 12, 0, 0); // Mon 2026-06-15 12:00 UTC
    const r = checkTimeGate(noon);
    expect(r.allow).toBe(true);
    expect(r.scoreBoost).toBe(TIME_GATE_CONFIG.BOOST_AMOUNT);
    expect(TIME_GATE_CONFIG.BOOST_AMOUNT).toBe(5);
  });

  it('overnight hours 0–7 are no longer hard-blocked', () => {
    const asian = Date.UTC(2026, 5, 15, 3, 0, 0);
    expect(checkTimeGate(asian).allow).toBe(true);
    expect(TIME_GATE_CONFIG.BLOCKED_HOURS).toEqual([13, 20]);
  });

  it('score 60 passes boosted composite floor and MIN_CONFIDENCE=0.60', () => {
    const compositeScore = 60;
    const scoreBoost = TIME_GATE_CONFIG.BOOST_AMOUNT;
    const scoreFloor = V2_CONFIG.MIN_COMPOSITE_SCORE - scoreBoost; // 60 - 5 = 55
    const confidence = compositeScore / 100;

    expect(compositeScore >= scoreFloor).toBe(true);
    expect(confidence >= V2_CONFIG.MIN_CONFIDENCE).toBe(true);
    expect(V2_CONFIG.MIN_CONFIDENCE).toBe(0.6);
    expect(V2_CONFIG.MIN_COMPOSITE_SCORE).toBe(60);
  });

  it('score 59 fails confidence even when boosted score floor would allow', () => {
    const compositeScore = 59;
    const scoreFloor = V2_CONFIG.MIN_COMPOSITE_SCORE - TIME_GATE_CONFIG.BOOST_AMOUNT;
    expect(compositeScore >= scoreFloor).toBe(true); // 59 >= 55
    expect(compositeScore / 100 >= V2_CONFIG.MIN_CONFIDENCE).toBe(false); // 0.59 < 0.60
  });
});
