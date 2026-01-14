type StoreName = "pipe_params" | "prompt_rehydration";

type StoredRecord<T> = {
  key: string;
  value: T;
  updatedAt: number;
  expiresAt: number;
};

const DB_NAME = "sts_persist";
const DB_VERSION = 1;
const PIPE_PARAMS_STORE: StoreName = "pipe_params";
const REHYDRATION_STORE: StoreName = "prompt_rehydration";

const PIPE_PARAMS_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const REHYDRATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;

let dbPromise: Promise<IDBDatabase> | null = null;
let lastCleanupAt = 0;

const hasIndexedDb = () =>
  typeof window !== "undefined" && typeof indexedDB !== "undefined";

const openDb = () => {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PIPE_PARAMS_STORE)) {
        const store = db.createObjectStore(PIPE_PARAMS_STORE, { keyPath: "key" });
        store.createIndex("expiresAt", "expiresAt", { unique: false });
      }
      if (!db.objectStoreNames.contains(REHYDRATION_STORE)) {
        const store = db.createObjectStore(REHYDRATION_STORE, { keyPath: "key" });
        store.createIndex("expiresAt", "expiresAt", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
};

const requestToPromise = <T>(request: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const withStore = async <T>(storeName: StoreName, mode: IDBTransactionMode, fn: (store: IDBObjectStore) => Promise<T>) => {
  const db = await openDb();
  const tx = db.transaction(storeName, mode);
  const store = tx.objectStore(storeName);
  return fn(store);
};

const maybeCleanup = () => {
  if (!hasIndexedDb()) return;
  const now = Date.now();
  if (now - lastCleanupAt < CLEANUP_INTERVAL_MS) return;
  lastCleanupAt = now;
  void cleanupExpired(PIPE_PARAMS_STORE);
  void cleanupExpired(REHYDRATION_STORE);
};

const cleanupExpired = async (storeName: StoreName) => {
  try {
    await withStore(storeName, "readwrite", async (store) => {
      const index = store.index("expiresAt");
      const range = IDBKeyRange.upperBound(Date.now());
      await new Promise<void>((resolve, reject) => {
        const cursorRequest = index.openCursor(range);
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;
          if (!cursor) {
            resolve();
            return;
          }
          cursor.delete();
          cursor.continue();
        };
        cursorRequest.onerror = () => reject(cursorRequest.error);
      });
    });
  } catch (err) {
    console.warn("[PersistedState] Cleanup failed", err);
  }
};

const getRecord = async <T>(storeName: StoreName, key: string): Promise<StoredRecord<T> | null> => {
  if (!hasIndexedDb()) return null;
  maybeCleanup();
  try {
    const record = await withStore(storeName, "readonly", async (store) => {
      const request = store.get(key) as IDBRequest<StoredRecord<T> | undefined>;
      return requestToPromise(request);
    });
    if (!record) return null;
    if (record.expiresAt && record.expiresAt <= Date.now()) {
      void deleteRecord(storeName, key);
      return null;
    }
    return record;
  } catch (err) {
    console.warn("[PersistedState] Read failed", err);
    return null;
  }
};

const setRecord = async <T>(storeName: StoreName, key: string, value: T, ttlMs: number): Promise<boolean> => {
  if (!hasIndexedDb()) return false;
  try {
    const record: StoredRecord<T> = {
      key,
      value,
      updatedAt: Date.now(),
      expiresAt: Date.now() + ttlMs,
    };
    await withStore(storeName, "readwrite", async (store) => {
      const request = store.put(record);
      await requestToPromise(request);
    });
    maybeCleanup();
    return true;
  } catch (err) {
    console.warn("[PersistedState] Write failed", err);
    return false;
  }
};

const deleteRecord = async (storeName: StoreName, key: string) => {
  if (!hasIndexedDb()) return;
  try {
    await withStore(storeName, "readwrite", async (store) => {
      const request = store.delete(key);
      await requestToPromise(request);
    });
  } catch (err) {
    console.warn("[PersistedState] Delete failed", err);
  }
};

const safeParseJson = (raw: string | null): unknown | null => {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const getLegacyJson = (key: string): unknown | null => {
  if (typeof window === "undefined") return null;
  return safeParseJson(window.localStorage.getItem(key));
};

const removeLegacyKey = (key: string) => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignore
  }
};

const setLegacyJson = (key: string, value: unknown) => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore
  }
};

export const buildPipeParamsKey = (workflowId: string) => `ds_pipe_params_${workflowId}`;
export const buildRehydrationKey = (workflowId: string) =>
  `ds_promptstudio_rehydration_state_v1_${workflowId}`;

export const loadPipeParams = async (workflowId: string): Promise<Record<string, unknown> | null> => {
  if (!workflowId) return null;
  const key = buildPipeParamsKey(workflowId);
  const record = await getRecord<Record<string, unknown>>(PIPE_PARAMS_STORE, key);
  if (record?.value) return record.value;

  const legacy = getLegacyJson(key);
  if (legacy && typeof legacy === "object" && !Array.isArray(legacy)) {
    const saved = await setRecord(PIPE_PARAMS_STORE, key, legacy as Record<string, unknown>, PIPE_PARAMS_TTL_MS);
    if (saved) removeLegacyKey(key);
    return legacy as Record<string, unknown>;
  }
  return null;
};

export const savePipeParams = async (workflowId: string, data: Record<string, unknown>): Promise<void> => {
  if (!workflowId) return;
  const key = buildPipeParamsKey(workflowId);
  const saved = await setRecord(PIPE_PARAMS_STORE, key, data, PIPE_PARAMS_TTL_MS);
  if (!saved) {
    setLegacyJson(key, data);
  }
};

export const deletePipeParams = async (workflowId: string): Promise<void> => {
  if (!workflowId) return;
  const key = buildPipeParamsKey(workflowId);
  await deleteRecord(PIPE_PARAMS_STORE, key);
  removeLegacyKey(key);
};

export const loadPromptRehydrationSnapshot = async (workflowId: string): Promise<unknown | null> => {
  if (!workflowId) return null;
  const key = buildRehydrationKey(workflowId);
  const record = await getRecord<unknown>(REHYDRATION_STORE, key);
  if (record?.value) return record.value;

  const legacy = getLegacyJson(key);
  if (legacy && typeof legacy === "object") {
    const saved = await setRecord(REHYDRATION_STORE, key, legacy, REHYDRATION_TTL_MS);
    if (saved) removeLegacyKey(key);
    return legacy;
  }
  return null;
};

export const savePromptRehydrationSnapshot = async (workflowId: string, snapshot: unknown | null): Promise<void> => {
  if (!workflowId) return;
  const key = buildRehydrationKey(workflowId);
  if (!snapshot) {
    await deleteRecord(REHYDRATION_STORE, key);
    removeLegacyKey(key);
    return;
  }
  const saved = await setRecord(REHYDRATION_STORE, key, snapshot, REHYDRATION_TTL_MS);
  if (!saved) {
    setLegacyJson(key, snapshot);
  }
};
