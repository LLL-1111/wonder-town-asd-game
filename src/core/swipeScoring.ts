import type { SwipeDirection } from '../config/protocols';

export type SwipeRole = 'child' | 'parent';
export type SwipePoint = { x: number; y: number; tMs: number };
export type SwipeGesture = {
  id: string;
  role: SwipeRole;
  pointerId: number;
  rawStartMs: number;
  rawEndMs: number;
  startMs: number;
  endMs: number;
  points: SwipePoint[];
};

export type SwipeFeatures = {
  durationMs: number;
  displacement: number;
  pathLength: number;
  meanSpeed: number;
  directionAngleDeg: number;
  direction: SwipeDirection | 'left' | 'down' | 'up-left' | 'down-left';
};

export type SwipePairScore = {
  child: SwipeFeatures;
  parent: SwipeFeatures;
  startTimeGapMs: number;
  directionDifferenceDeg: number;
  childRequiredErrorDeg: number;
  parentRequiredErrorDeg: number;
  distanceDifference: number;
  speedDifference: number;
  speedSimilarity: number;
  trajectorySimilarity: number;
  coordinated: boolean;
};

export type SwipePairRules = {
  pairingWindowMs: number;
  directionToleranceDeg: number;
  mutualDirectionToleranceDeg: number;
  minDistance: number;
  minTrajectorySimilarity: number;
  minSpeedSimilarity: number;
};

const directionAngles: Record<SwipeDirection, number> = { right: 0, 'up-right': -45, up: -90, 'down-right': 45 };
const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const pointDistance = (a: SwipePoint, b: SwipePoint) => Math.hypot(b.x - a.x, b.y - a.y);
export const angularDifference = (first: number, second: number) => Math.abs(((first - second + 540) % 360) - 180);

function directionLabel(angle: number): SwipeFeatures['direction'] {
  const normalized = (angle + 360) % 360;
  if (normalized < 22.5 || normalized >= 337.5) return 'right';
  if (normalized < 67.5) return 'down-right';
  if (normalized < 112.5) return 'down';
  if (normalized < 157.5) return 'down-left';
  if (normalized < 202.5) return 'left';
  if (normalized < 247.5) return 'up-left';
  if (normalized < 292.5) return 'up';
  return 'up-right';
}

export function analyzeSwipe(gesture: SwipeGesture): SwipeFeatures {
  const first = gesture.points[0] ?? { x: 0, y: 0, tMs: gesture.startMs };
  const last = gesture.points.at(-1) ?? first;
  const dx = last.x - first.x;
  const dy = last.y - first.y;
  const durationMs = Math.max(1, gesture.endMs - gesture.startMs);
  const pathLength = gesture.points.slice(1).reduce((sum, point, index) => sum + pointDistance(gesture.points[index], point), 0);
  const displacement = Math.hypot(dx, dy);
  const directionAngleDeg = Math.atan2(dy, dx) * 180 / Math.PI;
  return { durationMs, displacement, pathLength, meanSpeed: pathLength / (durationMs / 1000), directionAngleDeg, direction: directionLabel(directionAngleDeg) };
}

function resample(points: SwipePoint[], count = 16): Array<{ x: number; y: number }> {
  if (points.length < 2) return Array.from({ length: count }, () => ({ x: 0, y: 0 }));
  const cumulative = [0];
  for (let index = 1; index < points.length; index += 1) cumulative.push(cumulative[index - 1] + pointDistance(points[index - 1], points[index]));
  const total = cumulative.at(-1) || 1;
  return Array.from({ length: count }, (_, sampleIndex) => {
    const target = total * sampleIndex / (count - 1);
    let segment = 1;
    while (segment < cumulative.length - 1 && cumulative[segment] < target) segment += 1;
    const startDistance = cumulative[segment - 1];
    const segmentLength = Math.max(.000001, cumulative[segment] - startDistance);
    const ratio = (target - startDistance) / segmentLength;
    const start = points[segment - 1];
    const end = points[segment];
    return { x: (start.x + (end.x - start.x) * ratio - points[0].x) / total, y: (start.y + (end.y - start.y) * ratio - points[0].y) / total };
  });
}

export function compareSwipeTrajectories(child: SwipeGesture, parent: SwipeGesture) {
  const childPoints = resample(child.points);
  const parentPoints = resample(parent.points);
  const meanDistance = childPoints.reduce((sum, point, index) => sum + Math.hypot(point.x - parentPoints[index].x, point.y - parentPoints[index].y), 0) / childPoints.length;
  return clamp01(1 - meanDistance / .75);
}

export function scoreSwipePair(childGesture: SwipeGesture, parentGesture: SwipeGesture, requiredDirection: SwipeDirection, rules: SwipePairRules): SwipePairScore {
  const child = analyzeSwipe(childGesture);
  const parent = analyzeSwipe(parentGesture);
  const startTimeGapMs = Math.abs(childGesture.startMs - parentGesture.startMs);
  const directionDifferenceDeg = angularDifference(child.directionAngleDeg, parent.directionAngleDeg);
  const requiredAngle = directionAngles[requiredDirection];
  const childRequiredErrorDeg = angularDifference(child.directionAngleDeg, requiredAngle);
  const parentRequiredErrorDeg = angularDifference(parent.directionAngleDeg, requiredAngle);
  const distanceDifference = Math.abs(child.displacement - parent.displacement);
  const speedDifference = Math.abs(child.meanSpeed - parent.meanSpeed);
  const maxSpeed = Math.max(child.meanSpeed, parent.meanSpeed);
  const speedSimilarity = maxSpeed > 0 ? Math.min(child.meanSpeed, parent.meanSpeed) / maxSpeed : 0;
  const trajectorySimilarity = compareSwipeTrajectories(childGesture, parentGesture);
  const coordinated = startTimeGapMs <= rules.pairingWindowMs
    && childRequiredErrorDeg <= rules.directionToleranceDeg
    && parentRequiredErrorDeg <= rules.directionToleranceDeg
    && directionDifferenceDeg <= rules.mutualDirectionToleranceDeg
    && child.displacement >= rules.minDistance
    && parent.displacement >= rules.minDistance
    && trajectorySimilarity >= rules.minTrajectorySimilarity
    && speedSimilarity >= rules.minSpeedSimilarity;
  return { child, parent, startTimeGapMs, directionDifferenceDeg, childRequiredErrorDeg, parentRequiredErrorDeg, distanceDifference, speedDifference, speedSimilarity, trajectorySimilarity, coordinated };
}

