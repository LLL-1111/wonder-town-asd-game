import type { LevelId } from '../types';

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

export const balloonTrainingConfig: Record<LevelId, {
  quota: number;
  holdWindowMs: number;
  successOverlapMs: number;
}> = {
  L1: { quota: 4, holdWindowMs: 8000, successOverlapMs: 3000 },
  L2: { quota: 5, holdWindowMs: 12000, successOverlapMs: 6000 },
  L3: { quota: 6, holdWindowMs: 16000, successOverlapMs: 10000 },
};

export const balloonTestProtocol = {
  trialCount: 6,
  holdWindowMs: 14000,
  successOverlapMs: 6000,
  materialSet: 'TOUCH_01_A_prototype',
  actorIdentityMethod: 'fixed-side-pointerdown-prototype',
  validationStatus: 'REQUIRES_REAL_TABLET_VALIDATION',
};

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
