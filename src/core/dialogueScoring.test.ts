import { describe, expect, it } from 'vitest';
import { scoreDialogueTurns } from './dialogueScoring';
describe('dialogue turn scoring', () => {
  it('measures response gaps and alternating turns', () => { const score = scoreDialogueTurns([{ asker: 'parent', questionStartMs: 0, questionEndMs: 500, answerStartMs: 800, answerEndMs: 1200, eliminationMs: 1400 }, { asker: 'child', questionStartMs: 1600, questionEndMs: 2100, answerStartMs: 2300, answerEndMs: 2700, eliminationMs: 2900 }]); expect(score.completeTurnCount).toBe(2); expect(score.alternationCount).toBe(1); expect(score.meanResponseGapMs).toBe(250); });
  it('reports elimination and dialogue completion rates', () => { const score = scoreDialogueTurns([{ asker: 'child', questionStartMs: 0, questionEndMs: 300, answerStartMs: 400, answerEndMs: 700, eliminationMs: null }]); expect(score.dialogueCompletionRate).toBe(1); expect(score.eliminationRate).toBe(0); });
});
