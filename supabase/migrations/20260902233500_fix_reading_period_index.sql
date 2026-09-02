-- date_trunc(timestamptz) is timezone-dependent and cannot be used in an index
-- expression. Use a UTC timestamp without time zone for deterministic indexing.
DROP INDEX IF EXISTS public.meter_readings_subscriber_period_uidx;
CREATE UNIQUE INDEX IF NOT EXISTS meter_readings_subscriber_period_uidx
ON public.meter_readings (
  tenant_id,
  subscriber_id,
  (date_trunc('month', captured_at AT TIME ZONE 'UTC'))
);
