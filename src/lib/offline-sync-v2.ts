import { supabase } from "@/integrations/supabase/client";

const DB_NAME = "mizan-offline-v2";
const DB_VERSION = 2;
const OUTBOX = "outbox";
const CACHE = "cache";
const PHOTO_BUCKET = "meter-reading-photos";

export type OfflineTable = "meter_readings" | "receipts";
export type OfflinePayload = Record<string, unknown> & { photo_blob?: Blob };
export type OfflineOperation = { id: string; tenantId: string; table: OfflineTable; payload: OfflinePayload; createdAt: string; attempts: number; status: "pending" | "failed"; lastError?: string };
type CacheRecord = { key: string; tenantId: string; value: unknown; updatedAt: string };

function db(): Promise<IDBDatabase> { return new Promise((resolve, reject) => { const request = indexedDB.open(DB_NAME, DB_VERSION); request.onupgradeneeded = () => { const d = request.result; if (!d.objectStoreNames.contains(OUTBOX)) { const s = d.createObjectStore(OUTBOX, { keyPath: "id" }); s.createIndex("tenantId", "tenantId"); s.createIndex("createdAt", "createdAt"); } if (!d.objectStoreNames.contains(CACHE)) { const s = d.createObjectStore(CACHE, { keyPath: "key" }); s.createIndex("tenantId", "tenantId"); } }; request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error ?? new Error("IndexedDB unavailable")); }); }
async function put(store: string, value: unknown) { const d = await db(); await new Promise<void>((resolve, reject) => { const r = d.transaction(store, "readwrite").objectStore(store).put(value); r.onsuccess = () => resolve(); r.onerror = () => reject(r.error); }); d.close(); }
async function get<T>(store: string, key: string) { const d = await db(); const v = await new Promise<T | undefined>((resolve, reject) => { const r = d.transaction(store, "readonly").objectStore(store).get(key); r.onsuccess = () => resolve(r.result as T | undefined); r.onerror = () => reject(r.error); }); d.close(); return v; }
async function all<T>(store: string) { const d = await db(); const v = await new Promise<T[]>((resolve, reject) => { const r = d.transaction(store, "readonly").objectStore(store).getAll(); r.onsuccess = () => resolve(r.result as T[]); r.onerror = () => reject(r.error); }); d.close(); return v; }
async function remove(store: string, key: string) { const d = await db(); await new Promise<void>((resolve, reject) => { const r = d.transaction(store, "readwrite").objectStore(store).delete(key); r.onsuccess = () => resolve(); r.onerror = () => reject(r.error); }); d.close(); }
function cacheKey(key: string, tenantId: string) { return `${tenantId}:${key}`; }

export async function cacheTenant<T>(key: string, tenantId: string, value: T) { await put(CACHE, { key: cacheKey(key, tenantId), tenantId, value, updatedAt: new Date().toISOString() } satisfies CacheRecord); }
export async function getTenantCache<T>(key: string, tenantId: string): Promise<T | null> { const v = await get<CacheRecord>(CACHE, cacheKey(key, tenantId)); return v?.tenantId === tenantId ? v.value as T : null; }
export async function queueWrite(table: OfflineTable, tenantId: string, payload: OfflinePayload): Promise<OfflineOperation> { const id = String(payload.client_operation_id ?? crypto.randomUUID()); const item: OfflineOperation = { id, tenantId, table, payload, createdAt: new Date().toISOString(), attempts: 0, status: "pending" }; await put(OUTBOX, item); return item; }
export async function getPendingCount(tenantId: string) { const items = await all<OfflineOperation>(OUTBOX); return items.filter(x => x.tenantId === tenantId && (x.status === "pending" || x.status === "failed")).length; }

function photoExtension(type: string | undefined) {
  switch ((type || "").toLowerCase()) {
    case "image/png": return "png";
    case "image/webp": return "webp";
    case "image/heic": return "heic";
    case "image/heif": return "heif";
    default: return "jpg";
  }
}

async function uploadPhoto(tenantId: string, operationId: string, payload: OfflinePayload): Promise<string | null> {
  const blob = payload.photo_blob;
  if (!(blob instanceof Blob)) return typeof payload.photo_url === "string" ? payload.photo_url : null;
  const contentType = blob.type || "image/jpeg";
  const path = `${tenantId}/${operationId}.${photoExtension(contentType)}`;
  const { error } = await supabase.storage.from(PHOTO_BUCKET).upload(path, blob, { contentType, upsert: false });
  if (error && !/already exists/i.test(error.message)) throw error;
  return path;
}

async function syncOne(item: OfflineOperation) { const payload = { ...item.payload }; const photo = item.table === "meter_readings" ? await uploadPhoto(item.tenantId, item.id, payload) : null; delete payload.photo_blob; if (photo) payload.photo_url = photo; const { error } = await supabase.from(item.table).upsert(payload, { onConflict: "client_operation_id" }); if (error) throw error; }

export async function syncTenant(tenantId: string): Promise<{ synced: number; failed: number }> { if (!navigator.onLine) return { synced: 0, failed: 0 }; const items = (await all<OfflineOperation>(OUTBOX)).filter(x => x.tenantId === tenantId && (x.status === "pending" || x.status === "failed")).sort((a,b) => a.createdAt.localeCompare(b.createdAt)); let synced = 0, failed = 0; for (const item of items) { try { await syncOne(item); await remove(OUTBOX, item.id); synced++; } catch (e) { item.status = "failed"; item.attempts++; item.lastError = e instanceof Error ? e.message : "فشل التزامن"; await put(OUTBOX, item); failed++; } } return { synced, failed }; }
export async function writeOnline(table: OfflineTable, tenantId: string, payload: OfflinePayload) { const copy = { ...payload }; const photo = table === "meter_readings" ? await uploadPhoto(tenantId, String(copy.client_operation_id), copy) : null; delete copy.photo_blob; if (photo) copy.photo_url = photo; const { error } = await supabase.from(table).upsert(copy, { onConflict: "client_operation_id" }); if (error) throw error; }
export function installSync(tenantId: string | null, onDone?: (result: { synced: number; failed: number }) => void) { const sync = () => { if (tenantId && navigator.onLine) void syncTenant(tenantId).then(r => onDone?.(r)); }; window.addEventListener("online", sync); if (tenantId && navigator.onLine) sync(); return () => window.removeEventListener("online", sync); }
