-- Private storage for meter evidence. Object paths MUST start with tenant UUID.
INSERT INTO storage.buckets (id, name, public)
VALUES ('meter-reading-photos', 'meter-reading-photos', false)
ON CONFLICT (id) DO UPDATE SET public = false;

ALTER TABLE public.meter_readings
  ADD COLUMN IF NOT EXISTS photo_url TEXT;

DROP POLICY IF EXISTS "meter photos tenant read" ON storage.objects;
CREATE POLICY "meter photos tenant read"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'meter-reading-photos'
  AND (storage.foldername(name))[1] = public.current_tenant_id()::text
);

DROP POLICY IF EXISTS "meter photos tenant upload" ON storage.objects;
CREATE POLICY "meter photos tenant upload"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'meter-reading-photos'
  AND (storage.foldername(name))[1] = public.current_tenant_id()::text
  AND (public.has_role(auth.uid(), 'meter_reader') OR public.has_role(auth.uid(), 'project_manager'))
);

DROP POLICY IF EXISTS "meter photos tenant update" ON storage.objects;
CREATE POLICY "meter photos tenant update"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'meter-reading-photos' AND (storage.foldername(name))[1] = public.current_tenant_id()::text)
WITH CHECK (bucket_id = 'meter-reading-photos' AND (storage.foldername(name))[1] = public.current_tenant_id()::text);

-- Evidence is append-only from the browser. Deletion is a controlled backend operation.
DROP POLICY IF EXISTS "meter photos tenant delete" ON storage.objects;
