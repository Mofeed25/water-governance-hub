-- MIZAN production platform: offline-first and sustainability foundation.
ALTER TABLE public.meter_readings ADD COLUMN IF NOT EXISTS client_operation_id UUID;
ALTER TABLE public.receipts ADD COLUMN IF NOT EXISTS client_operation_id UUID;
CREATE UNIQUE INDEX IF NOT EXISTS meter_readings_client_operation_uidx ON public.meter_readings (client_operation_id) WHERE client_operation_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS receipts_client_operation_uidx ON public.receipts (client_operation_id) WHERE client_operation_id IS NOT NULL;
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS subscription_started_at TIMESTAMPTZ;
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS subscription_expires_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_tenants_subscription_expiry ON public.tenants (subscription_expires_at) WHERE subscription_expires_at IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS user_roles_one_tenant_role_uidx ON public.user_roles (tenant_id, role) WHERE tenant_id IS NOT NULL AND role IN ('project_manager'::public.app_role, 'meter_reader'::public.app_role, 'financial_collector'::public.app_role);
CREATE OR REPLACE VIEW public.tenant_sustainability_metrics WITH (security_invoker = true) AS
WITH subscriber_metrics AS (
  SELECT tenant_id, COUNT(*)::bigint AS subscribers, COUNT(*) FILTER (WHERE status = 'active')::bigint AS active_subscribers FROM public.subscribers GROUP BY tenant_id
), reading_metrics AS (
  SELECT tenant_id, COALESCE(SUM(consumption_m3), 0)::numeric AS consumption_m3 FROM public.meter_readings GROUP BY tenant_id
), billing_metrics AS (
  SELECT tenant_id, COALESCE(SUM(amount_yer), 0)::numeric AS billed_yer, COALESCE(SUM(paid_amount_yer), 0)::numeric AS collected_yer, COALESCE(SUM(GREATEST(amount_yer - paid_amount_yer, 0)), 0)::numeric AS outstanding_yer FROM public.billing_logs GROUP BY tenant_id
)
SELECT t.id AS tenant_id, t.name AS tenant_name, COALESCE(sm.subscribers, 0) AS subscribers, COALESCE(sm.active_subscribers, 0) AS active_subscribers, COALESCE(rm.consumption_m3, 0) AS consumption_m3, COALESCE(bm.billed_yer, 0) AS billed_yer, COALESCE(bm.collected_yer, 0) AS collected_yer, COALESCE(bm.outstanding_yer, 0) AS outstanding_yer, CASE WHEN COALESCE(bm.billed_yer, 0) = 0 THEN 0::numeric ELSE ROUND((COALESCE(bm.collected_yer, 0) / bm.billed_yer) * 100, 2) END AS collection_rate_pct
FROM public.tenants t LEFT JOIN subscriber_metrics sm ON sm.tenant_id = t.id LEFT JOIN reading_metrics rm ON rm.tenant_id = t.id LEFT JOIN billing_metrics bm ON bm.tenant_id = t.id;
REVOKE ALL ON public.tenant_sustainability_metrics FROM anon;
GRANT SELECT ON public.tenant_sustainability_metrics TO authenticated;
