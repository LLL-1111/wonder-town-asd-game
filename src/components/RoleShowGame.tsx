import { useMemo, useRef, useState } from 'react';
import { identityPrototype, versions } from '../config/protocols';
import { createId, wallTime } from '../core/ids';
import { eventStore } from '../data/eventStore';
import type { ActorRole, GameEvent, GameMode, LevelId, TestPhase, TrialSummary } from '../types';

type Props = { mode: GameMode; phase: TestPhase; pairId: string; onExit: () => void };
type Player = 'child' | 'parent';
type Stage = 'intro' | 'ready' | 'task' | 'speaking' | 'review' | 'task-ready' | 'success' | 'role-swap' | 'level-up' | 'finished';
type SideRole = 'initiator' | 'responder' | 'both';
type InfoItem = { id: string; label: string; side: SideRole };
type Scenario = {
  id: 'ticket' | 'library' | 'post-office';
  name: string;
  icon: string;
  goal: string;
  initiatorRole: string;
  responderRole: string;
  success: string;
  completionAction: string;
  prop: string;
  taskPrompts: string[];
  info: InfoItem[];
};

const LEVELS: LevelId[] = ['L1', 'L2', 'L3'];
const TASKS_PER_ROLE = 2;
const CONFIG_VERSION = 'lang-role-show-0.1';
const SCORER_VERSION = 'language-role-play-manual-confirmation-0.1';

const SCENARIOS: Record<LevelId, Scenario> = {
  L1: {
    id: 'ticket', name: '小镇售票处', icon: '🎫', goal: '通过对话买到需要的票。', initiatorRole: '游客', responderRole: '售票员',
    success: '买票完成啦！', completionAction: '完成出票', prop: '🎟️',
    taskPrompts: ['去游乐园的车票', '去动物园的车票', '去海边公园的车票', '去森林剧场的车票'],
    info: [
      { id: 'buy_intent', label: '表达了购票意图', side: 'initiator' },
      { id: 'destination', label: '说明了目的地', side: 'initiator' },
      { id: 'seller_confirm', label: '售票员进行了回应或确认', side: 'responder' },
      { id: 'quantity', label: '确认了票的数量', side: 'both' },
      { id: 'ticket_type', label: '确认了票的类型', side: 'both' },
    ],
  },
  L2: {
    id: 'library', name: '小镇图书馆', icon: '📚', goal: '通过对话完成一次借书。', initiatorRole: '借书者', responderRole: '图书管理员',
    success: '借书成功！', completionAction: '办理借书', prop: '📖',
    taskPrompts: ['借阅恐龙绘本', '借阅星空故事', '借阅动物百科', '借阅小镇地图册'],
    info: [
      { id: 'borrow_intent', label: '表达了借书意图', side: 'initiator' },
      { id: 'book_name', label: '说明了想借的书', side: 'initiator' },
      { id: 'librarian_confirm', label: '管理员确认了书籍', side: 'responder' },
      { id: 'borrow_period', label: '确认了借阅时间', side: 'both' },
      { id: 'return_rule', label: '确认了归还方式', side: 'responder' },
    ],
  },
  L3: {
    id: 'post-office', name: '小镇邮局', icon: '📮', goal: '通过对话把包裹寄到正确地点。', initiatorRole: '寄件人', responderRole: '邮局工作人员',
    success: '包裹寄出去啦！', completionAction: '寄出包裹', prop: '📦',
    taskPrompts: ['寄到海边镇的包裹', '寄到森林镇的包裹', '寄到彩虹村的包裹', '寄到山顶小屋的包裹'],
    info: [
      { id: 'send_intent', label: '表达了寄件意图', side: 'initiator' },
      { id: 'post_destination', label: '说明了寄送地点', side: 'initiator' },
      { id: 'worker_confirm', label: '工作人员进行了回应或确认', side: 'responder' },
      { id: 'item_type', label: '说明了物品类型', side: 'initiator' },
      { id: 'delivery_speed', label: '确认了寄送方式', side: 'both' },
    ],
  },
};

const playerName = (player: Player) => player === 'child' ? '儿童' : '家长';
const otherPlayer = (player: Player): Player => player === 'child' ? 'parent' : 'child';

export default function RoleShowGame({ mode, phase, pairId, onExit }: Props) {
  const sessionId = useRef(createId(mode === 'train' ? 'TRAIN' : 'TEST')).current;
  const trialId = useRef('');
  const taskStartedAt = useRef(0);
  const speechStartedAt = useRef(0);
  const lastSpeechEndAt = useRef<number | null>(null);
  const lastSpeaker = useRef<Player | null>(null);
  const responseLatencies = useRef<number[]>([]);

  const [stage, setStage] = useState<Stage>('intro');
  const [ready, setReady] = useState<Record<Player, boolean>>({ child: false, parent: false });
  const [levelIndex, setLevelIndex] = useState(0);
  const [swapped, setSwapped] = useState(false);
  const [taskInRole, setTaskInRole] = useState(0);
  const [speaker, setSpeaker] = useState<Player>('child');
  const [reported, setReported] = useState<string[]>([]);
  const [collected, setCollected] = useState<string[]>([]);
  const [utterances, setUtterances] = useState(0);
  const [alternatingTurns, setAlternatingTurns] = useState(0);
  const [hintCount, setHintCount] = useState(0);
  const [recognitionFailures, setRecognitionFailures] = useState(0);
  const [completedTasks, setCompletedTasks] = useState(0);
  const [eventCount, setEventCount] = useState(0);
  const [notice, setNotice] = useState('请儿童和家长分别确认准备');

  const level: LevelId = mode === 'train' ? LEVELS[levelIndex] : 'L2';
  const scenario = SCENARIOS[level];
  const requirementCount = level === 'L1' ? 3 : level === 'L2' ? 4 : 5;
  const minimumUtterances = level === 'L1' ? 2 : level === 'L2' ? 3 : 4;
  const requiredInfo = useMemo(() => scenario.info.slice(0, requirementCount), [scenario, requirementCount]);
  const initiator: Player = swapped ? 'parent' : 'child';
  const responder = otherPlayer(initiator);
  const taskNumber = taskInRole + (swapped ? TASKS_PER_ROLE : 0);
  const taskPrompt = scenario.taskPrompts[taskNumber % scenario.taskPrompts.length];
  const displayedTaskProgress = ['success', 'role-swap', 'level-up'].includes(stage) ? taskInRole + 1 : taskInRole;

  const append = async (actor_role: ActorRole, event_type: string, payload?: Record<string, unknown>, target_id: string | null = null) => {
    const event: GameEvent = {
      event_id: createId('EV'), pair_id: pairId, session_id: sessionId, trial_id: trialId.current || null,
      mode, phase, domain_id: 'language', game_id: 'LANG_03', level: mode === 'train' ? level : null,
      actor_role, actor_identity_method: identityPrototype.id, event_type, t_ms: performance.now(), wall_time: wallTime(), target_id, payload,
      config_version: CONFIG_VERSION, scorer_version: SCORER_VERSION, asset_version: versions.assets,
    };
    await eventStore.appendEvent(event);
    setEventCount(value => value + 1);
  };

  const resetInteraction = (nextInitiator: Player, nextTaskIndex: number, nextScenario: Scenario = scenario) => {
    trialId.current = createId('TRIAL');
    taskStartedAt.current = performance.now();
    lastSpeechEndAt.current = null;
    lastSpeaker.current = null;
    responseLatencies.current = [];
    setSpeaker(nextInitiator);
    setReported([]);
    setCollected([]);
    setUtterances(0);
    setAlternatingTurns(0);
    setHintCount(0);
    setRecognitionFailures(0);
    setStage('task');
    setNotice(`${playerName(nextInitiator)}先表达，${playerName(otherPlayer(nextInitiator))}认真倾听`);
    void append('system', 'role_task_started', {
      scenario_id: nextScenario.id, task_index_in_role: nextTaskIndex + 1,
      initiator_player: nextInitiator, responder_player: otherPlayer(nextInitiator),
      speech_recognition_mode: 'manual_core_information_confirmation',
    }, nextScenario.id);
  };

  const start = async () => {
    await eventStore.saveSession({
      session_id: sessionId, pair_id: pairId, mode, phase, game_id: 'LANG_03', started_at: wallTime(),
      protocol_version: CONFIG_VERSION, actor_identity_method: identityPrototype.id,
      identity_validation_status: 'REQUIRES_REAL_PARENT_CHILD_VALIDATION',
      material_set: mode === 'test' ? 'LANG_03_A_fixed-library-role-play' : null,
      response_window_ms: null, speech_recognition: 'not_enabled_manual_core_information_confirmation',
    });
    setStage('ready');
    setNotice('请儿童和家长分别确认准备');
    void append('system', 'speech_recognition_unavailable', {
      fallback: 'manual_core_information_confirmation',
      technical_failure_is_not_player_failure: true,
    });
  };

  const markReady = (player: Player) => {
    const next = { ...ready, [player]: true };
    setReady(next);
    void append(player, 'player_ready');
    if (next.child && next.parent) {
      setNotice('双方准备完成，游戏开始！');
      resetInteraction('child', 0);
    }
  };

  const roleFor = (player: Player) => player === initiator ? scenario.initiatorRole : scenario.responderRole;
  const infoForSpeaker = requiredInfo.filter(item => item.side === 'both' || (item.side === 'initiator' && speaker === initiator) || (item.side === 'responder' && speaker === responder));

  const voice = (player: Player) => {
    if (player !== speaker || (stage !== 'task' && stage !== 'speaking')) return;
    if (stage === 'task') {
      const now = performance.now();
      speechStartedAt.current = now;
      if (lastSpeechEndAt.current !== null && lastSpeaker.current && lastSpeaker.current !== player) {
        responseLatencies.current.push(now - lastSpeechEndAt.current);
      }
      setStage('speaking');
      setNotice(`${playerName(player)}正在以“${roleFor(player)}”身份自由表达……`);
      void append(player, 'role_speech_start', {
        scenario_id: scenario.id, role_name: roleFor(player), utterance_index: utterances + 1,
      });
      return;
    }
    const end = performance.now();
    const duration = end - speechStartedAt.current;
    lastSpeechEndAt.current = end;
    setReported([]);
    setStage('review');
    setNotice('请确认刚才表达过的核心信息；没有听清也可以重新说');
    void append(player, 'role_speech_end', {
      scenario_id: scenario.id, role_name: roleFor(player), duration_ms: duration, semantic_transcript_available: false,
    });
  };

  const toggleReported = (id: string) => {
    if (stage !== 'review') return;
    setReported(items => items.includes(id) ? items.filter(item => item !== id) : [...items, id]);
  };

  const retrySpeech = () => {
    const failures = recognitionFailures + 1;
    setRecognitionFailures(failures);
    setReported([]);
    setStage('task');
    setNotice(`请${playerName(speaker)}再说一次，技术上没有听清不会算作任务错误`);
    void append(speaker, 'speech_recognition_failure', {
      scenario_id: scenario.id, retry_count: failures, player_task_failed: false,
    });
  };

  const confirmExpression = () => {
    if (stage !== 'review') return;
    const nextCollected = Array.from(new Set([...collected, ...reported]));
    const nextUtterances = utterances + 1;
    const previousSpeaker = lastSpeaker.current;
    const didAlternate = previousSpeaker !== null && previousSpeaker !== speaker;
    const nextAlternating = alternatingTurns + (didAlternate ? 1 : 0);
    const currentSpeaker = speaker;
    lastSpeaker.current = currentSpeaker;
    setCollected(nextCollected);
    setUtterances(nextUtterances);
    setAlternatingTurns(nextAlternating);
    setReported([]);
    void append(currentSpeaker, 'core_information_confirmed', {
      scenario_id: scenario.id, role_name: roleFor(currentSpeaker), information_ids: reported,
      collected_information_ids: nextCollected, utterance_index: nextUtterances,
    });
    if (didAlternate) {
      void append('system', 'dialogue_turn_complete', {
        scenario_id: scenario.id, speaker: currentSpeaker, respondent_to: previousSpeaker,
        response_latency_ms: responseLatencies.current.at(-1) ?? null,
        bidirectional_turn_index: nextAlternating,
      });
    }

    const missing = requiredInfo.filter(item => !nextCollected.includes(item.id));
    if (!missing.length && nextUtterances >= minimumUtterances) {
      setStage('task-ready');
      setNotice('任务信息已经完整，请共同完成情境任务');
      void append('system', 'role_task_information_complete', {
        scenario_id: scenario.id, utterance_count: nextUtterances, alternating_turn_count: nextAlternating,
      });
      return;
    }

    const nextSpeaker = otherPlayer(currentSpeaker);
    setSpeaker(nextSpeaker);
    setStage('task');
    const nextHintCount = hintCount + 1;
    setHintCount(nextHintCount);
    const hint = missing.length ? `还需要确认：${missing.map(item => item.label.replace(/^.*了/, '')).join('、')}` : '再进行一次轮流回应，一起确认任务';
    setNotice(`${hint}。轮到${playerName(nextSpeaker)}表达`);
    void append('system', 'system_hint_shown', {
      scenario_id: scenario.id, missing_information_ids: missing.map(item => item.id),
      next_speaker: nextSpeaker, hint_did_not_supply_full_answer: true,
    });
  };

  const finishTask = async (player: Player) => {
    if (stage !== 'task-ready' || player !== responder) return;
    const duration = performance.now() - taskStartedAt.current;
    const nextCompleted = completedTasks + 1;
    setCompletedTasks(nextCompleted);
    setStage('success');
    setNotice(scenario.success);
    const summary: TrialSummary = {
      trial_id: trialId.current, session_id: sessionId, game_id: 'LANG_03', mode, phase,
      level: mode === 'train' ? level : null, opportunity_index: nextCompleted, target_id: scenario.id,
      outcome: 'completed_valid', child_target_id: null, parent_target_id: null, child_t_ms: null, parent_t_ms: null,
      inter_touch_ms: null, valid_for_scoring: true, actor_identity_method: identityPrototype.id,
      config_version: CONFIG_VERSION, scorer_version: SCORER_VERSION,
      metrics: {
        scenario_id: scenario.id, task_prompt: taskPrompt, initiator_player: initiator, responder_player: responder,
        required_information_ids: requiredInfo.map(item => item.id), collected_information_ids: collected,
        utterance_count: utterances, alternating_turn_count: alternatingTurns,
        response_latency_ms: responseLatencies.current, system_hint_count: hintCount,
        speech_recognition_failure_count: recognitionFailures, task_duration_ms: duration,
      },
    };
    await eventStore.saveTrial(summary);
    void append(player, 'role_task_complete', {
      scenario_id: scenario.id, completion_action: scenario.completionAction, duration_ms: duration,
      utterance_count: utterances, alternating_turn_count: alternatingTurns,
    }, scenario.id);
  };

  const afterSuccess = () => {
    if (taskInRole + 1 < TASKS_PER_ROLE) {
      const nextTask = taskInRole + 1;
      setTaskInRole(nextTask);
      resetInteraction(initiator, nextTask);
      return;
    }
    if (!swapped) {
      setStage('role-swap');
      setNotice(`交换角色啦！儿童变为${scenario.responderRole}，家长变为${scenario.initiatorRole}`);
      return;
    }
    if (mode === 'train' && levelIndex < LEVELS.length - 1) {
      setStage('level-up');
      setNotice(`${scenario.name}阶段完成，准备进入新的生活情境`);
      return;
    }
    setStage('finished');
  };

  const confirmRoleSwap = () => {
    setSwapped(true);
    setTaskInRole(0);
    setNotice(`儿童现在是${scenario.responderRole}，家长现在是${scenario.initiatorRole}`);
    void append('system', 'role_swap', {
      scenario_id: scenario.id, child_role: scenario.responderRole, parent_role: scenario.initiatorRole,
    });
    resetInteraction('parent', 0);
  };

  const advanceLevel = () => {
    const nextIndex = levelIndex + 1;
    const nextLevel = LEVELS[nextIndex];
    const nextScenario = SCENARIOS[nextLevel];
    setLevelIndex(nextIndex);
    setSwapped(false);
    setTaskInRole(0);
    setNotice(`进入${nextScenario.name}，儿童先扮演${nextScenario.initiatorRole}`);
    void append('system', 'level_advanced', { from_level: level, to_level: nextLevel, next_scenario_id: nextScenario.id });
    resetInteraction('child', 0, nextScenario);
  };

  const renderPlayer = (player: Player) => {
    const isSpeaker = player === speaker;
    const isResponder = player === responder;
    const ownInfo = infoForSpeaker;
    return (
      <section className={`role-show-player ${player} ${isSpeaker && ['task', 'speaking', 'review'].includes(stage) ? 'active' : ''}`}>
        <header><strong>{playerName(player)}</strong><span>{stage === 'ready' ? '准备中' : roleFor(player)}</span></header>
        {stage === 'ready' ? (
          <div className="role-ready-panel">
            <span>{player === 'child' ? '🧒' : '🧑'}</span>
            <button className={ready[player] ? 'secondary' : 'primary'} disabled={ready[player]} onClick={() => markReady(player)}>
              {ready[player] ? `${playerName(player)}已准备` : `${playerName(player)}准备好了`}
            </button>
          </div>
        ) : (
          <>
            <div className="role-identity-card">
              <small>当前角色</small><strong>{roleFor(player)}</strong>
              <span>{isSpeaker && ['task', 'speaking', 'review'].includes(stage) ? '现在由你表达' : '听伙伴表达并准备回应'}</span>
            </div>
            {(stage === 'task' || stage === 'speaking') && isSpeaker && (
              <button className={`role-voice ${stage === 'speaking' ? 'recording' : ''}`} onClick={() => voice(player)}>
                <span>🎙️</span><strong>{stage === 'speaking' ? '说完了，点击结束' : '按下后自由表达'}</strong>
                <small>不要求固定句子</small>
              </button>
            )}
            {stage === 'review' && isSpeaker && (
              <div className="role-review">
                <strong>刚才表达了哪些信息？</strong>
                <small>这是辅助确认，不是语音考试</small>
                <div className="role-info-options">
                  {ownInfo.map(item => <button key={item.id} className={reported.includes(item.id) ? 'selected' : ''} onClick={() => toggleReported(item.id)}>{reported.includes(item.id) ? '✓ ' : ''}{item.label}</button>)}
                </div>
                <button className="primary" onClick={confirmExpression}>确认本次表达</button>
                <button className="secondary" onClick={retrySpeech}>刚才没听清，重新说</button>
              </div>
            )}
            {stage === 'task-ready' && isResponder && (
              <button className="role-complete-action" onClick={() => void finishTask(player)}><span>{scenario.prop}</span><strong>{scenario.completionAction}</strong></button>
            )}
            {!isSpeaker && ['task', 'speaking', 'review'].includes(stage) && <div className="role-listening"><span>👂</span><strong>倾听伙伴</strong><small>下一次轮到你回应</small></div>}
          </>
        )}
      </section>
    );
  };

  if (stage === 'intro') return (
    <main className="game-intro role-show-intro">
      <header className="topbar transparent"><button className="icon-button" onClick={onExit}>←</button></header>
      <section className="intro-card"><div className="mascot-box">🎭</div><div className="intro-copy"><span className="eyebrow">小镇有话说 · 情境角色扮演</span><h1>小镇角色秀</h1><p className="lead">儿童和家长轮流表达、认真回应，一起完成小镇里的生活任务。</p><div className="rule-strip"><span>① 扮演角色</span><span>② 轮流对话</span><span>③ 一起完成任务</span></div><button className="primary large" onClick={() => void start()}>进入角色秀</button></div></section>
    </main>
  );

  if (stage === 'finished') return (
    <main className="finish-page"><section className="finish-card card"><div className="finish-art">🎭</div><h1>小镇角色任务完成啦！</h1><p>完成 {completedTasks} 个生活任务，保存 {eventCount} 条语言互动事件。</p><button className="primary" onClick={onExit}>返回游戏列表</button></section></main>
  );

  return (
    <main className="game-page role-show-game">
      <header className="game-topbar"><button className="icon-button" onClick={onExit}>←</button><div className="game-title"><span>🎭</span><div><small>小镇有话说</small><strong>小镇角色秀</strong></div></div><span className="status-pill">{mode === 'train' ? `${level} · 自动递进` : `${phase} · 固定标准任务`}</span></header>
      <div className="role-show-status"><strong>{notice}</strong><span>{scenario.name} · 当前角色已完成 {displayedTaskProgress}/{TASKS_PER_ROLE} 个任务</span></div>
      <section className="role-show-layout">
        {renderPlayer('child')}
        <aside className={`role-show-scene ${scenario.id}`}>
          <div className="role-scene-heading"><span>{scenario.icon}</span><div><small>当前生活情境</small><strong>{scenario.name}</strong></div></div>
          <div className="role-task-card"><small>共同任务</small><strong>{scenario.goal}</strong><span>{taskPrompt}</span></div>
          <div className="role-scene-prop"><span>{stage === 'success' ? scenario.prop : scenario.icon}</span><i>{stage === 'success' ? '✓' : ''}</i></div>
          <div className="role-dialogue-state">
            <strong>{stage === 'speaking' ? `${playerName(speaker)}正在说话` : stage === 'review' ? '确认刚才表达的信息' : stage === 'task-ready' ? '关键信息已经完整' : stage === 'success' ? scenario.success : stage === 'role-swap' ? '交换角色啦！' : stage === 'level-up' ? '情境阶段完成' : '轮流表达并回应'}</strong>
            <span>已完成 {utterances} 次表达 · {alternatingTurns} 次轮流回应</span>
          </div>
          {stage !== 'ready' && !['success', 'role-swap', 'level-up'].includes(stage) && (
            <div className="role-progress-info">
              {requiredInfo.map(item => <span key={item.id} className={collected.includes(item.id) ? 'done' : ''}>{collected.includes(item.id) ? '✓' : '○'} {item.label}</span>)}
            </div>
          )}
          {stage === 'success' && <div className="role-stage-action success"><strong>{scenario.success}</strong><span>{scenario.prop}</span><button className="primary" onClick={afterSuccess}>继续下一个任务</button></div>}
          {stage === 'role-swap' && <div className="role-stage-action"><strong>交换角色啦！</strong><p>儿童变为{scenario.responderRole}<br />家长变为{scenario.initiatorRole}</p><button className="primary" onClick={confirmRoleSwap}>交换完成，继续</button></div>}
          {stage === 'level-up' && <div className="role-stage-action"><strong>{scenario.name}完成！</strong><p>下一站：{SCENARIOS[LEVELS[levelIndex + 1]].name}</p><button className="primary" onClick={advanceLevel}>进入新情境</button></div>}
        </aside>
        {renderPlayer('parent')}
      </section>
    </main>
  );
}
