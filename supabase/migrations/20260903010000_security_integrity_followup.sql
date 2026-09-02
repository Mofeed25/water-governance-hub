-- MIZAN production integrity follow-up.
-- Tighten tenant identity, lifecycle enforcement, financial immutability,
-- and append-only meter evidence without deleting production data.

-- -----------------------------------------------------------------------------
-- 1. A browser user may edit profile metadata, never tenant assignment.
-- -----------------------------------------------------------------------------
REVOKE INSERT, UPDATE ON public.profiles FROM authenticated, anon;
GRANT UPDATE (full_name, phone) ON public.profiles TO authenticated;

DROP POLICY IF EXISTS "profiles self update" ON public.profiles;
CREATE POLICY "profiles self metadata update" ON public.profiles
FOR UPDATE TO authenticated
USING (id = (SELECT auth.uid()))
WITH CHECK (
  id = (SELECT auth.uid())
  AND tenant_id IS NOT DISTINCT FROM (
    SELECT p.tenant_id FROM public.profiles p WHERE p.id = (SELECT auth.uid())
  )
);

-- -----------------------------------------------------------------------------
-- 2. Tenant lifecycle is a real authorization boundary for tenant users.
--    Super-admins retain central visibility so they can suspend/renew projects.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "tenants read own" ON public.tenants;
CREATE POLICY "tenants read own active" ON public.tenants
FOR SELECT TO authenticated
USING (
  public.is_super_admin((SELECT auth.uid()))
  OR (id = public.current_tenant_id() AND public.can_access_tenant(id))
);

DROP POLICY IF EXISTS "subscribers tenant read" ON public.subscribers;
CREATE POLICY "subscribers tenant read" ON public.subscribers
FOR SELECT TO authenticated
USING (
  public.is_super_admin((SELECT auth.uid()))
  OR (tenant_id = public.current_tenant_id() AND public.can_access_tenant(tenant_id))
);

DROP POLICY IF EXISTS "subscribers tenant write" ON public.subscribers;
CREATE POLICY "subscribers tenant write" ON public.subscribers
FOR INSERT TO authenticated
WITH CHECK (
  tenant_id = public.current_tenant_id()
  AND public.can_access_tenant(tenant_id)
  AND public.has_role((SELECT auth.uid()), 'project_manager')
);

DROP POLICY IF EXISTS "subscribers tenant update" ON public.subscribers;
CREATE POLICY "subscribers tenant update" ON public.subscribers
FOR UPDATE TO authenticated
USING (
  tenant_id = public.current_tenant_id()
  AND public.can_access_tenant(tenant_id)
  AND public.has_role((SELECT auth.uid()), 'project_manager')
)
WITH CHECK (
  tenant_id = public.current_tenant_id()
  AND public.can_access_tenant(tenant_id)
  AND public.has_role((SELECT auth.uid()), 'project_manager')
);

DROP POLICY IF EXISTS "readings tenant read" ON public.meter_readings;
CREATE POLICY "readings tenant read" ON public.meter_readings
FOR SELECT TO authenticated
USING (
  public.is_super_admin((SELECT auth.uid()))
  OR (tenant_id = public.current_tenant_id() AND public.can_access_tenant(tenant_id))
);

DROP POLICY IF EXISTS "readings insert by reader" ON public.meter_readings;
CREATE POLICY "readings insert by reader" ON public.meter_readings
FOR INSERT TO authenticated
WITH CHECK (
  tenant_id = public.current_tenant_id()
  AND public.can_access_tenant(tenant_id)
  AND reader_id = (SELECT auth.uid())
  AND (
    public.has_role((SELECT auth.uid()), 'meter_reader')
    OR public.has_role((SELECT auth.uid()), 'project_manager')
  )
);

DROP POLICY IF EXISTS "receipts tenant read" ON public.receipts;
CREATE POLICY "receipts tenant read" ON public.receipts
FOR SELECT TO authenticated
USING (
  public.is_super_admin((SELECT auth.uid()))
  OR (tenant_id = public.current_tenant_id() AND public.can_access_tenant(tenant_id))
);

DROP POLICY IF EXISTS "receipts insert by collector" ON public.receipts;
CREATE POLICY "receipts insert by collector" ON public.receipts
FOR INSERT TO authenticated
WITH CHECK (
  tenant_id = public.current_tenant_id()
  AND public.can_access_tenant(tenant_id)
  AND collector_id = (SELECT auth.uid())
  AND (
    public.has_role((SELECT auth.uid()), 'financial_collector')
    OR public.has_role((SELECT auth.uid()), 'project_manager')
  )
);

DROP POLICY IF EXISTS "billing tenant read" ON public.billing_logs;
CREATE POLICY "billing tenant read" ON public.billing_logs
FOR SELECT TO authenticated
USING (
  public.is_super_admin((SELECT auth.uid()))
  OR (tenant_id = public.current_tenant_id() AND public.can_access_tenant(tenant_id))
);

DROP POLICY IF EXISTS "billing tenant write" ON public.billing_logs;
CREATE POLICY "billing tenant write" ON public.billing_logs
FOR INSERT TO authenticated
WITH CHECK (
  tenant_id = public.current_tenant_id()
  AND public.can_access_tenant(tenant_id)
  AND public.has_role((SELECT auth.uid()), 'project_manager')
);

-- -----------------------------------------------------------------------------
-- 3. Financial records: payment allocation may change paid_amount_yer/paid,
--    but a paid invoice's identity and charge amount can never be rewritten.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prevent_paid_invoice_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') AND OLD.paid_amount_yer > 0 THEN
    IF TG_OP = 'DELETE'
       OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
       OR NEW.subscriber_id IS DISTINCT FROM OLD.subscriber_id
       OR NEW.period IS DISTINCT FROM OLD.period
       OR NEW.consumption_m3 IS DISTINCT FROM OLD.consumption_m3
       OR NEW.amount_yer IS DISTINCT FROM OLD.amount_yer
       OR NEW.current_due_yer IS DISTINCT FROM OLD.current_due_yer
       OR NEW.previous_arrears_yer IS DISTINCT FROM OLD.previous_arrears_yer THEN
      RAISE EXCEPTION 'Paid invoice is immutable; create an explicit adjustment instead';
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- -----------------------------------------------------------------------------
-- 4. Meter evidence is append-only from browser clients.
-- -----------------------------------------------------------------------------
REVOKE UPDATE, DELETE, TRUNCATE ON public.meter_readings FROM authenticated, anon;
REVOKE UPDATE, DELETE, TRUNCATE ON public.receipts FROM authenticated, anon;

REVOKE UPDATE, DELETE, TRUNCATE ON storage.objects FROM authenticated, anon;
DROP POLICY IF EXISTS "meter photos tenant update" ON storage.objects;

-- -----------------------------------------------------------------------------
-- 5. Keep the database's role model at one operational account per role per
--    tenant and prevent one account from holding multiple tenant assignments.
-- -----------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS user_roles_one_user_tenant_uidx
ON public.user_roles (user_id, tenant_id)
WHERE tenant_id IS NOT NULL AND role <> 'super_admin'::public.app_role;
