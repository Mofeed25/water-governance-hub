-- Central administration must mutate tenant lifecycle through a server-authorized RPC.
CREATE OR REPLACE FUNCTION public.admin_manage_tenant(
  _tenant_id UUID,
  _action TEXT,
  _subscription_tier public.subscription_tier DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now TIMESTAMPTZ := clock_timestamp();
  v_expiry TIMESTAMPTZ;
BEGIN
  IF NOT public.is_super_admin((SELECT auth.uid())) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = _tenant_id) THEN RAISE EXCEPTION 'Tenant does not exist'; END IF;

  CASE _action
    WHEN 'suspend' THEN
      UPDATE public.tenants SET status = 'suspended'::public.tenant_status WHERE id = _tenant_id;
    WHEN 'activate' THEN
      UPDATE public.tenants SET status = 'active'::public.tenant_status WHERE id = _tenant_id;
    WHEN 'renew' THEN
      SELECT subscription_expires_at INTO v_expiry FROM public.tenants WHERE id = _tenant_id FOR UPDATE;
      v_expiry := GREATEST(COALESCE(v_expiry, v_now), v_now) + INTERVAL '1 year';
      UPDATE public.tenants SET status = 'active'::public.tenant_status, subscription_started_at = v_now, subscription_expires_at = v_expiry WHERE id = _tenant_id;
    WHEN 'tier' THEN
      IF _subscription_tier IS NULL THEN RAISE EXCEPTION 'Subscription tier is required'; END IF;
      UPDATE public.tenants SET subscription_tier = _subscription_tier WHERE id = _tenant_id;
    ELSE RAISE EXCEPTION 'Unknown tenant action';
  END CASE;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_manage_tenant(uuid,text,public.subscription_tier) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_manage_tenant(uuid,text,public.subscription_tier) TO authenticated;

-- A project is accessible only while active and within its subscription period.
CREATE OR REPLACE FUNCTION public.tenant_is_active(_tenant_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE((
    SELECT t.status = 'active'::public.tenant_status
      AND (t.subscription_expires_at IS NULL OR t.subscription_expires_at > clock_timestamp())
    FROM public.tenants t WHERE t.id = _tenant_id
  ), false);
$$;
REVOKE ALL ON FUNCTION public.tenant_is_active(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tenant_is_active(uuid) TO authenticated;
