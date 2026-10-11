export type TraceRole = 'child' | 'parent';
export type TracePoint = { x: number; y: number; tMs: number };
export type TraceGesture = { id: string; role: TraceRole; pointerId: number; startMs: number; endMs: number; points: TracePoint[] };
export type TrackPoint = { x: number; y: number };
export type TraceRules = { pairingWindowMs: number; maxDeviation: number; minPathCoverage: number; minSpeedSimilarity: number; minProcessSimilarity: number };

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const distance = (a: TrackPoint, b: TrackPoint) => Math.hypot(a.x - b.x, a.y - b.y);
const length = (points: TrackPoint[]) => points.slice(1).reduce((sum, point, index) => sum + distance(points[index], point), 0);
function nearestDistance(point: TrackPoint, track: TrackPoint[]) { return Math.min(...track.map((candidate) => distance(point, candidate))); }
function resample(points: TracePoint[], count = 20) {
  if (points.length < 2) return Array.from({ length: count }, () => points[0] ?? { x: 0, y: 0, tMs: 0 });
  return Array.from({ length: count }, (_, index) => points[Math.round(index * (points.length - 1) / (count - 1))]);
}
export function analyzeTrace(gesture: TraceGesture, track: TrackPoint[]) {
  const sampled = resample(gesture.points);
  const meanDeviation = sampled.reduce((sum, point) => sum + nearestDistance(point, track), 0) / sampled.length;
  const pathLength = length(gesture.points);
  const trackLength = Math.max(.001, length(track));
  const coverage = clamp01(pathLength / trackLength);
  const durationMs = Math.max(1, gesture.endMs - gesture.startMs);
  return { meanDeviation, accuracy: clamp01(1 - meanDeviation / .25), coverage, durationMs, meanSpeed: pathLength / (durationMs / 1000) };
}
export function scoreTracePair(childGesture: TraceGesture, parentGesture: TraceGesture, track: TrackPoint[], rules: TraceRules) {
  const child = analyzeTrace(childGesture, track); const parent = analyzeTrace(parentGesture, track);
  const startTimeGapMs = Math.abs(childGesture.startMs - parentGesture.startMs);
  const finishTimeGapMs = Math.abs(childGesture.endMs - parentGesture.endMs);
  const speedSimilarity = Math.min(child.meanSpeed, parent.meanSpeed) / Math.max(.001, child.meanSpeed, parent.meanSpeed);
  const childPoints = resample(childGesture.points); const parentPoints = resample(parentGesture.points);
  const processSimilarity = clamp01(1 - childPoints.reduce((sum, point, index) => sum + distance(point, parentPoints[index]), 0) / childPoints.length / .5);
  const completionSyncRate = clamp01(1 - finishTimeGapMs / Math.max(child.durationMs, parent.durationMs, 1));
  const coordinated = startTimeGapMs <= rules.pairingWindowMs && child.meanDeviation <= rules.maxDeviation && parent.meanDeviation <= rules.maxDeviation && child.coverage >= rules.minPathCoverage && parent.coverage >= rules.minPathCoverage && speedSimilarity >= rules.minSpeedSimilarity && processSimilarity >= rules.minProcessSimilarity;
  return { child, parent, startTimeGapMs, finishTimeGapMs, speedSimilarity, processSimilarity, completionSyncRate, coordinated };
}
