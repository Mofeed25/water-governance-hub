import { useEffect, useState } from "react";
import { CloudOff, Cloud, RefreshCw, CheckCircle2 } from "lucide-react";
import { getPendingCount, installSync, syncTenant } from "@/lib/offline-sync-v2";

export function OfflineStatus({ tenantId }: { tenantId: string | null }) {
  const [online, setOnline] = useState(() => typeof navigator !== "undefined" ? navigator.onLine : true);
  const [pending, setPending] = useState(0);
  const [syncing, setSyncing] = useState(false);

  const refresh = async () => {
    if (!tenantId) return;
    setPending(await getPendingCount(tenantId));
  };

  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    void refresh();
    const stop = installSync(tenantId, () => void refresh());
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => { window.removeEventListener("online", onOnline); window.removeEventListener("offline", onOffline); stop(); window.clearInterval(timer); };
  }, [tenantId]);

  const sync = async () => {
    if (!tenantId || !navigator.onLine) return;
    setSyncing(true);
    await syncTenant(tenantId);
    await refresh();
    setSyncing(false);
  };

  if (!online) return <div className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-800"><CloudOff className="h-3.5 w-3.5" /> وضع عدم الاتصال{pending ? ` · ${pending} بانتظار المزامنة` : " · البيانات المحلية متاحة"}</div>;
  if (pending) return <button type="button" onClick={() => void sync()} disabled={syncing} className="inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] font-bold text-blue-800 disabled:opacity-60"><RefreshCw className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} /> {syncing ? "جاري المزامنة…" : `${pending} عملية بانتظار المزامنة`}</button>;
  return <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-800"><Cloud className="h-3.5 w-3.5" /><CheckCircle2 className="h-3.5 w-3.5" /> متصل ومتزامن</div>;
}
