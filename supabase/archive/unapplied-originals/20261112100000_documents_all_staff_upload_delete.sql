-- ============================================================================
-- Documents: every staff member who can open the Documents module can upload
-- documents and delete documents from the central client library.
--
-- Before: only roles with FULL documents access could insert (view-only roles -
-- assistants, interns, marketing, ... - could not), and a document could only be
-- deleted by Director/Admin or by the person who uploaded it; deleting the stored
-- file was Director/Admin only.
--
-- These are ADDITIVE policies (Postgres ORs permissive policies), so nothing any
-- role could already do is taken away. The Restricted rule is unchanged:
-- restricted documents stay Director/Admin only - for viewing, uploading
-- over them and deleting.
--
-- Service-sourced rows shown in the library (audit working papers, advisory and
-- service deliverables) live in their own tables and keep their own rules.
-- ============================================================================

-- 1. Upload: metadata row
DROP POLICY IF EXISTS "documents insert any documents user" ON public.documents;
CREATE POLICY "documents insert any documents user" ON public.documents
  FOR INSERT TO authenticated
  WITH CHECK (
    public.can_view_module(auth.uid(), 'documents')
    AND uploaded_by = auth.uid()
    AND (documents.confidentiality <> 'restricted' OR public.is_admin(auth.uid()))
  );

-- 2. Upload: stored file
DROP POLICY IF EXISTS "docs storage insert any documents user" ON storage.objects;
CREATE POLICY "docs storage insert any documents user" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'client-documents'
    AND public.can_view_module(auth.uid(), 'documents')
  );

-- 3. Delete: metadata row (restricted documents remain Director/Admin only)
DROP POLICY IF EXISTS "documents delete any documents user" ON public.documents;
CREATE POLICY "documents delete any documents user" ON public.documents
  FOR DELETE TO authenticated
  USING (
    public.can_view_module(auth.uid(), 'documents')
    AND (documents.confidentiality <> 'restricted' OR public.is_admin(auth.uid()))
  );

-- 4. Delete: stored file
DROP POLICY IF EXISTS "docs storage delete any documents user" ON storage.objects;
CREATE POLICY "docs storage delete any documents user" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'client-documents'
    AND public.can_view_module(auth.uid(), 'documents')
    AND (public.is_admin(auth.uid()) OR NOT public.is_restricted_document_path('client-documents', storage.objects.name))
  );

NOTIFY pgrst, 'reload schema';
