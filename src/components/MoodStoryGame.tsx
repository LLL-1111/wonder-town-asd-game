import { useMemo, useRef, useState } from 'react';
import { identityPrototype, versions } from '../config/protocols';
import { createId, wallTime } from '../core/ids';
import { eventStore } from '../data/eventStore';
import type { ActorRole, GameEvent, GameMode, LevelId, TestPhase, TrialSummary } from '../types';

type Props = { mode: GameMode; phase: TestPhase; pairId: string; onExit: () => void };
type Player = 'child' | 'parent';
type Stage = 'intro' | 'ready' | 'choosing' | 'discussion' | 'speaking' | 'discussion-complete' | 'finished';
type EmotionId = 'happy' | 'sad' | 'angry' | 'scared' | 'calm' | 'surprised' | 'nervous' | 'expectant';
type Story = { id: string; person: string; pronoun: '他' | '她'; place: string; art: string; text: string };

const LEVELS: LevelId[] = ['L1', 'L2', 'L3'];
const CONFIG_VERSION = 'emotion-story-judgment-0.1';
const SCORER_VERSION = 'emotion-judgment-agreement-0.1';
const EMOTIONS: Record<EmotionId, { name: string; icon: string; color: string }> = {
  happy: { name: '开心', icon: '😊', color: '#f1b94d' }, sad: { name: '难过', icon: '😢', color: '#6aaad0' },
  angry: { name: '生气', icon: '😠', color: '#df735e' }, scared: { name: '害怕', icon: '😨', color: '#987dc0' },
  calm: { name: '平静', icon: '😌', color: '#77b79e' }, surprised: { name: '惊讶', icon: '😮', color: '#ed9b63' },
  nervous: { name: '紧张', icon: '😬', color: '#b786b5' }, expectant: { name: '期待', icon: '🤩', color: '#dc9d3f' },
};
const OPTIONS: Record<LevelId, EmotionId[]> = {
  L1: ['happy', 'sad', 'angry'],
  L2: ['happy', 'sad', 'angry', 'scared', 'calm'],
  L3: ['happy', 'sad', 'angry', 'scared', 'calm', 'surprised', 'nervous', 'expectant'],
};
const STORIES: Record<LevelId, Story[]> = {
  L1: [
    { id: 'MOOD_L1_01', person: '小雨', pronoun: '她', place: '生日会', art: '🎁😊🎈', text: '小雨准备的礼物被朋友特别喜欢。' },
    { id: 'MOOD_L1_02', person: '乐乐', pronoun: '他', place: '游戏角', art: '🧱💥', text: '乐乐刚搭好的积木突然倒了。' },
    { id: 'MOOD_L1_03', person: '安安', pronoun: '她', place: '小镇广场', art: '🎈💨', text: '安安最喜欢的气球飞走了。' },
  ],
  L2: [
    { id: 'MOOD_L2_01', person: '多多', pronoun: '他', place: '学校舞台', art: '🎤🏫', text: '老师请多多第一次到大家面前介绍作品。' },
    { id: 'MOOD_L2_02', person: '小米', pronoun: '她', place: '游乐园', art: '🎠🌧️', text: '小米期待很久的旋转木马因为下雨暂停了。' },
    { id: 'MOOD_L2_03', person: '晨晨', pronoun: '他', place: '超市', art: '🛒👋', text: '晨晨和家长走散了一会儿，又在服务台见面了。' },
  ],
  L3: [
    { id: 'MOOD_L3_01', person: '多多', pronoun: '他', place: '新活动室', art: '🚪🎨✨', text: '多多第一次参加新的绘画活动，门后有许多不认识的小伙伴。' },
    { id: 'MOOD_L3_02', person: '小雨', pronoun: '她', place: '小镇比赛', art: '🏁👏🎖️', text: '小雨完成了比赛，大家为她鼓掌，但结果还没有公布。' },
    { id: 'MOOD_L3_03', person: '乐乐', pronoun: '他', place: '朋友家', art: '🧸🤝🏠', text: '朋友想玩乐乐刚拿到的新玩具，正在等乐乐决定要不要分享。' },
  ],
};
const DISCUSSION_HINTS = ['你从故事里的哪个地方想到这种心情？', '如果是你遇到这件事，可能会有什么感觉？', '听听伙伴为什么会这样想。'];
const playerName = (player: Player) => player === 'child' ? '儿童' : '家长';
const otherPlayer = (player: Player): Player => player === 'child' ? 'parent' : 'child';

export default function MoodStoryGame({ mode, phase, pairId, onExit }: Props) {
  const sessionId = useRef(createId(mode === 'train' ? 'TRAIN' : 'TEST')).current;
  const trialId = useRef('');
  const storyStartedAt = useRef(0);
  const speechStartedAt = useRef(0);
  const selectionTimes = useRef<Record<Player, number | null>>({ child: null, parent: null });
  const confirmationTimes = useRef<Record<Player, number | null>>({ child: null, parent: null });

  const [stage, setStage] = useState<Stage>('intro');
  const [ready, setReady] = useState<Record<Player, boolean>>({ child: false, parent: false });
  const [levelIndex, setLevelIndex] = useState(0);
  const [storyIndex, setStoryIndex] = useState(0);
  const [selections, setSelections] = useState<Record<Player, EmotionId | null>>({ child: null, parent: null });
  const [confirmed, setConfirmed] = useState<Record<Player, boolean>>({ child: false, parent: false });
  const [discussionSpeaker, setDiscussionSpeaker] = useState<Player>('child');
  const [discussionTurns, setDiscussionTurns] = useState(0);
  const [promptCount, setPromptCount] = useState(0);
  const [activeHint, setActiveHint] = useState<string | null>(null);
  const [eventCount, setEventCount] = useState(0);
  const [completedStories, setCompletedStories] = useState(0);
  const [notice, setNotice] = useState('请儿童和家长分别确认准备');

  const level: LevelId = mode === 'train' ? LEVELS[levelIndex] : 'L2';
  const storySet = STORIES[level];
  const story = storySet[storyIndex];
  const emotions = useMemo(() => OPTIONS[level].map(id => ({ id, ...EMOTIONS[id] })), [level]);
  const agreement = Boolean(selections.child && selections.child === selections.parent);
  const revealed = ['discussion', 'speaking', 'discussion-complete'].includes(stage);

  const append = async (actor_role: ActorRole, event_type: string, payload?: Record<string, unknown>, target_id: string | null = null, eventLevel: LevelId = level) => {
    const event: GameEvent = {
      event_id: createId('EV'), pair_id: pairId, session_id: sessionId, trial_id: trialId.current || null,
      mode, phase, domain_id: 'emotion', game_id: 'EMO_01', level: mode === 'train' ? eventLevel : null,
      actor_role, actor_identity_method: identityPrototype.id, event_type, t_ms: performance.now(), wall_time: wallTime(),
      target_id, payload, config_version: CONFIG_VERSION, scorer_version: SCORER_VERSION, asset_version: versions.assets,
    };
    await eventStore.appendEvent(event);
    setEventCount(value => value + 1);
  };

  const prepareStory = (nextIndex: number, nextLevel: LevelId = level) => {
    const nextStory = STORIES[nextLevel][nextIndex];
    trialId.current = createId('TRIAL');
    storyStartedAt.current = performance.now();
    selectionTimes.current = { child: null, parent: null };
    confirmationTimes.current = { child: null, parent: null };
    setSelections({ child: null, parent: null });
    setConfirmed({ child: false, parent: false });
    setDiscussionTurns(0);
    setPromptCount(0);
    setActiveHint(null);
    setDiscussionSpeaker(nextIndex % 2 === 0 ? 'child' : 'parent');
    setStage('choosing');
    setNotice(`请分别判断${nextStory.person}现在可能是什么心情`);
    void append('system', 'mood_story_presented', {
      story_id: nextStory.id, person: nextStory.person, level: nextLevel,
      emotion_option_ids: OPTIONS[nextLevel], no_standard_answer_shown: true,
    }, nextStory.id, nextLevel);
  };

  const start = async () => {
    await eventStore.saveSession({
      session_id: sessionId, pair_id: pairId, mode, phase, game_id: 'EMO_01', started_at: wallTime(),
      protocol_version: CONFIG_VERSION, actor_identity_method: identityPrototype.id,
      identity_validation_status: 'REQUIRES_REAL_PARENT_CHILD_VALIDATION',
      material_set: mode === 'test' ? 'EMO_01_A_fixed-everyday-stories' : null, response_window_ms: null,
      interpretation_limit: 'agreement_is_story_emotion_judgment_agreement_not_true_emotional_synchrony',
    });
    setStage('ready');
  };

  const markReady = (player: Player) => {
    const next = { ...ready, [player]: true };
    setReady(next);
    void append(player, 'player_ready');
    if (next.child && next.parent) prepareStory(0);
  };

  const chooseEmotion = (player: Player, emotion: EmotionId) => {
    if (stage !== 'choosing' || confirmed[player]) return;
    selectionTimes.current[player] = performance.now() - storyStartedAt.current;
    setSelections(value => ({ ...value, [player]: emotion }));
    setNotice(`${playerName(player)}已选择，可以修改或确认；另一方的选择仍然隐藏`);
    void append(player, 'mood_selected', {
      story_id: story.id, emotion_id: emotion, selection_time_ms: selectionTimes.current[player], private_until_both_confirm: true,
    }, emotion);
  };

  const confirmEmotion = (player: Player) => {
    if (stage !== 'choosing' || !selections[player] || confirmed[player]) return;
    confirmationTimes.current[player] = performance.now() - storyStartedAt.current;
    const next = { ...confirmed, [player]: true };
    setConfirmed(next);
    void append(player, 'mood_selection_confirmed', {
      story_id: story.id, confirmation_time_ms: confirmationTimes.current[player], selection_hidden_from_partner: true,
    });
    if (next.child && next.parent && selections.child && selections.parent) {
      const same = selections.child === selections.parent;
      setStage('discussion');
      setNotice(same ? '你们想到了一样的心情！' : '你们想到了不同的心情。');
      void append('system', 'mood_choices_revealed', {
        story_id: story.id, child_emotion: selections.child, parent_emotion: selections.parent,
        judgment_agreement: same, agreement_is_not_scored_as_correctness: true,
      }, story.id);
    } else {
      setNotice(`${playerName(player)}已确认，选择已隐藏，等待${playerName(otherPlayer(player))}`);
    }
  };

  const voice = (player: Player) => {
    if (player !== discussionSpeaker || (stage !== 'discussion' && stage !== 'speaking')) return;
    if (stage === 'discussion') {
      speechStartedAt.current = performance.now();
      setStage('speaking');
      setNotice(`${playerName(player)}正在和伙伴说说自己的想法……`);
      void append(player, 'mood_reflection_start', { story_id: story.id, turn_index: discussionTurns + 1 });
      return;
    }
    const duration = performance.now() - speechStartedAt.current;
    const nextTurns = discussionTurns + 1;
    setDiscussionTurns(nextTurns);
    void append(player, 'mood_reflection_end', { story_id: story.id, turn_index: nextTurns, duration_ms: duration });
    if (nextTurns >= 2) {
      setStage('discussion-complete');
      setNotice('谢谢你们分享不同的想法，可以主动进入下一个故事');
      void completeStory(nextTurns);
    } else {
      const nextSpeaker = otherPlayer(player);
      setDiscussionSpeaker(nextSpeaker);
      setStage('discussion');
      setNotice(`轮到${playerName(nextSpeaker)}说说为什么会这样想`);
    }
  };

  const showHint = () => {
    if (stage !== 'discussion') return;
    const nextCount = promptCount + 1;
    const hint = DISCUSSION_HINTS[(nextCount - 1) % DISCUSSION_HINTS.length];
    setPromptCount(nextCount);
    setActiveHint(hint);
    void append('system', 'mood_discussion_hint_used', { story_id: story.id, prompt_index: nextCount, hint_does_not_supply_answer: true });
  };

  const completeStory = async (turns: number) => {
    const nextCompleted = completedStories + 1;
    setCompletedStories(nextCompleted);
    const summary: TrialSummary = {
      trial_id: trialId.current, session_id: sessionId, game_id: 'EMO_01', mode, phase,
      level: mode === 'train' ? level : null, opportunity_index: nextCompleted, target_id: story.id,
      outcome: 'completed_valid', child_target_id: selections.child, parent_target_id: selections.parent,
      child_t_ms: selectionTimes.current.child, parent_t_ms: selectionTimes.current.parent, inter_touch_ms: null,
      valid_for_scoring: true, actor_identity_method: identityPrototype.id, config_version: CONFIG_VERSION, scorer_version: SCORER_VERSION,
      metrics: {
        story_id: story.id, child_emotion: selections.child, parent_emotion: selections.parent,
        story_emotion_judgment_agreement: agreement, child_selection_time_ms: selectionTimes.current.child,
        parent_selection_time_ms: selectionTimes.current.parent, child_confirmation_time_ms: confirmationTimes.current.child,
        parent_confirmation_time_ms: confirmationTimes.current.parent, follow_up_dialogue_completed: turns >= 2,
        follow_up_dialogue_turns: turns, system_prompt_count: promptCount,
        interpretation_limit: 'not_true_emotional_synchrony', total_duration_ms: performance.now() - storyStartedAt.current,
      },
    };
    await eventStore.saveTrial(summary);
    void append('system', 'mood_story_round_complete', {
      story_id: story.id, judgment_agreement: agreement, follow_up_dialogue_turns: turns, system_prompt_count: promptCount,
    }, story.id);
  };

  const nextStory = () => {
    if (stage !== 'discussion-complete') return;
    if (storyIndex + 1 < storySet.length) {
      const next = storyIndex + 1;
      setStoryIndex(next);
      prepareStory(next);
      return;
    }
    if (mode === 'train' && levelIndex < LEVELS.length - 1) {
      const nextLevelIndex = levelIndex + 1;
      const nextLevel = LEVELS[nextLevelIndex];
      setLevelIndex(nextLevelIndex);
      setStoryIndex(0);
      setNotice(`进入 ${nextLevel}，故事中可能有更多种心情`);
      void append('system', 'mood_level_advanced', { from_level: level, to_level: nextLevel });
      prepareStory(0, nextLevel);
      return;
    }
    setStage('finished');
  };

  const renderPlayer = (player: Player) => {
    const selected = selections[player];
    const isDiscussionSpeaker = discussionSpeaker === player;
    return (
      <section className={`mood-player ${player} ${isDiscussionSpeaker && ['discussion', 'speaking'].includes(stage) ? 'active' : ''}`}>
        <header><strong>{playerName(player)}</strong><span>{stage === 'ready' ? '准备中' : revealed ? '分享想法' : '独立判断'}</span></header>
        {stage === 'ready' ? <div className="mood-ready"><span>{player === 'child' ? '🧒' : '🧑'}</span><button className={ready[player] ? 'secondary' : 'primary'} disabled={ready[player]} onClick={() => markReady(player)}>{ready[player] ? `${playerName(player)}已准备` : `${playerName(player)}准备好了`}</button></div> : (
          <>
            {stage === 'choosing' && !confirmed[player] && <><p className="mood-question">你觉得{story.pronoun}现在是什么心情？</p><div className={`mood-options count-${emotions.length}`}>{emotions.map(emotion => <button key={emotion.id} style={{ '--mood': emotion.color } as React.CSSProperties} onClick={() => chooseEmotion(player, emotion.id)}><span>{emotion.icon}</span><strong>{emotion.name}</strong></button>)}</div><div className="mood-local-confirm"><span>{selected ? '🔒 已选择，具体内容保密；可以重新选择' : '请在自己的区域选择'}</span><button className="primary" disabled={!selected} onClick={() => confirmEmotion(player)}>{playerName(player)}确认</button></div></>}
            {stage === 'choosing' && confirmed[player] && <div className="mood-private-lock"><span>🔒</span><strong>{playerName(player)}已确认</strong><p>选择已经隐藏<br />等待{playerName(otherPlayer(player))}</p></div>}
            {revealed && selected && <div className="mood-revealed-choice"><small>{playerName(player)}想到的心情</small><span>{EMOTIONS[selected].icon}</span><strong>{EMOTIONS[selected].name}</strong></div>}
            {(stage === 'discussion' || stage === 'speaking') && isDiscussionSpeaker && <button className={`mood-voice ${stage === 'speaking' ? 'recording' : ''}`} onClick={() => voice(player)}><span>🎙️</span><strong>{stage === 'speaking' ? '说完了，点击结束' : '说说为什么会这样想'}</strong></button>}
            {(stage === 'discussion' || stage === 'speaking') && !isDiscussionSpeaker && <div className="mood-listening"><span>👂</span><strong>听听伙伴的想法</strong></div>}
            {stage === 'discussion-complete' && <div className="mood-shared"><span>💬</span><strong>已经分享想法</strong></div>}
          </>
        )}
      </section>
    );
  };

  if (stage === 'intro') return <main className="game-intro mood-intro"><header className="topbar transparent"><button className="icon-button" onClick={onExit}>←</button></header><section className="intro-card"><div className="mascot-box">🏡💛</div><div className="intro-copy"><span className="eyebrow">小镇心情屋 · 情绪共同体验</span><h1>小镇心情故事</h1><p className="lead">面对同一个小镇故事，分别想一想人物的心情，再和伙伴说说为什么。</p><div className="rule-strip"><span>① 各自选择</span><span>② 同时揭晓</span><span>③ 分享想法</span></div><button className="primary large" onClick={() => void start()}>进入心情屋</button></div></section></main>;
  if (stage === 'finished') return <main className="finish-page"><section className="finish-card card"><div className="finish-art">💛</div><h1>心情故事看完啦！</h1><p>你们一起讨论了 {completedStories} 个故事，保存 {eventCount} 条互动事件。</p><button className="primary" onClick={onExit}>返回游戏列表</button></section></main>;

  return <main className="game-page mood-story-game"><header className="game-topbar"><button className="icon-button" onClick={onExit}>←</button><div className="game-title"><span>💛</span><div><small>小镇心情屋</small><strong>小镇心情故事</strong></div></div><span className="status-pill">{mode === 'train' ? `${level} · 故事 ${storyIndex + 1}/${storySet.length}` : `${phase} · 固定故事`}</span></header><div className="mood-status"><strong>{notice}</strong><span>这里没有标准答案，也不会比较谁对谁错</span></div><section className="mood-layout">{renderPlayer('child')}<article className="mood-story-center"><div className="mood-place">{story?.place ?? '心情屋'}</div><div className="mood-story-art">{story?.art ?? '🏡'}</div><h2>{story?.person ?? '小镇居民'}的故事</h2><p>{story?.text ?? '双方准备后开始第一则故事。'}</p>{revealed && <div className={`mood-result ${agreement ? 'same' : 'different'}`}><strong>{agreement ? '你们想到了一样的心情！' : '你们想到了不同的心情。'}</strong><span>{agreement ? '一样不代表标准答案，说说为什么吧。' : '不同也没有错，听听彼此为什么这样想。'}</span></div>}{stage === 'discussion' && <button className="mood-hint-button" onClick={showHint}>需要一个交流提示</button>}{activeHint && stage !== 'discussion-complete' && <div className="mood-hint">💡 {activeHint}</div>}{stage === 'discussion-complete' && <button className="primary mood-next" onClick={nextStory}>下一个故事</button>}<small className="mood-interpretation">记录的是“故事人物情绪判断的一致程度”，不是对错，也不等同于真实情绪同步。</small></article>{renderPlayer('parent')}</section></main>;
}
