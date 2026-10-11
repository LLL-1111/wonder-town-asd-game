import { describe, expect, it } from 'vitest';
import type { BalloonMissionConfig } from '../config/protocols';
import { createBalloonMission, stepBalloonMission } from './balloonEngine';
import type { BalloonMissionState } from './balloonEngine';

const config: BalloonMissionConfig = {
  quota: 1,
  missionKind: 'star-collection',
  missionWindowMs: 30000,
  launchRequiredMs: 1000,
  flightDurationMs: 10000,
  cloudGates: [{ id: 'G1', x: .3, minAltitude: .2, maxAltitude: .8 }],
  stars: [{ id: 'S1', x: .5, altitude: .5 }],
  weather: [],
  destination: '终点',
};

describe('balloon mission engine', () => {
  it('only launches after a shared hold', () => {
    let mission = createBalloonMission();
    mission = stepBalloonMission(mission, { childPressed: true, parentPressed: false }, config, 1000).state;
    expect(mission.phase).toBe('preparing');
    expect(mission.inflation).toBe(0);
    mission = stepBalloonMission(mission, { childPressed: true, parentPressed: true }, config, 1000).state;
    expect(mission.phase).toBe('flight');
  });

  it('uses joint hold to climb and joint release to glide down', () => {
    let mission: BalloonMissionState = { ...createBalloonMission(), phase: 'flight', altitude: .4, energy: 40 };
    mission = stepBalloonMission(mission, { childPressed: true, parentPressed: true }, config, 1000).state;
    expect(mission.altitude).toBeGreaterThan(.4);
    const highAltitude = mission.altitude;
    mission = stepBalloonMission(mission, { childPressed: false, parentPressed: false }, config, 1000).state;
    expect(mission.altitude).toBeLessThan(highAltitude);
  });

  it('penalizes one-sided control and can recover', () => {
    let mission: BalloonMissionState = { ...createBalloonMission(), phase: 'flight', stability: 80 };
    mission = stepBalloonMission(mission, { childPressed: true, parentPressed: false }, config, 1000).state;
    expect(mission.stability).toBeLessThan(80);
    const unstable = mission.stability;
    mission = stepBalloonMission(mission, { childPressed: true, parentPressed: true }, config, 1000).state;
    expect(mission.stability).toBeGreaterThan(unstable);
  });

  it('requires spatial tasks and a coordinated landing', () => {
    const mission: BalloonMissionState = {
      ...createBalloonMission(),
      phase: 'flight',
      route: .949,
      altitude: .2,
      passedGates: ['G1'],
      collectedStars: ['S1'],
      control: 'joint-hold',
    };
    const result = stepBalloonMission(mission, { childPressed: false, parentPressed: false }, config, 1000);
    expect(result.state.phase).toBe('arrived');
    expect(result.events.some((event) => event.type === 'mission_completed')).toBe(true);
  });
});
