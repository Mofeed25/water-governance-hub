// AI Chat edge function — Gemini via Lovable AI Gateway.
// - Verifies user JWT (verify_jwt=true by default)
// - Looks up caller's role + tenant_id server-side
// - Injects strict tenant scope: project_manager => their tenant only; super_admin => system-wide
// - Supports "Generative UI" via tool calling: model can return a `render_ui` tool call for ambiguous queries
// deno-lint-ignore-file no-explicit-any

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

async function sb(path: string, init: RequestInit = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`supabase ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function rpc(fn: string, body: Record<string, unknown>) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`rpc ${fn}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function getUser(token: string) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  return res.json();
}

// ---------- Tool implementations (server-side, scoped by role) ----------
async function tool_list_unpaid_subscribers(scope: { tenantId: string | null; isSuper: boolean; askedTenantId?: string | null }, args: { limit?: number }) {
  const tid = scope.isSuper ? (args as any).tenant_id ?? scope.askedTenantId : scope.tenantId;
  const filter = tid ? `&tenant_id=eq.${tid}` : "";
  const limit = Math.min(args.limit ?? 20, 100);
  const rows = await sb(`billing_logs?select=subscriber_id,period,amount_yer,paid_amount_yer,subscribers(name,meter_serial,zone,phone)&paid=eq.false${filter}&order=amount_yer.desc&limit=${limit}`);
  return rows;
}

async function tool_tenant_stats(scope: { tenantId: string | null; isSuper: boolean }, args: { tenant_id?: string }) {
  const tid = scope.isSuper ? (args.tenant_id ?? null) : scope.tenantId;
  if (!tid) {
    const tenants = await sb(`tenants?select=id,name,status,subscription_tier`);
    return { tenants };
  }
  const [subs, bills, tenants] = await Promise.all([
    sb(`subscribers?select=id,status&tenant_id=eq.${tid}`),
    sb(`billing_logs?select=amount_yer,paid_amount_yer,paid&tenant_id=eq.${tid}`),
    sb(`tenants?select=id,name,status,subscription_tier,tariff_per_m3&id=eq.${tid}`),
  ]);
  const billed = bills.reduce((a: number, b: any) => a + Number(b.amount_yer), 0);
  const collected = bills.reduce((a: number, b: any) => a + Number(b.paid_amount_yer), 0);
  return {
    tenant: tenants[0] ?? null,
    subscribers_total: subs.length,
    subscribers_active: subs.filter((s: any) => s.status === "active").length,
    billed_yer: Math.round(billed),
    collected_yer: Math.round(collected),
    unpaid_yer: Math.round(billed - collected),
  };
}

async function tool_governance(scope: { tenantId: string | null; isSuper: boolean }, args: { tenant_id?: string }) {
  const tid = scope.isSuper ? (args.tenant_id ?? scope.tenantId) : scope.tenantId;
  if (!tid) return { error: "tenant_id required" };
  return await rpc("governance_score", { _tenant_id: tid });
}

const TOOLS = [
  {
    type: "function",
    function: {
      name: "list_unpaid_subscribers",
      description: "List subscribers with outstanding unpaid invoices. Scoped to the caller's tenant unless super_admin.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "integer", description: "Max rows (default 20, max 100)" },
          tenant_id: { type: "string", description: "Only usable by super_admin to target a specific project" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "tenant_stats",
      description: "Return aggregate stats (subscribers, billed, collected, unpaid) for a project.",
      parameters: {
        type: "object",
        properties: { tenant_id: { type: "string" } },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "governance_score",
      description: "Return the 0-100 governance score and breakdown for a project.",
      parameters: {
        type: "object",
        properties: { tenant_id: { type: "string" } },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "render_ui",
      description: "Return interactive UI when the user's question is ambiguous or requires clarification. Do this INSTEAD of a plain text answer when input needs disambiguating.",
      parameters: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["choice", "filters"], description: "choice = pick one option; filters = pick multiple filter chips" },
          question: { type: "string", description: "Question/instruction shown to user, in Arabic" },
          options: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                label: { type: "string" },
                hint: { type: "string" },
              },
              required: ["id", "label"],
            },
          },
        },
        required: ["kind", "question", "options"],
      },
    },
  },
];

async function runTool(name: string, args: any, scope: any) {
  if (name === "list_unpaid_subscribers") return tool_list_unpaid_subscribers(scope, args);
  if (name === "tenant_stats") return tool_tenant_stats(scope, args);
  if (name === "governance_score") return tool_governance(scope, args);
  return { error: `unknown tool ${name}` };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...CORS, "Content-Type": "application/json" } });

    const user = await getUser(token);
    if (!user?.id) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...CORS, "Content-Type": "application/json" } });

    // Look up profile + roles server-side (service role, not user JWT)
    const [[profile], roles] = await Promise.all([
      sb(`profiles?select=id,tenant_id,full_name&id=eq.${user.id}`),
      sb(`user_roles?select=role&user_id=eq.${user.id}`),
    ]);
    const roleList: string[] = (roles ?? []).map((r: any) => r.role);
    const isSuper = roleList.includes("super_admin");
    const isManager = roleList.includes("project_manager") || roleList.includes("central_admin");
    if (!isSuper && !isManager) {
      return new Response(JSON.stringify({ error: "Chat is available only to project managers and super admins." }), {
        status: 403,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const userMessages: { role: string; content: string }[] = body.messages ?? [];

    // Resolve tenant name for context (for project_manager)
    let tenantName: string | null = null;
    if (profile?.tenant_id) {
      const t = await sb(`tenants?select=name&id=eq.${profile.tenant_id}`);
      tenantName = t[0]?.name ?? null;
    }

    const scope = { tenantId: profile?.tenant_id ?? null, isSuper };

    const system = `أنت مساعد ذكي لمنصة "ميزان" لإدارة مشاريع المياه في تعز، اليمن. أجب دائمًا بالعربية الفصحى ما لم يُطلب غير ذلك.
دور المستخدم: ${isSuper ? "super_admin (يرى جميع المشاريع)" : "project_manager"}
${tenantName && !isSuper ? `المشروع الحالي: ${tenantName} (tenant_id=${profile.tenant_id})` : ""}

قواعد صارمة:
1) استخدم الأدوات المتاحة لسحب بيانات حقيقية من قاعدة البيانات — لا تختلق أرقامًا.
2) إذا كان دور المستخدم project_manager، فكل استعلاماته مقيدة تلقائيًا بمشروعه (لا تمرّر tenant_id).
3) إذا كان super_admin وطلب بيانات بدون تحديد مشروع، استخدم أداة render_ui من نوع "choice" لعرض المشاريع المتاحة، إلا إذا طلب بوضوح "كل المشاريع".
4) عند الغموض (مثلاً "من لم يدفع؟" بدون فترة أو حد)، استخدم render_ui لسؤال المستخدم عن التوضيحات.
5) اختصر الردود ونسّق الأرقام. استخدم YER كعملة.`;

    // Multi-step tool loop
    const messages: any[] = [{ role: "system", content: system }, ...userMessages];
    let finalText = "";
    let finalUi: any = null;

    for (let step = 0; step < 4; step++) {
      const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages,
          tools: TOOLS,
        }),
      });

      if (aiRes.status === 429) {
        return new Response(JSON.stringify({ error: "rate_limited", message: "تم تجاوز حد الاستخدام. حاول لاحقًا." }), {
          status: 429, headers: { ...CORS, "Content-Type": "application/json" },
        });
      }
      if (aiRes.status === 402) {
        return new Response(JSON.stringify({ error: "credits_exhausted", message: "رصيد الذكاء الاصطناعي منتهٍ. الرجاء إضافة رصيد." }), {
          status: 402, headers: { ...CORS, "Content-Type": "application/json" },
        });
      }
      if (!aiRes.ok) {
        const txt = await aiRes.text();
        console.error("gateway error", aiRes.status, txt);
        return new Response(JSON.stringify({ error: "gateway_error", detail: txt }), {
          status: 500, headers: { ...CORS, "Content-Type": "application/json" },
        });
      }

      const data = await aiRes.json();
      const msg = data.choices?.[0]?.message;
      if (!msg) break;

      // Attach assistant message (with any tool_calls) for the next iteration
      messages.push(msg);

      const toolCalls = msg.tool_calls ?? [];
      if (!toolCalls.length) {
        finalText = msg.content ?? "";
        break;
      }

      for (const tc of toolCalls) {
        const name = tc.function?.name;
        let args: any = {};
        try { args = JSON.parse(tc.function?.arguments ?? "{}"); } catch { /* ignore */ }

        if (name === "render_ui") {
          finalUi = args;
          finalText = args.question ?? "";
          // Stop iterating; return UI to client
          messages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify({ ok: true }) });
          break;
        }

        const result = await runTool(name, args, scope);
        messages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(result) });
      }

      if (finalUi) break;
    }

    return new Response(JSON.stringify({ text: finalText, ui: finalUi }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: "internal", message: String(err) }), {
      status: 500, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
