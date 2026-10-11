export type FlightRole = 'child' | 'parent';
export type FlightSample = { tMs: number; x: number; y: number; speed: number };
export type FlightControl = { role: FlightRole; pointerId: number; startMs: number; endMs: number; samples: FlightSample[] };
const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const magnitude = (sample: FlightSample) => Math.hypot(sample.x, sample.y);
const directionSimilarity = (a: FlightSample, b: FlightSample) => { const divisor = magnitude(a) * magnitude(b); return divisor ? clamp01((a.x * b.x + a.y * b.y) / divisor * .5 + .5) : 0; };
export function scoreFlightPair(child: FlightControl, parent: FlightControl, responseWindowMs: number) {
  const responseTimeGapMs = Math.abs(child.startMs - parent.startMs);
  const count = Math.min(child.samples.length, parent.samples.length);
  const pairs = Array.from({ length: count }, (_, index) => [child.samples[Math.round(index * (child.samples.length - 1) / Math.max(1, count - 1))], parent.samples[Math.round(index * (parent.samples.length - 1) / Math.max(1, count - 1))]] as const);
  const meanDirectionSimilarity = pairs.length ? pairs.reduce((sum, [a, b]) => sum + directionSimilarity(a, b), 0) / pairs.length : 0;
  const speedSimilarity = pairs.length ? pairs.reduce((sum, [a, b]) => sum + Math.min(a.speed, b.speed) / Math.max(.001, a.speed, b.speed), 0) / pairs.length : 0;
  const overlapStart = Math.max(child.startMs, parent.startMs); const overlapEnd = Math.min(child.endMs, parent.endMs); const unionStart = Math.min(child.startMs, parent.startMs); const unionEnd = Math.max(child.endMs, parent.endMs);
  const operationSyncRate = clamp01(Math.max(0, overlapEnd - overlapStart) / Math.max(1, unionEnd - unionStart));
  const followSuccessRate = pairs.length ? pairs.filter(([a, b]) => directionSimilarity(a, b) >= .8).length / pairs.length : 0;
  return { responseTimeGapMs, meanDirectionSimilarity, speedSimilarity, operationSyncRate, followSuccessRate, coordinated: responseTimeGapMs <= responseWindowMs && meanDirectionSimilarity >= .72 && speedSimilarity >= .5 && operationSyncRate >= .55 && followSuccessRate >= .6 };
}
