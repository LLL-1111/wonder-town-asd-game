import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { identityPrototype, shoppingHelperTestProtocol, shoppingHelperTrainingConfig, versions } from '../config/protocols';
import { products, seededShuffle } from '../config/products';
import { createId, wallTime } from '../core/ids';
import { authorizeProductRole, classifyHelperConfirmation, consumeProductAuthorization, otherHelperRole, type HelperRole, type ProductAuthorization, type Proposal } from '../core/shoppingHelper';
import { downloadEventsCsv, downloadJsonExport, eventStore } from '../data/eventStore';
import type { ActorRole, GameEvent, GameMode, LevelId, Product, TestPhase, TrialOutcome, TrialSummary } from '../types';

type Props = { mode: GameMode; phase: TestPhase; pairId: string; onExit: () => void };
type Stage = 'intro' | 'playing' | 'level-up' | 'finished';
type Order = { id: string; items: Product[] };
type Participation = { childProposals: number; parentProposals: number; childConfirmations: number; parentConfirmations: number; wrongProposals: number; mismatches: number; confirmationTimeouts: number };
const LEVELS: LevelId[] = ['L1', 'L2', 'L3'];
const CUSTOMER_NAMES = ['林奶奶', '阿诚叔叔', '小雅姐姐'];

function seedFrom(value: string) { return [...value].reduce((sum, char) => ((sum * 31) + char.charCodeAt(0)) >>> 0, 17); }
function exactSpritePosition(product: Product) {
  // Only use a sprite when it is the matching item. Other catalogue entries are
  // deliberately marked as needing art rather than shown with a wrong illustration.
  const slots: Record<string, [number, number]> = { '牛奶': [0, 0], '苹果': [1, 0], '面包': [2, 0], '胡萝卜': [3, 0] };
  const slot = slots[product.name];
  if (!slot) return null;
  const [x, y] = slot;
  return `${x * 33.333}% ${y * 100}%`;
}
function emptyParticipation(): Participation { return { childProposals: 0, parentProposals: 0, childConfirmations: 0, parentConfirmations: 0, wrongProposals: 0, mismatches: 0, confirmationTimeouts: 0 }; }

export default function ShoppingHelperGame({ mode, phase, pairId, onExit }: Props) {
  const [stage, setStage] = useState<Stage>('intro');
  const [levelIndex, setLevelIndex] = useState(0);
  const [orderIndex, setOrderIndex] = useState(0);
  const [completedItemIds, setCompletedItemIds] = useState<string[]>([]);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [remainingMs, setRemainingMs] = useState(0);
  const [paused, setPaused] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [authorizedRole, setAuthorizedRole] = useState<ProductAuthorization>(null);
  const [outcomes, setOutcomes] = useState<TrialOutcome[]>([]);
  const [savedEventCount, setSavedEventCount] = useState(0);
  const sessionId = useRef(createId(mode === 'train' ? 'TRAIN' : phase ?? 'TEST')).current;
  const orderIdRef = useRef<string | null>(null);
  const orderOpenRef = useRef(false);
  const orderStartRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const pausedOrderRemainingRef = useRef<number | null>(null);
  const pausedConfirmationRemainingRef = useRef<number | null>(null);
  const authorizedRoleRef = useRef<ProductAuthorization>(null);
  const firstActionRef = useRef<Record<HelperRole, number | null>>({ child: null, parent: null });
  const participationRef = useRef<Participation>(emptyParticipation());
  const confirmationTimesRef = useRef<number[]>([]);

  const updateAuthorization = (role: ProductAuthorization) => {
    authorizedRoleRef.current = role;
    setAuthorizedRole(role);
  };

  const level = LEVELS[levelIndex];
  const config = mode === 'train' ? shoppingHelperTrainingConfig[level] : shoppingHelperTestProtocol;
  const totalOrders = mode === 'train' ? LEVELS.reduce((sum, item) => sum + shoppingHelperTrainingConfig[item].quota, 0) : shoppingHelperTestProtocol.trialCount;
  const completedOrders = mode === 'train' ? LEVELS.slice(0, levelIndex).reduce((sum, item) => sum + shoppingHelperTrainingConfig[item].quota, 0) + orderIndex : orderIndex;
  const shelves = useMemo(() => LEVELS.reduce<Record<LevelId, Product[]>>((result, item, index) => {
    result[item] = seededShuffle(products, seedFrom(`${sessionId}-${item}-${index}`)).slice(0, shoppingHelperTrainingConfig[item].itemCount);
    return result;
  }, {} as Record<LevelId, Product[]>), [sessionId]);
  const testShelf = useMemo(() => seededShuffle(products, seedFrom(`${pairId}-${shoppingHelperTestProtocol.materialSet}`)).slice(0, shoppingHelperTestProtocol.itemCount), [pairId]);
  const shelf = mode === 'train' ? shelves[level] : testShelf;
  const orders = useMemo<Order[]>(() => {
    const count = mode === 'train' ? shoppingHelperTrainingConfig[level].quota : shoppingHelperTestProtocol.trialCount;
    const listCount = config.shoppingListCount;
    return Array.from({ length: count }, (_, index) => ({
      id: `ORDER-${level}-${index + 1}`,
      items: seededShuffle(shelf, seedFrom(mode === 'test'
        ? `${pairId}-${shoppingHelperTestProtocol.materialSet}-${index}`
        : `${sessionId}-${mode}-${level}-${index}`)).slice(0, listCount),
    }));
  }, [config.shoppingListCount, level, mode, pairId, sessionId, shelf]);
  const currentOrder = orders[orderIndex];
  const outstandingIds = currentOrder?.items.filter((item) => !completedItemIds.includes(item.id)).map((item) => item.id) ?? [];
  const activeRole = proposal ? otherHelperRole(proposal.role) : null;
  const customerIndex = (completedOrders + levelIndex) % CUSTOMER_NAMES.length;
  const customerName = CUSTOMER_NAMES[customerIndex];
  const statusText = paused
    ? '已暂停，继续后请选择角色'
    : feedback ?? (authorizedRole === 'parent'
      ? '当前角色：家长，请点击商品'
      : authorizedRole === 'child'
        ? '当前角色：儿童，请点击商品'
        : notice ?? (proposal ? '请选择下一次操作角色' : '请选择角色后点击商品'));

  const appendEvent = useCallback(async (actorRole: ActorRole, eventType: string, data: Partial<GameEvent> = {}) => {
    await eventStore.appendEvent({
      event_id: createId('EV'), pair_id: pairId, session_id: sessionId, trial_id: data.trial_id ?? orderIdRef.current,
      mode, phase, domain_id: 'gaze', game_id: 'GAZE_02', level: mode === 'train' ? level : null, actor_role: actorRole,
      actor_identity_method: identityPrototype.id, event_type: eventType, t_ms: data.t_ms ?? performance.now(), wall_time: wallTime(),
      target_id: data.target_id ?? null, pointer_id: data.pointer_id, x_rel: data.x_rel, y_rel: data.y_rel, outcome: data.outcome,
      invalid_reason: data.invalid_reason, payload: data.payload,
      config_version: mode === 'train' ? 'train-gaze-02-order-collaboration-0.2' : 'test-gaze-02-order-collaboration-0.2', scorer_version: 'order-collaboration-0.2', asset_version: versions.assets,
    });
    setSavedEventCount((count) => count + 1);
  }, [level, mode, pairId, phase, sessionId]);
  const clearTimer = () => { if (timerRef.current !== null) window.clearInterval(timerRef.current); timerRef.current = null; };

  const advanceOrder = useCallback(() => {
    setFeedback(null); setNotice(null); setProposal(null); setCompletedItemIds([]); updateAuthorization(null); setPaused(false);
    if (mode === 'test') {
      if (orderIndex + 1 >= shoppingHelperTestProtocol.trialCount) setStage('finished');
      else setOrderIndex((value) => value + 1);
      return;
    }
    if (orderIndex + 1 < shoppingHelperTrainingConfig[level].quota) { setOrderIndex((value) => value + 1); return; }
    if (levelIndex < LEVELS.length - 1) {
      setStage('level-up');
      window.setTimeout(() => { setLevelIndex((value) => value + 1); setOrderIndex(0); setStage('playing'); }, 1500);
    } else setStage('finished');
  }, [level, levelIndex, mode, orderIndex]);

  const finishOrder = useCallback(async (outcome: TrialOutcome, finalCompletedIds = completedItemIds) => {
    if (!orderOpenRef.current || !orderIdRef.current || !currentOrder) return;
    orderOpenRef.current = false; clearTimer();
    const metric = {
      order_item_count: currentOrder.items.length,
      completed_item_count: finalCompletedIds.length,
      correct_confirmations: finalCompletedIds.length,
      evaluable_confirmation_opportunities: currentOrder.items.length,
      cooperative_order_completed: outcome === 'completed_valid',
      confirmation_response_ms: confirmationTimesRef.current,
      participation: participationRef.current,
    };
    const summary: TrialSummary = {
      trial_id: orderIdRef.current, session_id: sessionId, game_id: 'GAZE_02', mode, phase, level: mode === 'train' ? level : null,
      opportunity_index: completedOrders + 1, target_id: currentOrder.items.map((item) => item.id).join('|'), outcome,
      child_target_id: null, parent_target_id: null, child_t_ms: firstActionRef.current.child, parent_t_ms: firstActionRef.current.parent,
      inter_touch_ms: null, valid_for_scoring: !['technical_invalid', 'skipped_or_withdrawn'].includes(outcome), actor_identity_method: identityPrototype.id,
      config_version: mode === 'train' ? 'train-gaze-02-order-collaboration-0.2' : 'test-gaze-02-order-collaboration-0.2', scorer_version: 'order-collaboration-0.2', metrics: metric,
    };
    await eventStore.saveTrial(summary);
    await appendEvent('system', 'order_classified', { target_id: summary.target_id, outcome, payload: { summary, order_id: currentOrder.id } });
    setOutcomes((values) => [...values, outcome]);
    setFeedback(mode === 'test' ? '本张购物清单已记录' : outcome === 'completed_valid' ? '购物车装好啦，准备去收银！' : '这一单先到收银台结算，下一张清单马上来。');
    window.setTimeout(advanceOrder, mode === 'test' ? 600 : 1200);
  }, [advanceOrder, appendEvent, completedItemIds, completedOrders, currentOrder, level, mode, phase, sessionId]);

  useEffect(() => {
    if (stage !== 'playing' || feedback || paused || !currentOrder || orderOpenRef.current) return;
    orderOpenRef.current = true; orderIdRef.current = createId('ORDER'); orderStartRef.current = performance.now(); firstActionRef.current = { child: null, parent: null }; participationRef.current = emptyParticipation(); confirmationTimesRef.current = []; updateAuthorization(null); setRemainingMs(config.orderWindowMs);
    void appendEvent('system', 'order_open', { target_id: currentOrder.items.map((item) => item.id).join('|'), payload: { order_id: currentOrder.id, item_ids: currentOrder.items.map((item) => item.id), order_window_ms: config.orderWindowMs, confirmation_window_ms: config.confirmationWindowMs } });
  }, [appendEvent, config.confirmationWindowMs, config.orderWindowMs, currentOrder, feedback, paused, stage]);

  useEffect(() => {
    if (stage !== 'playing' || feedback || paused || !orderOpenRef.current) return;
    clearTimer();
    timerRef.current = window.setInterval(() => {
      const now = performance.now(); const remaining = Math.max(0, config.orderWindowMs - (now - orderStartRef.current)); setRemainingMs(remaining);
      if (proposal && now - proposal.atMs >= config.confirmationWindowMs) {
        participationRef.current.confirmationTimeouts += 1;
        void appendEvent('system', 'confirmation_timeout', { target_id: proposal.productId, invalid_reason: 'second_participant_timeout', payload: { proposer: proposal.role, confirmation_window_ms: config.confirmationWindowMs } });
        setProposal(null); updateAuthorization(null); setNotice('这次确认等得有点久，换一件清单商品再试试。');
      }
      if (remaining <= 0) void finishOrder('no_response');
    }, 100);
    return clearTimer;
  }, [appendEvent, config.confirmationWindowMs, config.orderWindowMs, feedback, finishOrder, paused, proposal, stage]);
  useEffect(() => () => clearTimer(), []);

  const startGame = async () => {
    await eventStore.saveSession({ session_id: sessionId, pair_id: pairId, mode, phase, game_id: 'GAZE_02', started_at: wallTime(), protocol_version: mode === 'train' ? 'train-gaze-02-order-collaboration-0.2' : 'test-gaze-02-order-collaboration-0.2', actor_identity_method: identityPrototype.id, identity_validation_status: shoppingHelperTestProtocol.validationStatus, material_set: mode === 'test' ? shoppingHelperTestProtocol.materialSet : null, order_window_ms: config.orderWindowMs, confirmation_window_ms: config.confirmationWindowMs });
    await appendEvent('system', 'session_started', { payload: { real_input_only: true, game_rule: 'propose_confirm_cart_order' } }); setStage('playing');
  };
  const chooseRole = (role: HelperRole) => {
    if (!orderOpenRef.current || paused || feedback || !currentOrder) return;
    const now = performance.now();
    updateAuthorization(authorizeProductRole(role));
    void appendEvent(role, 'role_select', { t_ms: now, payload: { authorization: 'one_product_click' } });
    setNotice(`${role === 'child' ? '儿童' : '家长'}模式，请点击商品`);
  };
  const handleTouch = (product: Product, event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault(); if (!orderOpenRef.current || paused || feedback || !currentOrder) return;
    const now = performance.now(); const rect = event.currentTarget.getBoundingClientRect();
    const eventData = { target_id: product.id, pointer_id: event.pointerId, t_ms: now, x_rel: (event.clientX - rect.left) / rect.width, y_rel: (event.clientY - rect.top) / rect.height };
    const role = authorizedRoleRef.current;
    if (role === null) {
      void appendEvent('system', 'item_click_invalid', { ...eventData, invalid_reason: 'role_selection_required', payload: { required_action: 'role_select' } });
      setNotice('请选择你的角色后开始操作');
      return;
    }
    updateAuthorization(consumeProductAuthorization(role));
    if (!proposal) {
      if (!outstandingIds.includes(product.id)) { participationRef.current.wrongProposals += 1; void appendEvent(role, 'proposal_not_on_list', { ...eventData, invalid_reason: 'not_outstanding_list_item', payload: { item_name: product.name } }); setNotice('这件不在还没完成的清单里，换一件试试。请选择下一位操作角色。'); return; }
      firstActionRef.current[role] ??= now;
      if (role === 'child') participationRef.current.childProposals += 1; else participationRef.current.parentProposals += 1;
      setProposal({ role, productId: product.id, atMs: now });
      void appendEvent(role, 'item_click', { ...eventData, payload: { item_name: product.name, action: 'propose', confirmer: otherHelperRole(role) } }); setNotice('请选择下一位操作角色'); return;
    }
    if (role === proposal.role) { void appendEvent(role, 'same_actor_confirmation_blocked', { ...eventData, invalid_reason: 'requires_other_participant' }); setNotice('请让另一位来确认这件商品。请选择下一位操作角色。'); return; }
    firstActionRef.current[role] ??= now;
    const result = classifyHelperConfirmation(proposal, role, product.id, outstandingIds, now);
    if (result.kind === 'not-outstanding') { void appendEvent(role, 'confirmation_not_evaluable', { ...eventData, invalid_reason: 'proposal_no_longer_outstanding' }); setProposal(null); setNotice('请选择下一位操作角色'); return; }
    if (role === 'child') participationRef.current.childConfirmations += 1; else participationRef.current.parentConfirmations += 1;
    if (result.kind === 'mismatch') {
      participationRef.current.mismatches += 1; void appendEvent(role, 'confirmation_mismatch', { ...eventData, invalid_reason: 'different_product', payload: { proposed_id: proposal.productId, response_ms: result.responseMs } }); setProposal(null); setNotice('两位选的不是同一件商品，重新一起找一找。请选择下一位操作角色。'); return;
    }
    const nextCompleted = [...completedItemIds, product.id]; confirmationTimesRef.current.push(result.responseMs);
    void appendEvent(role, 'item_click', { ...eventData, payload: { proposed_id: proposal.productId, response_ms: result.responseMs, completed_item_count: nextCompleted.length, action: 'confirm' } });
    setCompletedItemIds(nextCompleted); setProposal(null); setNotice('请选择下一位操作角色');
    if (nextCompleted.length >= currentOrder.items.length) void finishOrder('completed_valid', nextCompleted);
  };
  const togglePause = () => {
    if (paused) {
      const now = performance.now();
      orderStartRef.current = now - (config.orderWindowMs - (pausedOrderRemainingRef.current ?? remainingMs));
      if (proposal && pausedConfirmationRemainingRef.current !== null) setProposal({ ...proposal, atMs: now - (config.confirmationWindowMs - pausedConfirmationRemainingRef.current) });
      setPaused(false);
    } else {
      const now = performance.now();
      pausedOrderRemainingRef.current = remainingMs;
      pausedConfirmationRemainingRef.current = proposal ? Math.max(0, config.confirmationWindowMs - (now - proposal.atMs)) : null;
      clearTimer(); updateAuthorization(null); setNotice('已暂停；继续后请选择你的角色'); setPaused(true);
    }
  };
  const abort = async () => { if (orderOpenRef.current) await finishOrder('skipped_or_withdrawn'); await appendEvent('system', 'session_aborted', { outcome: 'skipped_or_withdrawn' }); onExit(); };

  if (stage === 'intro') return <main className="game-intro grocery-sky"><header className="topbar transparent"><button className="icon-button" onClick={onExit}>←</button><span className="status-pill">{mode === 'train' ? '训练模式' : `${phase} 标准化测试`}</span></header><section className="intro-card"><div className="mascot-box"><img className="intro-characters" src="/assets/parent-child-cutout-v1.png" alt="儿童和家长" /></div><div className="intro-copy"><span className="eyebrow">超市大忙碌 · 购物订单</span><h1>购物小帮手</h1><p className="lead">顾客给出购物清单。轮流由一位先指认，再由另一位确认同一件商品，放进共同购物车。</p><div className="rule-strip"><span>① 看购物清单</span><span>② 一位先指认</span><span>③ 另一位确认入车</span></div><p className="mode-explain">没有目标高亮，也不要求 800ms 同步点击。每一级会自动完成 6 张购物清单。</p><button className="primary large" onClick={() => void startGame()}>开始接待顾客</button></div></section></main>;
  if (stage === 'level-up') return <main className="celebration-screen"><div className="level-burst"><span className="level-badge" aria-hidden="true" /><h1>购物区升级啦！</h1><p>{level === 'L1' ? '下一站要买更多商品' : '货架更丰富，继续合作找一找'}</p></div></main>;
  if (stage === 'finished') return <main className="finish-page grocery-sky"><section className="finish-card card"><div className="finish-art"><span className="finish-badge" aria-hidden="true" /></div><span className="eyebrow">购物订单已保存</span><h1>{mode === 'train' ? '今天的购物帮手任务完成啦！' : `${phase} 测试已完成`}</h1><p>已完成 {outcomes.filter((item) => item === 'completed_valid').length} 张订单，并保存 {savedEventCount} 条真实操作事件。</p><div className="summary-grid"><div><strong>{outcomes.filter((item) => item === 'completed_valid').length}</strong><span>合作完成订单</span></div><div><strong>{outcomes.length}</strong><span>订单机会</span></div><div><strong>{savedEventCount}</strong><span>原始事件</span></div></div><div className="button-row centered wrap"><button className="secondary" onClick={() => void downloadJsonExport()}>导出 JSON</button><button className="secondary" onClick={() => void downloadEventsCsv()}>导出事件 CSV</button><button className="primary" onClick={onExit}>返回游戏列表</button></div></section></main>;

  return <main className="game-page helper-game-page">
    <header className="game-topbar">
      <button className="icon-button" onClick={() => void abort()}>←</button>
      <div className="game-title"><span className="mini-cart" aria-hidden="true" /><div><small>超市大忙碌</small><strong>购物小帮手</strong></div></div>
      <div className="game-progress"><span className="status-pill">{mode === 'train' ? level : `${phase} · 固定测试`}</span><div className="progress-track"><span style={{ width: `${Math.min(100, ((completedOrders + (feedback ? 1 : 0)) / totalOrders) * 100)}%` }} /></div><small>{Math.min(totalOrders, completedOrders + 1)} / {totalOrders}</small></div>
      <button className="quiet-button" onClick={togglePause}>{paused ? '继续' : '暂停'}</button>
    </header>
    <section className="helper-market-stage">
      <section className={`shared-task-board ${feedback ? 'customer-thanks' : ''}`} aria-label="共享购物任务">
        <div className="task-customer" aria-label={customerName}><img src="/assets/helper-customers-v1.png" alt="" style={{ transform: `translateX(-${customerIndex * 33.333}%)` }} /></div>
        <div className="task-customer-copy"><span>当前顾客 · {customerName}</span><strong>{feedback ? '谢谢你们，小帮手！' : proposal ? '我看到你们找到啦！' : '请帮我完成这张购物清单'}</strong><small>{feedback ? '购物车装好啦，我去收银台。' : proposal ? '请另一位确认同一件商品。' : '左右两边一起看清单，再到货架找商品。'}</small></div>
        <div className="shared-task-list" aria-label="顾客购物清单">
          {currentOrder.items.map((item) => {
            const sprite = exactSpritePosition(item);
            const isDone = completedItemIds.includes(item.id);
            return <span className={`shared-task-item ${isDone ? 'done' : ''}`} key={item.id}><i className={sprite ? 'sprite' : 'art-pending'} style={sprite ? { backgroundPosition: sprite } : { '--product-color': item.color } as React.CSSProperties} aria-hidden="true" /><b>{item.name}</b><em>{isDone ? '已收好' : '待购买'}</em></span>;
          })}
        </div>
        <div className="shared-task-count"><small>本单进度</small><b>{completedItemIds.length} / {currentOrder.items.length}</b></div>
      </section>
      <aside className="seat-side child-seat" aria-label="儿童操作侧"><span>儿童这一侧</span><button className={`seat-pad child-pad ${authorizedRole === 'child' ? 'selected' : ''} ${activeRole && activeRole !== 'child' ? 'not-turn' : ''}`} onClick={() => chooseRole('child')}><i /><b>我是儿童</b><small>{authorizedRole === 'child' ? '已授权一次商品操作' : proposal?.role === 'child' ? '我已指认，等家长确认' : activeRole === 'child' ? '请确认同一件商品' : '选择后获得一次商品操作权'}</small></button></aside>

      <section className="helper-search-zone" aria-label="商品搜索区">
        <div className="search-zone-heading"><div><span>共同搜索区</span><strong aria-live="polite">{statusText}</strong></div><div className="order-time"><small>本单剩余</small><b>{Math.ceil(remainingMs / 1000)} 秒</b></div></div>
        <div className={`helper-shelf count-${shelf.length}`}>
          {shelf.map((product) => {
            const sprite = exactSpritePosition(product);
            const isProposed = proposal?.productId === product.id;
            const isCompleted = completedItemIds.includes(product.id);
            return <button className={`helper-product ${isProposed ? 'is-proposed' : ''} ${isCompleted ? 'is-completed' : ''}`} key={product.id} aria-label={`${authorizedRole === 'child' ? '儿童' : authorizedRole === 'parent' ? '家长' : '未选择角色'}选择${product.name}`} onPointerDown={(event) => handleTouch(product, event)}>
              <span className={`helper-product-art ${sprite ? 'sprite' : 'art-pending'}`} style={sprite ? { backgroundPosition: sprite } : { '--product-color': product.color } as React.CSSProperties} aria-hidden="true">{!sprite && <b>待补充<br />插画</b>}</span>
              <span className="helper-product-name">{product.name}</span>
              {isProposed && <span className="product-state">已指认</span>}
              {isCompleted && <span className="product-state done">已入车</span>}
            </button>;
          })}
        </div>
      </section>
      <aside className="seat-side parent-seat" aria-label="家长操作侧"><span>家长这一侧</span><button className={`seat-pad parent-pad ${authorizedRole === 'parent' ? 'selected' : ''} ${activeRole && activeRole !== 'parent' ? 'not-turn' : ''}`} onClick={() => chooseRole('parent')}><i /><b>我是家长</b><small>{authorizedRole === 'parent' ? '已授权一次商品操作' : proposal?.role === 'parent' ? '我已指认，等儿童确认' : activeRole === 'parent' ? '请确认同一件商品' : '选择后获得一次商品操作权'}</small></button></aside>
      <div className="order-cart-progress" aria-label="共同购物车进度"><div className="cart-progress-head"><span>共同购物车</span><b>{completedItemIds.length} / {currentOrder.items.length}</b></div><div className="cart-progress-items">{currentOrder.items.map((item) => <span className={completedItemIds.includes(item.id) ? 'in-cart' : ''} key={item.id}>{completedItemIds.includes(item.id) ? '✓' : '○'} {item.name}</span>)}</div></div>
    </section>
    <aside className="prototype-ribbon">合作确认原型 · 操作来源按角色区记录；单平板不验证真实身份</aside>
  </main>;
}
