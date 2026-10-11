import { describe, expect, it } from 'vitest';
import { analyzeSwipe, compareSwipeTrajectories, scoreSwipePair } from './swipeScoring';
import type { SwipeGesture, SwipeRole } from './swipeScoring';

const gesture = (role: SwipeRole, startMs: number, points: Array<[number, number, number]>): SwipeGesture => ({ id: `${role}-${startMs}`, role, pointerId: role === 'child' ? 1 : 2, rawStartMs: startMs, rawEndMs: points.at(-1)![2], startMs, endMs: points.at(-1)![2], points: points.map(([x, y, tMs]) => ({ x, y, tMs })) });
const rules = { pairingWindowMs: 500, directionToleranceDeg: 30, mutualDirectionToleranceDeg: 25, minDistance: .3, minTrajectorySimilarity: .6, minSpeedSimilarity: .45 };

describe('swipe scoring', () => {
  it('extracts direction, distance and speed', () => {
    const result = analyzeSwipe(gesture('child', 0, [[0, .5, 0], [.25, .5, 250], [.6, .5, 500]]));
    expect(result.direction).toBe('right');
    expect(result.displacement).toBeCloseTo(.6);
    expect(result.meanSpeed).toBeCloseTo(1.2);
  });

  it('compares translated traces by normalized shape', () => {
    const child = gesture('child', 0, [[0, .2, 0], [.3, .3, 200], [.6, .4, 400]]);
    const parent = gesture('parent', 20, [[.1, .5, 20], [.4, .6, 220], [.7, .7, 420]]);
    expect(compareSwipeTrajectories(child, parent)).toBeGreaterThan(.95);
  });

  it('accepts temporally aligned gestures in the required direction', () => {
    const child = gesture('child', 1000, [[.1, .5, 1000], [.4, .3, 1200], [.75, .15, 1400]]);
    const parent = gesture('parent', 1100, [[.05, .7, 1100], [.35, .5, 1300], [.7, .3, 1500]]);
    const score = scoreSwipePair(child, parent, 'up-right', rules);
    expect(score.coordinated).toBe(true);
    expect(score.startTimeGapMs).toBe(100);
  });

  it('rejects opposite or late gestures', () => {
    const child = gesture('child', 1000, [[.1, .5, 1000], [.7, .5, 1400]]);
    const parent = gesture('parent', 1800, [[.8, .5, 1800], [.2, .5, 2200]]);
    const score = scoreSwipePair(child, parent, 'right', rules);
    expect(score.coordinated).toBe(false);
    expect(score.startTimeGapMs).toBe(800);
    expect(score.directionDifferenceDeg).toBe(180);
  });
});
