import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Activity, Droplets, Users, Wallet, Gauge, ArrowLeft, MessageCircle, Shield } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuthSession, useMizanRoles, type MizanRole } from "@/hooks/use-auth";
import { GovernanceGauge } from "@/components/GovernanceGauge";
import { SetupSuperAdmin } from "@/components/SetupSuperAdmin";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "لوحة التحكم — ميزان" }] }),
  component: Dashboard,
});

interface Stats { subscribers: number; readings: number; receipts: number; billing: number; }

const ROLE_LABEL: Record<MizanRole, string> = {
  super_admin: "المشرف الأعلى",
  central_admin: "الإدارة المركزية",
  project_manager: "مدير المشروع",
  meter_reader: "قارئ عدادات",
  financial_collector: "محصّل مالي",
};

function Dashboard() {
  const { user } = useAuthSession();
  const { profile, roles, loading: rolesLoading } = useMizanRoles(user?.id);
  const [stats, setStats] = useState<Stats>({ subscribers: 0, readings: 0, receipts: 0, billing: 0 });
  const [tenantName, setTenantName] = useState<string | null>(null);
  const [tenants, setTenants] = useState<{ id: string; name: string }[]>([]);
  const [selectedTenant, setSelectedTenant] = useState<string | null>(null);

  const isSuper = roles.includes("super_admin");
  const isManager = isSuper || roles.includes("project_manager") || roles.includes("central_admin");
  const canRead = isManager || roles.includes("meter_reader");
  const canCollect = isManager || roles.includes("financial_collector");

  const scopedTenantId = isSuper ? selectedTenant : profile?.tenant_id ?? null;

  const refresh = async () => {
    const tid = scopedTenantId;
    const subQ = supabase.from("subscribers").select("id", { count: "exact", head: true });
    const readQ = supabase.from("meter_readings").select("id", { count: "exact", head: true });
    const recQ = supabase.from("receipts").select("id", { count: "exact", head: true });
    const billQ = supabase.from("billing_logs").select("id", { count: "exact", head: true });
    const [s, r, rc, b, tn] = await Promise.all([
      tid ? subQ.eq("tenant_id", tid) : subQ,
      tid ? readQ.eq("tenant_id", tid) : readQ,
      tid ? recQ.eq("tenant_id", tid) : recQ,
      tid ? billQ.eq("tenant_id", tid) : billQ,
      tid ? supabase.from("tenants").select("name").eq("id", tid).maybeSingle() : Promise.resolve({ data: null as { name: string } | null }),
    ]);
    setStats({ subscribers: s.count ?? 0, readings: r.count ?? 0, receipts: rc.count ?? 0, billing: b.count ?? 0 });
    setTenantName(tn.data?.name ?? null);
  };

  useEffect(() => {
    if (isSuper) {
      supabase.from("tenants").select("id,name").order("name").then(({ data }) => {
        setTenants(data ?? []);
        if (!selectedTenant && data?.[0]) setSelectedTenant(data[0].id);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuper]);

  useEffect(() => {
    refresh();
    const channel = supabase
      .channel("dashboard-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "meter_readings" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "receipts" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "subscribers" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "billing_logs" }, refresh)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopedTenantId]);

  return (
    <div className="space-y-6">
      {!rolesLoading && roles.length === 0 && (
        <SetupSuperAdmin onDone={() => window.location.reload()} />
      )}
      <div className="glass rounded-2xl p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-xs font-semibold text-brand-600">أهلاً بك</div>
            <h1 className="mt-1 text-2xl font-extrabold">{profile?.full_name || user?.email}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {tenantName ? `المشروع: ${tenantName}` : isSuper ? "اختر مشروعًا للاطلاع" : "لم يتم ربط مشروع بعد"}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {isSuper && tenants.length > 0 && (
              <select
                value={selectedTenant ?? ""}
                onChange={(e) => setSelectedTenant(e.target.value || null)}
                className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold"
              >
                {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            )}
            {rolesLoading ? (
              <span className="text-xs text-muted-foreground">جارِ تحميل الصلاحيات…</span>
            ) : roles.length ? (
              roles.map((r) => (
                <span key={r} className="rounded-full border border-brand-200 bg-brand-50 px-2.5 py-1 text-[11px] font-bold text-brand-700">
                  {ROLE_LABEL[r]}
                </span>
              ))
            ) : (
              <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-700">
                لا توجد صلاحيات — تواصل مع الإدارة المركزية
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 grid gap-4 sm:grid-cols-2">
          <StatCard icon={Users} label="المشتركون" value={stats.subscribers} />
          <StatCard icon={Droplets} label="القراءات" value={stats.readings} tone="brand" />
          <StatCard icon={Wallet} label="الإيصالات" value={stats.receipts} tone="aqua" />
          <StatCard icon={Activity} label="سجلات الفوترة" value={stats.billing} />
        </div>
        <GovernanceGauge tenantId={scopedTenantId} />
      </div>

      {isManager && (
        <div>
          <h2 className="mb-3 text-sm font-bold text-muted-foreground">وصول سريع</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <QuickCard to="/reader" icon={Gauge} title="قارئ العدادات" body="تسجيل قراءات المشتركين" />
            <QuickCard to="/collector" icon={Wallet} title="التحصيل المالي" body="إصدار إيصالات مالية" />
            <QuickCard to="/chat" icon={MessageCircle} title="المساعد الذكي" body="اسأل عن بيانات مشروعك" />
            {isSuper && <QuickCard to="/admin" icon={Shield} title="الإدارة المركزية" body="المشاريع والاشتراكات" />}
          </div>
        </div>
      )}

      {!isManager && (canRead || canCollect) && (
        <div className="grid gap-3 sm:grid-cols-2">
          {canRead && <QuickCard to="/reader" icon={Gauge} title="قارئ العدادات" body="ابدأ تسجيل القراءات" />}
          {canCollect && <QuickCard to="/collector" icon={Wallet} title="التحصيل المالي" body="ابدأ إصدار الإيصالات" />}
        </div>
      )}
    </div>
  );
}

function StatCard({ icon: Icon, label, value, tone }: { icon: typeof Droplets; label: string; value: number; tone?: "brand" | "aqua" }) {
  return (
    <div className="glass rounded-2xl p-5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-muted-foreground">{label}</span>
        <div className={`grid h-9 w-9 place-items-center rounded-xl text-white ${tone === "aqua" ? "bg-aqua-600" : tone === "brand" ? "bg-brand-600" : "brand-gradient"}`}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <div className="num mt-3 text-3xl font-extrabold">{value.toLocaleString("en-US")}</div>
    </div>
  );
}

function QuickCard({ to, icon: Icon, title, body }: { to: string; icon: typeof Droplets; title: string; body: string }) {
  return (
    <Link to={to} className="glass group flex items-center justify-between rounded-2xl p-5 transition hover:shadow-lg">
      <div className="flex items-center gap-3">
        <div className="grid h-11 w-11 place-items-center rounded-xl brand-gradient text-white">
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <div className="font-bold">{title}</div>
          <div className="text-xs text-muted-foreground">{body}</div>
        </div>
      </div>
      <ArrowLeft className="h-4 w-4 text-muted-foreground transition group-hover:-translate-x-1 group-hover:text-brand-600" />
    </Link>
  );
}
