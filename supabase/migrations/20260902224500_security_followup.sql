-- Close privileged RPC surfaces left by the prototype migrations.

CREATE OR REPLACE FUNCTION public.recompute_subscriber_balance(_subscriber_id UUID)
RETURNS VOID
LANGUAGE SQL SECURITY DEFINER SET search_path = ''
AS $$
  UPDATE public.subscribers s
  SET balance_yer = COALESCE((
    SELECT SUM(GREATEST(bl.amount_yer - bl.paid_amount_yer, 0))
    FROM public.billing_logs bl
    WHERE bl.subscriber_id = _subscriber_id AND bl.tenant_id = s.tenant_id
  ), 0)
  WHERE s.id = _subscriber_id;
$$;
REVOKE ALL ON FUNCTION public.recompute_subscriber_balance(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_subscriber_balance(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.generate_invoice(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_invoice(uuid,text) TO service_role;

REVOKE ALL ON FUNCTION public.generate_invoices_for_tenant(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_invoices_for_tenant(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_invoices_for_tenant(uuid,text) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_list_users()
RETURNS TABLE (id uuid, email text, full_name text, tenant_id uuid, tenant_name text, roles text[])
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_super_admin((SELECT auth.uid())) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  RETURN QUERY
  SELECT u.id, u.email::text, p.full_name, p.tenant_id, t.name,
         COALESCE(ARRAY(SELECT ur.role::text FROM public.user_roles ur WHERE ur.user_id=u.id ORDER BY ur.role::text), '{}')
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.id=u.id
  LEFT JOIN public.tenants t ON t.id=p.tenant_id
  ORDER BY u.created_at;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_list_users() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_users() TO authenticated;

-- A receipt is a financial event: an overpayment is rejected rather than
-- silently disappearing. Allocation is atomic with the receipt insert.
CREATE OR REPLACE FUNCTION public.receipts_apply_payment()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  r RECORD;
  v_left NUMERIC := NEW.amount_yer;
  v_total_due NUMERIC;
  v_due NUMERIC;
  v_pay NUMERIC;
BEGIN
  IF NEW.amount_yer <= 0 THEN RAISE EXCEPTION 'Receipt amount must be positive'; END IF;

  SELECT COALESCE(SUM(GREATEST(bl.amount_yer - bl.paid_amount_yer,0)),0)
    INTO v_total_due
  FROM public.billing_logs bl
  WHERE bl.subscriber_id=NEW.subscriber_id AND bl.tenant_id=NEW.tenant_id;

  IF NEW.amount_yer > v_total_due THEN RAISE EXCEPTION 'Receipt exceeds outstanding balance'; END IF;

  FOR r IN
    SELECT bl.id, bl.amount_yer, bl.paid_amount_yer
    FROM public.billing_logs bl
    WHERE bl.subscriber_id=NEW.subscriber_id AND bl.tenant_id=NEW.tenant_id AND bl.paid=false
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

  IF v_left <> 0 THEN RAISE EXCEPTION 'Payment allocation failed; transaction rolled back'; END IF;
  PERFORM public.recompute_subscriber_balance(NEW.subscriber_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_receipts_apply_payment ON public.receipts;
CREATE TRIGGER trg_receipts_apply_payment
AFTER INSERT ON public.receipts
FOR EACH ROW EXECUTE FUNCTION public.receipts_apply_payment();
REVOKE ALL ON FUNCTION public.receipts_apply_payment() FROM PUBLIC, anon, authenticated;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.user_roles FROM authenticated, anon;
REVOKE UPDATE, DELETE, TRUNCATE ON public.meter_readings FROM authenticated, anon;
REVOKE UPDATE, DELETE, TRUNCATE ON public.receipts FROM authenticated, anon;
