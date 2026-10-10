import { describe, expect, it } from 'vitest';
import { classifyGazeTrial, summarizeGazeTrials } from './scoring';

describe('gaze trial scoring', () => {
  it('classifies overlapping correct role touches within the window as synchronized', () => {
    const result = classifyGazeTrial('F01', [
      { role: 'child', targetId: 'F01', downMs: 100, upMs: 1000 },
      { role: 'parent', targetId: 'F01', downMs: 650, upMs: 900 },
    ], 800, 3000);
    expect(result.outcome).toBe('completed_valid');
    expect(result.interTouchMs).toBe(550);
  });

  it('does not count non-overlapping presses as synchronized', () => {
    const result = classifyGazeTrial('F01', [
      { role: 'child', targetId: 'F01', downMs: 100, upMs: 200 },
      { role: 'parent', targetId: 'F01', downMs: 300, upMs: 500 },
    ], 800, 3000);
    expect(result.outcome).toBe('valid_not_synchronized');
  });

  it('does not silently treat empty denominators as 100 percent', () => {
    expect(summarizeGazeTrials(['technical_invalid']).synchronizedRate).toBeNull();
  });
});
