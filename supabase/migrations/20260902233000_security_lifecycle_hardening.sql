-- MIZAN production security hardening.
-- Disable the historical self-service super-admin bootstrap permanently.
CREATE OR REPLACE FUNCTION public.bootstrap_super_admin()
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'Super-admin provisioning is disabled. Use controlled platform provisioning.';
END;
$$;
REVOKE ALL ON FUNCTION public.bootstrap_super_admin() FROM public, anon, authenticated;

-- Tenant access is identity-scoped and lifecycle-scoped.
CREATE OR REPLACE FUNCTION public.can_access_tenant(_tenant_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT public.is_super_admin((SELECT auth.uid()))
      OR (_tenant_id = public.current_tenant_id()
          AND EXISTS (
            SELECT 1 FROM public.tenants t
            WHERE t.id = _tenant_id
              AND t.status = 'active'::public.tenant_status
              AND (t.subscription_expires_at IS NULL OR t.subscription_expires_at >= CURRENT_DATE)
          ));
$$;
REVOKE ALL ON FUNCTION public.can_access_tenant(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.can_access_tenant(uuid) TO authenticated;

-- Tenant users cannot move their own identity to another tenant.
REVOKE INSERT, UPDATE ON public.profiles FROM authenticated, anon;
GRANT UPDATE (full_name, phone) ON public.profiles TO authenticated;
DROP POLICY IF EXISTS "profiles self update" ON public.profiles;
CREATE POLICY "profiles self update" ON public.profiles FOR UPDATE TO authenticated
  USING (id = (SELECT auth.uid()))
  WITH CHECK (id = (SELECT auth.uid()) AND tenant_id IS NOT DISTINCT FROM public.current_tenant_id());

-- Explicit tenant + role policies.
DROP POLICY IF EXISTS "tenants read own" ON public.tenants;
CREATE POLICY "tenants read own" ON public.tenants FOR SELECT TO authenticated
  USING (public.can_access_tenant(id));

DROP POLICY IF EXISTS "subscribers tenant read" ON public.subscribers;
DROP POLICY IF EXISTS "subscribers tenant write" ON public.subscribers;
DROP POLICY IF EXISTS "subscribers tenant update" ON public.subscribers;
CREATE POLICY "subscribers tenant read" ON public.subscribers FOR SELECT TO authenticated
  USING (public.can_access_tenant(tenant_id));
CREATE POLICY "subscribers manager insert" ON public.subscribers FOR INSERT TO authenticated
  WITH CHECK (public.can_access_tenant(tenant_id) AND public.has_role((SELECT auth.uid()), 'project_manager'::public.app_role));
CREATE POLICY "subscribers manager update" ON public.subscribers FOR UPDATE TO authenticated
  USING (public.can_access_tenant(tenant_id) AND public.has_role((SELECT auth.uid()), 'project_manager'::public.app_role))
  WITH CHECK (public.can_access_tenant(tenant_id) AND public.has_role((SELECT auth.uid()), 'project_manager'::public.app_role));

DROP POLICY IF EXISTS "readings tenant read" ON public.meter_readings;
DROP POLICY IF EXISTS "readings insert by reader" ON public.meter_readings;
CREATE POLICY "readings tenant read" ON public.meter_readings FOR SELECT TO authenticated
  USING (public.can_access_tenant(tenant_id));
CREATE POLICY "readings insert by reader" ON public.meter_readings FOR INSERT TO authenticated
  WITH CHECK (public.can_access_tenant(tenant_id)
    AND reader_id = (SELECT auth.uid())
    AND (public.has_role((SELECT auth.uid()), 'meter_reader'::public.app_role)
      OR public.has_role((SELECT auth.uid()), 'project_manager'::public.app_role)));

DROP POLICY IF EXISTS "receipts tenant read" ON public.receipts;
DROP POLICY IF EXISTS "receipts insert by collector" ON public.receipts;
CREATE POLICY "receipts tenant read" ON public.receipts FOR SELECT TO authenticated
  USING (public.can_access_tenant(tenant_id));
CREATE POLICY "receipts insert by collector" ON public.receipts FOR INSERT TO authenticated
  WITH CHECK (public.can_access_tenant(tenant_id)
    AND collector_id = (SELECT auth.uid())
    AND (public.has_role((SELECT auth.uid()), 'financial_collector'::public.app_role)
      OR public.has_role((SELECT auth.uid()), 'project_manager'::public.app_role)));

-- Invoice creation is backend-controlled; project users only read invoices.
DROP POLICY IF EXISTS "billing tenant read" ON public.billing_logs;
DROP POLICY IF EXISTS "billing tenant write" ON public.billing_logs;
CREATE POLICY "billing tenant read" ON public.billing_logs FOR SELECT TO authenticated
  USING (public.can_access_tenant(tenant_id));
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.billing_logs FROM authenticated, anon;

-- Financial and evidence records are browser-immutable.
REVOKE UPDATE, DELETE, TRUNCATE ON public.receipts FROM authenticated, anon;
REVOKE UPDATE, DELETE, TRUNCATE ON public.meter_readings FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.user_roles FROM authenticated, anon;

-- Paid billing records cannot be mutated through privileged SQL paths either.
CREATE OR REPLACE FUNCTION public.prevent_paid_invoice_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = ''
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
REVOKE ALL ON FUNCTION public.prevent_paid_invoice_mutation() FROM public, anon, authenticated;

-- Browser storage is append-only evidence. Upload remains role/tenant scoped; updates are disabled.
REVOKE UPDATE, DELETE ON storage.objects FROM authenticated, anon;
DROP POLICY IF EXISTS "meter photos tenant update" ON storage.objects;

-- One authoritative reading per subscriber and billing period prevents duplicate consumption.
CREATE UNIQUE INDEX IF NOT EXISTS meter_readings_subscriber_period_uidx
ON public.meter_readings (tenant_id, subscriber_id, date_trunc('month', captured_at));
