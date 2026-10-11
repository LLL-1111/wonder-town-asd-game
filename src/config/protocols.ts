import type { BalloonLevelId, LevelId } from '../types';

export const versions = {
  config: 'train-gaze-01-prototype-0.1',
  testProtocol: 'test-gaze-01-prototype-0.1',
  scorer: 'gaze-common-target-0.1',
  assets: 'emoji-placeholder-0.1',
};

export const gazeTrainingConfig: Record<LevelId, {
  itemCount: number;
  quota: number;
  highlightMs: number;
  syncWindowMs: number;
  similarDistractors: number;
}> = {
  L1: { itemCount: 8, quota: 6, highlightMs: 3000, syncWindowMs: 800, similarDistractors: 0 },
  L2: { itemCount: 10, quota: 6, highlightMs: 2500, syncWindowMs: 800, similarDistractors: 2 },
  L3: { itemCount: 12, quota: 6, highlightMs: 2000, syncWindowMs: 800, similarDistractors: 3 },
};

export const gazeTestProtocol = {
  itemCount: 8,
  trialCount: 12,
  responseWindowMs: 3000,
  syncWindowMs: 800,
  materialSet: 'GAZE_01_A_prototype',
  actorIdentityMethod: 'same-target-dual-role-zones-prototype',
  validationStatus: 'REQUIRES_REAL_TABLET_VALIDATION',
};

// GAZE_02 was revised after V3.0: these values describe an order-based
// collaboration task, not the 800 ms simultaneous-touch task used by GAZE_01.
export const shoppingHelperTrainingConfig: Record<LevelId, {
  itemCount: number;
  quota: number;
  shoppingListCount: number;
  orderWindowMs: number;
  confirmationWindowMs: number;
}> = {
  L1: { itemCount: 8, quota: 6, shoppingListCount: 1, orderWindowMs: 24000, confirmationWindowMs: 6000 },
  L2: { itemCount: 10, quota: 6, shoppingListCount: 2, orderWindowMs: 28000, confirmationWindowMs: 6000 },
  L3: { itemCount: 12, quota: 6, shoppingListCount: 3, orderWindowMs: 32000, confirmationWindowMs: 6000 },
};

export const shoppingHelperTestProtocol = {
  itemCount: 8,
  trialCount: 6,
  shoppingListCount: 2,
  orderWindowMs: 28000,
  confirmationWindowMs: 6000,
  materialSet: 'GAZE_02_A_v2_order-collaboration',
  actorIdentityMethod: 'same-target-dual-role-zones-prototype',
  validationStatus: 'REQUIRES_REAL_TABLET_VALIDATION',
};

export type BalloonMissionKind = 'launch' | 'cloud-route' | 'star-collection' | 'weather-delivery';
export type BalloonTarget = { id: string; x: number; altitude: number };
export type BalloonGate = { id: string; x: number; minAltitude: number; maxAltitude: number };
export type BalloonWeather = { id: string; startX: number; endX: number; direction: -1 | 1 };

export type BalloonMissionConfig = {
  quota: number;
  missionKind: BalloonMissionKind;
  missionWindowMs: number;
  launchRequiredMs: number;
  flightDurationMs: number;
  cloudGates: BalloonGate[];
  stars: BalloonTarget[];
  weather: BalloonWeather[];
  destination: string;
};

export const balloonTrainingConfig: Record<BalloonLevelId, BalloonMissionConfig> = {
  L1: { quota: 2, missionKind: 'launch', missionWindowMs: 30000, launchRequiredMs: 1800, flightDurationMs: 12000, cloudGates: [], stars: [], weather: [], destination: '天空小平台' },
  L2: { quota: 2, missionKind: 'cloud-route', missionWindowMs: 40000, launchRequiredMs: 1800, flightDurationMs: 17000, cloudGates: [{ id: 'CLOUD_GATE_1', x: .38, minAltitude: .32, maxAltitude: .62 }, { id: 'CLOUD_GATE_2', x: .68, minAltitude: .48, maxAltitude: .78 }], stars: [], weather: [], destination: '云端小屋' },
  L3: { quota: 2, missionKind: 'star-collection', missionWindowMs: 50000, launchRequiredMs: 1800, flightDurationMs: 21000, cloudGates: [{ id: 'CLOUD_GATE_1', x: .3, minAltitude: .28, maxAltitude: .62 }], stars: [{ id: 'STAR_1', x: .46, altitude: .7 }, { id: 'STAR_2', x: .7, altitude: .4 }, { id: 'STAR_3', x: .84, altitude: .66 }], weather: [], destination: '彩虹城堡' },
  L4: { quota: 2, missionKind: 'weather-delivery', missionWindowMs: 60000, launchRequiredMs: 1800, flightDurationMs: 25000, cloudGates: [{ id: 'CLOUD_GATE_1', x: .28, minAltitude: .35, maxAltitude: .65 }, { id: 'CLOUD_GATE_2', x: .72, minAltitude: .5, maxAltitude: .82 }], stars: [{ id: 'STAR_1', x: .52, altitude: .72 }], weather: [{ id: 'WIND_1', startX: .38, endX: .48, direction: 1 }, { id: 'WIND_2', startX: .78, endX: .88, direction: -1 }], destination: '山顶邮局' },
};

export const balloonTestProtocol: BalloonMissionConfig & {
  trialCount: 6,
  materialSet: 'TOUCH_01_A_prototype',
  actorIdentityMethod: 'fixed-side-pointerdown-prototype',
  validationStatus: 'REQUIRES_REAL_TABLET_VALIDATION',
} = {
  quota: 6,
  trialCount: 6,
  missionKind: 'star-collection',
  missionWindowMs: 50000,
  launchRequiredMs: 1800,
  flightDurationMs: 21000,
  cloudGates: [{ id: 'TEST_GATE_1', x: .32, minAltitude: .3, maxAltitude: .64 }],
  stars: [{ id: 'TEST_STAR_1', x: .5, altitude: .7 }, { id: 'TEST_STAR_2', x: .76, altitude: .42 }],
  weather: [],
  destination: '云端小屋',
  materialSet: 'TOUCH_01_A_prototype',
  actorIdentityMethod: 'fixed-side-pointerdown-prototype',
  validationStatus: 'REQUIRES_REAL_TABLET_VALIDATION',
};

export type FountainCueMode = 'shared-pulse' | 'alternating-leader';
export type FountainRhythmConfig = {
  quota: number;
  beatOffsetsMs: number[];
  responseWindowMs: number;
  syncWindowMs: number;
  cueFlashMs: number;
  successRate: number;
  cueMode: FountainCueMode;
};

export const fountainTrainingConfig: Record<LevelId, FountainRhythmConfig> = {
  L1: { quota: 2, beatOffsetsMs: [1000, 2200, 3400, 4600], responseWindowMs: 500, syncWindowMs: 350, cueFlashMs: 500, successRate: .75, cueMode: 'shared-pulse' },
  L2: { quota: 2, beatOffsetsMs: [900, 1650, 2400, 3500, 4250, 5000], responseWindowMs: 420, syncWindowMs: 280, cueFlashMs: 380, successRate: .67, cueMode: 'shared-pulse' },
  L3: { quota: 2, beatOffsetsMs: [800, 1450, 2100, 3050, 3700, 4350, 5300, 5950], responseWindowMs: 360, syncWindowMs: 240, cueFlashMs: 300, successRate: .625, cueMode: 'alternating-leader' },
};

export const fountainTestProtocol: FountainRhythmConfig & {
  trialCount: number;
  materialSet: string;
  actorIdentityMethod: string;
  validationStatus: string;
} = {
  quota: 6,
  trialCount: 6,
  beatOffsetsMs: [900, 1700, 2500, 3600, 4400, 5200],
  responseWindowMs: 420,
  syncWindowMs: 280,
  cueFlashMs: 340,
  successRate: .67,
  cueMode: 'shared-pulse',
  materialSet: 'TOUCH_02_A_fixed-rhythm',
  actorIdentityMethod: 'fixed-side-pointerdown-prototype',
  validationStatus: 'REQUIRES_REAL_TABLET_VALIDATION',
};

export type SwipeDirection = 'right' | 'up-right' | 'up' | 'down-right';
export type RiverDriftConfig = {
  quota: number;
  directions: SwipeDirection[];
  trialWindowMs: number;
  pairingWindowMs: number;
  directionToleranceDeg: number;
  mutualDirectionToleranceDeg: number;
  minDistance: number;
  minTrajectorySimilarity: number;
  minSpeedSimilarity: number;
  maxAttemptsPerSegment: number;
  successRate: number;
};

export const riverTrainingConfig: Record<LevelId, RiverDriftConfig> = {
  L1: { quota: 2, directions: ['right', 'up-right', 'right'], trialWindowMs: 40000, pairingWindowMs: 650, directionToleranceDeg: 36, mutualDirectionToleranceDeg: 32, minDistance: .3, minTrajectorySimilarity: .55, minSpeedSimilarity: .35, maxAttemptsPerSegment: 2, successRate: .67 },
  L2: { quota: 2, directions: ['right', 'up-right', 'down-right', 'right'], trialWindowMs: 48000, pairingWindowMs: 500, directionToleranceDeg: 28, mutualDirectionToleranceDeg: 25, minDistance: .34, minTrajectorySimilarity: .62, minSpeedSimilarity: .45, maxAttemptsPerSegment: 2, successRate: .75 },
  L3: { quota: 2, directions: ['right', 'up-right', 'up', 'down-right', 'right'], trialWindowMs: 56000, pairingWindowMs: 400, directionToleranceDeg: 22, mutualDirectionToleranceDeg: 20, minDistance: .38, minTrajectorySimilarity: .68, minSpeedSimilarity: .55, maxAttemptsPerSegment: 2, successRate: .8 },
};

export const riverTestProtocol: RiverDriftConfig & {
  trialCount: number;
  materialSet: string;
  actorIdentityMethod: string;
  validationStatus: string;
} = {
  quota: 6,
  trialCount: 6,
  directions: ['right', 'up-right', 'down-right', 'right'],
  trialWindowMs: 42000,
  pairingWindowMs: 500,
  directionToleranceDeg: 28,
  mutualDirectionToleranceDeg: 25,
  minDistance: .34,
  minTrajectorySimilarity: .62,
  minSpeedSimilarity: .45,
  maxAttemptsPerSegment: 1,
  successRate: .75,
  materialSet: 'TOUCH_03_A_fixed-route',
  actorIdentityMethod: 'fixed-side-pointer-trace-prototype',
  validationStatus: 'REQUIRES_REAL_TABLET_VALIDATION',
};

export type RainbowTrackId = 'gentle' | 'waves' | 'rainbow';
export type RainbowTraceConfig = { quota: number; trackId: RainbowTrackId; trialWindowMs: number; pairingWindowMs: number; maxDeviation: number; minPathCoverage: number; minSpeedSimilarity: number; minProcessSimilarity: number };
export const rainbowTrainingConfig: Record<LevelId, RainbowTraceConfig> = {
  L1: { quota: 2, trackId: 'gentle', trialWindowMs: 30000, pairingWindowMs: 700, maxDeviation: .12, minPathCoverage: .7, minSpeedSimilarity: .45, minProcessSimilarity: .55 },
  L2: { quota: 2, trackId: 'waves', trialWindowMs: 38000, pairingWindowMs: 550, maxDeviation: .1, minPathCoverage: .78, minSpeedSimilarity: .55, minProcessSimilarity: .62 },
  L3: { quota: 2, trackId: 'rainbow', trialWindowMs: 46000, pairingWindowMs: 450, maxDeviation: .08, minPathCoverage: .84, minSpeedSimilarity: .65, minProcessSimilarity: .7 },
};
export const rainbowTestProtocol: RainbowTraceConfig & { trialCount: number; materialSet: string; validationStatus: string } = { quota: 6, trialCount: 6, trackId: 'waves', trialWindowMs: 38000, pairingWindowMs: 550, maxDeviation: .1, minPathCoverage: .78, minSpeedSimilarity: .55, minProcessSimilarity: .62, materialSet: 'TOUCH_04_A_fixed-rainbow-track', validationStatus: 'REQUIRES_REAL_TABLET_VALIDATION' };

export type FlightRouteId = 'straight' | 'curve' | 'multi-turn';
export type FlightConfig = { quota: number; routeId: FlightRouteId; missionWindowMs: number; requiredCoordinatedMs: number; responseWindowMs: number; obstacleCount: number; dynamicObstacles: boolean };
export const flightTrainingConfig: Record<LevelId, FlightConfig> = {
  L1: { quota: 2, routeId: 'straight', missionWindowMs: 30000, requiredCoordinatedMs: 6000, responseWindowMs: 700, obstacleCount: 1, dynamicObstacles: false },
  L2: { quota: 2, routeId: 'curve', missionWindowMs: 40000, requiredCoordinatedMs: 9000, responseWindowMs: 550, obstacleCount: 2, dynamicObstacles: false },
  L3: { quota: 2, routeId: 'multi-turn', missionWindowMs: 50000, requiredCoordinatedMs: 12000, responseWindowMs: 450, obstacleCount: 3, dynamicObstacles: true },
};
export const flightTestProtocol: FlightConfig & { trialCount: number; materialSet: string; validationStatus: string } = { quota: 6, trialCount: 6, routeId: 'curve', missionWindowMs: 40000, requiredCoordinatedMs: 9000, responseWindowMs: 550, obstacleCount: 2, dynamicObstacles: false, materialSet: 'TOUCH_05_A_fixed-flight-route', validationStatus: 'REQUIRES_REAL_TABLET_VALIDATION' };

export const sellerTrainingConfig: Record<LevelId, { itemCount: number; quota: number; responseWindowMs: number }> = {
  L1: { itemCount: 8, quota: 4, responseWindowMs: 7000 },
  L2: { itemCount: 10, quota: 6, responseWindowMs: 6000 },
  L3: { itemCount: 12, quota: 8, responseWindowMs: 5000 },
};
export const sellerTestProtocol = { itemCount: 8, trialCount: 12, responseWindowMs: 7000, materialSet: 'GAZE_03_A_prototype', validationStatus: 'REQUIRES_REAL_TABLET_VALIDATION' };

export const identityPrototype = {
  id: 'same-target-dual-role-zones-prototype',
  label: '同一商品双角色触摸区',
  status: '待真实平板双人验证',
  limitation: '浏览器只能根据按下起始区域分配角色，不能生物识别手指属于谁，也不能阻止同一人使用两指。',
};
