
-- ============ ENUMS ============
CREATE TYPE public.app_role AS ENUM ('super_admin','central_admin','project_manager','meter_reader','financial_collector');
CREATE TYPE public.subscription_tier AS ENUM ('free','premium');
CREATE TYPE public.tenant_status AS ENUM ('active','suspended');

-- ============ TENANTS ============
CREATE TABLE public.tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  directorate TEXT,
  established_year INT,
  households INT DEFAULT 0,
  tariff_per_m3 NUMERIC(10,2) DEFAULT 250,
  subscription_tier public.subscription_tier NOT NULL DEFAULT 'free',
  status public.tenant_status NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenants TO authenticated;
GRANT ALL ON public.tenants TO service_role;
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;

-- ============ PROFILES ============
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE SET NULL,
  full_name TEXT,
  phone TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- ============ USER ROLES ============
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role, tenant_id)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- ============ SECURITY DEFINER HELPERS ============
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

CREATE OR REPLACE FUNCTION public.is_super_admin(_user_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = 'super_admin');
$$;

CREATE OR REPLACE FUNCTION public.current_tenant_id()
RETURNS UUID LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT tenant_id FROM public.profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.tenant_is_active(_tenant_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT status = 'active' FROM public.tenants WHERE id = _tenant_id), false);
$$;

CREATE OR REPLACE FUNCTION public.can_access_tenant(_tenant_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_super_admin(auth.uid())
      OR (_tenant_id = public.current_tenant_id() AND public.tenant_is_active(_tenant_id));
$$;

-- Signup trigger
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email));
  RETURN NEW;
END;
$$;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============ POLICIES: profiles / tenants / user_roles ============
CREATE POLICY "profiles self read" ON public.profiles FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.is_super_admin(auth.uid()));
CREATE POLICY "profiles self update" ON public.profiles FOR UPDATE TO authenticated
  USING (id = auth.uid() OR public.is_super_admin(auth.uid()))
  WITH CHECK (id = auth.uid() OR public.is_super_admin(auth.uid()));
CREATE POLICY "profiles self insert" ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid() OR public.is_super_admin(auth.uid()));

CREATE POLICY "tenants read" ON public.tenants FOR SELECT TO authenticated
  USING (id = public.current_tenant_id() OR public.is_super_admin(auth.uid()));
CREATE POLICY "tenants admin write" ON public.tenants FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin(auth.uid()));
CREATE POLICY "tenants admin update" ON public.tenants FOR UPDATE TO authenticated
  USING (public.is_super_admin(auth.uid())) WITH CHECK (public.is_super_admin(auth.uid()));
CREATE POLICY "tenants admin delete" ON public.tenants FOR DELETE TO authenticated
  USING (public.is_super_admin(auth.uid()));

CREATE POLICY "user_roles read own" ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_super_admin(auth.uid()));
CREATE POLICY "user_roles admin write" ON public.user_roles FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin(auth.uid()));
CREATE POLICY "user_roles admin delete" ON public.user_roles FOR DELETE TO authenticated
  USING (public.is_super_admin(auth.uid()));

-- ============ SUBSCRIBERS ============
CREATE TABLE public.subscribers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  zone TEXT,
  meter_serial TEXT UNIQUE NOT NULL,
  phone TEXT,
  household_size INT DEFAULT 1,
  balance_yer NUMERIC(12,2) DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','arrears','disconnected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON public.subscribers(tenant_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.subscribers TO authenticated;
GRANT ALL ON public.subscribers TO service_role;
ALTER TABLE public.subscribers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "subscribers tenant read" ON public.subscribers FOR SELECT TO authenticated
  USING (public.can_access_tenant(tenant_id));
CREATE POLICY "subscribers manager insert" ON public.subscribers FOR INSERT TO authenticated
  WITH CHECK (public.can_access_tenant(tenant_id)
    AND (public.is_super_admin(auth.uid()) OR public.has_role(auth.uid(),'central_admin') OR public.has_role(auth.uid(),'project_manager')));
CREATE POLICY "subscribers manager update" ON public.subscribers FOR UPDATE TO authenticated
  USING (public.can_access_tenant(tenant_id)
    AND (public.is_super_admin(auth.uid()) OR public.has_role(auth.uid(),'central_admin') OR public.has_role(auth.uid(),'project_manager') OR public.has_role(auth.uid(),'financial_collector')));

-- ============ METER READINGS ============
CREATE TABLE public.meter_readings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  subscriber_id UUID NOT NULL REFERENCES public.subscribers(id) ON DELETE CASCADE,
  reader_id UUID REFERENCES auth.users(id),
  reading_m3 NUMERIC(12,2) NOT NULL,
  previous_m3 NUMERIC(12,2) DEFAULT 0,
  consumption_m3 NUMERIC(12,2) GENERATED ALWAYS AS (GREATEST(reading_m3 - COALESCE(previous_m3,0), 0)) STORED,
  period TEXT,
  gps_lat NUMERIC(10,6),
  gps_lng NUMERIC(10,6),
  photo_url TEXT,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON public.meter_readings(tenant_id);
CREATE INDEX ON public.meter_readings(subscriber_id, captured_at DESC);
GRANT SELECT, INSERT ON public.meter_readings TO authenticated;
GRANT ALL ON public.meter_readings TO service_role;
ALTER TABLE public.meter_readings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "readings tenant read" ON public.meter_readings FOR SELECT TO authenticated
  USING (public.can_access_tenant(tenant_id));
CREATE POLICY "readings insert" ON public.meter_readings FOR INSERT TO authenticated
  WITH CHECK (public.can_access_tenant(tenant_id)
    AND (public.is_super_admin(auth.uid()) OR public.has_role(auth.uid(),'meter_reader') OR public.has_role(auth.uid(),'project_manager')));

-- ============ RECEIPTS ============
CREATE TABLE public.receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  subscriber_id UUID NOT NULL REFERENCES public.subscribers(id) ON DELETE CASCADE,
  collector_id UUID REFERENCES auth.users(id),
  amount_yer NUMERIC(12,2) NOT NULL,
  amount_words_ar TEXT,
  period TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON public.receipts(tenant_id);
GRANT SELECT, INSERT ON public.receipts TO authenticated;
GRANT ALL ON public.receipts TO service_role;
ALTER TABLE public.receipts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "receipts tenant read" ON public.receipts FOR SELECT TO authenticated
  USING (public.can_access_tenant(tenant_id));
CREATE POLICY "receipts insert" ON public.receipts FOR INSERT TO authenticated
  WITH CHECK (public.can_access_tenant(tenant_id)
    AND (public.is_super_admin(auth.uid()) OR public.has_role(auth.uid(),'financial_collector') OR public.has_role(auth.uid(),'project_manager')));

-- ============ BILLING LOGS (invoices) ============
CREATE TABLE public.billing_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  subscriber_id UUID NOT NULL REFERENCES public.subscribers(id) ON DELETE CASCADE,
  period TEXT NOT NULL,
  consumption_m3 NUMERIC(12,2) NOT NULL DEFAULT 0,
  current_due_yer NUMERIC(12,2) NOT NULL DEFAULT 0,
  previous_arrears_yer NUMERIC(12,2) NOT NULL DEFAULT 0,
  amount_yer NUMERIC(12,2) NOT NULL DEFAULT 0,
  paid_amount_yer NUMERIC(12,2) NOT NULL DEFAULT 0,
  paid BOOLEAN NOT NULL DEFAULT false,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (subscriber_id, period)
);
CREATE INDEX ON public.billing_logs(tenant_id);
GRANT SELECT, INSERT, UPDATE ON public.billing_logs TO authenticated;
GRANT ALL ON public.billing_logs TO service_role;
ALTER TABLE public.billing_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "billing tenant read" ON public.billing_logs FOR SELECT TO authenticated
  USING (public.can_access_tenant(tenant_id));
CREATE POLICY "billing manager write" ON public.billing_logs FOR INSERT TO authenticated
  WITH CHECK (public.can_access_tenant(tenant_id)
    AND (public.is_super_admin(auth.uid()) OR public.has_role(auth.uid(),'project_manager') OR public.has_role(auth.uid(),'central_admin') OR public.has_role(auth.uid(),'financial_collector')));
CREATE POLICY "billing collector update" ON public.billing_logs FOR UPDATE TO authenticated
  USING (public.can_access_tenant(tenant_id)
    AND (public.is_super_admin(auth.uid()) OR public.has_role(auth.uid(),'project_manager') OR public.has_role(auth.uid(),'financial_collector')));

-- ============ SUBSCRIPTIONS ============
CREATE TABLE public.subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  tier public.subscription_tier NOT NULL DEFAULT 'free',
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.subscriptions TO authenticated;
GRANT ALL ON public.subscriptions TO service_role;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "subs read" ON public.subscriptions FOR SELECT TO authenticated
  USING (public.can_access_tenant(tenant_id));
CREATE POLICY "subs admin write" ON public.subscriptions FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid())) WITH CHECK (public.is_super_admin(auth.uid()));

-- ============ CHAT ============
CREATE TABLE public.chat_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
  title TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_conversations TO authenticated;
GRANT ALL ON public.chat_conversations TO service_role;
ALTER TABLE public.chat_conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "chat conv own" ON public.chat_conversations FOR ALL TO authenticated
  USING (user_id = auth.uid() AND (public.is_super_admin(auth.uid()) OR public.has_role(auth.uid(),'project_manager') OR public.has_role(auth.uid(),'central_admin')))
  WITH CHECK (user_id = auth.uid() AND (public.is_super_admin(auth.uid()) OR public.has_role(auth.uid(),'project_manager') OR public.has_role(auth.uid(),'central_admin')));

CREATE TABLE public.chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.chat_conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user','assistant','system','tool')),
  content TEXT NOT NULL,
  ui_data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON public.chat_messages(conversation_id, created_at);
GRANT SELECT, INSERT ON public.chat_messages TO authenticated;
GRANT ALL ON public.chat_messages TO service_role;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "chat msg own" ON public.chat_messages FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.chat_conversations c WHERE c.id = conversation_id AND c.user_id = auth.uid()));
CREATE POLICY "chat msg insert own" ON public.chat_messages FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.chat_conversations c WHERE c.id = conversation_id AND c.user_id = auth.uid()));

-- ============ REALTIME ============
ALTER PUBLICATION supabase_realtime ADD TABLE public.subscribers;
ALTER PUBLICATION supabase_realtime ADD TABLE public.meter_readings;
ALTER PUBLICATION supabase_realtime ADD TABLE public.receipts;
ALTER PUBLICATION supabase_realtime ADD TABLE public.billing_logs;
ALTER TABLE public.subscribers REPLICA IDENTITY FULL;
ALTER TABLE public.meter_readings REPLICA IDENTITY FULL;
ALTER TABLE public.receipts REPLICA IDENTITY FULL;
ALTER TABLE public.billing_logs REPLICA IDENTITY FULL;
