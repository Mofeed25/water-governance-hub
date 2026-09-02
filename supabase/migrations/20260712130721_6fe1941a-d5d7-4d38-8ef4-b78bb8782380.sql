-- Compatibility migration.
-- The original repository contained a second copy of the initial schema here,
-- which attempted to recreate existing enums/tables. This version evolves the
-- first migration instead, so a clean database can replay the migration chain.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typnamespace='public'::regnamespace AND typname='subscription_tier') THEN
    CREATE TYPE public.subscription_tier AS ENUM ('free','premium');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typnamespace='public'::regnamespace AND typname='tenant_status') THEN
    CREATE TYPE public.tenant_status AS ENUM ('active','suspended');
  END IF;
END $$;

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS subscription_tier public.subscription_tier NOT NULL DEFAULT 'free';
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS status public.tenant_status NOT NULL DEFAULT 'active';

ALTER TABLE public.subscribers ADD COLUMN IF NOT EXISTS phone TEXT;

ALTER TABLE public.meter_readings ADD COLUMN IF NOT EXISTS period TEXT;
ALTER TABLE public.meter_readings
  ADD COLUMN IF NOT EXISTS consumption_m3 NUMERIC(12,2)
  GENERATED ALWAYS AS (GREATEST(reading_m3 - COALESCE(previous_m3,0), 0)) STORED;

ALTER TABLE public.billing_logs ADD COLUMN IF NOT EXISTS current_due_yer NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE public.billing_logs ADD COLUMN IF NOT EXISTS previous_arrears_yer NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE public.billing_logs ADD COLUMN IF NOT EXISTS paid_amount_yer NUMERIC(12,2) NOT NULL DEFAULT 0;

UPDATE public.billing_logs
SET current_due_yer = amount_yer
WHERE current_due_yer = 0 AND amount_yer <> 0;
UPDATE public.billing_logs
SET paid_amount_yer = CASE WHEN paid THEN amount_yer ELSE 0 END
WHERE paid_amount_yer = 0 AND paid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname='billing_logs_subscriber_period_key'
  ) THEN
    ALTER TABLE public.billing_logs
      ADD CONSTRAINT billing_logs_subscriber_period_key UNIQUE (subscriber_id, period);
  END IF;
END $$;

-- Project subscriptions.
CREATE TABLE IF NOT EXISTS public.subscriptions (
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
DROP POLICY IF EXISTS "subs read" ON public.subscriptions;
DROP POLICY IF EXISTS "subs admin write" ON public.subscriptions;
CREATE POLICY "subs read" ON public.subscriptions FOR SELECT TO authenticated
  USING (id IS NOT NULL AND (tenant_id = public.current_tenant_id() OR public.is_super_admin(auth.uid())));
CREATE POLICY "subs admin write" ON public.subscriptions FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid())) WITH CHECK (public.is_super_admin(auth.uid()));

-- Tenant-scoped helper used by the later hardened policies.
CREATE OR REPLACE FUNCTION public.tenant_is_active(_tenant_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT t.status = 'active' FROM public.tenants t WHERE t.id = _tenant_id), false);
$$;
CREATE OR REPLACE FUNCTION public.can_access_tenant(_tenant_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_super_admin(auth.uid())
      OR (_tenant_id = public.current_tenant_id() AND public.tenant_is_active(_tenant_id));
$$;
REVOKE ALL ON FUNCTION public.tenant_is_active(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_access_tenant(uuid) FROM PUBLIC, anon;

-- Chat persistence.
CREATE TABLE IF NOT EXISTS public.chat_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
  title TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_chat_conversations_user ON public.chat_conversations(user_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_conversations TO authenticated;
GRANT ALL ON public.chat_conversations TO service_role;
ALTER TABLE public.chat_conversations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "chat conv own" ON public.chat_conversations;
CREATE POLICY "chat conv own" ON public.chat_conversations FOR ALL TO authenticated
  USING (user_id = auth.uid() AND (public.is_super_admin(auth.uid()) OR public.has_role(auth.uid(),'project_manager') OR public.has_role(auth.uid(),'central_admin')))
  WITH CHECK (user_id = auth.uid() AND (public.is_super_admin(auth.uid()) OR public.has_role(auth.uid(),'project_manager') OR public.has_role(auth.uid(),'central_admin')));

CREATE TABLE IF NOT EXISTS public.chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.chat_conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user','assistant','system','tool')),
  content TEXT NOT NULL,
  ui_data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation ON public.chat_messages(conversation_id, created_at);
GRANT SELECT, INSERT ON public.chat_messages TO authenticated;
GRANT ALL ON public.chat_messages TO service_role;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "chat msg own" ON public.chat_messages;
DROP POLICY IF EXISTS "chat msg insert own" ON public.chat_messages;
CREATE POLICY "chat msg own" ON public.chat_messages FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.chat_conversations c WHERE c.id=conversation_id AND c.user_id=auth.uid()));
CREATE POLICY "chat msg insert own" ON public.chat_messages FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.chat_conversations c WHERE c.id=conversation_id AND c.user_id=auth.uid()));

ALTER TABLE public.subscribers REPLICA IDENTITY FULL;
ALTER TABLE public.meter_readings REPLICA IDENTITY FULL;
ALTER TABLE public.receipts REPLICA IDENTITY FULL;
ALTER TABLE public.billing_logs REPLICA IDENTITY FULL;
DO $$
BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.subscribers; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.meter_readings; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.receipts; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.billing_logs; EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;
