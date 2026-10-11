export type ActorRole = 'parent' | 'child' | 'system';
export type GameMode = 'train' | 'test';
export type TestPhase = 'T0' | 'T1' | null;
export type LevelId = 'L1' | 'L2' | 'L3';
export type BalloonLevelId = LevelId | 'L4';

export type TrialOutcome =
  | 'completed_valid'
  | 'valid_not_synchronized'
  | 'wrong_target'
  | 'no_response'
  | 'technical_invalid'
  | 'skipped_or_withdrawn';

export interface GameEvent {
  event_id: string;
  pair_id: string;
  session_id: string;
  trial_id: string | null;
  mode: GameMode | 'probe';
  phase: TestPhase;
  domain_id: string;
  game_id: string;
  level: BalloonLevelId | null;
  actor_role: ActorRole;
  actor_identity_method: string;
  event_type: string;
  t_ms: number;
  wall_time: string;
  target_id: string | null;
  pointer_id?: number;
  x_rel?: number;
  y_rel?: number;
  outcome?: TrialOutcome;
  invalid_reason?: string;
  payload?: Record<string, unknown>;
  config_version: string;
  scorer_version: string;
  asset_version: string;
}

export interface TrialSummary {
  trial_id: string;
  session_id: string;
  game_id: string;
  mode: GameMode;
  phase: TestPhase;
  level: BalloonLevelId | null;
  opportunity_index: number;
  target_id: string;
  outcome: TrialOutcome;
  child_target_id: string | null;
  parent_target_id: string | null;
  child_t_ms: number | null;
  parent_t_ms: number | null;
  inter_touch_ms: number | null;
  valid_for_scoring: boolean;
  actor_identity_method: string;
  config_version: string;
  scorer_version: string;
  /** Game-specific, recomputable measurements saved alongside the raw events. */
  metrics?: Record<string, unknown>;
}

export interface Product {
  id: string;
  name: string;
  emoji: string;
  category: string;
  color: string;
}

export interface GameDefinition {
  id: string;
  name: string;
  subtitle: string;
  icon: string;
  status: 'demo-ready' | 'planned';
}

export interface DomainDefinition {
  id: string;
  name: string;
  place: string;
  icon: string;
  color: string;
  pale: string;
  description: string;
  games: GameDefinition[];
}
