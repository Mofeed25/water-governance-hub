import { supabase } from "@/integrations/supabase/client";

const DB_NAME = "mizan-offline-v1";
const DB_VERSION = 1;
const QUEUE_STORE = "outbox";
const CACHE_STORE = "cache";

export type OfflineOperation = {
  id: string;
  tenantId: string;
  table: "meter_readings" | "receipts";
  payload: Record<string, unknown>;
  createdAt: string;
  attempts: number;
  status: "pending" | "failed";
  lastError?: string;
};

type CacheRecord = { key: string; tenantId: string; value: unknown; updatedAt: string };

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || !window.indexedDB) {
      reject(new Error("IndexedDB غير متاح على هذا الجهاز"));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(QUEUE_STORE)) {
        const store = db.createObjectStore(QUEUE_STORE, { keyPath: "id" });
        store.createIndex("tenantId", "tenantId", { unique: false });
        store.createIndex("status", "status", { unique: false });
        store.createIndex("createdAt", "createdAt", { unique: false });
      }
      if (!db.objectStoreNames.contains(CACHE_STORE)) {
        const store = db.createObjectStore(CACHE_STORE, { keyPath: "key" });
        store.createIndex("tenantId", "tenantId", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("تعذر فتح التخزين المحلي"));
  });
}

async function tx<T>(storeName: string, mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const request = work(transaction.objectStore(storeName));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("فشل التخزين المحلي"));
    transaction.oncomplete = () => db.close();
    transaction.onerror = () => reject(transaction.error ?? new Error("فشل التخزين المحلي"));
  });
}

export async function cacheForTenant<T>(key: string, tenantId: string, value: T): Promise<void> {
  await tx(CACHE_STORE, "readwrite", (store) => store.put({ key, tenantId, value, updatedAt: new Date().toISOString() } satisfies CacheRecord));
}

export async function readTenantCache<T>(key: string, tenantId: string): Promise<T | null> {
  const record = await tx<CacheRecord | undefined>(CACHE_STORE, "readonly", (store) => store.get(key));
  return record?.tenantId === tenantId ? (record.value as T) : null;
}

export async function enqueueOffline(operation: Omit<OfflineOperation, "id" | "createdAt" | "attempts" | "status">): Promise<OfflineOperation> {
  const item: OfflineOperation = {
    ...operation,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    attempts: 0,
    status: "pending",
  };
  await tx(QUEUE_STORE, "readwrite", (store) => store.put(item));
  return item;
}

export async function pendingOfflineCount(tenantId?: string): Promise<number> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(QUEUE_STORE, "readonly").objectStore(QUEUE_STORE).getAll();
    request.onsuccess = () => {
      const rows = request.result as OfflineOperation[];
      resolve(rows.filter((r) => r.status === "pending" && (!tenantId || r.tenantId === tenantId)).length);
      db.close();
    };
    request.onerror = () => { db.close(); reject(request.error); };
  });
}

async function allPending(): Promise<OfflineOperation[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(QUEUE_STORE, "readonly").objectStore(QUEUE_STORE).getAll();
    request.onsuccess = () => { db.close(); resolve((request.result as OfflineOperation[]).filter((r) => r.status === "pending")); };
    request.onerror = () => { db.close(); reject(request.error); };
  });
}

async function updateQueue(item: OfflineOperation): Promise<void> {
  await tx(QUEUE_STORE, "readwrite", (store) => store.put(item));
}

async function deleteQueue(id: string): Promise<void> {
  await tx(QUEUE_STORE, "readwrite", (store) => store.delete(id));
}

export async function syncOfflineQueue(tenantId?: string): Promise<{ synced: number; failed: number }> {
  if (!navigator.onLine) return { synced: 0, failed: 0 };
  const operations = (await allPending()).filter((item) => !tenantId || item.tenantId === tenantId);
  let synced = 0;
  let failed = 0;
  for (const item of operations) {
    try {
      const { error } = await supabase.from(item.table).insert(item.payload);
      if (error) throw error;
      await deleteQueue(item.id);
      synced += 1;
    } catch (error) {
      item.attempts += 1;
      item.status = "failed";
      item.lastError = error instanceof Error ? error.message : "فشل التزامن";
      await updateQueue(item);
      failed += 1;
    }
  }
  return { synced, failed };
}

export function installOnlineSync(tenantId: string | null, onDone?: (result: { synced: number; failed: number }) => void): () => void {
  const handler = () => {
    if (!tenantId) return;
    void syncOfflineQueue(tenantId).then((result) => onDone?.(result));
  };
  window.addEventListener("online", handler);
  if (navigator.onLine) handler();
  return () => window.removeEventListener("online", handler);
}
