import { describe, expect, it } from 'vitest';
import { scoreFlightPair } from './flightScoring';
import type { FlightControl, FlightRole } from './flightScoring';
const control = (role: FlightRole, offset: number, reverse = false): FlightControl => ({ role, pointerId: role === 'child' ? 1 : 2, startMs: 1000 + offset, endMs: 3000 + offset, samples: Array.from({ length: 12 }, (_, i) => ({ tMs: 1000 + offset + i * 180, x: reverse ? -1 : 1, y: i < 6 ? -.25 : .25, speed: 1 })) });
describe('flight leader-follow scoring', () => {
  it('accepts a timely matching follower', () => { const score = scoreFlightPair(control('child', 120), control('parent', 0), 500); expect(score.coordinated).toBe(true); expect(score.followSuccessRate).toBe(1); });
  it('rejects an opposite control path', () => { expect(scoreFlightPair(control('child', 80, true), control('parent', 0), 500).coordinated).toBe(false); });
  it('reports the first action response gap', () => { expect(scoreFlightPair(control('child', 320), control('parent', 0), 500).responseTimeGapMs).toBe(320); });
});
