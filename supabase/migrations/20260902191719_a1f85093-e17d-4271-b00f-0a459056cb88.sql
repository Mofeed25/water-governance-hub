
-- 1) Auto-fill reading fields
CREATE OR REPLACE FUNCTION public.meter_readings_fill()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_prev NUMERIC;
BEGIN
  IF NEW.captured_at IS NULL THEN NEW.captured_at := now(); END IF;
  IF NEW.previous_m3 IS NULL THEN
    SELECT reading_m3 INTO v_prev FROM public.meter_readings
      WHERE subscriber_id = NEW.subscriber_id
      ORDER BY captured_at DESC LIMIT 1;
    NEW.previous_m3 := COALESCE(v_prev, 0);
  END IF;
  NEW.consumption_m3 := GREATEST(COALESCE(NEW.reading_m3,0) - COALESCE(NEW.previous_m3,0), 0);
  IF NEW.period IS NULL OR NEW.period = '' THEN
    NEW.period := to_char(NEW.captured_at, 'YYYY-MM');
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_meter_readings_fill ON public.meter_readings;
CREATE TRIGGER trg_meter_readings_fill
BEFORE INSERT ON public.meter_readings
FOR EACH ROW EXECUTE FUNCTION public.meter_readings_fill();

-- 2) Auto invoice after reading
CREATE OR REPLACE FUNCTION public.meter_readings_invoice()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.generate_invoice(NEW.subscriber_id, NEW.period);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_meter_readings_invoice ON public.meter_readings;
CREATE TRIGGER trg_meter_readings_invoice
AFTER INSERT ON public.meter_readings
FOR EACH ROW EXECUTE FUNCTION public.meter_readings_invoice();

-- 3) Recompute subscriber balance from unpaid invoices
CREATE OR REPLACE FUNCTION public.recompute_subscriber_balance(_subscriber_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.subscribers s
     SET balance_yer = COALESCE((
       SELECT SUM(GREATEST(b.amount_yer - b.paid_amount_yer, 0))
       FROM public.billing_logs b WHERE b.subscriber_id = _subscriber_id
     ), 0)
   WHERE s.id = _subscriber_id;
$$;

CREATE OR REPLACE FUNCTION public.billing_logs_sync_balance()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.recompute_subscriber_balance(COALESCE(NEW.subscriber_id, OLD.subscriber_id));
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_billing_logs_balance ON public.billing_logs;
CREATE TRIGGER trg_billing_logs_balance
AFTER INSERT OR UPDATE OR DELETE ON public.billing_logs
FOR EACH ROW EXECUTE FUNCTION public.billing_logs_sync_balance();

-- 4) Apply receipts to unpaid invoices (oldest first)
CREATE OR REPLACE FUNCTION public.receipts_apply_payment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_left NUMERIC := NEW.amount_yer;
  r RECORD;
  v_due NUMERIC;
  v_pay NUMERIC;
BEGIN
  FOR r IN
    SELECT id, amount_yer, paid_amount_yer
      FROM public.billing_logs
     WHERE subscriber_id = NEW.subscriber_id AND paid = false
     ORDER BY period ASC
  LOOP
    EXIT WHEN v_left <= 0;
    v_due := GREATEST(r.amount_yer - r.paid_amount_yer, 0);
    CONTINUE WHEN v_due <= 0;
    v_pay := LEAST(v_due, v_left);
    UPDATE public.billing_logs
       SET paid_amount_yer = paid_amount_yer + v_pay,
           paid = (paid_amount_yer + v_pay) >= amount_yer,
           paid_at = CASE WHEN (paid_amount_yer + v_pay) >= amount_yer THEN now() ELSE paid_at END
     WHERE id = r.id;
    v_left := v_left - v_pay;
  END LOOP;

  PERFORM public.recompute_subscriber_balance(NEW.subscriber_id);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_receipts_apply_payment ON public.receipts;
CREATE TRIGGER trg_receipts_apply_payment
AFTER INSERT ON public.receipts
FOR EACH ROW EXECUTE FUNCTION public.receipts_apply_payment();

-- 5) Indexes
CREATE INDEX IF NOT EXISTS idx_readings_sub_captured ON public.meter_readings (subscriber_id, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_readings_tenant ON public.meter_readings (tenant_id);
CREATE INDEX IF NOT EXISTS idx_billing_sub_period ON public.billing_logs (subscriber_id, period);
CREATE INDEX IF NOT EXISTS idx_billing_tenant ON public.billing_logs (tenant_id);
CREATE INDEX IF NOT EXISTS idx_receipts_tenant ON public.receipts (tenant_id);
CREATE INDEX IF NOT EXISTS idx_subscribers_tenant ON public.subscribers (tenant_id);

REVOKE EXECUTE ON FUNCTION public.recompute_subscriber_balance(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.recompute_subscriber_balance(uuid) TO authenticated, service_role;
