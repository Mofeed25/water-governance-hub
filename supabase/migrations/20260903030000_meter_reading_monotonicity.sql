-- Production invariant: a meter's accepted current reading may never be lower
-- than its most recent accepted reading. The client cannot bypass this check.

CREATE OR REPLACE FUNCTION public.validate_meter_reading_monotonicity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  previous_reading numeric;
BEGIN
  SELECT mr.reading_m3
    INTO previous_reading
  FROM public.meter_readings AS mr
  WHERE mr.tenant_id = NEW.tenant_id
    AND mr.subscriber_id = NEW.subscriber_id
    AND mr.captured_at <= NEW.captured_at
    AND mr.id <> NEW.id
  ORDER BY mr.captured_at DESC, mr.id DESC
  LIMIT 1;

  IF previous_reading IS NOT NULL AND NEW.reading_m3 < previous_reading THEN
    RAISE EXCEPTION 'meter reading cannot be lower than the previous accepted reading';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_meter_reading_monotonicity ON public.meter_readings;

CREATE TRIGGER trg_validate_meter_reading_monotonicity
BEFORE INSERT ON public.meter_readings
FOR EACH ROW
EXECUTE FUNCTION public.validate_meter_reading_monotonicity();

REVOKE ALL ON FUNCTION public.validate_meter_reading_monotonicity() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.validate_meter_reading_monotonicity() FROM anon;
REVOKE ALL ON FUNCTION public.validate_meter_reading_monotonicity() FROM authenticated;

COMMENT ON FUNCTION public.validate_meter_reading_monotonicity() IS
  'Server-side invariant preventing a new accepted meter reading from decreasing relative to the prior reading for the same tenant and subscriber.';
