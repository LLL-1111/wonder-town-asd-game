import { useCallback, useEffect, useRef, useState } from 'react';
import { fountainTestProtocol, fountainTrainingConfig, identityPrototype, versions } from '../config/protocols';
import { scoreRhythmTrial } from '../core/rhythmScoring';
import type { RhythmRole, RhythmTap } from '../core/rhythmScoring';
import { createId, wallTime } from '../core/ids';
import { downloadEventsCsv, downloadJsonExport, eventStore } from '../data/eventStore';
import type { ActorRole, GameEvent, GameMode, LevelId, TestPhase, TrialOutcome, TrialSummary } from '../types';

type Props = { mode: GameMode; phase: TestPhase; pairId: string; onExit: () => void };
type Stage = 'intro' | 'playing' | 'level-up' | 'finished';
const LEVELS: LevelId[] = ['L1', 'L2', 'L3'];
const COUNTDOWN_MS = 1800;

export default function RhythmFountainGame({ mode, phase, pairId, onExit }: Props) {
  const sessionId = useRef(createId(mode === 'train' ? 'TRAIN' : phase ?? 'TEST')).current;
  const [stage, setStage] = useState<Stage>('intro');
  const [levelIndex, setLevelIndex] = useState(0);
  const [trialIndex, setTrialIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [notice, setNotice] = useState('准备听节奏');
  const [countdown, setCountdown] = useState(2);
  const [elapsedMs, setElapsedMs] = useState(-COUNTDOWN_MS);
  const [remainingMs, setRemainingMs] = useState(0);
  const [tapFlash, setTapFlash] = useState<Record<RhythmRole, boolean>>({ child: false, parent: false });
  const [jointFlash, setJointFlash] = useState(false);
  const [outcomes, setOutcomes] = useState<TrialOutcome[]>([]);
  const [savedEventCount, setSavedEventCount] = useState(0);
  const trialIdRef = useRef<string | null>(null);
  const trialOpenRef = useRef(false);
  const trialStartRef = useRef(0);
  const cueStartRef = useRef(0);
  const tapsRef = useRef<RhythmTap[]>([]);
  const tapOrderRef = useRef(0);
  const activePointerRef = useRef<Record<RhythmRole, number | null>>({ child: null, parent: null });
  const latestTapRef = useRef<Record<RhythmRole, number | null>>({ child: null, parent: null });
  const cueLoggedRef = useRef(new Set<number>());
  const timerRef = useRef<number | null>(null);
  const pausedAtRef = useRef<number | null>(null);
  const pauseAccumRef = useRef(0);
  const level = LEVELS[levelIndex];
  const config = mode === 'train' ? fountainTrainingConfig[level] : fountainTestProtocol;
  const totalTrials = mode === 'train' ? LEVELS.reduce((sum, item) => sum + fountainTrainingConfig[item].quota, 0) : fountainTestProtocol.trialCount;
  const completed = mode === 'train' ? LEVELS.slice(0, levelIndex).reduce((sum, item) => sum + fountainTrainingConfig[item].quota, 0) + trialIndex : trialIndex;
  const leaderRole: RhythmRole | null = config.cueMode === 'alternating-leader' ? (completed % 2 === 0 ? 'child' : 'parent') : null;
  const logicalNow = () => performance.now() - pauseAccumRef.current;

  const clearTimer = () => { if (timerRef.current !== null) window.clearInterval(timerRef.current); timerRef.current = null; };
  const appendEvent = useCallback(async (actorRole: ActorRole, eventType: string, data: Partial<GameEvent> = {}) => {
    await eventStore.appendEvent({ event_id: createId('EV'), pair_id: pairId, session_id: sessionId, trial_id: data.trial_id ?? trialIdRef.current, mode, phase, domain_id: 'touch', game_id: 'TOUCH_02', level: mode === 'train' ? level : null, actor_role: actorRole, actor_identity_method: identityPrototype.id, event_type: eventType, t_ms: data.t_ms ?? performance.now(), wall_time: wallTime(), target_id: data.target_id ?? null, pointer_id: data.pointer_id, outcome: data.outcome, invalid_reason: data.invalid_reason, payload: data.payload, config_version: mode === 'train' ? 'train-touch-02-fountain-0.1' : 'test-touch-02-fountain-0.1', scorer_version: 'touch-rhythm-pairing-0.1', asset_version: versions.assets });
    setSavedEventCount((value) => value + 1);
  }, [level, mode, pairId, phase, sessionId]);

  const resetTrial = useCallback(() => {
    trialIdRef.current = null;
    tapsRef.current = [];
    tapOrderRef.current = 0;
    activePointerRef.current = { child: null, parent: null };
    latestTapRef.current = { child: null, parent: null };
    cueLoggedRef.current = new Set();
    pauseAccumRef.current = 0;
    pausedAtRef.current = null;
    setElapsedMs(-COUNTDOWN_MS);
    setCountdown(2);
    setTapFlash({ child: false, parent: false });
    setJointFlash(false);
    setFeedback(null);
    setNotice('准备听节奏');
    setPaused(false);
  }, []);

  const advance = useCallback(() => {
    resetTrial();
    if (mode === 'test') {
      if (trialIndex + 1 >= totalTrials) setStage('finished');
      else setTrialIndex((value) => value + 1);
      return;
    }
    if (trialIndex + 1 < fountainTrainingConfig[level].quota) {
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
    const finishedAt = logicalNow();
    const score = scoreRhythmTrial(config.beatOffsetsMs, cueStartRef.current, tapsRef.current, config.responseWindowMs, config.syncWindowMs);
    const outcome: TrialOutcome = forcedOutcome ?? (tapsRef.current.length === 0 ? 'no_response' : score.syncRate >= config.successRate ? 'completed_valid' : 'valid_not_synchronized');
    for (const beat of score.beats) {
      await appendEvent('system', 'beat_classified', { target_id: beat.beatId, outcome: beat.synchronized ? 'completed_valid' : 'valid_not_synchronized', payload: { beat_index: beat.beatIndex, expected_logical_t_ms: beat.expectedMs, child_t_ms: beat.childTap?.rawTMs ?? null, parent_t_ms: beat.parentTap?.rawTMs ?? null, child_logical_t_ms: beat.childTap?.tMs ?? null, parent_logical_t_ms: beat.parentTap?.tMs ?? null, child_cue_error_ms: beat.childCueErrorMs, parent_cue_error_ms: beat.parentCueErrorMs, inter_touch_ms: beat.interTouchMs, synchronized: beat.synchronized } });
    }
    for (const tap of score.extraTaps) {
      await appendEvent(tap.role, 'tap_extra', { t_ms: tap.rawTMs ?? tap.tMs, target_id: null, pointer_id: tap.pointerId, invalid_reason: 'no_unmatched_beat_in_response_window', payload: { tap_id: tap.id, tap_order: tap.order, logical_t_ms: tap.tMs } });
    }
    const firstChild = tapsRef.current.find((tap) => tap.role === 'child')?.rawTMs ?? null;
    const firstParent = tapsRef.current.find((tap) => tap.role === 'parent')?.rawTMs ?? null;
    const metrics = { expected_beat_count: score.beats.length, valid_pair_count: score.validPairCount, child_miss_count: score.childMissCount, parent_miss_count: score.parentMissCount, child_extra_count: score.childExtraCount, parent_extra_count: score.parentExtraCount, mean_inter_touch_ms: score.meanInterTouchMs, max_inter_touch_ms: score.maxInterTouchMs, rhythm_sync_rate: score.syncRate, completion_time_ms: Math.max(0, finishedAt - trialStartRef.current), response_window_ms: config.responseWindowMs, sync_window_ms: config.syncWindowMs, cue_mode: config.cueMode, leader_role: leaderRole };
    const summary: TrialSummary = { trial_id: trialIdRef.current, session_id: sessionId, game_id: 'TOUCH_02', mode, phase, level: mode === 'train' ? level : null, opportunity_index: completed + 1, target_id: 'FOUNTAIN_RHYTHM', outcome, child_target_id: 'CHILD_RHYTHM_PAD', parent_target_id: 'PARENT_RHYTHM_PAD', child_t_ms: firstChild, parent_t_ms: firstParent, inter_touch_ms: score.meanInterTouchMs, valid_for_scoring: !['technical_invalid', 'skipped_or_withdrawn'].includes(outcome), actor_identity_method: identityPrototype.id, config_version: mode === 'train' ? 'train-touch-02-fountain-0.1' : 'test-touch-02-fountain-0.1', scorer_version: 'touch-rhythm-pairing-0.1', metrics };
    await eventStore.saveTrial(summary);
    await appendEvent('system', 'trial_classified', { target_id: 'FOUNTAIN_RHYTHM', outcome, payload: { summary, ...metrics } });
    setOutcomes((items) => [...items, outcome]);
    setFeedback(mode === 'test' ? '本段节奏已记录' : outcome === 'completed_valid' ? '配合得很好，喷泉亮起来啦！' : outcome === 'no_response' ? '这段节奏结束啦，下一段再试试' : '听一听伙伴的节奏，下一段继续');
    window.setTimeout(advance, mode === 'test' ? 700 : 1100);
  }, [advance, appendEvent, completed, config, leaderRole, level, mode, phase, sessionId]);

  useEffect(() => {
    if (stage !== 'playing' || feedback || paused) return;
    if (!trialOpenRef.current) {
      trialOpenRef.current = true;
      trialIdRef.current = createId('TRIAL');
      pauseAccumRef.current = 0;
      trialStartRef.current = performance.now();
      cueStartRef.current = trialStartRef.current + COUNTDOWN_MS;
      tapsRef.current = [];
      cueLoggedRef.current = new Set();
      const trialDuration = COUNTDOWN_MS + config.beatOffsetsMs.at(-1)! + config.responseWindowMs + 350;
      setRemainingMs(trialDuration);
      void appendEvent('system', 'trial_open', { target_id: 'FOUNTAIN_RHYTHM', payload: { opportunity_index: completed + 1, beat_offsets_ms: config.beatOffsetsMs, response_window_ms: config.responseWindowMs, sync_window_ms: config.syncWindowMs, cue_mode: config.cueMode, leader_role: leaderRole } });
    }
    clearTimer();
    timerRef.current = window.setInterval(() => {
      const now = logicalNow();
      const elapsed = now - cueStartRef.current;
      const endAt = config.beatOffsetsMs.at(-1)! + config.responseWindowMs + 350;
      setElapsedMs(elapsed);
      setCountdown(Math.max(0, Math.ceil(-elapsed / 1000)));
      setRemainingMs(Math.max(0, endAt - elapsed));
      config.beatOffsetsMs.forEach((offset, index) => {
        if (elapsed >= offset && !cueLoggedRef.current.has(index)) {
          cueLoggedRef.current.add(index);
          void appendEvent('system', 'rhythm_cue', { target_id: `BEAT_${index + 1}`, payload: { beat_index: index, expected_logical_t_ms: cueStartRef.current + offset, leader_role: leaderRole } });
          setNotice(leaderRole ? `${leaderRole === 'child' ? '儿童' : '家长'}带节奏，两个人一起点` : '看喷泉，一起点！');
        }
      });
      if (elapsed >= endAt) void finishTrial();
    }, 25);
    return clearTimer;
  }, [appendEvent, completed, config, feedback, finishTrial, leaderRole, paused, stage]);
  useEffect(() => () => clearTimer(), []);

  const startGame = async () => {
    await eventStore.saveSession({ session_id: sessionId, pair_id: pairId, mode, phase, game_id: 'TOUCH_02', started_at: wallTime(), protocol_version: mode === 'train' ? 'train-touch-02-fountain-0.1' : 'test-touch-02-fountain-0.1', actor_identity_method: identityPrototype.id, identity_validation_status: fountainTestProtocol.validationStatus, material_set: mode === 'test' ? fountainTestProtocol.materialSet : null, response_window_ms: config.responseWindowMs, sync_window_ms: config.syncWindowMs });
    await appendEvent('system', 'session_started', { payload: { real_input_only: true, rule: 'one_to_one_rhythm_tap_pairing' } });
    setStage('playing');
  };

  const pointerDown = (role: RhythmRole, event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    if (!trialOpenRef.current || paused || feedback) return;
    if (activePointerRef.current[role] !== null) {
      void appendEvent(role, 'extra_pointer_ignored', { pointer_id: event.pointerId, target_id: `${role.toUpperCase()}_RHYTHM_PAD`, invalid_reason: 'role_already_has_pointer' });
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    const rawNow = performance.now();
    const now = rawNow - pauseAccumRef.current;
    activePointerRef.current[role] = event.pointerId;
    tapOrderRef.current += 1;
    const tap: RhythmTap = { id: createId('TAP'), role, tMs: now, rawTMs: rawNow, pointerId: event.pointerId, order: tapOrderRef.current };
    tapsRef.current.push(tap);
    latestTapRef.current[role] = now;
    setTapFlash((value) => ({ ...value, [role]: true }));
    window.setTimeout(() => setTapFlash((value) => ({ ...value, [role]: false })), 160);
    const otherRole = role === 'child' ? 'parent' : 'child';
    const otherTap = latestTapRef.current[otherRole];
    if (otherTap !== null && Math.abs(now - otherTap) <= config.syncWindowMs) {
      setJointFlash(true);
      window.setTimeout(() => setJointFlash(false), 260);
    }
    const nearestBeat = config.beatOffsetsMs.reduce((best, offset, index) => Math.abs(now - (cueStartRef.current + offset)) < best.distance ? { index, distance: Math.abs(now - (cueStartRef.current + offset)) } : best, { index: -1, distance: Number.POSITIVE_INFINITY });
    void appendEvent(role, 'rhythm_tap', { t_ms: rawNow, pointer_id: event.pointerId, target_id: nearestBeat.index >= 0 ? `BEAT_${nearestBeat.index + 1}` : null, payload: { tap_id: tap.id, tap_order: tap.order, logical_t_ms: now, nearest_beat_index: nearestBeat.index, nearest_beat_distance_ms: nearestBeat.distance, pointer_type: event.pointerType } });
  };
  const pointerEnd = (role: RhythmRole, event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    if (activePointerRef.current[role] !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    activePointerRef.current[role] = null;
    void appendEvent(role, 'rhythm_touch_end', { pointer_id: event.pointerId, target_id: `${role.toUpperCase()}_RHYTHM_PAD`, payload: { source_event: event.type } });
  };
  const togglePause = () => {
    if (paused) {
      if (pausedAtRef.current !== null) pauseAccumRef.current += performance.now() - pausedAtRef.current;
      pausedAtRef.current = null;
      setPaused(false);
      setNotice('继续听节奏，准备一起点');
    } else {
      clearTimer();
      pausedAtRef.current = performance.now();
      activePointerRef.current = { child: null, parent: null };
      setPaused(true);
      setNotice('已暂停，继续后请重新准备');
    }
  };
  const abort = async () => { if (trialOpenRef.current) await finishTrial('skipped_or_withdrawn'); await appendEvent('system', 'session_aborted', { outcome: 'skipped_or_withdrawn' }); onExit(); };

  if (stage === 'intro') return <main className="game-intro grocery-sky"><header className="topbar transparent"><button className="icon-button" onClick={onExit}>←</button><span className="status-pill">{mode === 'train' ? '训练模式' : `${phase} 标准化测试`}</span></header><section className="intro-card"><div className="mascot-box fountain-intro-art" aria-hidden="true">⛲</div><div className="intro-copy"><span className="eyebrow">乐园大冒险 · 节奏点击</span><h1>音乐喷泉秀</h1><p className="lead">看中央喷泉的节拍，儿童和家长在自己的区域一起点击。</p><div className="rule-strip"><span>① 看喷泉提示</span><span>② 听准节奏</span><span>③ 两个人一起点</span></div><p className="mode-explain">每个节拍只记录双方各一次有效点击，漏点和额外点击也会如实保存。</p><button className="primary large" onClick={() => void startGame()}>开始喷泉表演</button></div></section></main>;
  if (stage === 'level-up') return <main className="celebration-screen fountain-level-screen"><div className="level-burst"><span className="level-badge" aria-hidden="true" /><h1>新的喷泉节奏！</h1><p>下一关会加入更丰富的节拍组合</p></div></main>;
  if (stage === 'finished') return <main className="finish-page grocery-sky"><section className="finish-card card"><div className="finish-art">⛲</div><span className="eyebrow">节奏任务已保存</span><h1>{mode === 'train' ? '今天的喷泉表演完成啦！' : `${phase} 测试已完成`}</h1><p>完成 {outcomes.length} 段真实节奏任务，保存 {savedEventCount} 条原始事件。</p><div className="button-row centered wrap"><button className="secondary" onClick={() => void downloadJsonExport()}>导出 JSON</button><button className="secondary" onClick={() => void downloadEventsCsv()}>导出事件 CSV</button><button className="primary" onClick={onExit}>返回游戏列表</button></div></section></main>;

  const activeBeatIndex = config.beatOffsetsMs.findIndex((offset) => elapsedMs >= offset && elapsedMs <= offset + config.cueFlashMs);
  const completedBeatCount = config.beatOffsetsMs.filter((offset) => elapsedMs > offset + config.responseWindowMs).length;
  return <main className="game-page fountain-game-page"><header className="game-topbar"><button className="icon-button" onClick={() => void abort()}>←</button><div className="game-title"><span className="fountain-title-icon">⛲</span><div><small>乐园大冒险</small><strong>音乐喷泉秀</strong></div></div><div className="game-progress"><span className="status-pill">{mode === 'train' ? `${level} · ${leaderRole ? `${leaderRole === 'child' ? '儿童' : '家长'}带节奏` : '共同节拍'}` : `${phase} · 固定测试`}</span><div className="progress-track"><span style={{ width: `${Math.min(100, (completed / totalTrials) * 100)}%` }} /></div><small>{Math.min(totalTrials, completed + 1)} / {totalTrials}</small></div><button className="quiet-button" onClick={togglePause}>{paused ? '继续' : '暂停'}</button></header><section className="fountain-stage"><div className="fountain-status"><strong>{paused ? '已暂停' : feedback ?? (countdown > 0 ? `${countdown}，准备……` : notice)}</strong><span>节拍 {Math.min(config.beatOffsetsMs.length, completedBeatCount + 1)} / {config.beatOffsetsMs.length} · 剩余 {Math.ceil(remainingMs / 1000)} 秒</span></div><div className={`fountain-show ${activeBeatIndex >= 0 ? 'cue-active' : ''} ${jointFlash ? 'joint-hit' : ''}`}><div className="fountain-lights" aria-hidden="true"><i /><i /><i /><i /><i /></div><div className="fountain-jets" aria-hidden="true"><span /><span /><span /><span /><span /></div><div className="fountain-basin"><span>{jointFlash ? '配合成功' : activeBeatIndex >= 0 ? '现在一起点' : '看中央节拍'}</span></div><div className="rhythm-track">{config.beatOffsetsMs.map((offset, index) => <span className={`${index === activeBeatIndex ? 'active' : ''} ${elapsedMs > offset + config.responseWindowMs ? 'past' : ''}`} key={offset}>{index + 1}</span>)}</div></div><div className="fountain-controls"><button className={`fountain-pad child ${tapFlash.child ? 'tapped' : ''}`} onPointerDown={(event) => pointerDown('child', event)} onPointerUp={(event) => pointerEnd('child', event)} onPointerCancel={(event) => pointerEnd('child', event)}><span>儿童节奏区</span><strong>跟着喷泉点击</strong></button><div className={`fountain-sync ${jointFlash ? 'synced' : ''}`}><span>{jointFlash ? '同步' : '一起'}</span></div><button className={`fountain-pad parent ${tapFlash.parent ? 'tapped' : ''}`} onPointerDown={(event) => pointerDown('parent', event)} onPointerUp={(event) => pointerEnd('parent', event)} onPointerCancel={(event) => pointerEnd('parent', event)}><span>家长节奏区</span><strong>跟着喷泉点击</strong></button></div></section><aside className="prototype-ribbon">双人节奏点击 · 一对一拍点配对 · 原始触摸事件记录</aside></main>;
}
