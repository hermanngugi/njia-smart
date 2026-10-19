-- Repair tax filing receipt uploads when tax_return_id was never added
-- to public.documents in the deployed database.
-- Keep this additive and safe to run more than once.

ALTER TABLE public.tax_returns
  ADD COLUMN IF NOT EXISTS filed_at timestamptz,
  ADD COLUMN IF NOT EXISTS invoice_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS renewed_to_id uuid REFERENCES public.tax_returns(id) ON DELETE SET NULL;

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS tax_return_id uuid REFERENCES public.tax_returns(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_documents_tax_return
  ON public.documents(tax_return_id);

-- Make PostgREST refresh its view of the table after the DDL above.
NOTIFY pgrst, 'reload schema';

-- Tax filing receipt files use:
-- client-documents/<client_id>/tax-returns/<tax_return_id>/<filename>
-- Existing generic Documents policies remain in place for other paths.
DROP POLICY IF EXISTS "tax filing evidence storage upload" ON storage.objects;
CREATE POLICY "tax filing evidence storage upload"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'client-documents'
    AND public.has_full_module(auth.uid(), 'tax')
    AND (storage.foldername(name))[2] = 'tax-returns'
    AND EXISTS (
      SELECT 1
      FROM public.tax_returns tr
      WHERE tr.id::text = (storage.foldername(name))[3]
        AND tr.client_id::text = (storage.foldername(name))[1]
    )
  );

DROP POLICY IF EXISTS "tax filing evidence storage read" ON storage.objects;
CREATE POLICY "tax filing evidence storage read"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'client-documents'
    AND public.can_view_module(auth.uid(), 'tax')
    AND (storage.foldername(name))[2] = 'tax-returns'
    AND EXISTS (
      SELECT 1
      FROM public.tax_returns tr
      WHERE tr.id::text = (storage.foldername(name))[3]
        AND tr.client_id::text = (storage.foldername(name))[1]
    )
  );

-- Allow Tax-module users to save metadata for a receipt attached to a real
-- return belonging to the same client. No tax_return_id column was assumed
-- to exist before this migration.
DROP POLICY IF EXISTS "tax filing evidence metadata insert" ON public.documents;
CREATE POLICY "tax filing evidence metadata insert"
  ON public.documents
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.has_full_module(auth.uid(), 'tax')
    AND tax_return_id IS NOT NULL
    AND client_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.tax_returns tr
      WHERE tr.id = documents.tax_return_id
        AND tr.client_id = documents.client_id
    )
    AND file_path LIKE (
      client_id::text || '/tax-returns/' || tax_return_id::text || '/%'
    )
  );

DROP POLICY IF EXISTS "tax filing evidence metadata select" ON public.documents;
CREATE POLICY "tax filing evidence metadata select"
  ON public.documents
  FOR SELECT
  TO authenticated
  USING (
    public.can_view_module(auth.uid(), 'tax')
    AND tax_return_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.tax_returns tr
      WHERE tr.id = documents.tax_return_id
        AND tr.client_id = documents.client_id
    )
  );
