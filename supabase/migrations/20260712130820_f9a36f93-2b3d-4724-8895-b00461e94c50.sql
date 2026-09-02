-- Database functions only. Demo data belongs in supabase/seed.sql, not migrations.

CREATE OR REPLACE FUNCTION public.calc_consumption(_subscriber_id UUID)
RETURNS NUMERIC LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(mr.consumption_m3, 0)
  FROM public.meter_readings mr
  WHERE mr.subscriber_id = _subscriber_id
  ORDER BY mr.captured_at DESC, mr.id DESC
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.generate_invoice(_subscriber_id UUID, _period TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant UUID;
  v_tariff NUMERIC;
  v_consumption NUMERIC;
  v_current NUMERIC;
  v_arrears NUMERIC;
  v_id UUID;
BEGIN
  SELECT s.tenant_id, t.tariff_per_m3
    INTO v_tenant, v_tariff
    FROM public.subscribers s JOIN public.tenants t ON t.id = s.tenant_id
    WHERE s.id = _subscriber_id;

  SELECT COALESCE(SUM(consumption_m3), 0) INTO v_consumption
    FROM public.meter_readings
    WHERE subscriber_id = _subscriber_id AND period = _period;

  v_current := ROUND(v_consumption * v_tariff, 2);

  SELECT COALESCE(SUM(amount_yer - paid_amount_yer), 0) INTO v_arrears
    FROM public.billing_logs
    WHERE subscriber_id = _subscriber_id AND paid = false AND period < _period;

  INSERT INTO public.billing_logs
    (tenant_id, subscriber_id, period, consumption_m3, current_due_yer, previous_arrears_yer, amount_yer, paid_amount_yer, paid)
  VALUES
    (v_tenant, _subscriber_id, _period, v_consumption, v_current, v_arrears, v_current + v_arrears, 0, false)
  ON CONFLICT (subscriber_id, period) DO UPDATE
    SET consumption_m3 = EXCLUDED.consumption_m3,
        current_due_yer = EXCLUDED.current_due_yer,
        previous_arrears_yer = EXCLUDED.previous_arrears_yer,
        amount_yer = EXCLUDED.amount_yer
  RETURNING id INTO v_id;

  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.generate_invoices_for_tenant(_tenant_id UUID, _period TEXT)
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r RECORD; n INT := 0;
BEGIN
  IF NOT (public.is_super_admin(auth.uid()) OR (public.current_tenant_id() = _tenant_id AND public.has_role(auth.uid(),'project_manager'))) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  FOR r IN SELECT id FROM public.subscribers WHERE tenant_id = _tenant_id LOOP
    PERFORM public.generate_invoice(r.id, _period);
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION public.governance_score(_tenant_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_billed NUMERIC; v_collected NUMERIC; v_collection_eff NUMERIC;
  v_subs INT; v_read_subs INT; v_reading_cov NUMERIC;
  v_on_time NUMERIC; v_active_ratio NUMERIC;
  v_recent_reads INT; v_total_reads INT;
  v_active INT; v_disc INT;
  v_score NUMERIC;
BEGIN
  IF NOT public.can_access_tenant(_tenant_id) THEN RAISE EXCEPTION 'Forbidden'; END IF;

  SELECT COALESCE(SUM(amount_yer),0), COALESCE(SUM(paid_amount_yer),0)
    INTO v_billed, v_collected FROM public.billing_logs WHERE tenant_id = _tenant_id;
  v_collection_eff := CASE WHEN v_billed > 0 THEN LEAST(100, (v_collected / v_billed) * 100) ELSE 0 END;

  SELECT COUNT(*) INTO v_subs FROM public.subscribers WHERE tenant_id = _tenant_id AND status <> 'disconnected';
  SELECT COUNT(DISTINCT subscriber_id) INTO v_read_subs FROM public.meter_readings
    WHERE tenant_id = _tenant_id AND captured_at > now() - INTERVAL '45 days';
  v_reading_cov := CASE WHEN v_subs > 0 THEN LEAST(100, (v_read_subs::NUMERIC / v_subs) * 100) ELSE 0 END;

  SELECT COUNT(*) INTO v_total_reads FROM public.meter_readings WHERE tenant_id = _tenant_id;
  SELECT COUNT(*) INTO v_recent_reads FROM public.meter_readings
    WHERE tenant_id = _tenant_id AND captured_at > now() - INTERVAL '35 days';
  v_on_time := CASE WHEN v_total_reads > 0 THEN LEAST(100, (v_recent_reads::NUMERIC / v_total_reads) * 100) ELSE 0 END;

  SELECT COUNT(*) FILTER (WHERE status='active'), COUNT(*) FILTER (WHERE status='disconnected')
    INTO v_active, v_disc FROM public.subscribers WHERE tenant_id = _tenant_id;
  v_active_ratio := CASE WHEN (v_active + v_disc) > 0 THEN (v_active::NUMERIC / (v_active + v_disc)) * 100 ELSE 100 END;

  v_score := ROUND((v_collection_eff*0.40)+(v_reading_cov*0.30)+(v_on_time*0.20)+(v_active_ratio*0.10),1);
  RETURN jsonb_build_object(
    'score',v_score,
    'collection_efficiency',ROUND(v_collection_eff,1),
    'reading_coverage',ROUND(v_reading_cov,1),
    'on_time_readings',ROUND(v_on_time,1),
    'active_ratio',ROUND(v_active_ratio,1),
    'billed_yer',v_billed,
    'collected_yer',v_collected,
    'subscribers',v_subs,
    'read_subscribers',v_read_subs
  );
END $$;

REVOKE ALL ON FUNCTION public.calc_consumption(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.generate_invoice(uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.generate_invoices_for_tenant(uuid,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.governance_score(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.governance_score(uuid) TO authenticated;
