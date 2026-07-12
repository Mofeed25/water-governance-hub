
# Mizan LiveSync — Production Backend Upgrade Plan

This is a large, multi-part upgrade. I'll extract your uploaded codebase into the project (preserving the existing UI), then layer on real Supabase infrastructure. Below is what I'll build. Please confirm or adjust before I proceed.

## 1. Restore uploaded codebase
- Extract `mizan-livesync.zip` into the workspace (excluding `.git`), overwriting the current template scaffold.
- Keep all existing UI: `/routes/index.tsx`, `/auth`, `/dashboard`, `/collector`, `/reader`, `MizanFooter`, shadcn components — untouched in layout/design.
- Enable Lovable Cloud (Supabase) if not already active.

## 2. Database schema (SQL migrations)
New tables (all with `tenant_id` FK except `tenants`):
- `tenants` — id, name, region, subscription_tier (`free|premium`), status (`active|suspended`), created_at
- `profiles` — id (=auth.users.id), tenant_id, full_name, phone, created_at
- `user_roles` — user_id, role enum (`super_admin|project_manager|meter_reader|collector`), tenant_id (separate table per security guidance)
- `subscribers` — tenant_id, account_no, full_name (Arabic), phone, address, meter_serial, tariff_rate, arrears, active
- `meter_readings` — tenant_id, subscriber_id, reading_date, previous_reading, current_reading, consumption (generated), reader_id
- `invoices` — tenant_id, subscriber_id, period (month), consumption, current_due, previous_arrears, total_due, paid_amount, status, issued_at
- `subscriptions` — tenant_id, tier, started_at, expires_at, status
- `chat_conversations` + `chat_messages` — for AI chat history

## 3. RLS policies
- `has_role(uid, role)` and `is_super_admin(uid)` + `current_tenant_id(uid)` SECURITY DEFINER helpers to avoid recursion.
- `tenant_is_active(tenant_id)` — suspended tenants → all non-super-admin access blocked.
- Every table: super_admin full access; project_manager scoped to their tenant; meter_reader → read subscribers + write meter_readings only; collector → read subscribers/invoices + update invoice payments only. Neither has access to chat or settings.

## 4. Backend RPCs (Postgres functions)
- `calc_consumption(subscriber_id)` — derives from latest two readings.
- `generate_invoice(subscriber_id, period)` — computes current_due (consumption × tariff), rolls arrears from prior unpaid invoices, upserts invoice.
- `generate_invoices_for_tenant(tenant_id, period)` — batch.
- `governance_score(tenant_id)` — 0–100 composite: collection_efficiency (40%), reading_coverage (30%), on_time_readings (20%), active_subscribers_ratio (10%).

## 5. Seed data (Yemen/Taiz context)
`supabase/migrations/*_seed.sql`:
- 3 tenants: "مشروع مياه تعز - الحوبان", "مشروع مياه تعز - القاهرة", "مشروع مياه تعز - صالة".
- 300–600 subscribers each, generated via PL/pgSQL loops from arrays of authentic Taiz family names (Al-Mikhlafi, Al-Sharafi, Al-Sabri, Al-Odaini, Al-Shameeri, Al-Aghbari, Al-Qadasi, Al-Maqtari, Al-Hakimi, Al-Wesabi…) + first names (Mohammed, Ahmed, Ali, Abdullah, Fatima, Aisha, Khadija…).
- 2 months of realistic meter readings + invoices with mixed paid/unpaid.

## 6. Super Admin controls
- Enhance `/dashboard` (or add `/admin`) — only visible to `super_admin`:
  - Create/list tenants, toggle suspend/activate, change subscription tier.
  - Global stats + per-tenant governance scores.
- Suspension enforcement flows through RLS + a `tenant_is_active` gate in the `_authenticated` layout (redirect suspended users to a "Project Suspended" page).

## 7. AI Chat (Gemini via Edge Function)
- New Supabase Edge Function `ai-chat` (deno). Uses `LOVABLE_API_KEY` → Lovable AI Gateway (`google/gemini-2.5-flash`) — no direct Gemini key, no frontend key exposure.
- Function reads the caller's JWT → looks up role + tenant_id server-side and injects into the system prompt + tool context. project_manager queries auto-scoped to their tenant; super_admin can query globally.
- Tool calling with structured functions: `list_unpaid_subscribers`, `tenant_stats`, `governance_summary`, plus a `clarify` tool that returns Generative UI JSON (choice buttons, filter chips) rendered client-side when the query is ambiguous.
- Frontend `/chat` route gated to `super_admin` + `project_manager` only (hidden in sidebar for reader/collector).

## 8. Governance Score UI
- Add a gauge chart (Recharts RadialBar) on the project dashboard showing the score with color bands (red<40, amber 40–70, green>70) and a breakdown card of the four sub-metrics.

## 9. Verification
- Run migrations; confirm seed inserts; hit RPCs; smoke-test Edge Function via `invoke-server-function`; visually verify dashboard + chat routes render.

## Technical notes
- Stack: TanStack Start + Lovable Cloud (Supabase). Frontend reads use `useSuspenseQuery` + server functions with `requireSupabaseAuth`. No mock data anywhere.
- Model: `google/gemini-2.5-flash` via Lovable AI Gateway (chat + tool calling). Switchable.
- Roles table separated from profiles (security best-practice against privilege escalation).

## Open questions
1. **Tariff structure**: flat rate per m³, or tiered (e.g. 0–10 m³ = X, 10–20 = Y)? I'll default to tiered Yemeni-style if unspecified.
2. **Currency**: display in YER? Default yes.
3. **Chat model**: OK with `google/gemini-2.5-flash` (fast/cheap), or prefer `google/gemini-2.5-pro`?

Reply "go" (with any tweaks) and I'll ship it end-to-end.
