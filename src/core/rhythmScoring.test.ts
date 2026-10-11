import { describe, expect, it } from 'vitest';
import { scoreRhythmTrial } from './rhythmScoring';
import type { RhythmTap } from './rhythmScoring';

const tap = (id: string, role: 'child' | 'parent', tMs: number, order: number): RhythmTap => ({ id, role, tMs, order, pointerId: order });

describe('rhythm scoring', () => {
  it('pairs one tap from each role to the same beat', () => {
    const score = scoreRhythmTrial([1000, 2000], 0, [tap('c1', 'child', 1010, 1), tap('p1', 'parent', 1080, 2), tap('c2', 'child', 1980, 3), tap('p2', 'parent', 2050, 4)], 300, 150);
    expect(score.validPairCount).toBe(2);
    expect(score.syncRate).toBe(1);
    expect(score.meanInterTouchMs).toBe(70);
  });

  it('does not reuse a beat for duplicate taps', () => {
    const score = scoreRhythmTrial([1000], 0, [tap('c1', 'child', 990, 1), tap('c2', 'child', 1010, 2), tap('p1', 'parent', 1000, 3)], 200, 100);
    expect(score.validPairCount).toBe(1);
    expect(score.childExtraCount).toBe(1);
    expect(score.extraTaps[0].id).toBe('c2');
  });

  it('records missing partners and unsynchronized pairs', () => {
    const score = scoreRhythmTrial([1000, 2000], 0, [tap('c1', 'child', 800, 1), tap('p1', 'parent', 1200, 2), tap('c2', 'child', 2010, 3)], 250, 200);
    expect(score.validPairCount).toBe(0);
    expect(score.parentMissCount).toBe(1);
    expect(score.beats[0].interTouchMs).toBe(400);
  });

  it('treats taps outside the response window as extras', () => {
    const score = scoreRhythmTrial([1000], 0, [tap('c1', 'child', 400, 1), tap('p1', 'parent', 1600, 2)], 300, 200);
    expect(score.childMissCount).toBe(1);
    expect(score.parentMissCount).toBe(1);
    expect(score.extraTaps).toHaveLength(2);
  });
});
