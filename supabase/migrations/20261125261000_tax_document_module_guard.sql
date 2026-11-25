-- Njia Smart repair 23: keep tax-filing evidence behind Tax-module access even when users have Documents access.
DROP POLICY IF EXISTS documents_tax_access_guard ON public.documents;
CREATE POLICY documents_tax_access_guard ON public.documents AS RESTRICTIVE
FOR ALL TO authenticated
USING(tax_return_id IS NULL OR public.can_view_module(auth.uid(),'tax'))
WITH CHECK(tax_return_id IS NULL OR public.can_view_module(auth.uid(),'tax'));

DROP POLICY IF EXISTS tax_filing_storage_module_guard ON storage.objects;
CREATE POLICY tax_filing_storage_module_guard ON storage.objects AS RESTRICTIVE
FOR ALL TO authenticated
USING(bucket_id<>'client-documents' OR split_part(name,'/',2)<>'tax-returns' OR public.can_view_module(auth.uid(),'tax'))
WITH CHECK(bucket_id<>'client-documents' OR split_part(name,'/',2)<>'tax-returns' OR public.can_view_module(auth.uid(),'tax'));
NOTIFY pgrst,'reload schema';