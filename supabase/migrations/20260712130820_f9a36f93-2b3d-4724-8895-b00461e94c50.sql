
-- ============ CONSUMPTION HELPER ============
CREATE OR REPLACE FUNCTION public.calc_consumption(_subscriber_id UUID)
RETURNS NUMERIC LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(consumption_m3, 0)
  FROM public.meter_readings
  WHERE subscriber_id = _subscriber_id
  ORDER BY captured_at DESC
  LIMIT 1;
$$;

-- ============ INVOICE GENERATION ============
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
    (tenant_id, subscriber_id, period, consumption_m3, current_due_yer, previous_arrears_yer, amount_yer)
  VALUES
    (v_tenant, _subscriber_id, _period, v_consumption, v_current, v_arrears, v_current + v_arrears)
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

-- ============ GOVERNANCE SCORE ============
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
  IF NOT public.can_access_tenant(_tenant_id) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  SELECT COALESCE(SUM(amount_yer),0), COALESCE(SUM(paid_amount_yer),0)
    INTO v_billed, v_collected FROM public.billing_logs WHERE tenant_id = _tenant_id;
  v_collection_eff := CASE WHEN v_billed > 0 THEN LEAST(100, (v_collected / v_billed) * 100) ELSE 0 END;

  SELECT COUNT(*) INTO v_subs FROM public.subscribers WHERE tenant_id = _tenant_id AND status <> 'disconnected';
  SELECT COUNT(DISTINCT subscriber_id) INTO v_read_subs
    FROM public.meter_readings
    WHERE tenant_id = _tenant_id AND captured_at > now() - INTERVAL '45 days';
  v_reading_cov := CASE WHEN v_subs > 0 THEN LEAST(100, (v_read_subs::NUMERIC / v_subs) * 100) ELSE 0 END;

  SELECT COUNT(*) INTO v_total_reads FROM public.meter_readings WHERE tenant_id = _tenant_id;
  SELECT COUNT(*) INTO v_recent_reads
    FROM public.meter_readings WHERE tenant_id = _tenant_id AND captured_at > now() - INTERVAL '35 days';
  v_on_time := CASE WHEN v_total_reads > 0 THEN LEAST(100, (v_recent_reads::NUMERIC / GREATEST(v_total_reads,1)) * 100) ELSE 0 END;

  SELECT COUNT(*) FILTER (WHERE status = 'active'), COUNT(*) FILTER (WHERE status = 'disconnected')
    INTO v_active, v_disc FROM public.subscribers WHERE tenant_id = _tenant_id;
  v_active_ratio := CASE WHEN (v_active + v_disc) > 0 THEN (v_active::NUMERIC / (v_active + v_disc)) * 100 ELSE 100 END;

  v_score := ROUND(
    (v_collection_eff * 0.40) +
    (v_reading_cov  * 0.30) +
    (v_on_time      * 0.20) +
    (v_active_ratio * 0.10)
  , 1);

  RETURN jsonb_build_object(
    'score', v_score,
    'collection_efficiency', ROUND(v_collection_eff,1),
    'reading_coverage',      ROUND(v_reading_cov,1),
    'on_time_readings',      ROUND(v_on_time,1),
    'active_ratio',          ROUND(v_active_ratio,1),
    'billed_yer', v_billed, 'collected_yer', v_collected,
    'subscribers', v_subs,  'read_subscribers', v_read_subs
  );
END $$;

-- ============ SEED (idempotent) ============
DO $seed$
DECLARE
  v_t1 UUID; v_t2 UUID; v_t3 UUID;
  v_tenants UUID[]; v_tid UUID;
  first_names TEXT[] := ARRAY['محمد','أحمد','علي','عبدالله','فاطمة','عائشة','خديجة','مريم','يوسف','إبراهيم','خالد','عمر','حسن','حسين','سعيد','صالح','عبدالرحمن','عبدالكريم','ياسر','سلطان','منى','نادية','هدى','سمية','أمل','ريم','لطيفة','نجاة'];
  last_names  TEXT[] := ARRAY['المخلافي','الشرفي','الصبري','العديني','الشميري','الأغبري','القدسي','المقطري','الحكيمي','الوصابي','السفياني','الدبعي','الحُبيشي','النقيب','الحُميدي','العُلفي','السامعي','الحداد','الشرعبي','الظرافي','المطري','الحرازي'];
  zones TEXT[];
  n INT; i INT; j INT;
  v_sub UUID; v_reader UUID := gen_random_uuid();
  prev_read NUMERIC; curr_read NUMERIC; cons NUMERIC;
BEGIN
  IF EXISTS (SELECT 1 FROM public.tenants LIMIT 1) THEN
    RETURN;
  END IF;

  INSERT INTO public.tenants (name, directorate, established_year, households, tariff_per_m3, subscription_tier, status)
  VALUES ('مشروع مياه تعز — الحوبان','الحوبان', 2012, 4200, 250, 'premium', 'active') RETURNING id INTO v_t1;
  INSERT INTO public.tenants (name, directorate, established_year, households, tariff_per_m3, subscription_tier, status)
  VALUES ('مشروع مياه تعز — القاهرة','القاهرة', 2008, 3600, 220, 'premium', 'active') RETURNING id INTO v_t2;
  INSERT INTO public.tenants (name, directorate, established_year, households, tariff_per_m3, subscription_tier, status)
  VALUES ('مشروع مياه تعز — صالة','صالة', 2015, 2800, 200, 'free', 'active') RETURNING id INTO v_t3;

  INSERT INTO public.subscriptions (tenant_id, tier, started_at, active) VALUES
    (v_t1,'premium', now() - INTERVAL '18 months', true),
    (v_t2,'premium', now() - INTERVAL '12 months', true),
    (v_t3,'free',    now() - INTERVAL '6 months',  true);

  v_tenants := ARRAY[v_t1, v_t2, v_t3];

  FOREACH v_tid IN ARRAY v_tenants LOOP
    zones := CASE
      WHEN v_tid = v_t1 THEN ARRAY['الحوبان الشمالي','الحوبان الجنوبي','بير باشا','الروضة','النقيب']
      WHEN v_tid = v_t2 THEN ARRAY['القاهرة الشرقية','القاهرة الغربية','عصيفرة','ثعبات','الجحملية']
      ELSE ARRAY['صالة العُليا','صالة السفلى','المدرس','الشماسي','المسبح']
    END;

    n := 300 + floor(random() * 300)::INT;

    FOR i IN 1..n LOOP
      INSERT INTO public.subscribers (tenant_id, name, zone, meter_serial, phone, household_size, balance_yer, status)
      VALUES (
        v_tid,
        first_names[1 + floor(random() * array_length(first_names,1))::INT] || ' ' ||
        first_names[1 + floor(random() * array_length(first_names,1))::INT] || ' ' ||
        last_names[1 + floor(random() * array_length(last_names,1))::INT],
        zones[1 + floor(random() * array_length(zones,1))::INT],
        'MZ-' || upper(substr(md5(random()::text || v_tid::text || i::text), 1, 8)) || '-' || lpad(i::text, 4, '0'),
        '7' || (10000000 + floor(random() * 89999999))::TEXT,
        1 + floor(random() * 8)::INT,
        0,
        CASE WHEN random() < 0.05 THEN 'disconnected' WHEN random() < 0.15 THEN 'arrears' ELSE 'active' END
      ) RETURNING id INTO v_sub;

      -- Two months of readings + invoices
      prev_read := 100 + floor(random() * 500);
      curr_read := prev_read + 5 + floor(random() * 40);
      INSERT INTO public.meter_readings (tenant_id, subscriber_id, reader_id, previous_m3, reading_m3, period, captured_at)
      VALUES (v_tid, v_sub, NULL, prev_read, curr_read,
              to_char(now() - INTERVAL '35 days', 'YYYY-MM'),
              now() - INTERVAL '35 days' + (random() * INTERVAL '5 days'));

      prev_read := curr_read;
      curr_read := prev_read + 5 + floor(random() * 40);
      INSERT INTO public.meter_readings (tenant_id, subscriber_id, reader_id, previous_m3, reading_m3, period, captured_at)
      VALUES (v_tid, v_sub, NULL, prev_read, curr_read,
              to_char(now(), 'YYYY-MM'),
              now() - (random() * INTERVAL '10 days'));

      -- Generate invoices for both periods
      PERFORM public.generate_invoice(v_sub, to_char(now() - INTERVAL '35 days', 'YYYY-MM'));
      PERFORM public.generate_invoice(v_sub, to_char(now(), 'YYYY-MM'));
    END LOOP;

    -- Simulate ~65% payments on older invoices
    UPDATE public.billing_logs
       SET paid = true, paid_amount_yer = amount_yer, paid_at = now() - INTERVAL '15 days'
     WHERE tenant_id = v_tid
       AND period = to_char(now() - INTERVAL '35 days', 'YYYY-MM')
       AND random() < 0.65;

    -- Simulate ~30% payments on current invoices
    UPDATE public.billing_logs
       SET paid = true, paid_amount_yer = amount_yer, paid_at = now() - INTERVAL '2 days'
     WHERE tenant_id = v_tid
       AND period = to_char(now(), 'YYYY-MM')
       AND random() < 0.30;

    -- Create receipts for paid billings
    INSERT INTO public.receipts (tenant_id, subscriber_id, amount_yer, period, created_at)
    SELECT tenant_id, subscriber_id, paid_amount_yer, period, paid_at
      FROM public.billing_logs
     WHERE tenant_id = v_tid AND paid = true;

    -- Sync subscriber balances with unpaid amount
    UPDATE public.subscribers s
       SET balance_yer = COALESCE(u.owed, 0)
      FROM (
        SELECT subscriber_id, SUM(amount_yer - paid_amount_yer) owed
          FROM public.billing_logs
         WHERE tenant_id = v_tid AND paid = false
         GROUP BY subscriber_id
      ) u
     WHERE s.id = u.subscriber_id;
  END LOOP;
END $seed$;
