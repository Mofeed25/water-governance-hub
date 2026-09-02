-- MIZAN Field Reading: exact meter identity and OCR evidence contract.
-- The meter serial extracted from the photograph must equal the subscriber's
-- registered serial exactly. No fuzzy matching, partial matching, or override.

ALTER TABLE public.meter_readings
  ADD COLUMN IF NOT EXISTS meter_serial_extracted TEXT,
  ADD COLUMN IF NOT EXISTS meter_identity_match BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS meter_identity_confidence NUMERIC(5,4),
  ADD COLUMN IF NOT EXISTS reading_ocr_confidence NUMERIC(5,4),
  ADD COLUMN IF NOT EXISTS ocr_processing_ms INTEGER,
  ADD COLUMN IF NOT EXISTS identity_verified_at TIMESTAMPTZ;

ALTER TABLE public.meter_readings
  ADD CONSTRAINT meter_readings_identity_confidence_ck
  CHECK (meter_identity_confidence IS NULL OR meter_identity_confidence >= 0 AND meter_identity_confidence <= 1),
  ADD CONSTRAINT meter_readings_reading_ocr_confidence_ck
  CHECK (reading_ocr_confidence IS NULL OR reading_ocr_confidence >= 0 AND reading_ocr_confidence <= 1),
  ADD CONSTRAINT meter_readings_ocr_processing_ms_ck
  CHECK (ocr_processing_ms IS NULL OR ocr_processing_ms >= 0);

CREATE OR REPLACE FUNCTION public.validate_meter_reading_evidence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  registered_serial text;
BEGIN
  SELECT s.meter_serial
    INTO registered_serial
  FROM public.subscribers s
  WHERE s.id = NEW.subscriber_id
    AND s.tenant_id = NEW.tenant_id;

  IF registered_serial IS NULL THEN
    RAISE EXCEPTION 'Subscriber does not belong to the supplied tenant';
  END IF;

  IF NEW.meter_serial_extracted IS NULL OR NEW.meter_serial_extracted = '' THEN
    RAISE EXCEPTION 'Meter identity must be extracted from the meter photograph';
  END IF;

  IF NEW.meter_serial_extracted <> registered_serial THEN
    RAISE EXCEPTION 'Meter identity mismatch: photograph does not match the selected subscriber meter';
  END IF;

  IF NEW.meter_identity_match IS NOT TRUE THEN
    RAISE EXCEPTION 'Meter identity must be explicitly verified';
  END IF;

  IF NEW.identity_verified_at IS NULL THEN
    NEW.identity_verified_at := now();
  END IF;

  IF NEW.reading_ocr_confidence IS NULL OR NEW.reading_ocr_confidence < 0.90 THEN
    RAISE EXCEPTION 'Meter reading OCR confidence is below the automatic acceptance threshold';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_meter_reading_evidence ON public.meter_readings;
CREATE TRIGGER trg_validate_meter_reading_evidence
BEFORE INSERT ON public.meter_readings
FOR EACH ROW
EXECUTE FUNCTION public.validate_meter_reading_evidence();

COMMENT ON COLUMN public.meter_readings.meter_serial_extracted IS 'Exact serial extracted from the meter photograph; must equal subscribers.meter_serial.';
COMMENT ON COLUMN public.meter_readings.meter_identity_match IS 'Authoritative exact-match gate; TRUE only when extracted serial equals registered serial.';
COMMENT ON COLUMN public.meter_readings.reading_ocr_confidence IS 'OCR confidence for current reading; separate from exact meter identity.';
COMMENT ON COLUMN public.meter_readings.ocr_processing_ms IS 'Client OCR processing duration in milliseconds for field-performance monitoring.';
