import { useEffect, useMemo, useState } from 'react';
import GazeGame from './components/GazeGame';
import ShoppingHelperGame from './components/ShoppingHelperGame';
import SellerGame from './components/SellerGame';
import BalloonGame from './components/BalloonGame';
import TechLab from './components/TechLab';
import { domains } from './config/gameCatalog';
import { downloadEventsCsv, downloadJsonExport, eventStore } from './data/eventStore';
import type { DomainDefinition, GameMode, TestPhase, TrialSummary } from './types';

type Screen = 'home' | 'phase' | 'domains' | 'games' | 'gaze-game' | 'shopping-helper' | 'seller-game' | 'balloon-game' | 'tech' | 'data';

export default function App() {
  const [screen, setScreen] = useState<Screen>('home');
  const [mode, setMode] = useState<GameMode>('train');
  const [phase, setPhase] = useState<TestPhase>(null);
  const [selectedDomainId, setSelectedDomainId] = useState('gaze');
  const [pairId, setPairId] = useState(() => localStorage.getItem('wonder-town-pair-id') || 'PAIR_001');
  const [notice, setNotice] = useState<string | null>(null);
  const selectedDomain = useMemo(() => domains.find((domain) => domain.id === selectedDomainId) ?? domains[0], [selectedDomainId]);

  useEffect(() => localStorage.setItem('wonder-town-pair-id', pairId), [pairId]);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 2600);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const chooseMode = (nextMode: GameMode) => {
    setMode(nextMode);
    setPhase(null);
    setScreen(nextMode === 'test' ? 'phase' : 'domains');
  };

  const choosePhase = (nextPhase: Exclude<TestPhase, null>) => {
    setPhase(nextPhase);
    setScreen('domains');
  };

  if (screen === 'gaze-game') {
    return <GazeGame mode={mode} phase={phase} pairId={pairId} onExit={() => setScreen('games')} />;
  }
  if (screen === 'shopping-helper') {
    return <ShoppingHelperGame mode={mode} phase={phase} pairId={pairId} onExit={() => setScreen('games')} />;
  }
  if (screen === 'seller-game') {
    return <SellerGame mode={mode} phase={phase} pairId={pairId} onExit={() => setScreen('games')} />;
  }
  if (screen === 'balloon-game') {
    return <BalloonGame mode={mode} phase={phase} pairId={pairId} onExit={() => setScreen('games')} />;
  }
  if (screen === 'tech') return <TechLab pairId={pairId} onBack={() => setScreen('home')} />;
  if (screen === 'data') return <DataPage pairId={pairId} onBack={() => setScreen('home')} />;

  return (
    <main className="app-shell">
      {screen !== 'home' && (
        <header className="topbar app-topbar">
          <button className="icon-button" onClick={() => setScreen(screen === 'games' ? 'domains' : 'home')}>←</button>
          <div className="brand-mini"><span className="brand-mark">奇</span><div><small>亲子一起玩的小镇</small><strong>奇妙小镇</strong></div></div>
          <span className="status-pill">{mode === 'train' ? '训练模式' : `${phase ?? ''} 测试模式`}</span>
        </header>
      )}

      {screen === 'home' && <Home pairId={pairId} setPairId={setPairId} onMode={chooseMode} onTech={() => setScreen('tech')} onData={() => setScreen('data')} />}
      {screen === 'phase' && <PhaseSelect onChoose={choosePhase} />}
      {screen === 'domains' && <DomainSelect mode={mode} phase={phase} onChoose={(id) => { setSelectedDomainId(id); setScreen('games'); }} />}
      {screen === 'games' && <GameSelect domain={selectedDomain} mode={mode} onBack={() => setScreen('domains')} onStart={(gameId) => {
        if (gameId === 'GAZE_01') setScreen('gaze-game');
        else if (gameId === 'GAZE_02') setScreen('shopping-helper');
        else if (gameId === 'GAZE_03') setScreen('seller-game');
        else if (gameId === 'TOUCH_01') setScreen('balloon-game');
        else setNotice('这个游戏将在下一开发阶段接入，核心机制已经锁定。');
      }} />}
      {notice && <div className="global-notice">{notice}</div>}
    </main>
  );
}

function Home({ pairId, setPairId, onMode, onTech, onData }: {
  pairId: string;
  setPairId: (value: string) => void;
  onMode: (mode: GameMode) => void;
  onTech: () => void;
  onData: () => void;
}) {
  return (
    <section className="home-page">
      <div className="sky-decor cloud cloud-one" /><div className="sky-decor cloud cloud-two" /><div className="sun" aria-hidden="true" />
      <header className="home-header">
        <div className="home-tools">
          <label className="pair-field"><span>匿名亲子编号</span><input value={pairId} onChange={(event) => setPairId(event.target.value.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 24))} /></label>
          <button className="quiet-button" onClick={onData}>记录与导出</button>
          <button className="quiet-button" onClick={onTech}>家长工具</button>
        </div>
      </header>

      <div className="home-content">
        <TownScene onMode={onMode} />
      </div>
      <footer className="home-footer"><span>低刺激 · 可暂停 · 无惩罚反馈</span></footer>
    </section>
  );
}

function TownScene({ onMode }: { onMode: (mode: GameMode) => void }) {
  return (
    <div className="town-scene" aria-label="奇妙小镇场景">
      <img className="town-background-art" src="/assets/town-background-v1.png" alt="奇妙小镇的超市、乐园、交流中心和心情屋" />
      <div className="scene-title-sign"><small>亲子一起玩的小镇</small><h1>奇妙小镇</h1></div>
      <img className="scene-character-art" src="/assets/parent-child-cutout-v1.png" alt="儿童和家长角色" />
      <div className="scene-actions">
        <p>今天，一起去小镇完成一个小任务吧</p>
        <div className="mode-buttons">
          <button className="mode-button train" onClick={() => onMode('train')}><span className="mode-icon icon-training" aria-hidden="true" /><span><small>自由选择游戏</small><strong>开始训练</strong></span><b>→</b></button>
          <button className="mode-button test" onClick={() => onMode('test')}><span className="mode-icon icon-testing" aria-hidden="true" /><span><small>固定条件记录变化</small><strong>进入测试</strong></span><b>→</b></button>
        </div>
      </div>
    </div>
  );
}

function TownBuilding({ className, icon, title, color }: { className: string; icon: string; title: string; color: string }) {
  return <div className={`town-building ${className}`} style={{ '--building-color': color } as React.CSSProperties}><div className="roof" /><div className="building-body"><span>{icon}</span></div><strong>{title}</strong></div>;
}

function PhaseSelect({ onChoose }: { onChoose: (phase: 'T0' | 'T1') => void }) {
  return (
    <section className="content-page phase-page">
      <div className="page-heading"><span className="eyebrow">标准化测试</span><h1>这次要记录哪个阶段？</h1><p>阶段由家长确认。测试使用固定任务，不会自动升级，也不会在过程中显示成绩。</p></div>
      <div className="phase-cards">
        <button className="phase-card before" onClick={() => onChoose('T0')}><span className="phase-art phase-art-before" aria-hidden="true" /><small>训练开始前</small><strong>T0 训练前测</strong><p>记录第一次标准化任务表现</p></button>
        <div className="phase-path"><i /><span>多次短时训练</span><i /></div>
        <button className="phase-card after" onClick={() => onChoose('T1')}><span className="phase-art phase-art-after" aria-hidden="true" /><small>完成一段训练后</small><strong>T1 训练后测</strong><p>使用相同规则或等值材料比较</p></button>
      </div>
      <div className="info-banner">当前原型允许家长手动进入 T1；正式研究中的开放条件仍需在家长管理策略中冻结。</div>
    </section>
  );
}

function DomainSelect({ mode, phase, onChoose }: { mode: GameMode; phase: TestPhase; onChoose: (id: string) => void }) {
  const sceneArt: Record<string, string> = { gaze: '/assets/module-market.png', touch: '/assets/module-park.png', language: '/assets/module-talk.png', emotion: '/assets/module-heart.png' };
  return (
    <section className="content-page domains-page town-select-page">
      <div className="page-heading town-heading"><span className="eyebrow">{mode === 'train' ? '训练模式' : `${phase} 测试模式`}</span><h1>{mode === 'train' ? '选择今天要去的小镇地点' : '选择一个同步性领域'}</h1><p>{mode === 'train' ? '点击一个地点开始亲子任务，难度会在游戏内自动变化。' : '每个领域使用独立、固定的标准化任务。'}</p></div>
      <div className="town-module-grid">
        {domains.map((domain, index) => <button className="town-module-button" key={domain.id} style={{ '--domain': domain.color } as React.CSSProperties} onClick={() => onChoose(domain.id)}>
          <img src={sceneArt[domain.id]} alt="" /><span className="town-module-shade" /><span className="town-module-copy"><small>地点 0{index + 1} · {domain.name}</small><strong>{domain.place}</strong><em>{domain.description}</em><b>进入地点 <i>→</i></b></span>
        </button>)}
      </div>
    </section>
  );
}

function GameSelect({ domain, mode, onBack, onStart }: { domain: DomainDefinition; mode: GameMode; onBack: () => void; onStart: (id: string) => void }) {
  const gameArt: Record<string, string> = { GAZE_01: '/assets/game-restock.png', GAZE_02: '/assets/game-helper.png', GAZE_03: '/assets/game-seller.png', TOUCH_01: '/assets/module-park.png' };
  return (
    <section className="content-page games-page game-select-page" style={{ '--domain': domain.color, '--domain-pale': domain.pale } as React.CSSProperties}>
      <div className="game-world-header"><button className="world-back" onClick={onBack} aria-label="返回地点">←</button><div><span className="eyebrow">{domain.name}</span><h1>{domain.place}</h1><p>{domain.description}</p></div><span className="world-rule">{mode === 'train' ? '自动 L1 → L2 → L3' : '固定标准化协议'}</span></div>
      <div className="game-entry-grid">
        {domain.games.map((game, index) => <article className={`game-entry ${game.status}`} key={game.id}>
          <div className="game-entry-art">{gameArt[game.id] ? <img src={gameArt[game.id]} alt="" /> : <div className={`game-entry-placeholder game-entry-placeholder-${index}`} />}</div>
          <div className="game-entry-content"><span className="game-entry-step">任务 {index + 1}</span><h2>{game.name}</h2><p>{game.subtitle}</p><button className="game-entry-button" onClick={() => onStart(game.id)}>{game.status === 'demo-ready' ? (mode === 'train' ? '开始游戏' : '开始标准化任务') : '即将开放'}<i>→</i></button></div>
          {game.status === 'demo-ready' && <span className="game-entry-ready">可操作示范</span>}
        </article>)}
      </div>
    </section>
  );
}

function DataPage({ pairId, onBack }: { pairId: string; onBack: () => void }) {
  const [counts, setCounts] = useState({ sessions: 0, trials: 0, events: 0 });
  const [recent, setRecent] = useState<Array<Record<string, unknown>>>([]);
  const [testTrials, setTestTrials] = useState<TrialSummary[]>([]);

  const refresh = async () => {
    const snapshot = await eventStore.getSnapshot();
    setCounts({ sessions: snapshot.sessions.length, trials: snapshot.trials.length, events: snapshot.events.length });
    setRecent(snapshot.events.slice(-8).reverse() as unknown as Array<Record<string, unknown>>);
    setTestTrials(snapshot.trials.filter((trial) => trial.mode === 'test' && ['GAZE_01', 'GAZE_02', 'GAZE_03'].includes(trial.game_id)));
  };
  useEffect(() => { void refresh(); }, []);

  const testResult = (gameId: string, phase: 'T0' | 'T1') => {
    const rows = testTrials.filter((trial) => trial.game_id === gameId && trial.phase === phase && trial.valid_for_scoring);
    const synchronized = rows.filter((trial) => trial.outcome === 'completed_valid').length;
    return { total: rows.length, synchronized, rate: rows.length ? synchronized / rows.length : null };
  };
  const gameResults = ['GAZE_01', 'GAZE_02', 'GAZE_03'].map((gameId) => {
    const t0 = testResult(gameId, 'T0'); const t1 = testResult(gameId, 'T1');
    return { gameId, t0, t1, delta: t0.rate !== null && t1.rate !== null ? t1.rate - t0.rate : null };
  });
  const helperMetrics = (phaseValue: 'T0' | 'T1') => {
    // GAZE_02 changed from simultaneous click to order collaboration. Exclude
    // legacy prototype trials so T0/T1 only compare the confirmed new protocol.
    const rows = testTrials.filter((trial) => trial.game_id === 'GAZE_02' && trial.phase === phaseValue && trial.valid_for_scoring && trial.config_version === 'test-gaze-02-order-collaboration-0.2' && trial.metrics);
    const totals = rows.reduce((acc, trial) => {
      const metric = trial.metrics ?? {};
      acc.evaluableItems += Number(metric.evaluable_confirmation_opportunities ?? 0);
      acc.confirmedItems += Number(metric.correct_confirmations ?? 0);
      acc.completedOrders += metric.cooperative_order_completed ? 1 : 0;
      const times = Array.isArray(metric.confirmation_response_ms) ? metric.confirmation_response_ms : [];
      acc.responseTimes.push(...times.filter((value): value is number => typeof value === 'number'));
      return acc;
    }, { evaluableItems: 0, confirmedItems: 0, completedOrders: 0, responseTimes: [] as number[] });
    return { orders: rows.length, ...totals, meanResponseMs: totals.responseTimes.length ? Math.round(totals.responseTimes.reduce((sum, value) => sum + value, 0) / totals.responseTimes.length) : null };
  };
  const helperT0 = helperMetrics('T0');
  const helperT1 = helperMetrics('T1');

  return (
    <main className="page data-page">
      <header className="topbar"><button className="icon-button" onClick={onBack}>←</button><div><span className="eyebrow">家长数据管理</span><h1>真实记录与导出</h1></div><span className="status-pill">{pairId}</span></header>
      <section className="data-summary">
        <div><strong>{counts.sessions}</strong><span>会话</span></div><div><strong>{counts.trials}</strong><span>任务机会</span></div><div><strong>{counts.events}</strong><span>原始事件</span></div>
      </section>
      <section className="card export-card"><div><h2>导出可复核数据</h2><p>JSON 包含会话、试次和全部事件；CSV 提供逐事件记录。系统不会生成模拟结果。</p></div><div className="button-row wrap"><button className="primary" onClick={() => void downloadJsonExport()}>导出完整 JSON</button><button className="secondary" onClick={() => void downloadEventsCsv()}>导出事件 CSV</button><button className="quiet-button" onClick={() => void refresh()}>刷新</button></div></section>
      {gameResults.map(({ gameId, t0, t1, delta }) => <section className="card result-card" key={gameId}>
        <div><span className="eyebrow">只计算真实测试试次</span><h2>{gameId === 'GAZE_01' ? '《补货大作战》' : gameId === 'GAZE_02' ? '《购物小帮手》' : '《你买我来卖》'} T0 / T1 对比</h2><p>仅使用真实触控记录；角色响应游戏不套用双人同步窗。</p></div>
        {gameId === 'GAZE_02'
          ? <HelperResultComparison t0={helperT0} t1={helperT1} />
          : <div className="result-comparison"><ResultMetric label="T0 前测" result={t0} /><div className="delta-metric"><small>前后变化</small><strong>{delta === null ? '—' : `${delta >= 0 ? '+' : ''}${Math.round(delta * 100)}%`}</strong><span>{delta === null ? '需完成 T0 与 T1' : '描述性差值'}</span></div><ResultMetric label="T1 后测" result={t1} /></div>}
      </section>)}
      <section className="card event-preview"><h2>最近事件</h2>{recent.length ? <div className="event-table">{recent.map((event) => <div key={String(event.event_id)}><code>{String(event.event_type)}</code><span>{String(event.actor_role)}</span><span>{String(event.game_id)}</span><small>{String(event.wall_time)}</small></div>)}</div> : <p className="empty-state">还没有事件。进入技术验证台或《补货大作战》后，这里会显示真实操作记录。</p>}</section>
    </main>
  );
}

function HelperResultComparison({ t0, t1 }: { t0: { orders: number; evaluableItems: number; confirmedItems: number; completedOrders: number; meanResponseMs: number | null }; t1: { orders: number; evaluableItems: number; confirmedItems: number; completedOrders: number; meanResponseMs: number | null } }) {
  const render = (label: string, value: typeof t0) => <div className="result-metric"><small>{label}</small><strong>{value.evaluableItems ? `${Math.round((value.confirmedItems / value.evaluableItems) * 100)}%` : '—'}</strong><span>共同目标确认：{value.confirmedItems} / {value.evaluableItems}</span><span>完成订单：{value.completedOrders} / {value.orders}</span><span>第二位响应：{value.meanResponseMs === null ? '—' : `${value.meanResponseMs}ms`}</span></div>;
  return <div className="result-comparison">{render('T0 前测', t0)}<div className="delta-metric"><small>新版指标</small><strong>合作确认</strong><span>确认率、订单完成率、第二位响应时间均来自真实事件，可导出复算。</span></div>{render('T1 后测', t1)}</div>;
}

function ResultMetric({ label, result }: { label: string; result: { total: number; synchronized: number; rate: number | null } }) {
  const percent = result.rate === null ? 0 : Math.round(result.rate * 100);
  return (
    <div className="result-metric">
      <small>{label}</small><strong>{result.rate === null ? '—' : `${percent}%`}</strong>
      <div className="metric-track"><span style={{ width: `${percent}%` }} /></div>
      <span>{result.total ? `${result.synchronized} / ${result.total} 个有效机会` : '尚无真实测试数据'}</span>
    </div>
  );
}
