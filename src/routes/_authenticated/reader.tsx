import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Camera, MapPin, Loader2, Droplets } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuthSession, useMizanRoles } from "@/hooks/use-auth";
import { fmtDate } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/reader")({
  head: () => ({ meta: [{ title: "قارئ العدادات — ميزان" }] }),
  component: ReaderPage,
});

interface Subscriber { id: string; name: string; zone: string | null; meter_serial: string; tenant_id: string; }
interface ReadingRow {
  id: string; reading_m3: number; previous_m3: number | null; captured_at: string;
  gps_lat: number | null; gps_lng: number | null; subscriber_id: string;
  subscribers?: { name: string; meter_serial: string } | null;
}

function ReaderPage() {
  const { user } = useAuthSession();
  const { roles, profile, loading: rolesLoading } = useMizanRoles(user?.id);
  const canSubmit = roles.includes("meter_reader") || roles.includes("project_manager");

  const [subs, setSubs] = useState<Subscriber[]>([]);
  const [rows, setRows] = useState<ReadingRow[]>([]);
  const [subId, setSubId] = useState("");
  const [reading, setReading] = useState("");
  const [gps, setGps] = useState<{ lat: number; lng: number } | null>(null);
  const [gpsBusy, setGpsBusy] = useState(false);
  const [busy, setBusy] = useState(false);

  const loadSubs = async () => {
    const { data, error } = await supabase
      .from("subscribers")
      .select("id,name,zone,meter_serial,tenant_id")
      .order("meter_serial");
    if (error) { toast.error("تعذر تحميل المشتركين"); return; }
    setSubs(data ?? []);
  };

  const loadRows = async () => {
    const { data, error } = await supabase
      .from("meter_readings")
      .select("id,reading_m3,previous_m3,captured_at,gps_lat,gps_lng,subscriber_id,subscribers(name,meter_serial)")
      .order("captured_at", { ascending: false })
      .limit(20);
    if (error) { toast.error("تعذر تحميل سجل القراءات"); return; }
    setRows((data ?? []) as ReadingRow[]);
  };

  useEffect(() => {
    void loadSubs();
    void loadRows();
    const ch = supabase.channel("reader-live")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "meter_readings" }, () => void loadRows())
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, []);

  const captureGps = () => {
    if (!navigator.geolocation) { toast.error("GPS غير مدعوم على هذا الجهاز"); return; }
    setGpsBusy(true);
    navigator.geolocation.getCurrentPosition(
      (p) => { setGps({ lat: p.coords.latitude, lng: p.coords.longitude }); setGpsBusy(false); toast.success("تم تسجيل الإحداثيات"); },
      (e) => { setGpsBusy(false); toast.error(e.message || "تعذّر قراءة الموقع"); },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subId || !reading) { toast.error("يرجى تعبئة الحقول"); return; }
    const tenantId = subs.find((s) => s.id === subId)?.tenant_id ?? profile?.tenant_id ?? null;
    if (!user || !tenantId) { toast.error("الحساب غير مرتبط بمشروع"); return; }

    const readingValue = Number(reading);
    if (!Number.isFinite(readingValue) || readingValue < 0) {
      toast.error("القراءة يجب أن تكون رقمًا غير سالب");
      return;
    }

    setBusy(true);
    try {
      // The database is authoritative for previous_m3, consumption_m3 and the
      // integrity digest. The browser must not be trusted to provide them.
      const { error } = await supabase.from("meter_readings").insert({
        tenant_id: tenantId,
        subscriber_id: subId,
        reader_id: user.id,
        reading_m3: readingValue,
        gps_lat: gps?.lat ?? null,
        gps_lng: gps?.lng ?? null,
        captured_at: new Date().toISOString(),
      });
      if (error) throw error;
      toast.success("تم حفظ القراءة والتحقق منها خادميًا");
      setReading("");
      setSubId("");
      setGps(null);
      void loadRows();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "فشل حفظ القراءة");
    } finally { setBusy(false); }
  };

  const selected = useMemo(() => subs.find(s => s.id === subId), [subs, subId]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold">قارئ العدادات</h1>
        <p className="mt-1 text-sm text-muted-foreground">تسجيل القراءة مع إحداثيات GPS والتحقق الخادمي من سلامة البيانات.</p>
      </div>

      {!rolesLoading && !canSubmit && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          صلاحيات القراءة غير مفعّلة لحسابك — يمكنك عرض السجل فقط.
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-5">
        <form onSubmit={submit} className="glass rounded-2xl p-5 lg:col-span-2 space-y-3">
          <div className="flex items-center gap-2 text-sm font-bold">
            <Droplets className="h-4 w-4 text-brand-600" /> قراءة جديدة
          </div>

          <Field label="المشترك">
            <select required value={subId} onChange={e => setSubId(e.target.value)} disabled={!canSubmit || busy}
              className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-ring">
              <option value="">— اختر المشترك —</option>
              {subs.map(s => <option key={s.id} value={s.id}>{s.meter_serial} · {s.name} {s.zone ? `· ${s.zone}` : ""}</option>)}
            </select>
          </Field>

          <Field label="القراءة الحالية (م³)">
            <input required type="number" step="0.01" min="0" value={reading} onChange={e => setReading(e.target.value)} disabled={!canSubmit || busy} dir="ltr"
              className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-ring" />
          </Field>

          <div className="rounded-xl bg-muted/50 p-3 text-xs">
            <div className="font-semibold">القراءة السابقة</div>
            <div className="mt-1 text-muted-foreground">يتم تحديدها تلقائيًا من آخر قراءة موثقة في قاعدة البيانات.</div>
          </div>

          <div className="flex items-center gap-2">
            <button type="button" onClick={captureGps} disabled={gpsBusy || !canSubmit}
              className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2 text-xs font-semibold hover:bg-muted disabled:opacity-50">
              {gpsBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MapPin className="h-3.5 w-3.5" />}
              التقاط GPS
            </button>
            {gps && <span className="text-[11px] text-emerald-700 num">{gps.lat.toFixed(5)}, {gps.lng.toFixed(5)}</span>}
          </div>

          {selected && (
            <div className="rounded-xl bg-muted/50 p-3 text-xs">
              <div className="font-semibold">{selected.name}</div>
              <div className="text-muted-foreground">عدّاد: {selected.meter_serial}</div>
            </div>
          )}

          <button type="submit" disabled={!canSubmit || busy}
            className="mt-1 flex w-full items-center justify-center gap-2 rounded-xl brand-gradient px-4 py-3 text-sm font-bold text-white shadow-md hover:opacity-95 disabled:opacity-60">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Droplets className="h-4 w-4" />}
            حفظ القراءة
          </button>
          <p className="text-[10px] text-muted-foreground">
            <Camera className="inline h-3 w-3" /> التقاط صور العدادات يحتاج طبقة تخزين/سياسة وصول مخصصة وسيُضاف دون تجاوز ضوابط الخصوصية.
          </p>
        </form>

        <div className="glass rounded-2xl p-5 lg:col-span-3">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm font-bold">أحدث القراءات (مباشر)</div>
            <span className="text-[10px] text-emerald-700">● Realtime</span>
          </div>
          <div className="max-h-[420px] overflow-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-card">
                <tr className="text-right text-muted-foreground">
                  <th className="py-2">العدّاد</th><th>المشترك</th><th>القراءة</th><th>GPS</th><th>الوقت</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && <tr><td colSpan={5} className="py-6 text-center text-muted-foreground">لا توجد قراءات بعد</td></tr>}
                {rows.map(r => (
                  <tr key={r.id} className="border-t border-border/60">
                    <td className="py-2 font-semibold num">{r.subscribers?.meter_serial ?? "—"}</td>
                    <td>{r.subscribers?.name ?? "—"}</td>
                    <td className="num">{r.reading_m3}</td>
                    <td className="num text-[10px] text-muted-foreground">{r.gps_lat != null ? `${r.gps_lat.toFixed(3)},${r.gps_lng?.toFixed(3)}` : "—"}</td>
                    <td className="text-muted-foreground">{fmtDate(r.captured_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-semibold text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}
