/**
 * asset-handles.ts — 浏览器 linked 素材的句柄持久化（IndexedDB）。
 *
 * 浏览器不暴露真实路径，能跨会话留下的只有 `FileSystemFileHandle` 本身。
 * 台账里记的是 `fsa:<assetId>` 这个**键**；句柄本体在这里。
 *
 * ## 权限
 *
 * 句柄能存，权限不一定跟着：新会话里多半降级成 `prompt`，必须由用户手势
 * `requestPermission()` 才能读。所以「打开工程」那条路（点击触发）负责申请，
 * 申请不到就只是这一条素材没有来源 —— **不挡打开**。
 *
 * 这里所有失败都不抛给调用方（除了 IndexedDB 本身不可用）：素材引用是增强，
 * 不是打开工程的前提。
 */

const DB_NAME = 'artmatic-asset-handles';
const STORE = 'handles';
const VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('indexedDB unavailable'));
  });
  return dbPromise;
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('transaction aborted'));
  });
}

export async function putAssetHandle(assetId: string, handle: unknown): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE, 'readwrite');
  tx.objectStore(STORE).put(handle, assetId);
  await txDone(tx);
}

export async function getAssetHandle(assetId: string): Promise<unknown | null> {
  const db = await openDb();
  const tx = db.transaction(STORE, 'readonly');
  const req = tx.objectStore(STORE).get(assetId);
  const out = await new Promise<unknown>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
  await txDone(tx);
  return out;
}

export async function deleteAssetHandle(assetId: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE, 'readwrite');
  tx.objectStore(STORE).delete(assetId);
  await txDone(tx);
}

/** 句柄权限现状；没有这两个方法（老实现）按「能读」处理。 */
export async function queryReadPermission(handle: unknown): Promise<'granted' | 'prompt' | 'denied' | 'unknown'> {
  const h = handle as {
    queryPermission?: (o: { mode: 'read' }) => Promise<PermissionState>;
  };
  if (typeof h.queryPermission !== 'function') return 'unknown';
  try {
    return await h.queryPermission({ mode: 'read' });
  } catch {
    return 'unknown';
  }
}

/**
 * 在用户手势里申请读权限。**失败不抛**：这条素材缺失，但工程照常打开。
 */
export async function requestReadPermission(handle: unknown): Promise<boolean> {
  const state = await queryReadPermission(handle);
  if (state === 'granted' || state === 'unknown') return true;
  const h = handle as {
    requestPermission?: (o: { mode: 'read' }) => Promise<PermissionState>;
  };
  if (typeof h.requestPermission !== 'function') return false;
  try {
    return (await h.requestPermission({ mode: 'read' })) === 'granted';
  } catch {
    return false;
  }
}
