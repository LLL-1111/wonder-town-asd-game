export type DialogueRole = 'child' | 'parent';
export type DialogueTurn = { asker: DialogueRole; questionStartMs: number; questionEndMs: number; answerStartMs: number; answerEndMs: number; eliminationMs: number | null };
export function scoreDialogueTurns(turns: DialogueTurn[]) {
  const complete = turns.filter((turn) => turn.questionEndMs >= turn.questionStartMs && turn.answerEndMs >= turn.answerStartMs);
  const responseGaps = complete.map((turn) => Math.max(0, turn.answerStartMs - turn.questionEndMs));
  const turnDurations = complete.map((turn) => Math.max(0, turn.answerEndMs - turn.questionStartMs));
  const mean = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  const alternations = complete.slice(1).filter((turn, index) => turn.asker !== complete[index].asker).length;
  const eliminationRate = complete.length ? complete.filter((turn) => turn.eliminationMs !== null).length / complete.length : 0;
  const dialogueCompletionRate = turns.length ? complete.length / turns.length : 0;
  return { completeTurnCount: complete.length, alternationCount: alternations, meanResponseGapMs: mean(responseGaps), meanTurnDurationMs: mean(turnDurations), eliminationRate, dialogueCompletionRate };
}
