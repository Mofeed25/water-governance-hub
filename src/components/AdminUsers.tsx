import { useEffect, useState } from "react";
import { Users, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { MizanRole } from "@/hooks/use-auth";

const ROLE_LABEL: Record<MizanRole, string> = {
  super_admin: "المشرف الأعلى",
  central_admin: "الإدارة المركزية",
  project_manager: "مدير المشروع",
  meter_reader: "قارئ عدادات",
  financial_collector: "محصّل مالي",
};

interface AppUser {
  id: string;
  email: string;
  full_name: string | null;
  tenant_id: string | null;
  tenant_name: string | null;
  roles: string[];
}

export function AdminUsers({ tenants }: { tenants: { id: string; name: string }[] }) {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("admin_list_users");
    setLoading(false);
    if (error) { toast.error(error.message); return; }
    setUsers((data ?? []) as unknown as AppUser[]);
  };

  useEffect(() => { void load(); }, []);

  const assign = async (u: AppUser, tenantId: string | null, role: MizanRole | null) => {
    setBusy(u.id);
    const { error } = await supabase.rpc("admin_set_user_access", {
      _user_id: u.id,
      _tenant_id: tenantId,
      _role: role,
    });
    setBusy(null);
    if (error) { toast.error(error.message); return; }
    toast.success(role ? "تم تحديث صلاحيات المستخدم" : "تم تحديث المشروع");
    void load();
  };

  const revoke = async (u: AppUser, role: string) => {
    setBusy(u.id);
    const { error } = await supabase.rpc("admin_revoke_role", { _user_id: u.id, _role: role as MizanRole });
    setBusy(null);
    if (error) { toast.error(error.message); return; }
    toast.success("تم سحب الدور");
    void load();
  };

  return (
    <div className="glass overflow-hidden rounded-2xl">
      <div className="flex items-center gap-2 border-b border-border p-4">
        <Users className="h-4 w-4 text-brand-600" />
        <h2 className="text-sm font-bold">المستخدمون والصلاحيات</h2>
        {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs">
            <tr>
              <th className="p-3 text-right">المستخدم</th>
              <th className="p-3">المشروع</th>
              <th className="p-3">الأدوار</th>
              <th className="p-3">إسناد دور</th>
            </tr>
          </thead>
          <tbody>
            {!loading && users.length === 0 && (
              <tr><td colSpan={4} className="p-6 text-center text-muted-foreground">لا يوجد مستخدمون</td></tr>
            )}
            {users.map((u) => (
              <tr key={u.id} className="border-t border-border">
                <td className="p-3 text-right">
                  <div className="font-semibold">{u.full_name || "—"}</div>
                  <div className="text-[11px] text-muted-foreground">{u.email}</div>
                </td>
                <td className="p-3 text-center">
                  <select
                    disabled={busy === u.id}
                    value={u.tenant_id ?? ""}
                    onChange={(e) => void assign(u, e.target.value || null, null)}
                    className="rounded-lg border border-border bg-card px-2 py-1 text-xs"
                  >
                    <option value="">بدون مشروع</option>
                    {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </td>
                <td className="p-3">
                  <div className="flex flex-wrap justify-center gap-1">
                    {u.roles.length === 0 && <span className="text-[11px] text-muted-foreground">—</span>}
                    {u.roles.map((r) => (
                      <span key={r} className="inline-flex items-center gap-1 rounded-full border border-brand-200 bg-brand-50 px-2 py-0.5 text-[11px] font-bold text-brand-700">
                        {ROLE_LABEL[r as MizanRole] ?? r}
                        <button onClick={() => void revoke(u, r)} className="text-brand-700/60 hover:text-rose-600" aria-label={`سحب دور ${ROLE_LABEL[r as MizanRole] ?? r}`}>
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                </td>
                <td className="p-3 text-center">
                  <select
                    disabled={busy === u.id || !u.tenant_id}
                    value=""
                    onChange={(e) => e.target.value && void assign(u, u.tenant_id, e.target.value as MizanRole)}
                    className="rounded-lg border border-border bg-card px-2 py-1 text-xs"
                  >
                    <option value="">إضافة دور…</option>
                    {(Object.keys(ROLE_LABEL) as MizanRole[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
