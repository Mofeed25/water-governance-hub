-- Close privileged RPC surfaces left by the prototype migrations.

CREATE OR REPLACE FUNCTION public.recompute_subscriber_balance(_subscriber_id UUID)
RETURNS VOID
LANGUAGE SQL SECURITY DEFINER SET search_path = ''
AS $$
  UPDATE public.subscribers s
  SET balance_yer = COALESCE((
    SELECT SUM(GREATEST(bl.amount_yer - bl.paid_amount_yer, 0))
    FROM public.billing_logs bl
    WHERE bl.subscriber_id = _subscriber_id
      AND bl.tenant_id = s.tenant_id
  ), 0)
  WHERE s.id = _subscriber_id;
$$;
REVOKE ALL ON FUNCTION public.recompute_subscriber_balance(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_subscriber_balance(uuid) TO service_role;

-- generate_invoice is an internal primitive invoked by trusted database triggers
-- and by the controlled tenant-level generator. It must not be callable directly
-- by an authenticated browser session.
REVOKE ALL ON FUNCTION public.generate_invoice(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_invoice(uuid,text) TO service_role;

-- Tenant-wide invoice generation is a privileged operation. Keep the existing
-- authorization check but remove default PUBLIC execution.
REVOKE ALL ON FUNCTION public.generate_invoices_for_tenant(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_invoices_for_tenant(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_invoices_for_tenant(uuid,text) TO service_role;

-- Harden the administrative user listing function.
CREATE OR REPLACE FUNCTION public.admin_list_users()
RETURNS TABLE (id uuid, email text, full_name text, tenant_id uuid, tenant_name text, roles text[])
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_super_admin((SELECT auth.uid())) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  RETURN QUERY
  SELECT u.id,
         u.email::text,
         p.full_name,
         p.tenant_id,
         t.name,
         COALESCE(ARRAY(
           SELECT ur.role::text
           FROM public.user_roles ur
           WHERE ur.user_id=u.id
           ORDER BY ur.role::text
         ), '{}')
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.id=u.id
  LEFT JOIN public.tenants t ON t.id=p.tenant_id
  ORDER BY u.created_at;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_list_users() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_users() TO authenticated;

-- Keep direct role reads available only to the owning user/super admin via RLS;
-- no write path exists from the browser.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.user_roles FROM authenticated, anon;

-- No browser client should be able to alter immutable audit records.
REVOKE UPDATE, DELETE, TRUNCATE ON public.meter_readings FROM authenticated, anon;
REVOKE UPDATE, DELETE, TRUNCATE ON public.receipts FROM authenticated, anon;
