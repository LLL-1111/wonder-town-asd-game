import { describe, expect, it } from 'vitest';
import { analyzeTrace, scoreTracePair } from './traceScoring';
import type { TraceGesture, TraceRole } from './traceScoring';
const track = Array.from({ length: 11 }, (_, index) => ({ x: index / 10, y: .5 - Math.sin(index / 10 * Math.PI) * .18 }));
const gesture = (role: TraceRole, offset: number, drift = 0): TraceGesture => ({ id: role, role, pointerId: 1, startMs: 1000 + offset, endMs: 2000 + offset, points: track.map((point, index) => ({ x: point.x, y: point.y + drift, tMs: 1000 + offset + index * 100 })) });
describe('rainbow trace scoring', () => {
  it('measures path accuracy and coverage', () => { const score = analyzeTrace(gesture('child', 0), track); expect(score.meanDeviation).toBeLessThan(.001); expect(score.coverage).toBeGreaterThan(.99); });
  it('accepts synchronized traces following the same track', () => { expect(scoreTracePair(gesture('child', 0), gesture('parent', 80), track, { pairingWindowMs: 400, maxDeviation: .08, minPathCoverage: .8, minSpeedSimilarity: .7, minProcessSimilarity: .75 }).coordinated).toBe(true); });
  it('rejects a trace that leaves the track', () => { expect(scoreTracePair(gesture('child', 0), gesture('parent', 40, .25), track, { pairingWindowMs: 400, maxDeviation: .08, minPathCoverage: .8, minSpeedSimilarity: .7, minProcessSimilarity: .75 }).coordinated).toBe(false); });
});
