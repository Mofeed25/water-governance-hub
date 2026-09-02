import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

const roles = ["project_manager", "meter_reader", "financial_collector"] as const;
type Role = typeof roles[number];
type Account = { email: string; password: string; full_name: string; role: Role };

function response(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "content-type": "application/json" } }); }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return response({ error: "Method not allowed" }, 405);
  try {
    const auth = req.headers.get("Authorization");
    if (!auth?.startsWith("Bearer ")) return response({ error: "Unauthorized" }, 401);
    const token = auth.slice(7);
    const { data: caller, error: callerError } = await admin.auth.getUser(token);
    if (callerError || !caller.user) return response({ error: "Unauthorized" }, 401);
    const { data: superRole } = await admin.from("user_roles").select("id").eq("user_id", caller.user.id).eq("role", "super_admin").is("tenant_id", null).maybeSingle();
    if (!superRole) return response({ error: "Forbidden" }, 403);

    const body = await req.json();
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const tariff = Number(body.tariff_per_m3 ?? 0);
    const tier = body.subscription_tier === "premium" ? "premium" : "free";
    const accounts = Array.isArray(body.accounts) ? body.accounts as Account[] : [];
    if (!name || name.length > 160) return response({ error: "اسم المشروع غير صالح" }, 400);
    if (!Number.isFinite(tariff) || tariff < 0) return response({ error: "التعرفة غير صالحة" }, 400);
    if (accounts.length !== 3 || roles.some((role) => !accounts.some((a) => a.role === role))) return response({ error: "يجب توفير حساب واحد لكل دور تشغيلي" }, 400);
    for (const account of accounts) {
      if (!/^\S+@\S+\.\S+$/.test(account.email) || account.password.length < 8 || account.password.length > 128 || !account.full_name.trim()) return response({ error: "بيانات أحد الحسابات غير صالحة" }, 400);
    }

    const { data: tenant, error: tenantError } = await admin.from("tenants").insert({ name, tariff_per_m3: tariff, subscription_tier: tier, status: "active", subscription_started_at: new Date().toISOString(), subscription_expires_at: new Date(Date.now() + 365 * 86400000).toISOString() }).select("id,name").single();
    if (tenantError || !tenant) return response({ error: tenantError?.message ?? "تعذر إنشاء المشروع" }, 400);

    const created: string[] = [];
    try {
      for (const account of accounts) {
        const { data: createdUser, error: userError } = await admin.auth.admin.createUser({ email: account.email.toLowerCase().trim(), password: account.password, email_confirm: true, user_metadata: { full_name: account.full_name.trim() } });
        if (userError || !createdUser.user) throw new Error(userError?.message ?? "تعذر إنشاء الحساب");
        created.push(createdUser.user.id);
        const { error: profileError } = await admin.from("profiles").update({ tenant_id: tenant.id, full_name: account.full_name.trim() }).eq("id", createdUser.user.id);
        if (profileError) throw profileError;
        const { error: roleError } = await admin.from("user_roles").insert({ user_id: createdUser.user.id, tenant_id: tenant.id, role: account.role });
        if (roleError) throw roleError;
      }
    } catch (error) {
      for (const userId of created) await admin.auth.admin.deleteUser(userId);
      await admin.from("tenants").delete().eq("id", tenant.id);
      return response({ error: error instanceof Error ? error.message : "فشل إنشاء حسابات المشروع" }, 400);
    }
    return response({ tenant_id: tenant.id, name: tenant.name, status: "active", accounts_created: created.length }, 201);
  } catch (error) { return response({ error: error instanceof Error ? error.message : "Invalid request" }, 400); }
});
