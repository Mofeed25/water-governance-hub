-- MIZAN production security hardening.
-- Disable the historical self-service super-admin bootstrap permanently.
CREATE OR REPLACE FUNCTION public.bootstrap_super_admin()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'Super-admin provisioning is disabled. Use controlled platform provisioning.';
END;
$$;
REVOKE ALL ON FUNCTION public.bootstrap_super_admin() FROM public, anon, authenticated;

-- Subscription expiry is part of tenant access control. Keep the rule centralized.
CREATE OR REPLACE FUNCTION public.can_access_tenant(_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.tenants t
    WHERE t.id = _tenant_id
      AND t.status = 'active'
      AND (t.subscription_expires_at IS NULL OR t.subscription_expires_at >= CURRENT_DATE)
  );
$$;
REVOKE ALL ON FUNCTION public.can_access_tenant(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.can_access_tenant(uuid) TO authenticated;

-- Paid billing records are financial evidence: browser callers must not update/delete them.
REVOKE UPDATE, DELETE, TRUNCATE ON public.billing_logs FROM authenticated, anon;
REVOKE UPDATE, DELETE, TRUNCATE ON public.receipts FROM authenticated, anon;

-- Guard against changing an already-paid invoice through privileged SQL paths.
CREATE OR REPLACE FUNCTION public.prevent_paid_invoice_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') AND OLD.paid_amount_yer > 0 THEN
    RAISE EXCEPTION 'Paid invoice is immutable; create an explicit adjustment instead.';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
DROP TRIGGER IF EXISTS trg_prevent_paid_invoice_mutation ON public.billing_logs;
CREATE TRIGGER trg_prevent_paid_invoice_mutation
BEFORE UPDATE OR DELETE ON public.billing_logs
FOR EACH ROW EXECUTE FUNCTION public.prevent_paid_invoice_mutation();
REVOKE ALL ON FUNCTION public.prevent_paid_invoice_mutation() FROM public;

-- One authoritative reading per subscriber and billing period prevents duplicate consumption
-- from multiple approved readings. Existing rows are not deleted by this migration.
CREATE UNIQUE INDEX IF NOT EXISTS meter_readings_subscriber_period_uidx
ON public.meter_readings (tenant_id, subscriber_id, date_trunc('month', captured_at));
