import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type MizanRole =
  | "super_admin"
  | "central_admin"
  | "project_manager"
  | "meter_reader"
  | "financial_collector";

export interface MizanProfile {
  id: string;
  tenant_id: string | null;
  full_name: string | null;
}

export function useAuthSession() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setUser(data.session?.user ?? null);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null);
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return { user, loading };
}

export function useMizanRoles(userId: string | undefined) {
  const [roles, setRoles] = useState<MizanRole[]>([]);
  const [profile, setProfile] = useState<MizanProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) {
      setRoles([]);
      setProfile(null);
      setLoading(false);
      return;
    }
    let mounted = true;
    (async () => {
      const [rolesRes, profRes] = await Promise.all([
        supabase.from("user_roles").select("role").eq("user_id", userId),
        supabase.from("profiles").select("id, tenant_id, full_name").eq("id", userId).maybeSingle(),
      ]);
      if (!mounted) return;
      setRoles(((rolesRes.data ?? []) as { role: MizanRole }[]).map((r) => r.role));
      setProfile((profRes.data as MizanProfile | null) ?? null);
      setLoading(false);
    })();
    return () => {
      mounted = false;
    };
  }, [userId]);

  return { roles, profile, loading, hasRole: (r: MizanRole) => roles.includes(r) };
}
