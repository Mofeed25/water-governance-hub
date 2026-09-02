-- MIZAN production platform: offline-first and sustainability foundation.
-- Idempotency prevents duplicate writes when a device reconnects after a lost response.

ALTER TABLE public.meter_readings
  ADD COLUMN IF NOT EXISTS client_operation_id UUID;
ALTER TABLE public.receipts
  ADD COLUMN IF NOT EXISTS client_operation_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS meter_readings_client_operation_uidx
  ON public.meter_readings (client_operation_id)
  WHERE client_operation_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS receipts_client_operation_uidx
  ON public.receipts (client_operation_id)
  WHERE client_operation_id IS NOT NULL;

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS subscription_started_at TIMESTAMPTZ;
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS subscription_expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_tenants_subscription_expiry
  ON public.tenants (subscription_expires_at)
  WHERE subscription_expires_at IS NOT NULL;

-- Explicit role invariant: a project has at most one active account of each
-- operational role. The central administrator is not a tenant role.
CREATE UNIQUE INDEX IF NOT EXISTS user_roles_one_tenant_role_uidx
  ON public.user_roles (tenant_id, role)
  WHERE tenant_id IS NOT NULL
    AND role IN ('project_manager'::public.app_role, 'meter_reader'::public.app_role, 'financial_collector'::public.app_role);

-- Sustainability metrics are calculated from tenant-scoped source tables in the
-- application layer; this view provides one stable contract for dashboards.
CREATE OR REPLACE VIEW public.tenant_sustainability_metrics
WITH (security_invoker = true) AS
SELECT
  t.id AS tenant_id,
  t.name AS tenant_name,
  COUNT(DISTINCT s.id)::bigint AS subscribers,
  COUNT(DISTINCT CASE WHEN s.status = 'active' THEN s.id END)::bigint AS active_subscribers,
  COALESCE(SUM(mr.consumption_m3), 0)::numeric AS consumption_m3,
  COALESCE(SUM(bl.amount_yer), 0)::numeric AS billed_yer,
  COALESCE(SUM(bl.paid_amount_yer), 0)::numeric AS collected_yer,
  COALESCE(SUM(GREATEST(bl.amount_yer - bl.paid_amount_yer, 0)), 0)::numeric AS outstanding_yer,
  CASE
    WHEN COALESCE(SUM(bl.amount_yer), 0) = 0 THEN 0::numeric
    ELSE ROUND((COALESCE(SUM(bl.paid_amount_yer), 0) / SUM(bl.amount_yer)) * 100, 2)
  END AS collection_rate_pct
FROM public.tenants t
LEFT JOIN public.subscribers s ON s.tenant_id = t.id
LEFT JOIN public.meter_readings mr ON mr.tenant_id = t.id AND mr.subscriber_id = s.id
LEFT JOIN public.billing_logs bl ON bl.tenant_id = t.id AND bl.subscriber_id = s.id
GROUP BY t.id, t.name;

REVOKE ALL ON public.tenant_sustainability_metrics FROM anon;
GRANT SELECT ON public.tenant_sustainability_metrics TO authenticated;
