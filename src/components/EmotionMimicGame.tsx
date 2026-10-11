import { useRef, useState } from 'react';
import { identityPrototype, versions } from '../config/protocols';
import { createId, wallTime } from '../core/ids';
import { eventStore } from '../data/eventStore';
import type { ActorRole, GameEvent, GameMode, LevelId, TestPhase, TrialSummary } from '../types';

type Props = { mode: GameMode; phase: TestPhase; pairId: string; onExit: () => void };
type Player = 'child' | 'parent';
type Stage = 'intro' | 'ready' | 'expressing' | 'sharing' | 'speaking' | 'sharing-complete' | 'finished';
type MimicTask = { id: string; emotion: string; emotionIcon: string; character: string; situation: string; avatars: string[]; tone: string };

const LEVELS: LevelId[] = ['L1', 'L2', 'L3'];
const TOGETHER_WINDOW_MS = 2000;
const CONFIG_VERSION = 'emotion-mimic-show-0.1';
const SCORER_VERSION = 'emotion-expression-participation-0.1';
const TASKS: Record<LevelId, MimicTask[]> = {
  L1: [
    { id: 'MIMIC_L1_HAPPY', emotion: '开心', emotionIcon: '😊', character: '小雨', situation: '小雨收到了一份特别喜欢的生日礼物。', avatars: ['😊', '😄', '😁'], tone: '#efbd55' },
    { id: 'MIMIC_L1_SAD', emotion: '难过', emotionIcon: '😢', character: '乐乐', situation: '乐乐刚搭好的积木突然倒了。', avatars: ['😢', '😞', '🥺'], tone: '#76add0' },
  ],
  L2: [
    { id: 'MIMIC_L2_SURPRISED', emotion: '惊讶', emotionIcon: '😮', character: '安安', situation: '安安打开门，发现朋友们准备了惊喜。', avatars: ['😮', '😲', '🤭'], tone: '#e99d66' },
    { id: 'MIMIC_L2_SCARED', emotion: '害怕', emotionIcon: '😨', character: '多多', situation: '多多听见黑暗的房间里突然传来响声。', avatars: ['😨', '😰', '🫣'], tone: '#9582bf' },
    { id: 'MIMIC_L2_ANGRY', emotion: '生气', emotionIcon: '😠', character: '晨晨', situation: '晨晨排好的玩具被别人不小心碰乱了。', avatars: ['😠', '😤', '😣'], tone: '#df775f' },
  ],
  L3: [
    { id: 'MIMIC_L3_EXPECT_NERVOUS', emotion: '期待又紧张', emotionIcon: '🤩😬', character: '小雨', situation: '小雨第一次参加小镇舞台表演，马上就要上场了。', avatars: ['🤩', '😬', '🥹'], tone: '#c68cb1' },
    { id: 'MIMIC_L3_HAPPY_SURPRISED', emotion: '开心又惊讶', emotionIcon: '😊😮', character: '乐乐', situation: '乐乐以为朋友忘了生日，却突然收到了大家的祝福。', avatars: ['🤭', '🤩', '🥳'], tone: '#e5a45c' },
    { id: 'MIMIC_L3_SAD_CALM', emotion: '有点难过，也慢慢平静', emotionIcon: '😢😌', character: '安安', situation: '安安喜欢的活动结束了，和朋友约好下次再一起玩。', avatars: ['🥺', '😌', '🥲'], tone: '#7daea7' },
  ],
};
const TALK_HINTS = ['说说你刚才是怎么表现这种心情的。', '你觉得身体和脸上哪里最能表现这种心情？', '看看伙伴的表达，有什么地方让你印象深刻？'];
const playerName = (player: Player) => player === 'child' ? '儿童' : '家长';
const otherPlayer = (player: Player): Player => player === 'child' ? 'parent' : 'child';

export default function EmotionMimicGame({ mode, phase, pairId, onExit }: Props) {
  const sessionId = useRef(createId(mode === 'train' ? 'TRAIN' : 'TEST')).current;
  const trialId = useRef('');
  const taskStartedAt = useRef(0);
  const selectionTimes = useRef<Record<Player, number | null>>({ child: null, parent: null });
  const completionTimes = useRef<Record<Player, number | null>>({ child: null, parent: null });
  const speechStartedAt = useRef(0);

  const [stage, setStage] = useState<Stage>('intro');
  const [ready, setReady] = useState<Record<Player, boolean>>({ child: false, parent: false });
  const [levelIndex, setLevelIndex] = useState(0);
  const [taskIndex, setTaskIndex] = useState(0);
  const [avatars, setAvatars] = useState<Record<Player, string | null>>({ child: null, parent: null });
  const [completed, setCompleted] = useState<Record<Player, boolean>>({ child: false, parent: false });
  const [talkSpeaker, setTalkSpeaker] = useState<Player>('child');
  const [talkTurns, setTalkTurns] = useState(0);
  const [hintCount, setHintCount] = useState(0);
  const [activeHint, setActiveHint] = useState<string | null>(null);
  const [roundsCompleted, setRoundsCompleted] = useState(0);
  const [eventCount, setEventCount] = useState(0);
  const [notice, setNotice] = useState('请儿童和家长分别确认准备');

  const level: LevelId = mode === 'train' ? LEVELS[levelIndex] : 'L2';
  const taskSet = TASKS[level];
  const task = taskSet[taskIndex];
  const revealed = ['sharing', 'speaking', 'sharing-complete'].includes(stage);

  const append = async (actor_role: ActorRole, event_type: string, payload?: Record<string, unknown>, target_id: string | null = null, eventLevel: LevelId = level) => {
    const event: GameEvent = {
      event_id: createId('EV'), pair_id: pairId, session_id: sessionId, trial_id: trialId.current || null,
      mode, phase, domain_id: 'emotion', game_id: 'EMO_02', level: mode === 'train' ? eventLevel : null,
      actor_role, actor_identity_method: identityPrototype.id, event_type, t_ms: performance.now(), wall_time: wallTime(), target_id,
      payload, config_version: CONFIG_VERSION, scorer_version: SCORER_VERSION, asset_version: versions.assets,
    };
    await eventStore.appendEvent(event);
    setEventCount(value => value + 1);
  };

  const prepareTask = (nextIndex: number, nextLevel: LevelId = level) => {
    const nextTask = TASKS[nextLevel][nextIndex];
    trialId.current = createId('TRIAL');
    taskStartedAt.current = performance.now();
    selectionTimes.current = { child: null, parent: null };
    completionTimes.current = { child: null, parent: null };
    setAvatars({ child: null, parent: null });
    setCompleted({ child: false, parent: false });
    setTalkTurns(0);
    setHintCount(0);
    setActiveHint(null);
    setTalkSpeaker(nextIndex % 2 === 0 ? 'child' : 'parent');
    setStage('expressing');
    setNotice(`请一起表现：${nextTask.emotion}`);
    void append('system', 'emotion_mimic_task_presented', {
      task_id: nextTask.id, emotion_task: nextTask.emotion, level: nextLevel,
      capture_mode: 'self-selected-avatar-after-live-expression', ai_expression_scoring: false,
    }, nextTask.id, nextLevel);
  };

  const start = async () => {
    await eventStore.saveSession({
      session_id: sessionId, pair_id: pairId, mode, phase, game_id: 'EMO_02', started_at: wallTime(),
      protocol_version: CONFIG_VERSION, actor_identity_method: identityPrototype.id,
      identity_validation_status: 'REQUIRES_REAL_PARENT_CHILD_VALIDATION',
      material_set: mode === 'test' ? 'EMO_02_A_fixed-expression-tasks' : null, response_window_ms: null,
      expression_capture_mode: 'self-selected-avatar_after_live_expression', camera_capture: false, ai_expression_scoring: false,
    });
    setStage('ready');
  };

  const markReady = (player: Player) => {
    const next = { ...ready, [player]: true };
    setReady(next);
    void append(player, 'player_ready');
    if (next.child && next.parent) prepareTask(0);
  };

  const selectAvatar = (player: Player, avatar: string) => {
    if (stage !== 'expressing' || completed[player]) return;
    selectionTimes.current[player] = performance.now() - taskStartedAt.current;
    setAvatars(value => ({ ...value, [player]: avatar }));
    setNotice(`${playerName(player)}已保存一次表达，具体结果暂时隐藏`);
    void append(player, 'mimic_avatar_selected', {
      task_id: task.id, selection_time_ms: selectionTimes.current[player], private_until_both_complete: true,
    });
  };

  const finishExpression = (player: Player) => {
    if (stage !== 'expressing' || !avatars[player] || completed[player]) return;
    completionTimes.current[player] = performance.now() - taskStartedAt.current;
    const next = { ...completed, [player]: true };
    setCompleted(next);
    void append(player, 'emotion_expression_complete', {
      task_id: task.id, completion_time_ms: completionTimes.current[player], result_hidden_from_partner: true,
    });
    if (next.child && next.parent && avatars.child && avatars.parent) {
      const childTime = completionTimes.current.child ?? 0;
      const parentTime = completionTimes.current.parent ?? 0;
      const gap = Math.abs(childTime - parentTime);
      setStage('sharing');
      setNotice(`你们一起表达了${task.emotion}！看看彼此的表情吧`);
      void append('system', 'emotion_expressions_revealed', {
        task_id: task.id, child_avatar: avatars.child, parent_avatar: avatars.parent,
        completion_gap_ms: gap, completed_together: gap <= TOGETHER_WINDOW_MS,
        no_correctness_judgment: true,
      }, task.id);
    } else {
      setNotice(`${playerName(player)}已完成，表达结果已隐藏，等待${playerName(otherPlayer(player))}`);
    }
  };

  const showHint = () => {
    if (stage !== 'sharing') return;
    const next = hintCount + 1;
    setHintCount(next);
    setActiveHint(TALK_HINTS[(next - 1) % TALK_HINTS.length]);
    void append('system', 'mimic_discussion_hint_used', { task_id: task.id, prompt_index: next });
  };

  const voice = (player: Player) => {
    if (player !== talkSpeaker || (stage !== 'sharing' && stage !== 'speaking')) return;
    if (stage === 'sharing') {
      speechStartedAt.current = performance.now();
      setStage('speaking');
      setNotice(`${playerName(player)}正在分享自己的情绪体验……`);
      void append(player, 'mimic_reflection_start', { task_id: task.id, turn_index: talkTurns + 1 });
      return;
    }
    const duration = performance.now() - speechStartedAt.current;
    const nextTurns = talkTurns + 1;
    setTalkTurns(nextTurns);
    void append(player, 'mimic_reflection_end', { task_id: task.id, turn_index: nextTurns, duration_ms: duration });
    if (nextTurns >= 2) {
      setStage('sharing-complete');
      setNotice('你们已经分享了情绪体验，可以主动进入下一个任务');
      void completeRound(nextTurns);
    } else {
      const nextSpeaker = otherPlayer(player);
      setTalkSpeaker(nextSpeaker);
      setStage('sharing');
      setNotice(`轮到${playerName(nextSpeaker)}分享自己的感受`);
    }
  };

  const completeRound = async (turns: number) => {
    const childTime = completionTimes.current.child ?? 0;
    const parentTime = completionTimes.current.parent ?? 0;
    const gap = Math.abs(childTime - parentTime);
    const order = childTime === parentTime ? 'same_time' : childTime < parentTime ? 'child_first' : 'parent_first';
    const nextRounds = roundsCompleted + 1;
    setRoundsCompleted(nextRounds);
    const summary: TrialSummary = {
      trial_id: trialId.current, session_id: sessionId, game_id: 'EMO_02', mode, phase,
      level: mode === 'train' ? level : null, opportunity_index: nextRounds, target_id: task.id,
      outcome: 'completed_valid', child_target_id: avatars.child, parent_target_id: avatars.parent,
      child_t_ms: childTime, parent_t_ms: parentTime, inter_touch_ms: gap, valid_for_scoring: true,
      actor_identity_method: identityPrototype.id, config_version: CONFIG_VERSION, scorer_version: SCORER_VERSION,
      metrics: {
        emotion_task: task.emotion, child_completion_time_ms: childTime, parent_completion_time_ms: parentTime,
        completion_order: order, completion_gap_ms: gap, completed_together: gap <= TOGETHER_WINDOW_MS,
        follow_up_emotion_dialogue_completed: turns >= 2, follow_up_dialogue_turns: turns,
        system_prompt_count: hintCount, completed_round_number: nextRounds,
        capture_mode: 'self-selected-avatar_after_live_expression', ai_expression_accuracy_recorded: false,
      },
    };
    await eventStore.saveTrial(summary);
    void append('system', 'emotion_mimic_round_complete', {
      task_id: task.id, completion_order: order, completed_together: gap <= TOGETHER_WINDOW_MS,
      dialogue_completed: turns >= 2, completed_round_number: nextRounds,
    }, task.id);
  };

  const nextTask = () => {
    if (stage !== 'sharing-complete') return;
    if (taskIndex + 1 < taskSet.length) {
      const next = taskIndex + 1;
      setTaskIndex(next);
      prepareTask(next);
      return;
    }
    if (mode === 'train' && levelIndex < LEVELS.length - 1) {
      const nextLevelIndex = levelIndex + 1;
      const nextLevel = LEVELS[nextLevelIndex];
      setLevelIndex(nextLevelIndex);
      setTaskIndex(0);
      void append('system', 'emotion_mimic_level_advanced', { from_level: level, to_level: nextLevel });
      prepareTask(0, nextLevel);
      return;
    }
    setStage('finished');
  };

  const renderPlayer = (player: Player) => {
    const selected = avatars[player];
    const isSpeaker = talkSpeaker === player;
    return <section className={`mimic-player ${player} ${isSpeaker && ['sharing', 'speaking'].includes(stage) ? 'active' : ''}`}>
      <header><strong>{playerName(player)}</strong><span>{stage === 'ready' ? '准备中' : revealed ? '交流区' : '表情模仿区'}</span></header>
      {stage === 'ready' ? <div className="mimic-ready"><span>{player === 'child' ? '🧒' : '🧑'}</span><button className={ready[player] ? 'secondary' : 'primary'} disabled={ready[player]} onClick={() => markReady(player)}>{ready[player] ? `${playerName(player)}已准备` : `${playerName(player)}准备好了`}</button></div> : <>
        {stage === 'expressing' && !completed[player] && <><div className="mimic-mirror"><span>🪞</span><strong>先做一做“{task.emotion}”的表情</strong><small>完成后，选一个角色帮你保存这次表达</small></div><div className="mimic-avatar-options">{task.avatars.map(avatar => <button key={avatar} onClick={() => selectAvatar(player, avatar)}>{avatar}</button>)}</div><div className="mimic-local-finish"><span>{selected ? '🔒 已保存，具体角色暂时保密；可以重新选择' : '请选择一个角色保存表达'}</span><button className="primary" disabled={!selected} onClick={() => finishExpression(player)}>{playerName(player)}完成</button></div></>}
        {stage === 'expressing' && completed[player] && <div className="mimic-private-lock"><span>🔒</span><strong>{playerName(player)}已完成</strong><p>表达结果已经隐藏<br />等待{playerName(otherPlayer(player))}</p></div>}
        {revealed && selected && <div className="mimic-reveal"><small>{playerName(player)}的表达角色</small><span>{selected}</span><strong>{task.emotion}</strong></div>}
        {(stage === 'sharing' || stage === 'speaking') && isSpeaker && <button className={`mimic-voice ${stage === 'speaking' ? 'recording' : ''}`} onClick={() => voice(player)}><span>🎙️</span><strong>{stage === 'speaking' ? '说完了，点击结束' : '分享刚才的情绪体验'}</strong></button>}
        {(stage === 'sharing' || stage === 'speaking') && !isSpeaker && <div className="mimic-listening"><span>👂</span><strong>听听伙伴的感受</strong></div>}
        {stage === 'sharing-complete' && <div className="mimic-shared"><span>💬</span><strong>已经互相分享</strong></div>}
      </>}
    </section>;
  };

  if (stage === 'intro') return <main className="game-intro mimic-intro"><header className="topbar transparent"><button className="icon-button" onClick={onExit}>←</button></header><section className="intro-card"><div className="mascot-box">🎭😊</div><div className="intro-copy"><span className="eyebrow">小镇心情屋 · 情绪表达同步</span><h1>情绪模仿秀</h1><p className="lead">一起体验同一种心情，各自完成表达，再同时看看彼此的表情角色。</p><div className="rule-strip"><span>① 看情绪任务</span><span>② 各自模仿</span><span>③ 同时展示</span></div><button className="primary large" onClick={() => void start()}>进入模仿秀</button></div></section></main>;
  if (stage === 'finished') return <main className="finish-page"><section className="finish-card card"><div className="finish-art">🎭</div><h1>情绪模仿秀完成啦！</h1><p>共同体验了 {roundsCompleted} 个情绪任务，保存 {eventCount} 条互动事件。</p><button className="primary" onClick={onExit}>返回游戏列表</button></section></main>;

  return <main className="game-page mimic-game"><header className="game-topbar"><button className="icon-button" onClick={onExit}>←</button><div className="game-title"><span>🎭</span><div><small>小镇心情屋</small><strong>情绪模仿秀</strong></div></div><span className="status-pill">{mode === 'train' ? `${level} · 任务 ${taskIndex + 1}/${taskSet.length}` : `${phase} · 固定任务`}</span></header><div className="mimic-status"><strong>{notice}</strong><span>不判断谁更像，也不记录表情识别准确率</span></div><section className="mimic-layout">{renderPlayer('child')}<article className="mimic-task-center" style={{ '--task-tone': task?.tone ?? '#e3a65f' } as React.CSSProperties}><span className="mimic-character">{task?.emotionIcon ?? '😊'}</span><small>{task?.character ?? '小镇居民'}的心情故事</small><p>{task?.situation ?? '双方准备后开始情绪任务。'}</p><div className="mimic-target"><small>今天请一起表现</small><strong>{task?.emotion ?? '一种心情'}</strong></div>{revealed && <div className="mimic-result"><strong>一起完成情绪模仿！</strong><span>看看彼此的表达，再说说刚才的感受吧。</span></div>}{stage === 'sharing' && <button className="mimic-hint-button" onClick={showHint}>需要一个交流提示</button>}{activeHint && stage !== 'sharing-complete' && <div className="mimic-hint">💡 {activeHint}</div>}{stage === 'sharing-complete' && <button className="primary mimic-next" onClick={nextTask}>下一个情绪任务</button>}<small className="mimic-note">当前不启用摄像头或AI评分；表情角色只用于保存和共同展示本次表达。</small></article>{renderPlayer('parent')}</section></main>;
}
