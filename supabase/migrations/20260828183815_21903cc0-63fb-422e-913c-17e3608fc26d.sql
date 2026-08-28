
-- 1) Bootstrap the first super admin
CREATE OR REPLACE FUNCTION public.bootstrap_super_admin()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'super_admin') THEN
    RETURN false;
  END IF;
  INSERT INTO public.user_roles (user_id, role) VALUES (v_uid, 'super_admin')
  ON CONFLICT (user_id, role) DO NOTHING;
  RETURN true;
END $$;

REVOKE ALL ON FUNCTION public.bootstrap_super_admin() FROM public;
GRANT EXECUTE ON FUNCTION public.bootstrap_super_admin() TO authenticated;

CREATE OR REPLACE FUNCTION public.super_admin_exists()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'super_admin') $$;

REVOKE ALL ON FUNCTION public.super_admin_exists() FROM public;
GRANT EXECUTE ON FUNCTION public.super_admin_exists() TO authenticated;

-- 2) List platform users (super admin only)
CREATE OR REPLACE FUNCTION public.admin_list_users()
RETURNS TABLE (id uuid, email text, full_name text, tenant_id uuid, tenant_name text, roles text[])
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  RETURN QUERY
  SELECT u.id,
         u.email::text,
         p.full_name,
         p.tenant_id,
         t.name,
         COALESCE(ARRAY(SELECT ur.role::text FROM public.user_roles ur WHERE ur.user_id = u.id ORDER BY 1), '{}')
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.id = u.id
  LEFT JOIN public.tenants t ON t.id = p.tenant_id
  ORDER BY u.created_at;
END $$;

REVOKE ALL ON FUNCTION public.admin_list_users() FROM public;
GRANT EXECUTE ON FUNCTION public.admin_list_users() TO authenticated;

-- 3) Assign access
CREATE OR REPLACE FUNCTION public.admin_set_user_access(_user_id uuid, _tenant_id uuid, _role app_role)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  UPDATE public.profiles SET tenant_id = _tenant_id WHERE id = _user_id;
  IF NOT FOUND THEN
    INSERT INTO public.profiles (id, tenant_id) VALUES (_user_id, _tenant_id);
  END IF;
  IF _role IS NOT NULL THEN
    INSERT INTO public.user_roles (user_id, role, tenant_id)
    VALUES (_user_id, _role, _tenant_id)
    ON CONFLICT (user_id, role) DO UPDATE SET tenant_id = EXCLUDED.tenant_id;
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.admin_set_user_access(uuid, uuid, app_role) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_set_user_access(uuid, uuid, app_role) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_revoke_role(_user_id uuid, _role app_role)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  DELETE FROM public.user_roles WHERE user_id = _user_id AND role = _role;
END $$;

REVOKE ALL ON FUNCTION public.admin_revoke_role(uuid, app_role) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_revoke_role(uuid, app_role) TO authenticated;
