import { useCallback, useEffect, useRef, useState } from 'react';
import { balloonTestProtocol, balloonTrainingConfig, identityPrototype, versions } from '../config/protocols';
import { createId, wallTime } from '../core/ids';
import { downloadEventsCsv, downloadJsonExport, eventStore } from '../data/eventStore';
import type { ActorRole, GameEvent, GameMode, LevelId, TestPhase, TrialOutcome, TrialSummary } from '../types';

type Props = { mode: GameMode; phase: TestPhase; pairId: string; onExit: () => void };
type Stage = 'intro' | 'playing' | 'level-up' | 'finished';
type PlayerRole = 'child' | 'parent';
const LEVELS: LevelId[] = ['L1', 'L2', 'L3'];
const roleName = (role: PlayerRole) => role === 'child' ? '儿童' : '家长';

export default function BalloonGame({ mode, phase, pairId, onExit }: Props) {
  const sessionId = useRef(createId(mode === 'train' ? 'TRAIN' : phase ?? 'TEST')).current;
  const [stage, setStage] = useState<Stage>('intro');
  const [levelIndex, setLevelIndex] = useState(0);
  const [trialIndex, setTrialIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [remainingMs, setRemainingMs] = useState(0);
  const [overlapMs, setOverlapMs] = useState(0);
  const [pressed, setPressed] = useState<Record<PlayerRole, boolean>>({ child: false, parent: false });
  const [outcomes, setOutcomes] = useState<TrialOutcome[]>([]);
  const [savedEventCount, setSavedEventCount] = useState(0);
  const trialIdRef = useRef<string | null>(null);
  const trialOpenRef = useRef(false);
  const trialStartRef = useRef(0);
  const overlapStartRef = useRef<number | null>(null);
  const overlapAccumRef = useRef(0);
  const downAtRef = useRef<Record<PlayerRole, number | null>>({ child: null, parent: null });
  const timerRef = useRef<number | null>(null);
  const pausedAtRef = useRef<number | null>(null);
  const level = LEVELS[levelIndex];
  const config = mode === 'train' ? balloonTrainingConfig[level] : balloonTestProtocol;
  const totalTrials = mode === 'train' ? LEVELS.reduce((sum, item) => sum + balloonTrainingConfig[item].quota, 0) : balloonTestProtocol.trialCount;
  const completed = mode === 'train' ? LEVELS.slice(0, levelIndex).reduce((sum, item) => sum + balloonTrainingConfig[item].quota, 0) + trialIndex : trialIndex;

  const clearTimer = () => { if (timerRef.current !== null) window.clearInterval(timerRef.current); timerRef.current = null; };
  const appendEvent = useCallback(async (actorRole: ActorRole, eventType: string, data: Partial<GameEvent> = {}) => {
    await eventStore.appendEvent({ event_id: createId('EV'), pair_id: pairId, session_id: sessionId, trial_id: data.trial_id ?? trialIdRef.current, mode, phase, domain_id: 'touch', game_id: 'TOUCH_01', level: mode === 'train' ? level : null, actor_role: actorRole, actor_identity_method: identityPrototype.id, event_type: eventType, t_ms: data.t_ms ?? performance.now(), wall_time: wallTime(), target_id: data.target_id ?? null, pointer_id: data.pointer_id, outcome: data.outcome, invalid_reason: data.invalid_reason, payload: data.payload, config_version: mode === 'train' ? 'train-touch-01-balloon-0.1' : 'test-touch-01-balloon-0.1', scorer_version: 'touch-overlap-0.1', asset_version: versions.assets });
    setSavedEventCount((value) => value + 1);
  }, [level, mode, pairId, phase, sessionId]);

  const advance = useCallback(() => {
    setFeedback(null); setOverlapMs(0); setPressed({ child: false, parent: false }); setPaused(false);
    overlapStartRef.current = null; overlapAccumRef.current = 0; downAtRef.current = { child: null, parent: null };
    if (mode === 'test') { if (trialIndex + 1 >= totalTrials) setStage('finished'); else setTrialIndex((value) => value + 1); return; }
    if (trialIndex + 1 < balloonTrainingConfig[level].quota) { setTrialIndex((value) => value + 1); return; }
    if (levelIndex < LEVELS.length - 1) { setStage('level-up'); window.setTimeout(() => { setLevelIndex((value) => value + 1); setTrialIndex(0); setStage('playing'); }, 1400); } else setStage('finished');
  }, [level, levelIndex, mode, totalTrials, trialIndex]);

  const finish = useCallback(async (outcome: TrialOutcome) => {
    if (!trialOpenRef.current || !trialIdRef.current) return;
    trialOpenRef.current = false; clearTimer();
    const now = performance.now();
    const finalOverlap = overlapAccumRef.current + (overlapStartRef.current === null ? 0 : now - overlapStartRef.current);
    overlapAccumRef.current = finalOverlap; overlapStartRef.current = null; setOverlapMs(finalOverlap); setPressed({ child: false, parent: false });
    const metrics = { overlap_ms: finalOverlap, overlap_threshold_ms: config.successOverlapMs, hold_window_ms: config.holdWindowMs, child_down_ms: downAtRef.current.child, parent_down_ms: downAtRef.current.parent };
    const summary: TrialSummary = { trial_id: trialIdRef.current, session_id: sessionId, game_id: 'TOUCH_01', mode, phase, level: mode === 'train' ? level : null, opportunity_index: completed + 1, target_id: 'BALLOON', outcome, child_target_id: 'BALLOON', parent_target_id: 'BALLOON', child_t_ms: downAtRef.current.child, parent_t_ms: downAtRef.current.parent, inter_touch_ms: finalOverlap, valid_for_scoring: !['technical_invalid', 'skipped_or_withdrawn'].includes(outcome), actor_identity_method: identityPrototype.id, config_version: mode === 'train' ? 'train-touch-01-balloon-0.1' : 'test-touch-01-balloon-0.1', scorer_version: 'touch-overlap-0.1', metrics };
    await eventStore.saveTrial(summary); await appendEvent('system', 'trial_classified', { target_id: 'BALLOON', outcome, payload: { summary, ...metrics } });
    setOutcomes((items) => [...items, outcome]); setFeedback(outcome === 'completed_valid' ? '气球飞起来啦！一起按得很棒！' : outcome === 'no_response' ? '这次没有形成共同长按' : '本次操作已记录');
    window.setTimeout(advance, mode === 'test' ? 600 : 1000);
  }, [advance, appendEvent, completed, config.holdWindowMs, config.successOverlapMs, level, mode, phase, sessionId]);

  useEffect(() => {
    if (stage !== 'playing' || feedback || paused) return;
    if (!trialOpenRef.current) { trialOpenRef.current = true; trialIdRef.current = createId('TRIAL'); trialStartRef.current = performance.now(); overlapStartRef.current = null; overlapAccumRef.current = 0; downAtRef.current = { child: null, parent: null }; setRemainingMs(config.holdWindowMs); setOverlapMs(0); void appendEvent('system', 'trial_open', { target_id: 'BALLOON', payload: { opportunity_index: completed + 1, overlap_threshold_ms: config.successOverlapMs, hold_window_ms: config.holdWindowMs } }); }
    clearTimer();
    timerRef.current = window.setInterval(() => { const now = performance.now(); const remaining = Math.max(0, config.holdWindowMs - (now - trialStartRef.current)); const currentOverlap = overlapAccumRef.current + (overlapStartRef.current === null ? 0 : now - overlapStartRef.current); setRemainingMs(remaining); setOverlapMs(currentOverlap); if (currentOverlap >= config.successOverlapMs) void finish('completed_valid'); else if (remaining <= 0) void finish('no_response'); }, 100);
    return clearTimer;
  }, [appendEvent, completed, config.holdWindowMs, config.successOverlapMs, feedback, finish, paused, stage]);
  useEffect(() => () => clearTimer(), []);

  const startGame = async () => { await eventStore.saveSession({ session_id: sessionId, pair_id: pairId, mode, phase, game_id: 'TOUCH_01', started_at: wallTime(), protocol_version: mode === 'train' ? 'train-touch-01-balloon-0.1' : 'test-touch-01-balloon-0.1', actor_identity_method: identityPrototype.id, identity_validation_status: balloonTestProtocol.validationStatus, material_set: mode === 'test' ? balloonTestProtocol.materialSet : null, response_window_ms: config.holdWindowMs }); await appendEvent('system', 'session_started', { payload: { real_input_only: true, rule: 'two_role_hold_overlap' } }); setStage('playing'); };
  const handleDown = (role: PlayerRole, event: React.PointerEvent<HTMLButtonElement>) => { event.preventDefault(); if (!trialOpenRef.current || paused || feedback || downAtRef.current[role] !== null) return; const now = performance.now(); downAtRef.current[role] = now; setPressed((value) => ({ ...value, [role]: true })); void appendEvent(role, 'touch_down', { t_ms: now, target_id: 'BALLOON', pointer_id: event.pointerId, payload: { role, action: 'hold_start' } }); if (downAtRef.current.child !== null && downAtRef.current.parent !== null && overlapStartRef.current === null) { overlapStartRef.current = now; void appendEvent('system', 'overlap_start', { t_ms: now, target_id: 'BALLOON', payload: { child_down_ms: downAtRef.current.child, parent_down_ms: downAtRef.current.parent } }); } };
  const handleUp = (role: PlayerRole, event: React.PointerEvent<HTMLButtonElement>) => { event.preventDefault(); if (downAtRef.current[role] === null) return; const now = performance.now(); downAtRef.current[role] = null; setPressed((value) => ({ ...value, [role]: false })); void appendEvent(role, 'touch_up', { t_ms: now, target_id: 'BALLOON', pointer_id: event.pointerId, payload: { role, action: 'hold_end' } }); if (overlapStartRef.current !== null) { overlapAccumRef.current += now - overlapStartRef.current; overlapStartRef.current = null; setOverlapMs(overlapAccumRef.current); void appendEvent('system', 'overlap_end', { t_ms: now, target_id: 'BALLOON', payload: { overlap_ms: overlapAccumRef.current } }); } };
  const togglePause = () => { if (paused) { if (pausedAtRef.current !== null) trialStartRef.current += performance.now() - pausedAtRef.current; pausedAtRef.current = null; setPaused(false); } else { clearTimer(); pausedAtRef.current = performance.now(); downAtRef.current = { child: null, parent: null }; overlapStartRef.current = null; setPressed({ child: false, parent: false }); setPaused(true); } };
  const abort = async () => { if (trialOpenRef.current) await finish('skipped_or_withdrawn'); await appendEvent('system', 'session_aborted', { outcome: 'skipped_or_withdrawn' }); onExit(); };

  if (stage === 'intro') return <main className="game-intro grocery-sky"><header className="topbar transparent"><button className="icon-button" onClick={onExit}>←</button><span className="status-pill">{mode === 'train' ? '训练模式' : `${phase} 标准化测试`}</span></header><section className="intro-card"><div className="mascot-box"><img className="intro-characters" src="/assets/parent-child-cutout-v1.png" alt="儿童和家长" /></div><div className="intro-copy"><span className="eyebrow">乐园大冒险 · 共同长按</span><h1>气球飞上天</h1><p className="lead">儿童和家长同时按住自己的按钮，重叠按住的时间会让气球升得更高。</p><div className="rule-strip"><span>① 儿童按住</span><span>② 家长按住</span><span>③ 共同长按让气球升空</span></div><p className="mode-explain">保持双方按住，松开后可以重新尝试。难度会自动从 L1 进入 L2、L3。</p><button className="primary large" onClick={() => void startGame()}>开始游戏</button></div></section></main>;
  if (stage === 'level-up') return <main className="celebration-screen balloon-level-screen"><div className="level-burst"><span className="level-badge" aria-hidden="true" /><h1>气球飞得更高啦！</h1><p>下一等级需要更长的共同长按</p></div></main>;
  if (stage === 'finished') return <main className="finish-page grocery-sky"><section className="finish-card card"><div className="finish-art">🎈</div><span className="eyebrow">触摸任务已保存</span><h1>{mode === 'train' ? '今天的气球任务完成啦！' : `${phase} 测试已完成`}</h1><p>完成 {outcomes.filter((item) => item === 'completed_valid').length} 次共同长按，保存 {savedEventCount} 条原始事件。</p><div className="button-row centered wrap"><button className="secondary" onClick={() => void downloadJsonExport()}>导出 JSON</button><button className="secondary" onClick={() => void downloadEventsCsv()}>导出事件 CSV</button><button className="primary" onClick={onExit}>返回游戏列表</button></div></section></main>;

  const balloonScale = Math.min(1.55, 1 + overlapMs / Math.max(1, config.successOverlapMs) * .55);
  return <main className="game-page balloon-game-page"><header className="game-topbar"><button className="icon-button" onClick={() => void abort()}>←</button><div className="game-title"><span className="mini-cart" aria-hidden="true" /><div><small>乐园大冒险</small><strong>气球飞上天</strong></div></div><div className="game-progress"><span className="status-pill">{mode === 'train' ? level : `${phase} · 固定测试`}</span><div className="progress-track"><span style={{ width: `${Math.min(100, (completed / totalTrials) * 100)}%` }} /></div><small>{Math.min(totalTrials, completed + 1)} / {totalTrials}</small></div><button className="quiet-button" onClick={togglePause}>{paused ? '继续' : '暂停'}</button></header><section className="balloon-stage"><div className="balloon-status"><strong>{paused ? '已暂停' : feedback ?? '请两个人一起按住'}</strong><span>共同长按 {Math.round(overlapMs)} / {config.successOverlapMs} ms · 剩余 {Math.ceil(remainingMs / 1000)} 秒</span></div><div className="balloon-scene"><div className="balloon-cloud cloud-left" /><div className="balloon-cloud cloud-right" /><div className="balloon-visual" style={{ transform: `scale(${balloonScale})` }}><span className="balloon-knot" /><span className="balloon-string" /></div></div><div className="balloon-controls"><button className={`balloon-pad child ${pressed.child ? 'pressed' : ''}`} onPointerDown={(event) => handleDown('child', event)} onPointerUp={(event) => handleUp('child', event)} onPointerCancel={(event) => handleUp('child', event)} onPointerLeave={(event) => { if (event.buttons) handleUp('child', event); }}><span>儿童</span><strong>{pressed.child ? '按住中' : '按住这里'}</strong></button><div className="balloon-progress"><span style={{ width: `${Math.min(100, overlapMs / config.successOverlapMs * 100)}%` }} /></div><button className={`balloon-pad parent ${pressed.parent ? 'pressed' : ''}`} onPointerDown={(event) => handleDown('parent', event)} onPointerUp={(event) => handleUp('parent', event)} onPointerCancel={(event) => handleUp('parent', event)} onPointerLeave={(event) => { if (event.buttons) handleUp('parent', event); }}><span>家长</span><strong>{pressed.parent ? '按住中' : '按住这里'}</strong></button></div></section><aside className="prototype-ribbon">触摸同步原型 · 双区长按 · 重叠时间记录</aside></main>;
}
