
CREATE OR REPLACE FUNCTION public.meter_readings_fill()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_prev NUMERIC;
BEGIN
  IF NEW.captured_at IS NULL THEN NEW.captured_at := now(); END IF;
  IF NEW.previous_m3 IS NULL OR NEW.previous_m3 = 0 THEN
    SELECT reading_m3 INTO v_prev FROM public.meter_readings
      WHERE subscriber_id = NEW.subscriber_id
      ORDER BY captured_at DESC LIMIT 1;
    NEW.previous_m3 := COALESCE(v_prev, COALESCE(NEW.previous_m3, 0));
  END IF;
  NEW.consumption_m3 := GREATEST(COALESCE(NEW.reading_m3,0) - COALESCE(NEW.previous_m3,0), 0);
  IF NEW.period IS NULL OR NEW.period = '' THEN
    NEW.period := to_char(NEW.captured_at, 'YYYY-MM');
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.meter_readings_fill() FROM public, anon, authenticated;
