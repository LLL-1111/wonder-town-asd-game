import { useCallback, useEffect, useRef, useState } from 'react';
import { identityPrototype, riverTestProtocol, riverTrainingConfig, versions } from '../config/protocols';
import type { RiverDriftConfig, SwipeDirection } from '../config/protocols';
import { scoreSwipePair } from '../core/swipeScoring';
import type { SwipeGesture, SwipePairScore, SwipePoint, SwipeRole } from '../core/swipeScoring';
import { createId, wallTime } from '../core/ids';
import { downloadEventsCsv, downloadJsonExport, eventStore } from '../data/eventStore';
import type { ActorRole, GameEvent, GameMode, LevelId, TestPhase, TrialOutcome, TrialSummary } from '../types';

type Props = { mode: GameMode; phase: TestPhase; pairId: string; onExit: () => void };
type Stage = 'intro' | 'playing' | 'level-up' | 'finished';
type ActiveSwipe = { id: string; pointerId: number; rawStartMs: number; startMs: number; points: SwipePoint[]; lastSampleRawMs: number };
type PairRecord = { segmentIndex: number; attempt: number; child: SwipeGesture; parent: SwipeGesture; score: SwipePairScore };
const LEVELS: LevelId[] = ['L1', 'L2', 'L3'];
const directionLabel: Record<SwipeDirection, string> = { right: '向右滑', 'up-right': '向右上滑', up: '向上滑', 'down-right': '向右下滑' };
const directionArrow: Record<SwipeDirection, string> = { right: '→', 'up-right': '↗', up: '↑', 'down-right': '↘' };
const clamp = (value: number) => Math.max(0, Math.min(1, value));

export default function RiverDriftGame({ mode, phase, pairId, onExit }: Props) {
  const sessionId = useRef(createId(mode === 'train' ? 'TRAIN' : phase ?? 'TEST')).current;
  const [stage, setStage] = useState<Stage>('intro');
  const [levelIndex, setLevelIndex] = useState(0);
  const [trialIndex, setTrialIndex] = useState(0);
  const [segmentIndex, setSegmentIndex] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [paused, setPaused] = useState(false);
  const [locked, setLocked] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [notice, setNotice] = useState('看河道方向，两个人一起滑');
  const [remainingMs, setRemainingMs] = useState(0);
  const [pending, setPending] = useState<Record<SwipeRole, boolean>>({ child: false, parent: false });
  const [tracing, setTracing] = useState<Record<SwipeRole, boolean>>({ child: false, parent: false });
  const [lastCoordinated, setLastCoordinated] = useState<boolean | null>(null);
  const [outcomes, setOutcomes] = useState<TrialOutcome[]>([]);
  const [savedEventCount, setSavedEventCount] = useState(0);
  const trialIdRef = useRef<string | null>(null);
  const trialOpenRef = useRef(false);
  const trialStartRef = useRef(0);
  const pauseAccumRef = useRef(0);
  const pausedAtRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);
  const activeRef = useRef<Record<SwipeRole, ActiveSwipe | null>>({ child: null, parent: null });
  const pendingRef = useRef<Record<SwipeRole, SwipeGesture | null>>({ child: null, parent: null });
  const pairRecordsRef = useRef<PairRecord[]>([]);
  const unpairedCountRef = useRef(0);
  const technicalInvalidRef = useRef(0);
  const segmentIndexRef = useRef(0);
  const attemptRef = useRef(0);
  const segmentLoggedRef = useRef(new Set<number>());
  const level = LEVELS[levelIndex];
  const config: RiverDriftConfig = mode === 'train' ? riverTrainingConfig[level] : riverTestProtocol;
  const totalTrials = mode === 'train' ? LEVELS.reduce((sum, item) => sum + riverTrainingConfig[item].quota, 0) : riverTestProtocol.trialCount;
  const completed = mode === 'train' ? LEVELS.slice(0, levelIndex).reduce((sum, item) => sum + riverTrainingConfig[item].quota, 0) + trialIndex : trialIndex;
  const currentDirection = config.directions[Math.min(segmentIndex, config.directions.length - 1)];
  const logicalNow = () => performance.now() - pauseAccumRef.current;

  const clearTimer = () => { if (timerRef.current !== null) window.clearInterval(timerRef.current); timerRef.current = null; };
  const appendEvent = useCallback(async (actorRole: ActorRole, eventType: string, data: Partial<GameEvent> = {}) => {
    await eventStore.appendEvent({ event_id: createId('EV'), pair_id: pairId, session_id: sessionId, trial_id: data.trial_id ?? trialIdRef.current, mode, phase, domain_id: 'touch', game_id: 'TOUCH_03', level: mode === 'train' ? level : null, actor_role: actorRole, actor_identity_method: identityPrototype.id, event_type: eventType, t_ms: data.t_ms ?? performance.now(), wall_time: wallTime(), target_id: data.target_id ?? null, pointer_id: data.pointer_id, outcome: data.outcome, invalid_reason: data.invalid_reason, payload: data.payload, config_version: mode === 'train' ? 'train-touch-03-river-0.1' : 'test-touch-03-river-0.1', scorer_version: 'touch-swipe-pair-0.1', asset_version: versions.assets });
    setSavedEventCount((value) => value + 1);
  }, [level, mode, pairId, phase, sessionId]);

  const resetTrial = useCallback(() => {
    trialIdRef.current = null;
    activeRef.current = { child: null, parent: null };
    pendingRef.current = { child: null, parent: null };
    pairRecordsRef.current = [];
    unpairedCountRef.current = 0;
    technicalInvalidRef.current = 0;
    segmentIndexRef.current = 0;
    attemptRef.current = 0;
    segmentLoggedRef.current = new Set();
    pauseAccumRef.current = 0;
    pausedAtRef.current = null;
    setSegmentIndex(0);
    setAttempt(0);
    setPending({ child: false, parent: false });
    setTracing({ child: false, parent: false });
    setLastCoordinated(null);
    setFeedback(null);
    setNotice('看河道方向，两个人一起滑');
    setPaused(false);
    setLocked(false);
  }, []);

  const advanceTrial = useCallback(() => {
    resetTrial();
    if (mode === 'test') {
      if (trialIndex + 1 >= totalTrials) setStage('finished');
      else setTrialIndex((value) => value + 1);
      return;
    }
    if (trialIndex + 1 < riverTrainingConfig[level].quota) {
      setTrialIndex((value) => value + 1);
      return;
    }
    if (levelIndex < LEVELS.length - 1) {
      setStage('level-up');
      window.setTimeout(() => { setLevelIndex((value) => value + 1); setTrialIndex(0); setStage('playing'); }, 1500);
    } else setStage('finished');
  }, [level, levelIndex, mode, resetTrial, totalTrials, trialIndex]);

  const finishTrial = useCallback(async (forcedOutcome?: TrialOutcome) => {
    if (!trialOpenRef.current || !trialIdRef.current) return;
    trialOpenRef.current = false;
    clearTimer();
    const records = pairRecordsRef.current;
    unpairedCountRef.current += Number(Boolean(pendingRef.current.child)) + Number(Boolean(pendingRef.current.parent));
    technicalInvalidRef.current += Number(Boolean(activeRef.current.child)) + Number(Boolean(activeRef.current.parent));
    const validSegments = new Set(records.filter((record) => record.score.coordinated).map((record) => record.segmentIndex)).size;
    const completionRate = config.directions.length ? validSegments / config.directions.length : 0;
    const pairedScores = records.map((record) => record.score);
    const mean = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
    const outcome: TrialOutcome = forcedOutcome ?? (records.length === 0 ? 'no_response' : completionRate >= config.successRate ? 'completed_valid' : 'valid_not_synchronized');
    const firstChild = records[0]?.child.rawStartMs ?? pendingRef.current.child?.rawStartMs ?? null;
    const firstParent = records[0]?.parent.rawStartMs ?? pendingRef.current.parent?.rawStartMs ?? null;
    const metrics = { segment_count: config.directions.length, valid_segment_count: validSegments, pair_attempt_count: records.length, unpaired_gesture_count: unpairedCountRef.current, technical_invalid_count: technicalInvalidRef.current, mean_start_time_gap_ms: mean(pairedScores.map((score) => score.startTimeGapMs)), mean_direction_difference_deg: mean(pairedScores.map((score) => score.directionDifferenceDeg)), mean_trajectory_similarity: mean(pairedScores.map((score) => score.trajectorySimilarity)), mean_speed_similarity: mean(pairedScores.map((score) => score.speedSimilarity)), collaborative_completion_rate: completionRate, total_task_time_ms: Math.max(0, logicalNow() - trialStartRef.current), directions: config.directions };
    const summary: TrialSummary = { trial_id: trialIdRef.current, session_id: sessionId, game_id: 'TOUCH_03', mode, phase, level: mode === 'train' ? level : null, opportunity_index: completed + 1, target_id: 'RIVER_ROUTE', outcome, child_target_id: 'CHILD_SWIPE_ZONE', parent_target_id: 'PARENT_SWIPE_ZONE', child_t_ms: firstChild, parent_t_ms: firstParent, inter_touch_ms: metrics.mean_start_time_gap_ms, valid_for_scoring: !['technical_invalid', 'skipped_or_withdrawn'].includes(outcome), actor_identity_method: identityPrototype.id, config_version: mode === 'train' ? 'train-touch-03-river-0.1' : 'test-touch-03-river-0.1', scorer_version: 'touch-swipe-pair-0.1', metrics };
    await eventStore.saveTrial(summary);
    await appendEvent('system', 'trial_classified', { target_id: 'RIVER_ROUTE', outcome, payload: { summary, ...metrics } });
    setOutcomes((items) => [...items, outcome]);
    setFeedback(mode === 'test' ? '本条漂流路线已记录' : outcome === 'completed_valid' ? '配合成功，小船到达终点啦！' : outcome === 'no_response' ? '这次小船先靠岸休息' : '完成路线啦，下一次再配合得更整齐');
    window.setTimeout(advanceTrial, mode === 'test' ? 700 : 1200);
  }, [advanceTrial, appendEvent, completed, config, level, mode, phase, sessionId]);

  const clearPending = () => {
    pendingRef.current = { child: null, parent: null };
    setPending({ child: false, parent: false });
  };

  const classifyPair = useCallback((child: SwipeGesture, parent: SwipeGesture) => {
    if (!trialOpenRef.current || locked) return;
    const index = segmentIndexRef.current;
    const direction = config.directions[index];
    attemptRef.current += 1;
    setAttempt(attemptRef.current);
    const score = scoreSwipePair(child, parent, direction, config);
    pairRecordsRef.current.push({ segmentIndex: index, attempt: attemptRef.current, child, parent, score });
    setLocked(true);
    setLastCoordinated(score.coordinated);
    setNotice(score.coordinated ? '方向和节奏一致，小船前进！' : score.startTimeGapMs > config.pairingWindowMs ? '再靠近一点时间，一起滑' : '看清方向，再一起试一次');
    void appendEvent('system', 'gesture_paired', { target_id: `SEGMENT_${index + 1}`, outcome: score.coordinated ? 'completed_valid' : 'valid_not_synchronized', payload: { segment_index: index, attempt: attemptRef.current, required_direction: direction, child_swipe_id: child.id, parent_swipe_id: parent.id, start_time_gap_ms: score.startTimeGapMs, child_direction: score.child.direction, parent_direction: score.parent.direction, child_direction_deg: score.child.directionAngleDeg, parent_direction_deg: score.parent.directionAngleDeg, direction_difference_deg: score.directionDifferenceDeg, child_distance: score.child.displacement, parent_distance: score.parent.displacement, distance_difference: score.distanceDifference, child_speed: score.child.meanSpeed, parent_speed: score.parent.meanSpeed, speed_difference: score.speedDifference, speed_similarity: score.speedSimilarity, trajectory_similarity: score.trajectorySimilarity, coordinated: score.coordinated } });
    void appendEvent('system', 'segment_classified', { target_id: `SEGMENT_${index + 1}`, outcome: score.coordinated ? 'completed_valid' : 'valid_not_synchronized', payload: { segment_index: index, attempt: attemptRef.current, coordinated: score.coordinated } });
    const exhausted = attemptRef.current >= config.maxAttemptsPerSegment;
    window.setTimeout(() => {
      if (!trialOpenRef.current) return;
      clearPending();
      setLastCoordinated(null);
      if (score.coordinated || exhausted) {
        if (index + 1 >= config.directions.length) {
          void finishTrial();
          return;
        }
        segmentIndexRef.current = index + 1;
        attemptRef.current = 0;
        setSegmentIndex(index + 1);
        setAttempt(0);
        setNotice('看下一段河道，两个人一起滑');
      } else setNotice('再试一次，两个人一起滑');
      setLocked(false);
    }, 750);
  }, [appendEvent, config, finishTrial, locked]);

  useEffect(() => {
    if (stage !== 'playing' || feedback || paused) return;
    if (!trialOpenRef.current) {
      trialOpenRef.current = true;
      trialIdRef.current = createId('TRIAL');
      pauseAccumRef.current = 0;
      trialStartRef.current = performance.now();
      setRemainingMs(config.trialWindowMs);
      void appendEvent('system', 'route_open', { target_id: 'RIVER_ROUTE', payload: { opportunity_index: completed + 1, directions: config.directions, trial_window_ms: config.trialWindowMs, pairing_window_ms: config.pairingWindowMs, max_attempts_per_segment: config.maxAttemptsPerSegment } });
    }
    const currentSegment = segmentIndexRef.current;
    if (!segmentLoggedRef.current.has(currentSegment)) {
      segmentLoggedRef.current.add(currentSegment);
      void appendEvent('system', 'segment_open', { target_id: `SEGMENT_${currentSegment + 1}`, payload: { segment_index: currentSegment, required_direction: config.directions[currentSegment] } });
    }
    clearTimer();
    timerRef.current = window.setInterval(() => {
      const remaining = Math.max(0, config.trialWindowMs - (logicalNow() - trialStartRef.current));
      setRemainingMs(remaining);
      if (remaining <= 0) void finishTrial();
    }, 100);
    return clearTimer;
  }, [appendEvent, completed, config, feedback, finishTrial, paused, segmentIndex, stage]);
  useEffect(() => () => clearTimer(), []);

  const startGame = async () => {
    await eventStore.saveSession({ session_id: sessionId, pair_id: pairId, mode, phase, game_id: 'TOUCH_03', started_at: wallTime(), protocol_version: mode === 'train' ? 'train-touch-03-river-0.1' : 'test-touch-03-river-0.1', actor_identity_method: identityPrototype.id, identity_validation_status: riverTestProtocol.validationStatus, material_set: mode === 'test' ? riverTestProtocol.materialSet : null, trial_window_ms: config.trialWindowMs, pairing_window_ms: config.pairingWindowMs });
    await appendEvent('system', 'session_started', { payload: { real_input_only: true, rule: 'paired_directional_swipe_traces' } });
    setStage('playing');
  };

  const pointForEvent = (event: React.PointerEvent<HTMLButtonElement>): SwipePoint => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: clamp((event.clientX - rect.left) / rect.width), y: clamp((event.clientY - rect.top) / rect.height), tMs: logicalNow() };
  };
  const pointerDown = (role: SwipeRole, event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    if (!trialOpenRef.current || paused || feedback || locked || pendingRef.current[role]) return;
    if (activeRef.current[role]) { void appendEvent(role, 'extra_pointer_ignored', { pointer_id: event.pointerId, invalid_reason: 'role_already_swiping' }); return; }
    event.currentTarget.setPointerCapture(event.pointerId);
    const rawNow = performance.now();
    const point = pointForEvent(event);
    const active: ActiveSwipe = { id: createId('SWIPE'), pointerId: event.pointerId, rawStartMs: rawNow, startMs: point.tMs, points: [point], lastSampleRawMs: rawNow };
    activeRef.current[role] = active;
    setTracing((value) => ({ ...value, [role]: true }));
    setNotice('保持方向，滑到操作区另一边');
    void appendEvent(role, 'swipe_start', { t_ms: rawNow, pointer_id: event.pointerId, target_id: `${role.toUpperCase()}_SWIPE_ZONE`, payload: { swipe_id: active.id, segment_index: segmentIndexRef.current, required_direction: config.directions[segmentIndexRef.current], start: point, pointer_type: event.pointerType } });
  };
  const pointerMove = (role: SwipeRole, event: React.PointerEvent<HTMLButtonElement>) => {
    const active = activeRef.current[role];
    if (!active || active.pointerId !== event.pointerId) return;
    event.preventDefault();
    const rawNow = performance.now();
    const point = pointForEvent(event);
    const last = active.points.at(-1)!;
    if (rawNow - active.lastSampleRawMs < 16 && Math.hypot(point.x - last.x, point.y - last.y) < .008) return;
    active.points.push(point);
    active.lastSampleRawMs = rawNow;
  };
  const pointerEnd = (role: SwipeRole, event: React.PointerEvent<HTMLButtonElement>) => {
    const active = activeRef.current[role];
    if (!active || active.pointerId !== event.pointerId) return;
    event.preventDefault();
    const rawNow = performance.now();
    const finalPoint = pointForEvent(event);
    const last = active.points.at(-1)!;
    if (Math.hypot(finalPoint.x - last.x, finalPoint.y - last.y) > .002) active.points.push(finalPoint);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    const gesture: SwipeGesture = { id: active.id, role, pointerId: active.pointerId, rawStartMs: active.rawStartMs, rawEndMs: rawNow, startMs: active.startMs, endMs: finalPoint.tMs, points: active.points };
    activeRef.current[role] = null;
    pendingRef.current[role] = gesture;
    setTracing((value) => ({ ...value, [role]: false }));
    setPending((value) => ({ ...value, [role]: true }));
    setNotice(`${role === 'child' ? '儿童' : '家长'}完成滑动，等待伙伴`);
    void appendEvent(role, 'swipe_trace_completed', { t_ms: rawNow, pointer_id: event.pointerId, target_id: `${role.toUpperCase()}_SWIPE_ZONE`, payload: { swipe_id: gesture.id, segment_index: segmentIndexRef.current, required_direction: config.directions[segmentIndexRef.current], raw_start_ms: gesture.rawStartMs, raw_end_ms: gesture.rawEndMs, logical_start_ms: gesture.startMs, logical_end_ms: gesture.endMs, trajectory_points: gesture.points } });
    const child = pendingRef.current.child;
    const parent = pendingRef.current.parent;
    if (child && parent) classifyPair(child, parent);
  };
  const pointerCancel = (role: SwipeRole, event: React.PointerEvent<HTMLButtonElement>) => {
    const active = activeRef.current[role];
    if (!active || active.pointerId !== event.pointerId) return;
    activeRef.current[role] = null;
    technicalInvalidRef.current += 1;
    setTracing((value) => ({ ...value, [role]: false }));
    void appendEvent(role, 'swipe_cancelled', { pointer_id: event.pointerId, target_id: `${role.toUpperCase()}_SWIPE_ZONE`, invalid_reason: 'pointercancel', payload: { swipe_id: active.id } });
  };
  const togglePause = () => {
    if (paused) {
      if (pausedAtRef.current !== null) pauseAccumRef.current += performance.now() - pausedAtRef.current;
      pausedAtRef.current = null;
      setPaused(false);
      setNotice('继续游戏，看方向一起滑');
    } else {
      clearTimer();
      pausedAtRef.current = performance.now();
      (['child', 'parent'] as SwipeRole[]).forEach((role) => { const active = activeRef.current[role]; if (active) { technicalInvalidRef.current += 1; void appendEvent(role, 'swipe_cancelled', { invalid_reason: 'paused_during_swipe', payload: { swipe_id: active.id } }); } });
      activeRef.current = { child: null, parent: null };
      if (pendingRef.current.child || pendingRef.current.parent) unpairedCountRef.current += Number(Boolean(pendingRef.current.child)) + Number(Boolean(pendingRef.current.parent));
      clearPending();
      setTracing({ child: false, parent: false });
      setPaused(true);
      setNotice('已暂停，继续后请重新一起滑');
    }
  };
  const abort = async () => { if (trialOpenRef.current) await finishTrial('skipped_or_withdrawn'); await appendEvent('system', 'session_aborted', { outcome: 'skipped_or_withdrawn' }); onExit(); };

  if (stage === 'intro') return <main className="game-intro grocery-sky"><header className="topbar transparent"><button className="icon-button" onClick={onExit}>←</button><span className="status-pill">{mode === 'train' ? '训练模式' : `${phase} 标准化测试`}</span></header><section className="intro-card"><div className="mascot-box river-intro-art" aria-hidden="true">🛶</div><div className="intro-copy"><span className="eyebrow">乐园大冒险 · 共同滑动</span><h1>欢乐漂流记</h1><p className="lead">看河道的方向，儿童和家长在自己的区域朝同一个方向滑动。</p><div className="rule-strip"><span>① 看路线方向</span><span>② 两个人一起滑</span><span>③ 配合推动小船</span></div><p className="mode-explain">系统会记录双方的滑动时间、轨迹、方向、距离和速度。</p><button className="primary large" onClick={() => void startGame()}>开始漂流</button></div></section></main>;
  if (stage === 'level-up') return <main className="celebration-screen river-level-screen"><div className="level-burst"><span className="level-badge" aria-hidden="true" /><h1>进入新的河道！</h1><p>下一关会增加转弯和组合方向</p></div></main>;
  if (stage === 'finished') return <main className="finish-page grocery-sky"><section className="finish-card card"><div className="finish-art">🛶</div><span className="eyebrow">滑动任务已保存</span><h1>{mode === 'train' ? '今天的漂流任务完成啦！' : `${phase} 测试已完成`}</h1><p>完成 {outcomes.length} 条真实漂流路线，保存 {savedEventCount} 条原始事件。</p><div className="button-row centered wrap"><button className="secondary" onClick={() => void downloadJsonExport()}>导出 JSON</button><button className="secondary" onClick={() => void downloadEventsCsv()}>导出事件 CSV</button><button className="primary" onClick={onExit}>返回游戏列表</button></div></section></main>;

  const boatProgress = Math.min(1, (segmentIndex + (lastCoordinated ? .75 : 0)) / config.directions.length);
  const pad = (role: SwipeRole) => <button className={`river-swipe-pad ${role} ${tracing[role] ? 'tracing' : ''} ${pending[role] ? 'waiting' : ''}`} onPointerDown={(event) => pointerDown(role, event)} onPointerMove={(event) => pointerMove(role, event)} onPointerUp={(event) => pointerEnd(role, event)} onPointerCancel={(event) => pointerCancel(role, event)}><span>{role === 'child' ? '儿童滑动区' : '家长滑动区'}</span><b>{pending[role] ? '等待伙伴' : tracing[role] ? '继续滑动' : directionLabel[currentDirection]}</b><strong>{directionArrow[currentDirection]}</strong></button>;
  return <main className="game-page river-game-page"><header className="game-topbar"><button className="icon-button" onClick={() => void abort()}>←</button><div className="game-title"><span className="river-title-icon">🛶</span><div><small>乐园大冒险</small><strong>欢乐漂流记</strong></div></div><div className="game-progress"><span className="status-pill">{mode === 'train' ? `${level} · 共同滑动` : `${phase} · 固定测试`}</span><div className="progress-track"><span style={{ width: `${Math.min(100, (completed / totalTrials) * 100)}%` }} /></div><small>{Math.min(totalTrials, completed + 1)} / {totalTrials}</small></div><button className="quiet-button" onClick={togglePause}>{paused ? '继续' : '暂停'}</button></header><section className="river-stage"><div className="river-status"><strong>{paused ? '已暂停' : feedback ?? notice}</strong><span>河段 {Math.min(config.directions.length, segmentIndex + 1)} / {config.directions.length} · 尝试 {attempt + 1} / {config.maxAttemptsPerSegment} · 剩余 {Math.ceil(remainingMs / 1000)} 秒</span></div><div className={`river-scene ${lastCoordinated === true ? 'river-success' : lastCoordinated === false ? 'river-wobble' : ''}`}><div className="river-banks top" /><div className="river-water"><div className="river-current">{config.directions.map((direction, index) => <span className={index < segmentIndex ? 'passed' : index === segmentIndex ? 'active' : ''} key={`${direction}-${index}`}>{directionArrow[direction]}</span>)}</div><div className="river-boat" style={{ left: `${10 + boatProgress * 76}%` }}><span>🛶</span><i>儿童＋家长</i></div><div className="river-finish">终点</div></div><div className="river-banks bottom" /><div className="river-direction-card"><small>本段方向</small><strong>{directionArrow[currentDirection]}</strong><span>{directionLabel[currentDirection]}</span></div></div><div className="river-controls">{pad('child')}<div className={`river-pair-indicator ${pending.child && pending.parent ? 'ready' : ''}`}><strong>{pending.child && pending.parent ? '正在比较' : '共同划船'}</strong><span>{lastCoordinated === true ? '配合成功' : lastCoordinated === false ? '再试一次' : '方向一致'}</span></div>{pad('parent')}</div></section><aside className="prototype-ribbon">双人共同滑动 · 轨迹与方向分析 · 原始路径记录</aside></main>;
}
