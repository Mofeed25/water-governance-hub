-- Production hardening for MIZAN / Water Governance Hub.
-- This migration is deliberately additive and safe for an already-populated deployment.

-- -----------------------------------------------------------------------------
-- 1. Required extension for server-side integrity digests.
-- -----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- -----------------------------------------------------------------------------
-- 2. Make the data model internally consistent when older migrations were
--    applied from the original prototype schema.
-- -----------------------------------------------------------------------------
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS subscription_tier public.subscription_tier NOT NULL DEFAULT 'free';
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS status public.tenant_status NOT NULL DEFAULT 'active';

ALTER TABLE public.subscribers
  ADD COLUMN IF NOT EXISTS phone TEXT;

ALTER TABLE public.meter_readings
  ADD COLUMN IF NOT EXISTS period TEXT;
ALTER TABLE public.meter_readings
  ADD COLUMN IF NOT EXISTS consumption_m3 NUMERIC(12,2);
ALTER TABLE public.meter_readings
  ADD COLUMN IF NOT EXISTS hash_signature TEXT;

ALTER TABLE public.receipts
  ADD COLUMN IF NOT EXISTS hash_signature TEXT;

ALTER TABLE public.billing_logs
  ADD COLUMN IF NOT EXISTS current_due_yer NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE public.billing_logs
  ADD COLUMN IF NOT EXISTS previous_arrears_yer NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE public.billing_logs
  ADD COLUMN IF NOT EXISTS paid_amount_yer NUMERIC(12,2) NOT NULL DEFAULT 0;

-- Backfill billing columns when the older schema used only amount_yer/paid.
UPDATE public.billing_logs
SET current_due_yer = amount_yer
WHERE current_due_yer = 0 AND amount_yer > 0 AND previous_arrears_yer = 0;
UPDATE public.billing_logs
SET paid_amount_yer = CASE WHEN paid THEN amount_yer ELSE 0 END
WHERE paid_amount_yer = 0 AND paid;

-- If consumption_m3 is a normal column, backfill it. If it is generated, this
-- UPDATE is intentionally skipped by the DO block below.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='meter_readings'
      AND column_name='consumption_m3' AND is_generated='NEVER'
  ) THEN
    UPDATE public.meter_readings
    SET consumption_m3 = GREATEST(reading_m3 - COALESCE(previous_m3,0), 0)
    WHERE consumption_m3 IS NULL;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 3. Strong tenant integrity: child records cannot point at a subscriber from
--    another project, even if a caller supplies a forged tenant_id.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='subscribers_tenant_id_id_key'
      AND conrelid='public.subscribers'::regclass
  ) THEN
    ALTER TABLE public.subscribers
      ADD CONSTRAINT subscribers_tenant_id_id_key UNIQUE (tenant_id, id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='meter_readings_tenant_subscriber_fk'
      AND conrelid='public.meter_readings'::regclass
  ) THEN
    ALTER TABLE public.meter_readings
      ADD CONSTRAINT meter_readings_tenant_subscriber_fk
      FOREIGN KEY (tenant_id, subscriber_id)
      REFERENCES public.subscribers(tenant_id, id)
      ON DELETE CASCADE NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='receipts_tenant_subscriber_fk'
      AND conrelid='public.receipts'::regclass
  ) THEN
    ALTER TABLE public.receipts
      ADD CONSTRAINT receipts_tenant_subscriber_fk
      FOREIGN KEY (tenant_id, subscriber_id)
      REFERENCES public.subscribers(tenant_id, id)
      ON DELETE CASCADE NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='billing_logs_tenant_subscriber_fk'
      AND conrelid='public.billing_logs'::regclass
  ) THEN
    ALTER TABLE public.billing_logs
      ADD CONSTRAINT billing_logs_tenant_subscriber_fk
      FOREIGN KEY (tenant_id, subscriber_id)
      REFERENCES public.subscribers(tenant_id, id)
      ON DELETE CASCADE NOT VALID;
  END IF;
END $$;

ALTER TABLE public.meter_readings VALIDATE CONSTRAINT meter_readings_tenant_subscriber_fk;
ALTER TABLE public.receipts VALIDATE CONSTRAINT receipts_tenant_subscriber_fk;
ALTER TABLE public.billing_logs VALIDATE CONSTRAINT billing_logs_tenant_subscriber_fk;

-- -----------------------------------------------------------------------------
-- 4. Integrity checks for operational and financial values.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='tenants_tariff_nonnegative') THEN
    ALTER TABLE public.tenants ADD CONSTRAINT tenants_tariff_nonnegative CHECK (tariff_per_m3 >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='subscribers_household_positive') THEN
    ALTER TABLE public.subscribers ADD CONSTRAINT subscribers_household_positive CHECK (household_size >= 1);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='subscribers_balance_nonnegative') THEN
    ALTER TABLE public.subscribers ADD CONSTRAINT subscribers_balance_nonnegative CHECK (balance_yer >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='meter_readings_nonnegative') THEN
    ALTER TABLE public.meter_readings ADD CONSTRAINT meter_readings_nonnegative CHECK (reading_m3 >= 0 AND COALESCE(previous_m3,0) >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='meter_readings_gps_latitude') THEN
    ALTER TABLE public.meter_readings ADD CONSTRAINT meter_readings_gps_latitude CHECK (gps_lat IS NULL OR gps_lat BETWEEN -90 AND 90);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='meter_readings_gps_longitude') THEN
    ALTER TABLE public.meter_readings ADD CONSTRAINT meter_readings_gps_longitude CHECK (gps_lng IS NULL OR gps_lng BETWEEN -180 AND 180);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='receipts_amount_positive') THEN
    ALTER TABLE public.receipts ADD CONSTRAINT receipts_amount_positive CHECK (amount_yer > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='billing_amounts_valid') THEN
    ALTER TABLE public.billing_logs ADD CONSTRAINT billing_amounts_valid
      CHECK (current_due_yer >= 0 AND previous_arrears_yer >= 0 AND amount_yer >= 0 AND paid_amount_yer >= 0 AND paid_amount_yer <= amount_yer);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='billing_period_format') THEN
    ALTER TABLE public.billing_logs ADD CONSTRAINT billing_period_format
      CHECK (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 5. Security-definer functions: pin search_path and enforce tenant-scoped
--    roles. This follows Supabase's recommended pattern.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = _user_id
      AND ur.role = _role
      AND (
        ur.role = 'super_admin'::public.app_role
        OR ur.tenant_id = public.current_tenant_id()
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.is_super_admin(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = _user_id AND ur.role = 'super_admin'::public.app_role
  );
$$;

CREATE OR REPLACE FUNCTION public.current_tenant_id()
RETURNS UUID
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT p.tenant_id FROM public.profiles p WHERE p.id = (SELECT auth.uid());
$$;

CREATE OR REPLACE FUNCTION public.tenant_is_active(_tenant_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT COALESCE((SELECT t.status = 'active'::public.tenant_status FROM public.tenants t WHERE t.id = _tenant_id), false);
$$;

CREATE OR REPLACE FUNCTION public.can_access_tenant(_tenant_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT public.is_super_admin((SELECT auth.uid()))
      OR (_tenant_id = public.current_tenant_id() AND public.tenant_is_active(_tenant_id));
$$;

REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_super_admin(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.current_tenant_id() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tenant_is_active(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_access_tenant(uuid) FROM PUBLIC, anon;

-- -----------------------------------------------------------------------------
-- 6. Prevent self-escalation: the old first-user bootstrap endpoint is removed
--    from the public Data API. Initial provisioning must be performed by a
--    trusted operator using the Supabase SQL editor/service role.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bootstrap_super_admin()
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'Bootstrap is disabled in production. Provision the first super admin through a trusted server-side/admin operation.';
END;
$$;
REVOKE ALL ON FUNCTION public.bootstrap_super_admin() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.super_admin_exists() FROM PUBLIC, anon, authenticated;

-- Super-admin operations are server-authorized and cannot target a different
-- user's role in a way that leaves the platform without an administrator.
CREATE OR REPLACE FUNCTION public.admin_set_user_access(_user_id UUID, _tenant_id UUID, _role public.app_role)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_super_admin((SELECT auth.uid())) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF _user_id IS NULL THEN RAISE EXCEPTION 'user_id is required'; END IF;
  IF _tenant_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = _tenant_id) THEN
    RAISE EXCEPTION 'Tenant does not exist';
  END IF;
  IF _role IS NULL THEN
    UPDATE public.profiles SET tenant_id = _tenant_id WHERE id = _user_id;
  ELSE
    UPDATE public.profiles SET tenant_id = _tenant_id WHERE id = _user_id;
    IF NOT FOUND THEN
      INSERT INTO public.profiles (id, tenant_id) VALUES (_user_id, _tenant_id);
    END IF;
    INSERT INTO public.user_roles (user_id, role, tenant_id)
    VALUES (_user_id, _role, _tenant_id)
    ON CONFLICT (user_id, role) DO UPDATE SET tenant_id = EXCLUDED.tenant_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_revoke_role(_user_id UUID, _role public.app_role)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_super_admin((SELECT auth.uid())) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF _user_id = (SELECT auth.uid()) AND _role = 'super_admin'::public.app_role THEN
    RAISE EXCEPTION 'You cannot remove your own super_admin role';
  END IF;
  IF _role = 'super_admin'::public.app_role
     AND (SELECT count(*) FROM public.user_roles WHERE role='super_admin'::public.app_role) <= 1 THEN
    RAISE EXCEPTION 'The platform must retain at least one super_admin';
  END IF;
  DELETE FROM public.user_roles WHERE user_id = _user_id AND role = _role;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_user_access(uuid, uuid, public.app_role) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_revoke_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_user_access(uuid, uuid, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_revoke_role(uuid, public.app_role) TO authenticated;

-- -----------------------------------------------------------------------------
-- 7. Server-side meter integrity. consumption_m3 is generated when possible;
--    the trigger only changes base fields and never writes a generated column.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.meter_readings_fill()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_prev NUMERIC;
BEGIN
  IF NEW.captured_at IS NULL THEN NEW.captured_at := clock_timestamp(); END IF;
  IF NEW.previous_m3 IS NULL THEN
    SELECT mr.reading_m3 INTO v_prev
    FROM public.meter_readings mr
    WHERE mr.subscriber_id = NEW.subscriber_id
    ORDER BY mr.captured_at DESC, mr.id DESC
    LIMIT 1;
    NEW.previous_m3 := COALESCE(v_prev, 0);
  END IF;
  IF NEW.reading_m3 < COALESCE(NEW.previous_m3,0) THEN
    RAISE EXCEPTION 'Meter reading cannot be lower than the previous reading; record a meter replacement/reset event instead';
  END IF;
  IF NEW.period IS NULL OR NEW.period = '' THEN NEW.period := to_char(NEW.captured_at, 'YYYY-MM'); END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_meter_readings_fill ON public.meter_readings;
CREATE TRIGGER trg_meter_readings_fill
BEFORE INSERT ON public.meter_readings
FOR EACH ROW EXECUTE FUNCTION public.meter_readings_fill();
REVOKE ALL ON FUNCTION public.meter_readings_fill() FROM PUBLIC, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 8. Accounting: invoices are created/recalculated only before payment. Once
--    money has been applied, the invoice amount is immutable.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_invoice(_subscriber_id UUID, _period TEXT)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_tenant UUID; v_tariff NUMERIC; v_consumption NUMERIC;
  v_current NUMERIC; v_arrears NUMERIC; v_id UUID; v_paid NUMERIC; v_existing NUMERIC;
BEGIN
  IF _subscriber_id IS NULL OR _period IS NULL OR _period !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION 'Invalid invoice parameters';
  END IF;

  SELECT s.tenant_id, t.tariff_per_m3 INTO v_tenant, v_tariff
  FROM public.subscribers s JOIN public.tenants t ON t.id=s.tenant_id
  WHERE s.id=_subscriber_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Subscriber not found'; END IF;

  SELECT COALESCE(SUM(mr.consumption_m3),0) INTO v_consumption
  FROM public.meter_readings mr
  WHERE mr.subscriber_id=_subscriber_id AND mr.period=_period;
  v_current := ROUND(v_consumption * v_tariff, 2);

  SELECT COALESCE(SUM(GREATEST(bl.amount_yer - bl.paid_amount_yer,0)),0)
  INTO v_arrears
  FROM public.billing_logs bl
  WHERE bl.subscriber_id=_subscriber_id AND bl.period < _period;

  SELECT bl.id, bl.amount_yer, bl.paid_amount_yer
  INTO v_id, v_existing, v_paid
  FROM public.billing_logs bl
  WHERE bl.subscriber_id=_subscriber_id AND bl.period=_period
  FOR UPDATE;

  IF v_id IS NOT NULL THEN
    IF COALESCE(v_paid,0) > 0 AND v_existing <> ROUND(v_current + v_arrears,2) THEN
      RAISE EXCEPTION 'Paid invoice is immutable; create an adjustment/reversal workflow instead';
    END IF;
    UPDATE public.billing_logs
       SET consumption_m3=v_consumption,
           current_due_yer=v_current,
           previous_arrears_yer=v_arrears,
           amount_yer=ROUND(v_current + v_arrears,2),
           paid=(paid_amount_yer >= ROUND(v_current + v_arrears,2))
     WHERE id=v_id
     RETURNING id INTO v_id;
    RETURN v_id;
  END IF;

  INSERT INTO public.billing_logs
    (tenant_id,subscriber_id,period,consumption_m3,current_due_yer,previous_arrears_yer,amount_yer,paid_amount_yer,paid)
  VALUES
    (v_tenant,_subscriber_id,_period,v_consumption,v_current,v_arrears,ROUND(v_current+v_arrears,2),0,false)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.generate_invoice(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_invoice(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_invoice(uuid,text) TO service_role;

-- -----------------------------------------------------------------------------
-- 9. Payment application is idempotent at the database level. Receipts are
--    immutable and the balance is derived from billing rows.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.receipts_apply_payment()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE r RECORD; v_left NUMERIC := NEW.amount_yer; v_due NUMERIC; v_pay NUMERIC;
BEGIN
  IF NEW.amount_yer <= 0 THEN RAISE EXCEPTION 'Receipt amount must be positive'; END IF;
  FOR r IN
    SELECT bl.id, bl.amount_yer, bl.paid_amount_yer
    FROM public.billing_logs bl
    WHERE bl.subscriber_id=NEW.subscriber_id AND bl.tenant_id=NEW.tenant_id
      AND bl.paid=false
    ORDER BY bl.period ASC, bl.created_at ASC
    FOR UPDATE
  LOOP
    EXIT WHEN v_left <= 0;
    v_due := GREATEST(r.amount_yer-r.paid_amount_yer,0);
    CONTINUE WHEN v_due <= 0;
    v_pay := LEAST(v_due,v_left);
    UPDATE public.billing_logs bl
    SET paid_amount_yer=bl.paid_amount_yer+v_pay,
        paid=(bl.paid_amount_yer+v_pay)>=bl.amount_yer,
        paid_at=CASE WHEN (bl.paid_amount_yer+v_pay)>=bl.amount_yer THEN clock_timestamp() ELSE bl.paid_at END
    WHERE bl.id=r.id;
    v_left := v_left-v_pay;
  END LOOP;
  PERFORM public.recompute_subscriber_balance(NEW.subscriber_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_receipts_apply_payment ON public.receipts;
CREATE TRIGGER trg_receipts_apply_payment
AFTER INSERT ON public.receipts
FOR EACH ROW EXECUTE FUNCTION public.receipts_apply_payment();
REVOKE ALL ON FUNCTION public.receipts_apply_payment() FROM PUBLIC, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 10. Server-generated integrity hashes. These are integrity digests, not
--     encryption. They cannot be forged by changing the client code.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sign_meter_reading()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  NEW.hash_signature := encode(
    extensions.digest(
      concat_ws('|', NEW.id::text, NEW.tenant_id::text, NEW.subscriber_id::text,
                NEW.reader_id::text, NEW.reading_m3::text, NEW.previous_m3::text,
                NEW.captured_at::text), 'sha256'), 'hex');
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.sign_receipt()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  NEW.hash_signature := encode(
    extensions.digest(
      concat_ws('|', NEW.id::text, NEW.tenant_id::text, NEW.subscriber_id::text,
                NEW.collector_id::text, NEW.amount_yer::text, NEW.created_at::text),
      'sha256'), 'hex');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sign_meter_reading ON public.meter_readings;
CREATE TRIGGER trg_sign_meter_reading
BEFORE INSERT ON public.meter_readings
FOR EACH ROW EXECUTE FUNCTION public.sign_meter_reading();
DROP TRIGGER IF EXISTS trg_sign_receipt ON public.receipts;
CREATE TRIGGER trg_sign_receipt
BEFORE INSERT ON public.receipts
FOR EACH ROW EXECUTE FUNCTION public.sign_receipt();

REVOKE ALL ON FUNCTION public.sign_meter_reading() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sign_receipt() FROM PUBLIC, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 11. Realtime: publish only what the application actually uses.
-- -----------------------------------------------------------------------------
ALTER TABLE public.meter_readings REPLICA IDENTITY DEFAULT;
ALTER TABLE public.receipts REPLICA IDENTITY DEFAULT;
ALTER TABLE public.subscribers REPLICA IDENTITY DEFAULT;
ALTER TABLE public.billing_logs REPLICA IDENTITY DEFAULT;

-- -----------------------------------------------------------------------------
-- 12. Useful indexes for tenant-scoped queries and invoice/payment processing.
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_user_roles_user_tenant_role ON public.user_roles(user_id, tenant_id, role);
CREATE INDEX IF NOT EXISTS idx_profiles_tenant ON public.profiles(tenant_id);
CREATE INDEX IF NOT EXISTS idx_receipts_subscriber_created ON public.receipts(subscriber_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_billing_unpaid ON public.billing_logs(subscriber_id, period) WHERE paid=false;

-- Ensure clients cannot directly mutate immutable financial/audit records.
REVOKE UPDATE, DELETE ON public.meter_readings FROM authenticated, anon;
REVOKE UPDATE, DELETE ON public.receipts FROM authenticated, anon;
REVOKE UPDATE, DELETE ON public.user_roles FROM authenticated, anon;
