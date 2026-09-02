import { supabase } from "@/integrations/supabase/client";

const DB_NAME = "mizan-offline-v2";
const DB_VERSION = 1;
const OUTBOX = "outbox";
const CACHE = "cache";

export type OfflineTable = "meter_readings" | "receipts";
export type OfflineOperation = { id: string; tenantId: string; table: OfflineTable; payload: Record<string, unknown>; createdAt: string; attempts: number; status: "pending" | "failed"; lastError?: string };
type CacheRecord = { key: string; tenantId: string; value: unknown; updatedAt: string };

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const d = request.result;
      if (!d.objectStoreNames.contains(OUTBOX)) {
        const s = d.createObjectStore(OUTBOX, { keyPath: "id" });
        s.createIndex("tenantId", "tenantId");
        s.createIndex("createdAt", "createdAt");
      }
      if (!d.objectStoreNames.contains(CACHE)) {
        const s = d.createObjectStore(CACHE, { keyPath: "key" });
        s.createIndex("tenantId", "tenantId");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB unavailable"));
  });
}

async function put(storeName: string, value: unknown): Promise<void> {
  const d = await db();
  await new Promise<void>((resolve, reject) => {
    const r = d.transaction(storeName, "readwrite").objectStore(storeName).put(value);
    r.onsuccess = () => resolve(); r.onerror = () => reject(r.error);
  });
  d.close();
}

async function get<T>(storeName: string, key: string): Promise<T | undefined> {
  const d = await db();
  const value = await new Promise<T | undefined>((resolve, reject) => {
    const r = d.transaction(storeName, "readonly").objectStore(storeName).get(key);
    r.onsuccess = () => resolve(r.result as T | undefined); r.onerror = () => reject(r.error);
  });
  d.close(); return value;
}

async function all<T>(storeName: string): Promise<T[]> {
  const d = await db();
  const value = await new Promise<T[]>((resolve, reject) => {
    const r = d.transaction(storeName, "readonly").objectStore(storeName).getAll();
    r.onsuccess = () => resolve(r.result as T[]); r.onerror = () => reject(r.error);
  });
  d.close(); return value;
}

async function remove(storeName: string, key: string): Promise<void> {
  const d = await db();
  await new Promise<void>((resolve, reject) => {
    const r = d.transaction(storeName, "readwrite").objectStore(storeName).delete(key);
    r.onsuccess = () => resolve(); r.onerror = () => reject(r.error);
  });
  d.close();
}

export async function cacheTenant<T>(key: string, tenantId: string, value: T): Promise<void> {
  await put(CACHE, { key, tenantId, value, updatedAt: new Date().toISOString() } satisfies CacheRecord);
}

export async function getTenantCache<T>(key: string, tenantId: string): Promise<T | null> {
  const value = await get<CacheRecord>(CACHE, key);
  return value?.tenantId === tenantId ? (value.value as T) : null;
}

export async function queueWrite(table: OfflineTable, tenantId: string, payload: Record<string, unknown>): Promise<OfflineOperation> {
  const item: OfflineOperation = { id: crypto.randomUUID(), tenantId, table, payload, createdAt: new Date().toISOString(), attempts: 0, status: "pending" };
  await put(OUTBOX, item); return item;
}

export async function getPendingCount(tenantId: string): Promise<number> {
  const items = await all<OfflineOperation>(OUTBOX);
  return items.filter((x) => x.tenantId === tenantId && (x.status === "pending" || x.status === "failed")).length;
}

export async function syncTenant(tenantId: string): Promise<{ synced: number; failed: number }> {
  if (!navigator.onLine) return { synced: 0, failed: 0 };
  const items = (await all<OfflineOperation>(OUTBOX)).filter((x) => x.tenantId === tenantId && (x.status === "pending" || x.status === "failed")).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  let synced = 0; let failed = 0;
  for (const item of items) {
    try {
      const { error } = await supabase.from(item.table).insert(item.payload);
      if (error) throw error;
      await remove(OUTBOX, item.id); synced++;
    } catch (error) {
      item.status = "failed"; item.attempts += 1; item.lastError = error instanceof Error ? error.message : "فشل التزامن";
      await put(OUTBOX, item); failed++;
    }
  }
  return { synced, failed };
}

export function installSync(tenantId: string | null, onDone?: (result: { synced: number; failed: number }) => void): () => void {
  const sync = () => { if (tenantId && navigator.onLine) void syncTenant(tenantId).then((r) => onDone?.(r)); };
  window.addEventListener("online", sync);
  if (tenantId && navigator.onLine) sync();
  return () => window.removeEventListener("online", sync);
}
