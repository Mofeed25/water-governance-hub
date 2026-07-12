ALTER TABLE public.receipts ADD COLUMN IF NOT EXISTS hash_signature TEXT;
ALTER TABLE public.meter_readings ADD COLUMN IF NOT EXISTS hash_signature TEXT;