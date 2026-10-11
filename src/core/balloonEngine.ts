import type { BalloonMissionConfig } from '../config/protocols';

export type BalloonControl = 'idle' | 'joint-hold' | 'joint-glide' | 'child-only' | 'parent-only';
export type BalloonMissionPhase = 'preparing' | 'flight' | 'arrived';

export type BalloonEngineEvent = {
  type: string;
  targetId: string;
  payload?: Record<string, unknown>;
};

export type BalloonMissionState = {
  phase: BalloonMissionPhase;
  control: BalloonControl;
  inflation: number;
  route: number;
  altitude: number;
  energy: number;
  stability: number;
  passedGates: string[];
  collectedStars: string[];
  activeWeatherId: string | null;
  checkpointRetries: number;
};

export type BalloonInput = { childPressed: boolean; parentPressed: boolean };

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));

export const getBalloonControl = ({ childPressed, parentPressed }: BalloonInput, previous: BalloonControl): BalloonControl => {
  if (childPressed && parentPressed) return 'joint-hold';
  if (childPressed) return 'child-only';
  if (parentPressed) return 'parent-only';
  return previous === 'idle' && !childPressed && !parentPressed ? 'idle' : 'joint-glide';
};

export const createBalloonMission = (): BalloonMissionState => ({
  phase: 'preparing',
  control: 'idle',
  inflation: 0,
  route: 0,
  altitude: .14,
  energy: 0,
  stability: 100,
  passedGates: [],
  collectedStars: [],
  activeWeatherId: null,
  checkpointRetries: 0,
});

export function stepBalloonMission(
  state: BalloonMissionState,
  input: BalloonInput,
  config: BalloonMissionConfig,
  deltaMs: number,
): { state: BalloonMissionState; events: BalloonEngineEvent[] } {
  if (state.phase === 'arrived' || deltaMs <= 0) return { state, events: [] };
  const seconds = Math.min(deltaMs, 250) / 1000;
  const control = getBalloonControl(input, state.control);
  const events: BalloonEngineEvent[] = [];
  let next: BalloonMissionState = { ...state, control };

  if (control !== state.control) {
    events.push({ type: 'control_changed', targetId: 'BALLOON', payload: { from: state.control, to: control } });
  }

  if (state.phase === 'preparing') {
    const inflationDelta = control === 'joint-hold'
      ? deltaMs / config.launchRequiredMs
      : control === 'child-only' || control === 'parent-only'
        ? -deltaMs / (config.launchRequiredMs * 1.25)
        : -deltaMs / (config.launchRequiredMs * 4);
    next.inflation = clamp(state.inflation + inflationDelta);
    if (next.inflation >= 1) {
      next = { ...next, phase: 'flight', inflation: 1, energy: 38, altitude: .16, control: 'joint-hold' };
      events.push({ type: 'takeoff_completed', targetId: 'BALLOON', payload: { launch_required_ms: config.launchRequiredMs } });
    }
    return { state: next, events };
  }

  const isOneSided = control === 'child-only' || control === 'parent-only';
  const isHolding = control === 'joint-hold';
  const isGliding = control === 'joint-glide' || control === 'idle';
  const weather = config.weather.find((item) => state.route >= item.startX && state.route <= item.endX) ?? null;

  next.energy = clamp(state.energy + (isHolding ? 25 : isGliding ? -9 : -17) * seconds, 0, 100);
  const verticalRate = isHolding ? .2 : isGliding ? -.105 : -.035;
  const windDrift = weather && !isHolding ? weather.direction * .07 : 0;
  next.altitude = clamp(state.altitude + (verticalRate + windDrift) * seconds, .08, .91);
  const stabilityRate = isHolding ? 7 : isOneSided ? -(weather ? 34 : 17) : weather ? -13 : 1.5;
  next.stability = clamp(state.stability + stabilityRate * seconds, 0, 100);
  const speedFactor = .32 + next.energy / 145;
  next.route = Math.min(.96, state.route + seconds / config.flightDurationMs * 1000 * speedFactor);

  const nextWeather = config.weather.find((item) => next.route >= item.startX && next.route <= item.endX) ?? null;
  if (nextWeather?.id !== state.activeWeatherId) {
    if (state.activeWeatherId) events.push({ type: 'weather_event_completed', targetId: state.activeWeatherId });
    if (nextWeather) events.push({ type: 'weather_event_started', targetId: nextWeather.id, payload: { direction: nextWeather.direction } });
    next.activeWeatherId = nextWeather?.id ?? null;
  }

  for (const gate of config.cloudGates) {
    if (next.passedGates.includes(gate.id) || state.route >= gate.x || next.route < gate.x) continue;
    if (next.altitude >= gate.minAltitude && next.altitude <= gate.maxAltitude) {
      next.passedGates = [...next.passedGates, gate.id];
      events.push({ type: 'cloud_gate_passed', targetId: gate.id, payload: { altitude: next.altitude } });
    } else {
      next.route = Math.max(0, gate.x - .09);
      next.stability = Math.max(35, next.stability - 18);
      next.checkpointRetries += 1;
      events.push({ type: 'checkpoint_restarted', targetId: gate.id, payload: { reason: 'cloud_gate_missed', altitude: next.altitude } });
    }
  }

  for (const star of config.stars) {
    if (next.collectedStars.includes(star.id)) continue;
    if (Math.abs(next.route - star.x) <= .055 && Math.abs(next.altitude - star.altitude) <= .115) {
      next.collectedStars = [...next.collectedStars, star.id];
      events.push({ type: 'star_collected', targetId: star.id, payload: { altitude: next.altitude } });
    } else if (state.route <= star.x + .065 && next.route > star.x + .065) {
      next.route = Math.max(0, star.x - .1);
      next.stability = Math.max(35, next.stability - 15);
      next.checkpointRetries += 1;
      events.push({ type: 'checkpoint_restarted', targetId: star.id, payload: { reason: 'star_missed', altitude: next.altitude } });
    }
  }

  if (next.stability <= 0) {
    next.route = Math.max(0, next.route - .12);
    next.altitude = .35;
    next.stability = 60;
    next.energy = 25;
    next.checkpointRetries += 1;
    events.push({ type: 'checkpoint_restarted', targetId: 'BALLOON', payload: { reason: 'stability_empty' } });
  }

  const tasksComplete = next.passedGates.length === config.cloudGates.length
    && next.collectedStars.length === config.stars.length;
  if (tasksComplete && next.route >= .95 && next.altitude <= .22 && isGliding) {
    next.phase = 'arrived';
    next.route = 1;
    events.push({ type: 'mission_completed', targetId: config.destination, payload: { destination: config.destination } });
  }

  return { state: next, events };
}

