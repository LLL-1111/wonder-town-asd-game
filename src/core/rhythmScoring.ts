export type RhythmRole = 'child' | 'parent';

export type RhythmTap = {
  id: string;
  role: RhythmRole;
  tMs: number;
  rawTMs?: number;
  pointerId: number;
  order: number;
};

export type RhythmBeatResult = {
  beatId: string;
  beatIndex: number;
  expectedMs: number;
  childTap: RhythmTap | null;
  parentTap: RhythmTap | null;
  childCueErrorMs: number | null;
  parentCueErrorMs: number | null;
  interTouchMs: number | null;
  synchronized: boolean;
};

export type RhythmScore = {
  beats: RhythmBeatResult[];
  extraTaps: RhythmTap[];
  validPairCount: number;
  childMissCount: number;
  parentMissCount: number;
  childExtraCount: number;
  parentExtraCount: number;
  syncRate: number;
  meanInterTouchMs: number | null;
  maxInterTouchMs: number | null;
};

function assignRoleTaps(role: RhythmRole, expectedTimes: number[], taps: RhythmTap[], responseWindowMs: number) {
  const assigned = new Map<number, RhythmTap>();
  const extras: RhythmTap[] = [];
  for (const tap of taps.filter((item) => item.role === role).sort((a, b) => a.tMs - b.tMs || a.order - b.order)) {
    let bestIndex = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    expectedTimes.forEach((expected, index) => {
      const distance = Math.abs(tap.tMs - expected);
      if (!assigned.has(index) && distance <= responseWindowMs && distance < bestDistance) {
        bestIndex = index;
        bestDistance = distance;
      }
    });
    if (bestIndex === -1) extras.push(tap);
    else assigned.set(bestIndex, tap);
  }
  return { assigned, extras };
}

export function scoreRhythmTrial(
  beatOffsetsMs: number[],
  cueStartMs: number,
  taps: RhythmTap[],
  responseWindowMs: number,
  syncWindowMs: number,
): RhythmScore {
  const expectedTimes = beatOffsetsMs.map((offset) => cueStartMs + offset);
  const child = assignRoleTaps('child', expectedTimes, taps, responseWindowMs);
  const parent = assignRoleTaps('parent', expectedTimes, taps, responseWindowMs);
  const beats = expectedTimes.map((expectedMs, beatIndex): RhythmBeatResult => {
    const childTap = child.assigned.get(beatIndex) ?? null;
    const parentTap = parent.assigned.get(beatIndex) ?? null;
    const childCueErrorMs = childTap ? childTap.tMs - expectedMs : null;
    const parentCueErrorMs = parentTap ? parentTap.tMs - expectedMs : null;
    const interTouchMs = childTap && parentTap ? Math.abs(childTap.tMs - parentTap.tMs) : null;
    return { beatId: `BEAT_${beatIndex + 1}`, beatIndex, expectedMs, childTap, parentTap, childCueErrorMs, parentCueErrorMs, interTouchMs, synchronized: interTouchMs !== null && interTouchMs <= syncWindowMs };
  });
  const pairedDelays = beats.flatMap((beat) => beat.interTouchMs === null ? [] : [beat.interTouchMs]);
  const validPairCount = beats.filter((beat) => beat.synchronized).length;
  const extraTaps = [...child.extras, ...parent.extras].sort((a, b) => a.order - b.order);
  return {
    beats,
    extraTaps,
    validPairCount,
    childMissCount: beats.filter((beat) => !beat.childTap).length,
    parentMissCount: beats.filter((beat) => !beat.parentTap).length,
    childExtraCount: child.extras.length,
    parentExtraCount: parent.extras.length,
    syncRate: beats.length ? validPairCount / beats.length : 0,
    meanInterTouchMs: pairedDelays.length ? pairedDelays.reduce((sum, value) => sum + value, 0) / pairedDelays.length : null,
    maxInterTouchMs: pairedDelays.length ? Math.max(...pairedDelays) : null,
  };
}

