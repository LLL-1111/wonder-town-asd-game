import type { ActorRole, TrialOutcome } from '../types';

export interface RolePress {
  role: Exclude<ActorRole, 'system'>;
  targetId: string;
  downMs: number;
  upMs: number | null;
}

export interface GazeTrialClassification {
  outcome: TrialOutcome;
  interTouchMs: number | null;
  childTargetId: string | null;
  parentTargetId: string | null;
  childMs: number | null;
  parentMs: number | null;
}

export function classifyGazeTrial(
  targetId: string,
  presses: RolePress[],
  syncWindowMs: number,
  deadlineMs: number,
): GazeTrialClassification {
  const childPress = presses.find((press) => press.role === 'child');
  const parentPress = presses.find((press) => press.role === 'parent');
  const childCorrect = childPress?.targetId === targetId;
  const parentCorrect = parentPress?.targetId === targetId;

  if (childCorrect && parentCorrect && childPress && parentPress) {
    const interTouchMs = Math.abs(childPress.downMs - parentPress.downMs);
    const laterDown = Math.max(childPress.downMs, parentPress.downMs);
    const childEnd = childPress.upMs ?? deadlineMs;
    const parentEnd = parentPress.upMs ?? deadlineMs;
    const overlapAtSecondTouch = Math.min(childEnd, parentEnd) >= laterDown;
    return {
      outcome: interTouchMs <= syncWindowMs && overlapAtSecondTouch
        ? 'completed_valid'
        : 'valid_not_synchronized',
      interTouchMs,
      childTargetId: childPress.targetId,
      parentTargetId: parentPress.targetId,
      childMs: childPress.downMs,
      parentMs: parentPress.downMs,
    };
  }

  if (childPress || parentPress) {
    const hasWrongTarget = (childPress && !childCorrect) || (parentPress && !parentCorrect);
    return {
      outcome: hasWrongTarget ? 'wrong_target' : 'no_response',
      interTouchMs: null,
      childTargetId: childPress?.targetId ?? null,
      parentTargetId: parentPress?.targetId ?? null,
      childMs: childPress?.downMs ?? null,
      parentMs: parentPress?.downMs ?? null,
    };
  }

  return {
    outcome: 'no_response',
    interTouchMs: null,
    childTargetId: null,
    parentTargetId: null,
    childMs: null,
    parentMs: null,
  };
}

export function summarizeGazeTrials(outcomes: TrialOutcome[]) {
  const valid = outcomes.filter((outcome) => !['technical_invalid', 'skipped_or_withdrawn'].includes(outcome));
  const synchronized = valid.filter((outcome) => outcome === 'completed_valid').length;
  return {
    validCount: valid.length,
    synchronizedCount: synchronized,
    synchronizedRate: valid.length ? synchronized / valid.length : null,
  };
}
