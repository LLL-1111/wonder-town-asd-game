import { useCallback, useEffect, useRef, useState } from 'react';
import { balloonTestProtocol, balloonTrainingConfig, identityPrototype, versions } from '../config/protocols';
import type { BalloonMissionConfig } from '../config/protocols';
import { createBalloonMission, stepBalloonMission } from '../core/balloonEngine';
import type { BalloonEngineEvent, BalloonMissionState } from '../core/balloonEngine';
import { createId, wallTime } from '../core/ids';
import { downloadEventsCsv, downloadJsonExport, eventStore } from '../data/eventStore';
import type { ActorRole, BalloonLevelId, GameEvent, GameMode, TestPhase, TrialOutcome, TrialSummary } from '../types';

type Props = { mode: GameMode; phase: TestPhase; pairId: string; onExit: () => void };
type Stage = 'intro' | 'playing' | 'level-up' | 'finished';
type PlayerRole = 'child' | 'parent';

const LEVELS: BalloonLevelId[] = ['L1', 'L2', 'L3', 'L4'];
const RELEASE_SYNC_WINDOW_MS = 450;
const roleName = (role: PlayerRole) => role === 'child' ? '儿童' : '家长';
const missionName = (config: BalloonMissionConfig) => config.missionKind === 'launch' ? '共同起飞' : config.missionKind === 'cloud-route' ? '穿越云层' : config.missionKind === 'star-collection' ? '收集星星' : '风中运输';

export default function BalloonGame({ mode, phase, pairId, onExit }: Props) {
  const sessionId = useRef(createId(mode === 'train' ? 'TRAIN' : phase ?? 'TEST')).current;
  const [stage, setStage] = useState<Stage>('intro');
  const [levelIndex, setLevelIndex] = useState(0);
  const [trialIndex, setTrialIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [notice, setNotice] = useState('两个人一起按住，为气球充气');
  const [remainingMs, setRemainingMs] = useState(0);
  const [syncRate, setSyncRate] = useState(0);
  const [mission, setMission] = useState<BalloonMissionState>(createBalloonMission);
  const [pressed, setPressed] = useState<Record<PlayerRole, boolean>>({ child: false, parent: false });
  const [outcomes, setOutcomes] = useState<TrialOutcome[]>([]);
  const [savedEventCount, setSavedEventCount] = useState(0);
  const trialIdRef = useRef<string | null>(null);
  const trialOpenRef = useRef(false);
  const trialStartRef = useRef(0);
  const missionRef = useRef<BalloonMissionState>(createBalloonMission());
  const pressedRef = useRef<Record<PlayerRole, boolean>>({ child: false, parent: false });
  const firstDownRef = useRef<Record<PlayerRole, number | null>>({ child: null, parent: null });
  const currentDownRef = useRef<Record<PlayerRole, number | null>>({ child: null, parent: null });
  const lastUpRef = useRef<Record<PlayerRole, number | null>>({ child: null, parent: null });
  const overlapStartRef = useRef<number | null>(null);
  const overlapAccumRef = useRef(0);
  const activeStartRef = useRef<number | null>(null);
  const activeAccumRef = useRef(0);
  const desyncCountRef = useRef(0);
  const resyncCountRef = useRef(0);
  const synchronizedReleaseRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const lastFrameRef = useRef<number | null>(null);
  const pausedAtRef = useRef<number | null>(null);
  const level = LEVELS[levelIndex];
  const config = mode === 'train' ? balloonTrainingConfig[level] : balloonTestProtocol;
  const totalTrials = mode === 'train' ? LEVELS.reduce((sum, item) => sum + balloonTrainingConfig[item].quota, 0) : balloonTestProtocol.trialCount;
  const completed = mode === 'train' ? LEVELS.slice(0, levelIndex).reduce((sum, item) => sum + balloonTrainingConfig[item].quota, 0) + trialIndex : trialIndex;

  const clearTimer = () => { if (timerRef.current !== null) window.clearInterval(timerRef.current); timerRef.current = null; };
  const appendEvent = useCallback(async (actorRole: ActorRole, eventType: string, data: Partial<GameEvent> = {}) => {
    await eventStore.appendEvent({ event_id: createId('EV'), pair_id: pairId, session_id: sessionId, trial_id: data.trial_id ?? trialIdRef.current, mode, phase, domain_id: 'touch', game_id: 'TOUCH_01', level: mode === 'train' ? level : null, actor_role: actorRole, actor_identity_method: identityPrototype.id, event_type: eventType, t_ms: data.t_ms ?? performance.now(), wall_time: wallTime(), target_id: data.target_id ?? null, pointer_id: data.pointer_id, outcome: data.outcome, invalid_reason: data.invalid_reason, payload: data.payload, config_version: mode === 'train' ? 'train-touch-01-balloon-0.2' : 'test-touch-01-balloon-0.2', scorer_version: 'touch-mission-sync-0.2', asset_version: versions.assets });
    setSavedEventCount((value) => value + 1);
  }, [level, mode, pairId, phase, sessionId]);

  const resetTrialState = useCallback(() => {
    const freshMission = createBalloonMission();
    missionRef.current = freshMission;
    pressedRef.current = { child: false, parent: false };
    firstDownRef.current = { child: null, parent: null };
    currentDownRef.current = { child: null, parent: null };
    lastUpRef.current = { child: null, parent: null };
    overlapStartRef.current = null;
    overlapAccumRef.current = 0;
    activeStartRef.current = null;
    activeAccumRef.current = 0;
    desyncCountRef.current = 0;
    resyncCountRef.current = 0;
    synchronizedReleaseRef.current = 0;
    lastFrameRef.current = null;
    setMission(freshMission);
    setPressed({ child: false, parent: false });
    setSyncRate(0);
    setFeedback(null);
    setNotice('两个人一起按住，为气球充气');
    setPaused(false);
  }, []);

  const advance = useCallback(() => {
    resetTrialState();
    if (mode === 'test') {
      if (trialIndex + 1 >= totalTrials) setStage('finished');
      else setTrialIndex((value) => value + 1);
      return;
    }
    if (trialIndex + 1 < balloonTrainingConfig[level].quota) {
      setTrialIndex((value) => value + 1);
      return;
    }
    if (levelIndex < LEVELS.length - 1) {
      setStage('level-up');
      window.setTimeout(() => { setLevelIndex((value) => value + 1); setTrialIndex(0); setStage('playing'); }, 1600);
    } else setStage('finished');
  }, [level, levelIndex, mode, resetTrialState, totalTrials, trialIndex]);

  const finish = useCallback(async (outcome: TrialOutcome, finalMission = missionRef.current) => {
    if (!trialOpenRef.current || !trialIdRef.current) return;
    trialOpenRef.current = false;
    clearTimer();
    const now = performance.now();
    const finalOverlap = overlapAccumRef.current + (overlapStartRef.current === null ? 0 : now - overlapStartRef.current);
    const finalActive = activeAccumRef.current + (activeStartRef.current === null ? 0 : now - activeStartRef.current);
    const totalTaskTime = Math.max(0, now - trialStartRef.current);
    const finalSyncRate = finalActive > 0 ? Math.min(1, finalOverlap / finalActive) : 0;
    const childFirst = firstDownRef.current.child;
    const parentFirst = firstDownRef.current.parent;
    const firstTouchGap = childFirst === null || parentFirst === null ? null : Math.abs(childFirst - parentFirst);
    overlapAccumRef.current = finalOverlap;
    overlapStartRef.current = null;
    activeAccumRef.current = finalActive;
    activeStartRef.current = null;
    pressedRef.current = { child: false, parent: false };
    setPressed({ child: false, parent: false });
    setSyncRate(finalSyncRate);
    const metrics = { total_task_time_ms: totalTaskTime, mission_completion_time_ms: outcome === 'completed_valid' ? totalTaskTime : null, simultaneous_touch_ms: finalOverlap, effective_operation_time_ms: finalActive, sync_rate: finalSyncRate, first_child_down_ms: childFirst, first_parent_down_ms: parentFirst, first_touch_gap_ms: firstTouchGap, desync_count: desyncCountRef.current, resync_count: resyncCountRef.current, synchronized_release_count: synchronizedReleaseRef.current, checkpoint_retry_count: finalMission.checkpointRetries, stability_remaining: finalMission.stability, cloud_gates_passed: finalMission.passedGates.length, stars_collected: finalMission.collectedStars.length, mission_kind: config.missionKind, destination: config.destination };
    const summary: TrialSummary = { trial_id: trialIdRef.current, session_id: sessionId, game_id: 'TOUCH_01', mode, phase, level: mode === 'train' ? level : null, opportunity_index: completed + 1, target_id: config.destination, outcome, child_target_id: 'CHILD_CONTROL', parent_target_id: 'PARENT_CONTROL', child_t_ms: childFirst, parent_t_ms: parentFirst, inter_touch_ms: firstTouchGap, valid_for_scoring: !['technical_invalid', 'skipped_or_withdrawn'].includes(outcome), actor_identity_method: identityPrototype.id, config_version: mode === 'train' ? 'train-touch-01-balloon-0.2' : 'test-touch-01-balloon-0.2', scorer_version: 'touch-mission-sync-0.2', metrics };
    await eventStore.saveTrial(summary);
    await appendEvent('system', 'trial_classified', { target_id: config.destination, outcome, payload: { summary, ...metrics } });
    setOutcomes((items) => [...items, outcome]);
    setFeedback(outcome === 'completed_valid' ? `任务完成，到达${config.destination}！` : outcome === 'no_response' ? '这次还没有到达终点' : '本次操作已记录');
    window.setTimeout(advance, mode === 'test' ? 700 : 1200);
  }, [advance, appendEvent, completed, config.destination, config.missionKind, level, mode, phase, sessionId]);

  const handleEngineEvent = useCallback((event: BalloonEngineEvent, now: number) => {
    void appendEvent('system', event.type, { t_ms: now, target_id: event.targetId, payload: event.payload });
    if (event.type === 'takeoff_completed') setNotice('起飞啦！一起控制高度');
    else if (event.type === 'cloud_gate_passed') setNotice('稳稳穿过云层！');
    else if (event.type === 'star_collected') setNotice('收集到一颗星星！');
    else if (event.type === 'weather_event_started') setNotice('风来啦，两个人一起按住保持稳定！');
    else if (event.type === 'weather_event_completed') setNotice('一起穿过大风啦！');
    else if (event.type === 'checkpoint_restarted') setNotice(event.payload?.reason === 'star_missed' ? '差一点碰到星星，再来一次' : '气球偏离路线，一起调整高度');
  }, [appendEvent]);

  useEffect(() => {
    if (stage !== 'playing' || feedback || paused) return;
    if (!trialOpenRef.current) {
      trialOpenRef.current = true;
      trialIdRef.current = createId('TRIAL');
      trialStartRef.current = performance.now();
      lastFrameRef.current = performance.now();
      setRemainingMs(config.missionWindowMs);
      void appendEvent('system', 'trial_open', { target_id: config.destination, payload: { opportunity_index: completed + 1, mission_kind: config.missionKind, mission_window_ms: config.missionWindowMs, cloud_gate_count: config.cloudGates.length, star_count: config.stars.length, weather_event_count: config.weather.length, destination: config.destination } });
    }
    clearTimer();
    timerRef.current = window.setInterval(() => {
      const now = performance.now();
      const delta = Math.max(0, now - (lastFrameRef.current ?? now));
      lastFrameRef.current = now;
      const result = stepBalloonMission(missionRef.current, { childPressed: pressedRef.current.child, parentPressed: pressedRef.current.parent }, config, delta);
      missionRef.current = result.state;
      setMission(result.state);
      result.events.forEach((event) => handleEngineEvent(event, now));
      const currentOverlap = overlapAccumRef.current + (overlapStartRef.current === null ? 0 : now - overlapStartRef.current);
      const currentActive = activeAccumRef.current + (activeStartRef.current === null ? 0 : now - activeStartRef.current);
      setSyncRate(currentActive > 0 ? Math.min(1, currentOverlap / currentActive) : 0);
      const remaining = Math.max(0, config.missionWindowMs - (now - trialStartRef.current));
      setRemainingMs(remaining);
      if (result.state.phase === 'arrived') void finish('completed_valid', result.state);
      else if (remaining <= 0) void finish('no_response', result.state);
    }, 100);
    return clearTimer;
  }, [appendEvent, completed, config, feedback, finish, handleEngineEvent, paused, stage]);
  useEffect(() => () => clearTimer(), []);

  const startGame = async () => {
    await eventStore.saveSession({ session_id: sessionId, pair_id: pairId, mode, phase, game_id: 'TOUCH_01', started_at: wallTime(), protocol_version: mode === 'train' ? 'train-touch-01-balloon-0.2' : 'test-touch-01-balloon-0.2', actor_identity_method: identityPrototype.id, identity_validation_status: balloonTestProtocol.validationStatus, material_set: mode === 'test' ? balloonTestProtocol.materialSet : null, response_window_ms: config.missionWindowMs });
    await appendEvent('system', 'session_started', { payload: { real_input_only: true, rule: 'shared-hold-mission-control' } });
    setStage('playing');
  };
  const closeActiveWindow = (now: number) => { if (activeStartRef.current !== null) { activeAccumRef.current += now - activeStartRef.current; activeStartRef.current = null; } };
  const closeOverlapWindow = (now: number) => { if (overlapStartRef.current !== null) { overlapAccumRef.current += now - overlapStartRef.current; overlapStartRef.current = null; void appendEvent('system', 'overlap_end', { t_ms: now, target_id: 'BALLOON', payload: { overlap_ms: overlapAccumRef.current } }); } };
  const handleDown = (role: PlayerRole, event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    if (!trialOpenRef.current || paused || feedback || currentDownRef.current[role] !== null) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const now = performance.now();
    const wasAnyPressed = currentDownRef.current.child !== null || currentDownRef.current.parent !== null;
    currentDownRef.current[role] = now;
    if (firstDownRef.current[role] === null) firstDownRef.current[role] = now;
    if (!wasAnyPressed) activeStartRef.current = now;
    pressedRef.current = { ...pressedRef.current, [role]: true };
    setPressed(pressedRef.current);
    void appendEvent(role, 'touch_down', { t_ms: now, target_id: `${role.toUpperCase()}_CONTROL`, pointer_id: event.pointerId, payload: { role, action: 'hold_start' } });
    if (currentDownRef.current.child !== null && currentDownRef.current.parent !== null && overlapStartRef.current === null) {
      const isResync = overlapAccumRef.current > 0;
      overlapStartRef.current = now;
      if (isResync) { resyncCountRef.current += 1; void appendEvent('system', 'resync_completed', { t_ms: now, target_id: 'BALLOON', payload: { resync_count: resyncCountRef.current } }); }
      setNotice(missionRef.current.phase === 'preparing' ? '配合成功，气球正在充气' : '共同动力开启，气球向上飞');
      void appendEvent('system', 'overlap_start', { t_ms: now, target_id: 'BALLOON', payload: { child_down_ms: currentDownRef.current.child, parent_down_ms: currentDownRef.current.parent } });
    } else setNotice(`等等${roleName(role === 'child' ? 'parent' : 'child')}，一起操作`);
  };
  const handleUp = (role: PlayerRole, event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    if (currentDownRef.current[role] === null) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    const now = performance.now();
    const wasOverlapping = overlapStartRef.current !== null;
    currentDownRef.current[role] = null;
    lastUpRef.current[role] = now;
    pressedRef.current = { ...pressedRef.current, [role]: false };
    setPressed(pressedRef.current);
    void appendEvent(role, 'touch_up', { t_ms: now, target_id: `${role.toUpperCase()}_CONTROL`, pointer_id: event.pointerId, payload: { role, action: 'hold_end' } });
    closeOverlapWindow(now);
    const stillPressed = currentDownRef.current.child !== null || currentDownRef.current.parent !== null;
    if (stillPressed) {
      if (wasOverlapping) { desyncCountRef.current += 1; void appendEvent('system', 'desync_started', { t_ms: now, target_id: 'BALLOON', payload: { desync_count: desyncCountRef.current, released_role: role } }); }
      setNotice('一位伙伴松开了，气球正在摇晃');
    } else {
      closeActiveWindow(now);
      const childUp = lastUpRef.current.child;
      const parentUp = lastUpRef.current.parent;
      if (childUp !== null && parentUp !== null && Math.abs(childUp - parentUp) <= RELEASE_SYNC_WINDOW_MS) {
        synchronizedReleaseRef.current += 1;
        void appendEvent('system', 'joint_glide_started', { t_ms: now, target_id: 'BALLOON', payload: { release_gap_ms: Math.abs(childUp - parentUp), synchronized_release_count: synchronizedReleaseRef.current } });
      }
      setNotice(missionRef.current.phase === 'flight' ? '共同滑翔中，需要上升时再一起按住' : '两个人一起按住，为气球充气');
    }
  };
  const togglePause = () => {
    if (paused) { if (pausedAtRef.current !== null) trialStartRef.current += performance.now() - pausedAtRef.current; pausedAtRef.current = null; lastFrameRef.current = performance.now(); setPaused(false); }
    else { const now = performance.now(); clearTimer(); pausedAtRef.current = now; closeOverlapWindow(now); closeActiveWindow(now); currentDownRef.current = { child: null, parent: null }; pressedRef.current = { child: false, parent: false }; setPressed({ child: false, parent: false }); setNotice('已暂停，继续后请重新一起操作'); setPaused(true); }
  };
  const abort = async () => { if (trialOpenRef.current) await finish('skipped_or_withdrawn'); await appendEvent('system', 'session_aborted', { outcome: 'skipped_or_withdrawn' }); onExit(); };

  if (stage === 'intro') return <main className="game-intro grocery-sky"><header className="topbar transparent"><button className="icon-button" onClick={onExit}>←</button><span className="status-pill">{mode === 'train' ? '训练模式' : `${phase} 标准化测试`}</span></header><section className="intro-card"><div className="mascot-box"><img className="intro-characters" src="/assets/parent-child-cutout-v1.png" alt="儿童和家长" /></div><div className="intro-copy"><span className="eyebrow">乐园大冒险 · 共同驾驶</span><h1>气球飞上天</h1><p className="lead">两个人一起给气球充气，再用共同按住和共同松开控制飞行。</p><div className="rule-strip"><span>一起按住：上升</span><span>一起松开：滑翔</span><span>配合完成天空任务</span></div><p className="mode-explain">穿过云层、收集星星并把物品送到目的地。只有配合才能让气球保持稳定。</p><button className="primary large" onClick={() => void startGame()}>开始天空冒险</button></div></section></main>;
  if (stage === 'level-up') return <main className="celebration-screen balloon-level-screen"><div className="level-burst"><span className="level-badge" aria-hidden="true" /><h1>新的天空任务！</h1><p>下一关将加入新的路线挑战</p></div></main>;
  if (stage === 'finished') return <main className="finish-page grocery-sky"><section className="finish-card card"><div className="finish-art">🎈</div><span className="eyebrow">触摸任务已保存</span><h1>{mode === 'train' ? '今天的天空冒险完成啦！' : `${phase} 测试已完成`}</h1><p>完成 {outcomes.filter((item) => item === 'completed_valid').length} 次合作任务，保存 {savedEventCount} 条原始事件。</p><div className="button-row centered wrap"><button className="secondary" onClick={() => void downloadJsonExport()}>导出 JSON</button><button className="secondary" onClick={() => void downloadEventsCsv()}>导出事件 CSV</button><button className="primary" onClick={onExit}>返回游戏列表</button></div></section></main>;

  const bothPressed = pressed.child && pressed.parent;
  const nextGate = config.cloudGates.find((gate) => !mission.passedGates.includes(gate.id));
  const nextStar = config.stars.find((star) => !mission.collectedStars.includes(star.id));
  const taskHint = mission.phase === 'preparing' ? '共同给气球充气' : mission.route >= .95 ? '一起松开，让气球降落' : nextGate ? '调整高度，穿过云门' : nextStar ? '调整高度，碰到星星' : `前往${config.destination}`;
  return <main className="game-page balloon-game-page"><header className="game-topbar"><button className="icon-button" onClick={() => void abort()}>←</button><div className="game-title"><span className="mini-cart" aria-hidden="true" /><div><small>乐园大冒险</small><strong>气球飞上天</strong></div></div><div className="game-progress"><span className="status-pill">{mode === 'train' ? `${level} · ${missionName(config)}` : `${phase} · 固定测试`}</span><div className="progress-track"><span style={{ width: `${Math.min(100, (completed / totalTrials) * 100)}%` }} /></div><small>{Math.min(totalTrials, completed + 1)} / {totalTrials}</small></div><button className="quiet-button" onClick={togglePause}>{paused ? '继续' : '暂停'}</button></header><section className="balloon-stage"><div className="balloon-status"><strong>{paused ? '已暂停' : feedback ?? notice}</strong><span>当前任务：{taskHint} · 同步率 {Math.round(syncRate * 100)}% · 剩余 {Math.ceil(remainingMs / 1000)} 秒</span></div><div className={`balloon-scene mission-${config.missionKind}`}><div className="balloon-route-line" />{config.cloudGates.map((gate) => <div className={`balloon-gate ${mission.passedGates.includes(gate.id) ? 'completed' : ''}`} key={gate.id} style={{ left: `${28 + (gate.x - mission.route) * 82}%`, top: `${(1 - gate.maxAltitude) * 78 + 4}%`, height: `${(gate.maxAltitude - gate.minAltitude) * 78}%` }}><span>云门</span></div>)}{config.stars.map((star) => <div className={`balloon-star ${mission.collectedStars.includes(star.id) ? 'collected' : ''}`} key={star.id} style={{ left: `${28 + (star.x - mission.route) * 82}%`, top: `${(1 - star.altitude) * 78 + 4}%` }}>★</div>)}{config.weather.map((weather) => <div className={`balloon-wind ${mission.activeWeatherId === weather.id ? 'active' : ''}`} key={weather.id} style={{ left: `${28 + (weather.startX - mission.route) * 82}%`, width: `${(weather.endX - weather.startX) * 82}%` }}>{weather.direction > 0 ? '≋→' : '←≋'}</div>)}<div className="balloon-destination" style={{ left: `${28 + (1 - mission.route) * 82}%` }}>{config.destination}</div><div className="balloon-craft" style={{ left: '27%', top: `${(1 - mission.altitude) * 72 + 3}%` }}><div className={`balloon-visual ${bothPressed ? 'is-flying' : ''} ${mission.control === 'child-only' || mission.control === 'parent-only' ? 'is-wobbling' : ''} ${feedback?.includes('任务完成') ? 'is-success' : ''}`} style={{ transform: mission.phase === 'preparing' ? `scale(${.68 + mission.inflation * .32})` : undefined }}><span className="balloon-knot" /><span className="balloon-string" /><span className="balloon-cargo">{config.missionKind === 'weather-delivery' ? '📦' : '🧺'}</span></div></div><div className="balloon-hud"><span>动力<strong>{Math.round(mission.energy)}%</strong></span><span>稳定<strong>{Math.round(mission.stability)}%</strong></span><span>{mission.phase === 'preparing' ? '充气' : '路线'}<strong>{Math.round((mission.phase === 'preparing' ? mission.inflation : mission.route) * 100)}%</strong></span><span>星星<strong>{mission.collectedStars.length}/{config.stars.length}</strong></span></div></div><div className="balloon-controls"><button className={`balloon-pad child ${pressed.child ? 'pressed' : ''}`} onPointerDown={(event) => handleDown('child', event)} onPointerUp={(event) => handleUp('child', event)} onPointerCancel={(event) => handleUp('child', event)}><span>儿童操作区</span><strong>{pressed.child ? '按住中' : '按住 / 松开'}</strong></button><div className={`balloon-sync-orb ${bothPressed ? 'synced' : ''}`}><strong>{bothPressed ? '共同动力' : mission.control === 'joint-glide' ? '共同滑翔' : '等待配合'}</strong></div><button className={`balloon-pad parent ${pressed.parent ? 'pressed' : ''}`} onPointerDown={(event) => handleDown('parent', event)} onPointerUp={(event) => handleUp('parent', event)} onPointerCancel={(event) => handleUp('parent', event)}><span>家长操作区</span><strong>{pressed.parent ? '按住中' : '按住 / 松开'}</strong></button></div></section><aside className="prototype-ribbon">共同长按驾驶 · 云层路线 · 星星收集 · 风中运输</aside></main>;
}
