import type { GameEvent, TrialSummary } from '../types';

const DB_NAME = 'wonder-town-v1';
const DB_VERSION = 1;
const EVENT_STORE = 'events';
const TRIAL_STORE = 'trials';
const SESSION_STORE = 'sessions';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(EVENT_STORE)) {
        const events = db.createObjectStore(EVENT_STORE, { keyPath: 'event_id' });
        events.createIndex('session_id', 'session_id');
      }
      if (!db.objectStoreNames.contains(TRIAL_STORE)) {
        const trials = db.createObjectStore(TRIAL_STORE, { keyPath: 'trial_id' });
        trials.createIndex('session_id', 'session_id');
      }
      if (!db.objectStoreNames.contains(SESSION_STORE)) {
        db.createObjectStore(SESSION_STORE, { keyPath: 'session_id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function put(storeName: string, value: unknown): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function getAll<T>(storeName: string): Promise<T[]> {
  const db = await openDb();
  const values = await new Promise<T[]>((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const request = tx.objectStore(storeName).getAll();
    request.onsuccess = () => resolve(request.result as T[]);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return values;
}

export const eventStore = {
  appendEvent(event: GameEvent) {
    return put(EVENT_STORE, event);
  },
  saveTrial(trial: TrialSummary) {
    return put(TRIAL_STORE, trial);
  },
  saveSession(session: Record<string, unknown>) {
    return put(SESSION_STORE, session);
  },
  getEvents() {
    return getAll<GameEvent>(EVENT_STORE);
  },
  getTrials() {
    return getAll<TrialSummary>(TRIAL_STORE);
  },
  getSessions() {
    return getAll<Record<string, unknown>>(SESSION_STORE);
  },
  async getSnapshot() {
    const [sessions, trials, events] = await Promise.all([
      getAll<Record<string, unknown>>(SESSION_STORE),
      getAll<TrialSummary>(TRIAL_STORE),
      getAll<GameEvent>(EVENT_STORE),
    ]);
    return {
      schema_version: 'wonder-town-export-0.1',
      exported_at: new Date().toISOString(),
      sessions,
      trials,
      events,
    };
  },
  async clearPrototypeData() {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([EVENT_STORE, TRIAL_STORE, SESSION_STORE], 'readwrite');
      tx.objectStore(EVENT_STORE).clear();
      tx.objectStore(TRIAL_STORE).clear();
      tx.objectStore(SESSION_STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  },
};

function downloadFile(name: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

export async function downloadJsonExport() {
  const snapshot = await eventStore.getSnapshot();
  downloadFile(`wonder-town-export-${Date.now()}.json`, JSON.stringify(snapshot, null, 2), 'application/json');
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

export async function downloadEventsCsv() {
  const events = await eventStore.getEvents();
  const columns: Array<keyof GameEvent> = [
    'event_id', 'pair_id', 'session_id', 'trial_id', 'mode', 'phase', 'domain_id',
    'game_id', 'level', 'actor_role', 'actor_identity_method', 'event_type', 't_ms',
    'wall_time', 'target_id', 'pointer_id', 'outcome', 'invalid_reason', 'payload',
    'config_version', 'scorer_version', 'asset_version',
  ];
  const csv = [
    columns.join(','),
    ...events.map((event) => columns.map((column) => csvCell(event[column])).join(',')),
  ].join('\n');
  downloadFile(`wonder-town-events-${Date.now()}.csv`, csv, 'text/csv;charset=utf-8');
}
