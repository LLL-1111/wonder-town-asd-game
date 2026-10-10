import { useRef, useState } from 'react';
import { createId, wallTime } from '../core/ids';
import { downloadEventsCsv, downloadJsonExport, eventStore } from '../data/eventStore';
import { identityPrototype, versions } from '../config/protocols';
import type { ActorRole, GameEvent } from '../types';

interface Props {
  pairId: string;
  onBack: () => void;
}

type TouchState = Record<'child' | 'parent', { active: boolean; downMs: number | null }>;

export default function TechLab({ pairId, onBack }: Props) {
  const [touch, setTouch] = useState<TouchState>({
    child: { active: false, downMs: null },
    parent: { active: false, downMs: null },
  });
  const [touchResult, setTouchResult] = useState('等待双方触摸');
  const [audioStatus, setAudioStatus] = useState('尚未测试');
  const [cameraStatus, setCameraStatus] = useState('尚未测试');
  const [storageStatus, setStorageStatus] = useState('尚未测试');
  const recorderRef = useRef<MediaRecorder | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const [snapshot, setSnapshot] = useState<string | null>(null);
  const probeSession = useRef(createId('PROBE')).current;

  const logProbe = async (role: ActorRole, eventType: string, payload: Record<string, unknown> = {}) => {
    const event: GameEvent = {
      event_id: createId('EV'), pair_id: pairId, session_id: probeSession, trial_id: null,
      mode: 'probe', phase: null, domain_id: 'system', game_id: 'TECH_PROBE', level: null,
      actor_role: role, actor_identity_method: identityPrototype.id, event_type: eventType,
      t_ms: performance.now(), wall_time: wallTime(), target_id: null, payload,
      config_version: versions.config, scorer_version: versions.scorer, asset_version: versions.assets,
    };
    await eventStore.appendEvent(event);
  };

  const touchDown = (role: 'child' | 'parent', event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const now = performance.now();
    setTouch((current) => {
      const next = { ...current, [role]: { active: true, downMs: now } };
      const other = role === 'child' ? next.parent : next.child;
      if (other.active && other.downMs !== null) {
        setTouchResult(`已识别两个活动触点 · 起始相差 ${Math.round(Math.abs(now - other.downMs))} ms`);
      } else {
        setTouchResult(`${role === 'child' ? '儿童' : '家长'}触点已进入，等待另一方`);
      }
      return next;
    });
    void logProbe(role, 'pointerdown', { pointer_id: event.pointerId, pointer_type: event.pointerType });
  };

  const touchUp = (role: 'child' | 'parent', event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    setTouch((current) => ({ ...current, [role]: { ...current[role], active: false } }));
    setTouchResult(`${role === 'child' ? '儿童' : '家长'}触点已松开；事件已保存`);
    void logProbe(role, event.type, { pointer_id: event.pointerId });
  };

  const startAudio = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioStreamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];
      recorder.ondataavailable = (event) => event.data.size && audioChunksRef.current.push(event.data);
      recorder.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType });
        setAudioStatus(`录音成功 · ${Math.max(1, Math.round(blob.size / 1024))} KB · 本次不持久保存音频`);
        void logProbe('system', 'audio_probe_completed', { bytes: blob.size, mime_type: recorder.mimeType });
        stream.getTracks().forEach((track) => track.stop());
      };
      recorderRef.current = recorder;
      recorder.start();
      setAudioStatus('正在录音…说一句话，然后停止');
      void logProbe('system', 'audio_probe_started');
    } catch (error) {
      setAudioStatus(`麦克风不可用：${error instanceof Error ? error.message : '未知错误'}`);
      void logProbe('system', 'audio_probe_failed', { message: String(error) });
    }
  };

  const stopAudio = () => {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
  };

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
      cameraStreamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraStatus('摄像头已开启；画面仅用于本次本地验证');
      void logProbe('system', 'camera_probe_started');
    } catch (error) {
      setCameraStatus(`摄像头不可用：${error instanceof Error ? error.message : '未知错误'}`);
      void logProbe('system', 'camera_probe_failed', { message: String(error) });
    }
  };

  const takeSnapshot = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
    setSnapshot(dataUrl);
    setCameraStatus(`截帧成功 · ${video.videoWidth}×${video.videoHeight} · 未写入数据库`);
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
    if (videoRef.current) videoRef.current.srcObject = null;
    void logProbe('system', 'camera_snapshot_completed', { width: video.videoWidth, height: video.videoHeight, persisted: false });
  };

  const testStorage = async () => {
    await logProbe('system', 'indexeddb_probe');
    const events = await eventStore.getEvents();
    setStorageStatus(`IndexedDB 写入与读取成功 · 当前共有 ${events.length} 条事件`);
  };

  return (
    <main className="page lab-page">
      <header className="topbar">
        <button className="icon-button" onClick={onBack} aria-label="返回">←</button>
        <div><span className="eyebrow">家长工具</span><h1>关键技术验证台</h1></div>
        <span className="status-pill warning">尚未完成真实平板验收</span>
      </header>

      <section className="lab-intro card">
        <div>
          <span className="eyebrow">阶段 0</span>
          <h2>先证明输入可靠，再解释同步结果</h2>
          <p>这里产生的都是当前设备上的真实浏览器事件。双角色区域可以分配事件身份，但不能证明两根手指一定来自两个人。</p>
        </div>
        <div className="validation-badge"><strong>{identityPrototype.label}</strong><span>{identityPrototype.status}</span></div>
      </section>

      <div className="lab-grid">
        <section className="card lab-card touch-lab">
          <div className="card-title-row"><span className="number-dot">1</span><div><h3>双人多点触控</h3><p>两人分别按住各自区域，观察是否同时保持活动。</p></div></div>
          <div className="dual-touch-pad">
            <button className={`probe-pad child ${touch.child.active ? 'active' : ''}`} onPointerDown={(e) => touchDown('child', e)} onPointerUp={(e) => touchUp('child', e)} onPointerCancel={(e) => touchUp('child', e)}>
              <span>儿童</span><strong>{touch.child.active ? '正在按住' : '按住这里'}</strong>
            </button>
            <div className="connection"><span>一起</span></div>
            <button className={`probe-pad parent ${touch.parent.active ? 'active' : ''}`} onPointerDown={(e) => touchDown('parent', e)} onPointerUp={(e) => touchUp('parent', e)} onPointerCancel={(e) => touchUp('parent', e)}>
              <span>家长</span><strong>{touch.parent.active ? '正在按住' : '按住这里'}</strong>
            </button>
          </div>
          <p className="probe-result">{touchResult}</p>
        </section>

        <section className="card lab-card">
          <div className="card-title-row"><span className="number-dot">2</span><div><h3>语音录制</h3><p>验证权限、录制容器与事件记录；不会保存本次音频。</p></div></div>
          <div className="button-row"><button className="primary small" onClick={startAudio}>开始录音</button><button className="secondary small" onClick={stopAudio}>停止</button></div>
          <p className="probe-result">{audioStatus}</p>
        </section>

        <section className="card lab-card camera-card">
          <div className="card-title-row"><span className="number-dot">3</span><div><h3>前置摄像头</h3><p>验证权限、预览和本地截帧；照片不写入数据库。</p></div></div>
          <div className="camera-preview">{snapshot ? <img src={snapshot} alt="本地测试截帧" /> : <video ref={videoRef} playsInline muted />}</div>
          <div className="button-row"><button className="primary small" onClick={startCamera}>开启摄像头</button><button className="secondary small" onClick={takeSnapshot}>截取一帧</button></div>
          <p className="probe-result">{cameraStatus}</p>
        </section>

        <section className="card lab-card">
          <div className="card-title-row"><span className="number-dot">4</span><div><h3>存储与导出</h3><p>IndexedDB 追加写入，并导出原始 JSON 或事件 CSV。</p></div></div>
          <div className="button-row wrap"><button className="primary small" onClick={testStorage}>写入探针</button><button className="secondary small" onClick={() => void downloadJsonExport()}>导出 JSON</button><button className="secondary small" onClick={() => void downloadEventsCsv()}>导出 CSV</button></div>
          <p className="probe-result">{storageStatus}</p>
        </section>
      </div>

      <section className="card validation-table-card">
        <h2>当前验证结论</h2>
        <div className="validation-list">
          <div><span>浏览器事件采集</span><strong className="ok">可在当前设备验证</strong></div>
          <div><span>同一商品双角色区域</span><strong className="warning-text">原型可用，身份真实性待平板实测</strong></div>
          <div><span>录音与摄像头</span><strong>需逐台授权测试</strong></div>
          <div><span>真实双人多点触控稳定性</span><strong className="warning-text">未通过真实 iPad / Android 验收</strong></div>
        </div>
        <p className="fine-print">限制：{identityPrototype.limitation}</p>
      </section>
    </main>
  );
}
