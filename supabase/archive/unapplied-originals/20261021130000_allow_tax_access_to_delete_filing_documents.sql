-- Allow users who can access the Tax module to delete tax-filing attachments.
-- Scope both metadata and Storage deletion to tax-linked records / tax-returns paths;
-- do not broaden deletion rights for unrelated client documents.

DROP POLICY IF EXISTS "tax filing documents delete by tax access" ON public.documents;
CREATE POLICY "tax filing documents delete by tax access"
  ON public.documents
  FOR DELETE
  TO authenticated
  USING (
    tax_return_id IS NOT NULL
    AND public.can_view_module(auth.uid(), 'tax')
  );

-- The file must be deleted from Storage before the metadata row is deleted.
-- Tax filing uploads use: <client_id>/tax-returns/<tax_return_id>/<filename>
DROP POLICY IF EXISTS "tax filing storage delete by tax access" ON storage.objects;
CREATE POLICY "tax filing storage delete by tax access"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'client-documents'
    AND split_part(name, '/', 2) = 'tax-returns'
    AND public.can_view_module(auth.uid(), 'tax')
  );
