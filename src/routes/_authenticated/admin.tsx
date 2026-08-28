import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Shield, Plus, Pause, Play, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AdminUsers } from "@/components/AdminUsers";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({ meta: [{ title: "الإدارة المركزية — ميزان" }] }),
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/auth" });
    const { data: r } = await supabase.from("user_roles").select("role").eq("user_id", data.user.id);
    if (!r?.some((x) => x.role === "super_admin")) throw redirect({ to: "/dashboard" });
  },
  component: AdminPage,
});

interface Tenant {
  id: string;
  name: string;
  status: "active" | "suspended";
  subscription_tier: "free" | "premium";
  tariff_per_m3: number;
  created_at: string;
}

function AdminPage() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", tariff: "250", tier: "free" as "free" | "premium" });

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.from("tenants").select("*").order("created_at", { ascending: false });
    setLoading(false);
    if (error) { toast.error(error.message); return; }
    setTenants((data ?? []) as Tenant[]);
  };

  useEffect(() => { load(); }, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    setCreating(true);
    const { error } = await supabase.from("tenants").insert({
      name: form.name.trim(),
      tariff_per_m3: Number(form.tariff),
      subscription_tier: form.tier,
      status: "active",
    });
    setCreating(false);
    if (error) { toast.error(error.message); return; }
    toast.success("تم إنشاء المشروع");
    setForm({ name: "", tariff: "250", tier: "free" });
    load();
  };

  const toggleSuspend = async (t: Tenant) => {
    const next = t.status === "active" ? "suspended" : "active";
    const { error } = await supabase.from("tenants").update({ status: next }).eq("id", t.id);
    if (error) { toast.error(error.message); return; }
    toast.success(next === "suspended" ? "تم تعليق المشروع — انقطع وصول المستخدمين" : "تمت إعادة تفعيل المشروع");
    load();
  };

  const updateTier = async (t: Tenant, tier: "free" | "premium") => {
    const { error } = await supabase.from("tenants").update({ subscription_tier: tier }).eq("id", t.id);
    if (error) { toast.error(error.message); return; }
    load();
  };

  return (
    <div className="space-y-6">
      <div className="glass rounded-2xl p-6">
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-xl brand-gradient text-white">
            <Shield className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold">الإدارة المركزية</h1>
            <p className="text-sm text-muted-foreground">إدارة المشاريع والاشتراكات والتعليق الفوري</p>
          </div>
        </div>
      </div>

      <div className="glass rounded-2xl p-5">
        <h2 className="mb-3 text-sm font-bold">إنشاء مشروع جديد</h2>
        <form onSubmit={create} className="grid gap-3 sm:grid-cols-4">
          <input
            className="rounded-lg border border-border bg-card px-3 py-2 text-sm sm:col-span-2"
            placeholder="اسم المشروع (مثلاً: مياه تعز — ذبحان)"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <input
            className="rounded-lg border border-border bg-card px-3 py-2 text-sm"
            type="number"
            placeholder="التعرفة لكل م³"
            value={form.tariff}
            onChange={(e) => setForm({ ...form, tariff: e.target.value })}
          />
          <select
            className="rounded-lg border border-border bg-card px-3 py-2 text-sm"
            value={form.tier}
            onChange={(e) => setForm({ ...form, tier: e.target.value as "free" | "premium" })}
          >
            <option value="free">مجاني</option>
            <option value="premium">مميّز</option>
          </select>
          <button
            type="submit"
            disabled={creating}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg brand-gradient px-4 py-2 text-sm font-bold text-white sm:col-span-4"
          >
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            إنشاء المشروع
          </button>
        </form>
      </div>

      <div className="glass overflow-hidden rounded-2xl">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs">
            <tr>
              <th className="p-3 text-right">المشروع</th>
              <th className="p-3">الحالة</th>
              <th className="p-3">الاشتراك</th>
              <th className="p-3">التعرفة (م³)</th>
              <th className="p-3">إجراءات</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">جاري التحميل…</td></tr>
            )}
            {!loading && tenants.length === 0 && (
              <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">لا توجد مشاريع</td></tr>
            )}
            {tenants.map((t) => (
              <tr key={t.id} className="border-t border-border">
                <td className="p-3 text-right font-semibold">{t.name}</td>
                <td className="p-3 text-center">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                    t.status === "active" ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"
                  }`}>
                    {t.status === "active" ? "نشط" : "معلّق"}
                  </span>
                </td>
                <td className="p-3 text-center">
                  <select
                    value={t.subscription_tier}
                    onChange={(e) => updateTier(t, e.target.value as "free" | "premium")}
                    className="rounded-lg border border-border bg-card px-2 py-1 text-xs"
                  >
                    <option value="free">مجاني</option>
                    <option value="premium">مميّز</option>
                  </select>
                </td>
                <td className="p-3 text-center num">{t.tariff_per_m3}</td>
                <td className="p-3 text-center">
                  <button
                    onClick={() => toggleSuspend(t)}
                    className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold ${
                      t.status === "active"
                        ? "bg-rose-50 text-rose-700 hover:bg-rose-100"
                        : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                    }`}
                  >
                    {t.status === "active" ? <><Pause className="h-3 w-3" /> تعليق</> : <><Play className="h-3 w-3" /> تفعيل</>}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">
        عند تعليق مشروع، تتوقف سياسات RLS عن السماح لمستخدميه بالوصول إلى بياناته فورًا.
      </p>
    </div>
  );
}
