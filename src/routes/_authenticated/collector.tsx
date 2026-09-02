import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Wallet, Lock, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuthSession, useMizanRoles } from "@/hooks/use-auth";
import { tafqitYER } from "@/lib/tafqit";
import { fmtDate, fmtYER } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/collector")({
  head: () => ({ meta: [{ title: "التحصيل المالي — ميزان" }] }),
  component: CollectorPage,
});

interface Subscriber { id: string; name: string; zone: string | null; meter_serial: string; balance_yer: number | null; tenant_id: string; }
interface ReceiptRow {
  id: string; amount_yer: number; amount_words_ar: string | null; period: string | null; created_at: string;
  subscribers?: { name: string; meter_serial: string } | null;
}

function CollectorPage() {
  const { user } = useAuthSession();
  const { roles, profile, loading: rolesLoading } = useMizanRoles(user?.id);
  const canSubmit = roles.includes("financial_collector") || roles.includes("project_manager");

  const [subs, setSubs] = useState<Subscriber[]>([]);
  const [rows, setRows] = useState<ReceiptRow[]>([]);
  const [subId, setSubId] = useState("");
  const [amount, setAmount] = useState("");
  const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7));
  const [busy, setBusy] = useState(false);

  const words = useMemo(() => (amount ? tafqitYER(parseFloat(amount) || 0) : ""), [amount]);

  const loadSubs = async () => {
    const { data } = await supabase.from("subscribers").select("id,name,zone,meter_serial,balance_yer,tenant_id").order("meter_serial");
    setSubs(data ?? []);
  };
  const loadRows = async () => {
    const { data } = await supabase.from("receipts")
      .select("id,amount_yer,amount_words_ar,period,created_at,subscribers(name,meter_serial)")
      .order("created_at", { ascending: false }).limit(20);
    setRows((data ?? []) as ReceiptRow[]);
  };

  useEffect(() => {
    loadSubs(); loadRows();
    const ch = supabase.channel("collector-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "receipts" }, loadRows)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subId || !amount) { toast.error("يرجى تعبئة الحقول"); return; }
    const tenantId = subs.find((s) => s.id === subId)?.tenant_id ?? profile?.tenant_id ?? null;
    if (!user || !tenantId) { toast.error("الحساب غير مرتبط بمشروع"); return; }
    const amt = parseFloat(amount);
    if (amt <= 0) { toast.error("المبلغ غير صالح"); return; }
    setBusy(true);
    try {
      const created_at = new Date().toISOString();
      const canon = `${tenantId}|${subId}|${user.id}|${amt}|${created_at}`;
      const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canon));
      const hash = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");

      const { error } = await supabase.from("receipts").insert({
        tenant_id: tenantId,
        subscriber_id: subId,
        collector_id: user.id,
        amount_yer: amt,
        amount_words_ar: tafqitYER(amt),
        period,
        hash_signature: hash,
      });
      if (error) throw error;
      toast.success("تم إصدار الإيصال — مغلق تشفيريًا");
      setAmount(""); setSubId(""); loadSubs();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "فشل الإرسال");
    } finally { setBusy(false); }
  };

  const selected = subs.find(s => s.id === subId);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold">التحصيل المالي</h1>
        <p className="mt-1 text-sm text-muted-foreground">إصدار إيصالات فورية مع تفقيط عربي — مغلقة بعد الإرسال.</p>
      </div>

      {!rolesLoading && !canSubmit && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          صلاحيات التحصيل غير مفعّلة لحسابك — يمكنك عرض السجل فقط.
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-5">
        <form onSubmit={submit} className="glass rounded-2xl p-5 lg:col-span-2 space-y-3">
          <div className="flex items-center gap-2 text-sm font-bold">
            <Wallet className="h-4 w-4 text-aqua-600" /> إيصال جديد
          </div>

          <Field label="المشترك">
            <select required value={subId} onChange={e => setSubId(e.target.value)} disabled={!canSubmit || busy}
              className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-ring">
              <option value="">— اختر المشترك —</option>
              {subs.map(s => <option key={s.id} value={s.id}>{s.meter_serial} · {s.name}</option>)}
            </select>
          </Field>

          {selected && (
            <div className="rounded-xl bg-muted/50 p-3 text-xs">
              <div>الرصيد الحالي: <span className="num font-bold">{fmtYER(selected.balance_yer ?? 0)}</span> ريال</div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field label="المبلغ (ريال يمني)">
              <input required type="number" min="1" step="1" value={amount} onChange={e => setAmount(e.target.value)} disabled={!canSubmit || busy} dir="ltr"
                className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-ring" />
            </Field>
            <Field label="الفترة">
              <input type="month" value={period} onChange={e => setPeriod(e.target.value)} disabled={!canSubmit || busy} dir="ltr"
                className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-ring" />
            </Field>
          </div>

          {words && (
            <div className="rounded-xl border border-aqua-200 bg-aqua-50/60 p-3 text-xs">
              <div className="font-semibold text-aqua-700">التفقيط:</div>
              <div className="mt-1 leading-relaxed">{words}</div>
            </div>
          )}

          <button type="submit" disabled={!canSubmit || busy}
            className="mt-1 flex w-full items-center justify-center gap-2 rounded-xl brand-gradient px-4 py-3 text-sm font-bold text-white shadow-md hover:opacity-95 disabled:opacity-60">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
            إصدار الإيصال وقفله
          </button>
        </form>

        <div className="glass rounded-2xl p-5 lg:col-span-3">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm font-bold">أحدث الإيصالات (مباشر)</div>
            <span className="text-[10px] text-emerald-700">● WebSocket</span>
          </div>
          <div className="max-h-[420px] overflow-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-card">
                <tr className="text-right text-muted-foreground">
                  <th className="py-2">العدّاد</th><th>المشترك</th><th>المبلغ</th><th>الفترة</th><th>الوقت</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && <tr><td colSpan={5} className="py-6 text-center text-muted-foreground">لا توجد إيصالات بعد</td></tr>}
                {rows.map(r => (
                  <tr key={r.id} className="border-t border-border/60">
                    <td className="py-2 font-semibold num">{r.subscribers?.meter_serial ?? "—"}</td>
                    <td>{r.subscribers?.name ?? "—"}</td>
                    <td className="num font-bold">{fmtYER(r.amount_yer)}</td>
                    <td className="num text-muted-foreground">{r.period ?? "—"}</td>
                    <td className="text-muted-foreground">{fmtDate(r.created_at)}</td>
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
