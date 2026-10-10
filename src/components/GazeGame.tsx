import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { gazeTestProtocol, gazeTrainingConfig, identityPrototype, versions } from '../config/protocols';
import { products, seededShuffle } from '../config/products';
import { createId, wallTime } from '../core/ids';
import { classifyGazeTrial, summarizeGazeTrials, type RolePress } from '../core/scoring';
import { downloadEventsCsv, downloadJsonExport, eventStore } from '../data/eventStore';
import type { ActorRole, GameEvent, GameMode, LevelId, Product, TestPhase, TrialOutcome, TrialSummary } from '../types';

interface Props {
  mode: GameMode;
  phase: TestPhase;
  pairId: string;
  onExit: () => void;
}

type Stage = 'intro' | 'playing' | 'level-up' | 'finished';

const LEVELS: LevelId[] = ['L1', 'L2', 'L3'];
const feedbackText: Record<TrialOutcome, string> = {
  completed_valid: '补货成功！这一格货架已经整理好了。',
  valid_not_synchronized: '都找对啦，下次试着靠近一点按住。',
  wrong_target: '这次选到了别的商品，再一起看看。',
  no_response: '这次没有完成，下一件商品要来啦。',
  technical_invalid: '设备刚才打了个小盹，这次不计入。',
  skipped_or_withdrawn: '本次已跳过。',
};

// The sprite sheet contains independent illustrated shelf items. Map every
// catalog category to a matching visual family so labels never sit on an
// unrelated placeholder or emoji.
function productSpritePosition(product: Product) {
  const slotByCategory: Record<string, [number, number]> = {
    '饮品': [0, 0], '水果': [1, 0], '零食': [2, 0], '蔬菜': [3, 0],
    '日用品': [0, 1], '文具': [1, 1],
  };
  const [x, y] = slotByCategory[product.category] ?? [2, 1];
  return `${x * 33.333}% ${y * 100}%`;
}

function seedFrom(text: string) {
  return [...text].reduce((value, char) => ((value * 31) + char.charCodeAt(0)) >>> 0, 17);
}

export default function GazeGame({ mode, phase, pairId, onExit }: Props) {
  const [stage, setStage] = useState<Stage>('intro');
  const [levelIndex, setLevelIndex] = useState(0);
  const [trialIndex, setTrialIndex] = useState(0);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<TrialOutcome[]>([]);
  const [activeRoles, setActiveRoles] = useState<Record<'child' | 'parent', boolean>>({ child: false, parent: false });
  const [remainingMs, setRemainingMs] = useState(0);
  const [savedEventCount, setSavedEventCount] = useState(0);
  const [stockedCount, setStockedCount] = useState(0);
  const sessionId = useRef(createId(mode === 'train' ? 'TRAIN' : phase ?? 'TEST')).current;
  const trialIdRef = useRef<string | null>(null);
  const trialStartRef = useRef(0);
  const trialOpenRef = useRef(false);
  const pressesRef = useRef<RolePress[]>([]);
  const pointerRoleRef = useRef(new Map<number, 'child' | 'parent'>());
  const finishTimerRef = useRef<number | null>(null);
  const countdownTimerRef = useRef<number | null>(null);

  const level = LEVELS[levelIndex];
  const trainConfig = gazeTrainingConfig[level];
  const responseWindowMs = mode === 'train' ? trainConfig.highlightMs : gazeTestProtocol.responseWindowMs;
  const syncWindowMs = mode === 'train' ? trainConfig.syncWindowMs : gazeTestProtocol.syncWindowMs;
  const totalTrials = mode === 'train'
    ? LEVELS.reduce((sum, item) => sum + gazeTrainingConfig[item].quota, 0)
    : gazeTestProtocol.trialCount;
  const completedTrials = mode === 'train'
    ? LEVELS.slice(0, levelIndex).reduce((sum, item) => sum + gazeTrainingConfig[item].quota, 0) + trialIndex
    : trialIndex;

  const shelves = useMemo(() => {
    const base = seedFrom(sessionId);
    return LEVELS.reduce<Record<LevelId, Product[]>>((result, item, index) => {
      result[item] = seededShuffle(products, base + index * 997).slice(0, gazeTrainingConfig[item].itemCount);
      return result;
    }, {} as Record<LevelId, Product[]>);
  }, [sessionId]);

  const testShelf = useMemo(
    () => seededShuffle(products, seedFrom(`${pairId}-${gazeTestProtocol.materialSet}`)).slice(0, gazeTestProtocol.itemCount),
    [pairId],
  );

  const shelf = mode === 'train' ? shelves[level] : testShelf;
  const targetOrder = useMemo(() => {
    const source = mode === 'train' ? shelves[level] : testShelf;
    const needed = mode === 'train' ? gazeTrainingConfig[level].quota : gazeTestProtocol.trialCount;
    const order: Product[] = [];
    let pass = 0;
    while (order.length < needed) {
      const protocolSeed = mode === 'train'
        ? `${sessionId}-${level}-${pass}`
        : `${pairId}-${gazeTestProtocol.materialSet}-${pass}`;
      order.push(...seededShuffle(source, seedFrom(protocolSeed)));
      pass += 1;
    }
    return order.slice(0, needed);
  }, [level, mode, pairId, sessionId, shelves, testShelf]);
  const currentTarget = targetOrder[trialIndex % targetOrder.length];

  const appendEvent = useCallback(async (
    actorRole: ActorRole,
    eventType: string,
    data: Partial<GameEvent> = {},
  ) => {
    const event: GameEvent = {
      event_id: createId('EV'), pair_id: pairId, session_id: sessionId,
      trial_id: data.trial_id ?? trialIdRef.current, mode, phase, domain_id: 'gaze', game_id: 'GAZE_01',
      level: mode === 'train' ? level : null, actor_role: actorRole,
      actor_identity_method: identityPrototype.id, event_type: eventType,
      t_ms: data.t_ms ?? performance.now(), wall_time: wallTime(), target_id: data.target_id ?? null,
      pointer_id: data.pointer_id, x_rel: data.x_rel, y_rel: data.y_rel,
      outcome: data.outcome, invalid_reason: data.invalid_reason, payload: data.payload,
      config_version: mode === 'train' ? versions.config : versions.testProtocol,
      scorer_version: versions.scorer, asset_version: versions.assets,
    };
    await eventStore.appendEvent(event);
    setSavedEventCount((count) => count + 1);
  }, [level, mode, pairId, phase, sessionId]);

  const clearTrialTimers = () => {
    if (finishTimerRef.current) window.clearTimeout(finishTimerRef.current);
    if (countdownTimerRef.current) window.clearInterval(countdownTimerRef.current);
    finishTimerRef.current = null;
    countdownTimerRef.current = null;
  };

  const advanceAfterFeedback = useCallback(() => {
    setFeedback(null);
    if (mode === 'test') {
      if (trialIndex + 1 >= gazeTestProtocol.trialCount) setStage('finished');
      else setTrialIndex((value) => value + 1);
      return;
    }
    if (trialIndex + 1 < trainConfig.quota) {
      setTrialIndex((value) => value + 1);
      return;
    }
    if (levelIndex < LEVELS.length - 1) {
      setStage('level-up');
      window.setTimeout(() => {
        setLevelIndex((value) => value + 1);
        setTrialIndex(0);
        setStage('playing');
      }, 1700);
      return;
    }
    setStage('finished');
  }, [levelIndex, mode, trainConfig.quota, trialIndex]);

  const finishTrial = useCallback(async (forceOutcome?: TrialOutcome) => {
    if (!trialOpenRef.current || !trialIdRef.current || !currentTarget) return;
    trialOpenRef.current = false;
    clearTrialTimers();
    const deadline = trialStartRef.current + responseWindowMs;
    const classified = classifyGazeTrial(currentTarget.id, pressesRef.current, syncWindowMs, deadline);
    const outcome = forceOutcome ?? classified.outcome;
    const summary: TrialSummary = {
      trial_id: trialIdRef.current, session_id: sessionId, game_id: 'GAZE_01', mode, phase,
      level: mode === 'train' ? level : null,
      opportunity_index: completedTrials + 1, target_id: currentTarget.id, outcome,
      child_target_id: classified.childTargetId, parent_target_id: classified.parentTargetId,
      child_t_ms: classified.childMs, parent_t_ms: classified.parentMs,
      inter_touch_ms: classified.interTouchMs,
      valid_for_scoring: !['technical_invalid', 'skipped_or_withdrawn'].includes(outcome),
      actor_identity_method: identityPrototype.id,
      config_version: mode === 'train' ? versions.config : versions.testProtocol,
      scorer_version: versions.scorer,
    };
    await eventStore.saveTrial(summary);
    await appendEvent('system', 'trial_classified', { outcome, target_id: currentTarget.id, payload: { summary } });
    setOutcomes((values) => [...values, outcome]);
    if (outcome === 'completed_valid') setStockedCount((count) => count + 1);
    setActiveRoles({ child: false, parent: false });
    setFeedback(mode === 'test' ? '本次操作已记录' : feedbackText[outcome]);
    window.setTimeout(advanceAfterFeedback, mode === 'test' ? 560 : 1050);
  }, [advanceAfterFeedback, appendEvent, completedTrials, currentTarget, level, mode, phase, responseWindowMs, sessionId, syncWindowMs]);

  useEffect(() => {
    if (stage !== 'playing' || feedback || !currentTarget || trialOpenRef.current) return;
    trialOpenRef.current = true;
    pressesRef.current = [];
    pointerRoleRef.current.clear();
    trialIdRef.current = createId('TRIAL');
    trialStartRef.current = performance.now();
    setRemainingMs(responseWindowMs);
    setActiveRoles({ child: false, parent: false });
    void appendEvent('system', 'trial_open', {
      target_id: currentTarget.id,
      payload: { opportunity_index: completedTrials + 1, response_window_ms: responseWindowMs, sync_window_ms: syncWindowMs },
    });
    finishTimerRef.current = window.setTimeout(() => void finishTrial(), responseWindowMs);
    countdownTimerRef.current = window.setInterval(() => {
      setRemainingMs(Math.max(0, responseWindowMs - (performance.now() - trialStartRef.current)));
    }, 100);
    return clearTrialTimers;
  }, [appendEvent, completedTrials, currentTarget, feedback, finishTrial, responseWindowMs, stage, syncWindowMs]);

  useEffect(() => () => clearTrialTimers(), []);

  const startGame = async () => {
    await eventStore.saveSession({
      session_id: sessionId, pair_id: pairId, mode, phase, game_id: 'GAZE_01', started_at: wallTime(),
      protocol_version: mode === 'train' ? versions.config : versions.testProtocol,
      actor_identity_method: identityPrototype.id,
      identity_validation_status: gazeTestProtocol.validationStatus,
      material_set: mode === 'test' ? gazeTestProtocol.materialSet : null,
      response_window_ms: responseWindowMs,
      sync_window_ms: syncWindowMs,
    });
    await appendEvent('system', 'session_started', { payload: { real_input_only: true } });
    setStage('playing');
  };

  const pointerDown = (role: 'child' | 'parent', product: Product, event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    if (!trialOpenRef.current) return;
    if (pressesRef.current.some((press) => press.role === role)) {
      void appendEvent(role, 'extra_pointer_ignored', { target_id: product.id, pointer_id: event.pointerId, invalid_reason: 'role_already_has_pointer' });
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    const rect = event.currentTarget.getBoundingClientRect();
    const now = performance.now();
    pointerRoleRef.current.set(event.pointerId, role);
    pressesRef.current.push({ role, targetId: product.id, downMs: now, upMs: null });
    setActiveRoles((value) => ({ ...value, [role]: true }));
    void appendEvent(role, 'pointerdown', {
      target_id: product.id, pointer_id: event.pointerId, t_ms: now,
      x_rel: (event.clientX - rect.left) / rect.width, y_rel: (event.clientY - rect.top) / rect.height,
      payload: { pointer_type: event.pointerType, correct_target: product.id === currentTarget.id },
    });
    const classification = classifyGazeTrial(currentTarget.id, pressesRef.current, syncWindowMs, trialStartRef.current + responseWindowMs);
    if (classification.outcome === 'completed_valid') {
      void finishTrial();
    }
  };

  const pointerEnd = (role: 'child' | 'parent', product: Product, event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    const now = performance.now();
    const press = pressesRef.current.find((item) => item.role === role && item.upMs === null);
    if (press) press.upMs = now;
    pointerRoleRef.current.delete(event.pointerId);
    setActiveRoles((value) => ({ ...value, [role]: false }));
    void appendEvent(role, event.type, { target_id: product.id, pointer_id: event.pointerId, t_ms: now });
  };

  const abortSession = async () => {
    if (trialOpenRef.current) await finishTrial('skipped_or_withdrawn');
    await appendEvent('system', 'session_aborted', { outcome: 'skipped_or_withdrawn' });
    onExit();
  };

  if (stage === 'intro') {
    return (
      <main className="game-intro grocery-sky">
        <header className="topbar transparent"><button className="icon-button" onClick={onExit}>←</button><span className="status-pill">{mode === 'train' ? '训练模式' : `${phase} 标准化测试`}</span></header>
        <section className="intro-card">
          <div className="mascot-box"><img className="intro-characters" src="/visual-mockups/scheme-a/assets-v2-child-parent.png" alt="奇妙小镇的儿童与家长角色" /></div>
          <div className="intro-copy">
            <span className="eyebrow">超市大忙碌</span>
            <h1>补货大作战</h1>
            <p className="lead">找到发亮的商品。儿童按住商品左侧，家长按住右侧，两个人一起完成补货。</p>
            <div className="rule-strip"><span>① 找到发亮商品</span><span>② 各按自己的区域</span><span>③ 同时保持一下</span></div>
            <div className="prototype-note"><strong>身份方案 A · 技术原型</strong><span>{identityPrototype.status}。同一商品的两个区域映射到同一 target_id，不改变共同目标机制。</span></div>
            {mode === 'train' ? (
              <p className="mode-explain">系统会从 L1 自动进入 L2、L3。答错或超时不会挡住升级，也不能手动选难度。</p>
            ) : (
              <p className="mode-explain">本次为固定 12 次标准化任务，不自动升级，也不会在过程中显示同步成绩。</p>
            )}
            <button className="primary large" onClick={() => void startGame()}>我准备好了</button>
          </div>
        </section>
      </main>
    );
  }

  if (stage === 'level-up') {
    return <main className="celebration-screen"><div className="level-burst"><span className="level-badge" aria-hidden="true" /><h1>升级啦！</h1><p>{level === 'L1' ? '生鲜货架区已经整理好，下一站去日用品区。' : '新货架区域开放，继续一起完成补货。'}</p></div></main>;
  }

  if (stage === 'finished') {
    const summary = summarizeGazeTrials(outcomes);
    return (
      <main className="finish-page grocery-sky">
        <section className="finish-card card">
          <div className="finish-art"><span className="finish-badge" aria-hidden="true" /></div>
          <span className="eyebrow">本次会话已安全保存</span>
          <h1>{mode === 'train' ? '今天的补货完成啦！' : `${phase} 测试已完成`}</h1>
          {mode === 'train' ? (
            <p>完成 {outcomes.length} 个真实任务机会，其中 {summary.synchronizedCount} 次在当前原型同步窗内完成。</p>
          ) : (
            <p>已经保存 {outcomes.length} 个正式测试机会。测试过程中不展示即时同步成绩，家长可导出原始数据复核。</p>
          )}
          <div className="summary-grid">
            <div><strong>{outcomes.length}</strong><span>已记录机会</span></div>
            <div><strong>{savedEventCount}</strong><span>本次原始事件</span></div>
            <div><strong>{identityPrototype.status}</strong><span>身份方案状态</span></div>
          </div>
          <div className="button-row centered wrap"><button className="secondary" onClick={() => void downloadJsonExport()}>导出 JSON</button><button className="secondary" onClick={() => void downloadEventsCsv()}>导出事件 CSV</button><button className="primary" onClick={onExit}>返回游戏列表</button></div>
        </section>
      </main>
    );
  }

  return (
    <main className="game-page">
      <header className="game-topbar">
        <button className="icon-button" onClick={() => void abortSession()}>←</button>
        <div className="game-title"><span className="mini-cart" aria-hidden="true" /><div><small>超市大忙碌</small><strong>补货大作战</strong></div></div>
        <div className="game-progress">
          <span className="status-pill">{mode === 'train' ? level : `${phase} · 固定测试`}</span>
          <div className="progress-track"><span style={{ width: `${Math.min(100, ((completedTrials + (feedback ? 1 : 0)) / totalTrials) * 100)}%` }} /></div>
          <small>{Math.min(totalTrials, completedTrials + 1)} / {totalTrials}</small>
        </div>
      </header>

      <section className="grocery-stage">
        <div className="store-sign"><span>今日补货 · 已整理 {stockedCount} 格</span><strong>找到发亮的商品，两个人一起按住！</strong></div>
        <div className="time-cloud" aria-label="本次剩余时间"><span style={{ width: `${(remainingMs / responseWindowMs) * 100}%` }} /></div>
        <div className={`shelf-grid count-${shelf.length}`}>
          {shelf.map((product) => {
            const isTarget = product.id === currentTarget.id;
            return (
              <article className={`product-card ${isTarget ? `target target-${level.toLowerCase()}` : ''}`} key={product.id} style={{ '--product-color': product.color } as React.CSSProperties}>
                <div className="product-visual"><span className="product-illustration" aria-hidden="true" style={{ backgroundPosition: productSpritePosition(product) }} /><span className="product-name">{product.name}</span>{isTarget && <span className="sparkle" aria-hidden="true" />}</div>
                <div className="role-touch-row">
                  <button className={`role-zone child-zone ${activeRoles.child ? 'role-busy' : ''}`} aria-label={`儿童选择${product.name}`} onPointerDown={(e) => pointerDown('child', product, e)} onPointerUp={(e) => pointerEnd('child', product, e)} onPointerCancel={(e) => pointerEnd('child', product, e)}><span>儿童</span></button>
                  <button className={`role-zone parent-zone ${activeRoles.parent ? 'role-busy' : ''}`} aria-label={`家长选择${product.name}`} onPointerDown={(e) => pointerDown('parent', product, e)} onPointerUp={(e) => pointerEnd('parent', product, e)} onPointerCancel={(e) => pointerEnd('parent', product, e)}><span>家长</span></button>
                </div>
              </article>
            );
          })}
        </div>
        <div className="role-legend"><span className={activeRoles.child ? 'active' : ''}><i className="role-dot child-dot" />儿童操作左半边</span><span className={activeRoles.parent ? 'active' : ''}><i className="role-dot parent-dot" />家长操作右半边</span></div>
      </section>

      {feedback && <div className={`feedback-toast ${outcomes.at(-1) === 'completed_valid' ? 'success' : ''}`}><span>{outcomes.at(-1) === 'completed_valid' ? '✓' : '●'}</span>{feedback}</div>}
      <aside className="prototype-ribbon">身份分区原型 · 待真实平板双人验证</aside>
    </main>
  );
}
