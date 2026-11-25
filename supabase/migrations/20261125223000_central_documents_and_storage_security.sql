-- Njia Smart consolidated repair 02: central documents and storage boundaries.
-- Consolidates the unapplied document-library, enum-compare, tax-delete and
-- all-staff document upload/delete drafts. Existing files and metadata are kept.

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS document_group text NOT NULL DEFAULT 'client_master',
  ADD COLUMN IF NOT EXISTS service_line text,
  ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'general_supporting',
  ADD COLUMN IF NOT EXISTS storage_bucket text NOT NULL DEFAULT 'client-documents',
  ADD COLUMN IF NOT EXISTS period_label text,
  ADD COLUMN IF NOT EXISTS expires_on date,
  ADD COLUMN IF NOT EXISTS confidentiality text NOT NULL DEFAULT 'confidential',
  ADD COLUMN IF NOT EXISTS service_project_id uuid REFERENCES public.service_projects(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS advisory_project_id uuid REFERENCES public.advisory_projects(id) ON DELETE SET NULL;

ALTER TABLE public.documents DROP CONSTRAINT IF EXISTS documents_group_check;
ALTER TABLE public.documents ADD CONSTRAINT documents_group_check
  CHECK (document_group IN ('client_master','service'));
ALTER TABLE public.documents DROP CONSTRAINT IF EXISTS documents_service_line_check;
ALTER TABLE public.documents ADD CONSTRAINT documents_service_line_check
  CHECK (service_line IS NULL OR service_line IN ('audit','advisory','tax','ict','outsourced_accounting','payroll_management','financial_business_management'));
ALTER TABLE public.documents DROP CONSTRAINT IF EXISTS documents_confidentiality_check;
ALTER TABLE public.documents ADD CONSTRAINT documents_confidentiality_check
  CHECK (confidentiality IN ('confidential','restricted'));

UPDATE public.documents
SET document_group='service', service_line='tax', category='tax_filing'
WHERE tax_return_id IS NOT NULL;
UPDATE public.documents d
SET document_group='service',
    service_line=COALESCE(d.service_line,e.type::text),
    category=CASE e.type::text WHEN 'tax' THEN 'tax_filing' WHEN 'advisory' THEN 'advisory_assignment' ELSE 'audit_evidence' END
FROM public.engagements e
WHERE d.engagement_id=e.id AND d.tax_return_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_documents_client_group ON public.documents(client_id,document_group);
CREATE INDEX IF NOT EXISTS idx_documents_service_line ON public.documents(service_line);
CREATE INDEX IF NOT EXISTS idx_documents_service_project ON public.documents(service_project_id);
CREATE INDEX IF NOT EXISTS idx_documents_advisory_project ON public.documents(advisory_project_id);
CREATE INDEX IF NOT EXISTS idx_documents_expires_on ON public.documents(expires_on) WHERE expires_on IS NOT NULL;

CREATE OR REPLACE FUNCTION public.validate_document_client_links()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
  IF TG_OP='UPDATE' AND OLD.confidentiality='restricted' AND NOT public.is_admin(auth.uid()) THEN
    IF NEW.confidentiality IS DISTINCT FROM 'restricted'
       OR NEW.file_path IS DISTINCT FROM OLD.file_path
       OR NEW.storage_bucket IS DISTINCT FROM OLD.storage_bucket
       OR NEW.client_id IS DISTINCT FROM OLD.client_id THEN
      RAISE EXCEPTION 'Only Director/Admin may change restricted document access or location';
    END IF;
  END IF;
  IF NEW.tax_return_id IS NOT NULL THEN
    NEW.document_group:='service'; NEW.service_line:='tax';
    IF NEW.category IS NULL OR NEW.category='general_supporting' THEN NEW.category:='tax_filing'; END IF;
  ELSIF NEW.engagement_id IS NOT NULL THEN
    NEW.document_group:='service';
    SELECT e.type::text INTO NEW.service_line FROM public.engagements e WHERE e.id=NEW.engagement_id;
    IF NEW.category IS NULL OR NEW.category='general_supporting' THEN
      NEW.category:=CASE NEW.service_line WHEN 'tax' THEN 'tax_filing' WHEN 'advisory' THEN 'advisory_assignment' ELSE 'audit_evidence' END;
    END IF;
  END IF;
  IF NEW.document_group='client_master' THEN
    NEW.service_line:=NULL; NEW.engagement_id:=NULL; NEW.tax_return_id:=NULL;
    NEW.service_project_id:=NULL; NEW.advisory_project_id:=NULL;
  ELSIF NEW.service_line IS NULL THEN
    RAISE EXCEPTION 'Choose a service line for service documents';
  END IF;
  IF NEW.engagement_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM public.engagements e WHERE e.id=NEW.engagement_id AND e.client_id=NEW.client_id
  ) THEN RAISE EXCEPTION 'Engagement does not belong to this client'; END IF;
  IF NEW.tax_return_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM public.tax_returns t WHERE t.id=NEW.tax_return_id AND t.client_id=NEW.client_id
  ) THEN RAISE EXCEPTION 'Tax return does not belong to this client'; END IF;
  IF NEW.service_project_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM public.service_projects s WHERE s.id=NEW.service_project_id
      AND s.client_id=NEW.client_id AND s.module::text=NEW.service_line
  ) THEN RAISE EXCEPTION 'Service project does not belong to this client or service'; END IF;
  IF NEW.advisory_project_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM public.advisory_projects a WHERE a.id=NEW.advisory_project_id
      AND a.client_id=NEW.client_id AND NEW.service_line='advisory'
  ) THEN RAISE EXCEPTION 'Advisory project does not belong to this client'; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_validate_document_client_links ON public.documents;
CREATE TRIGGER trg_validate_document_client_links
BEFORE INSERT OR UPDATE ON public.documents
FOR EACH ROW EXECUTE FUNCTION public.validate_document_client_links();

CREATE OR REPLACE FUNCTION public.is_restricted_document_path(_bucket text,_path text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS(SELECT 1 FROM public.documents d
    WHERE d.storage_bucket=_bucket AND d.file_path=_path AND d.confidentiality='restricted');
$$;
REVOKE ALL ON FUNCTION public.is_restricted_document_path(text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.is_restricted_document_path(text,text) TO authenticated,service_role;

-- One restrictive rule prevents any permissive metadata policy from exposing
-- restricted records to ordinary staff.
DROP POLICY IF EXISTS documents_restricted_guard ON public.documents;
CREATE POLICY documents_restricted_guard ON public.documents
AS RESTRICTIVE FOR ALL TO authenticated
USING (confidentiality <> 'restricted' OR public.is_admin(auth.uid()))
WITH CHECK (confidentiality <> 'restricted' OR public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "documents select by rank" ON public.documents;
CREATE POLICY "documents select by rank" ON public.documents FOR SELECT TO authenticated
USING (
  public.can_view_module_all(auth.uid(),'documents')
  OR (public.is_module_assigned_only(auth.uid(),'documents') AND
      (uploaded_by=auth.uid() OR EXISTS(
        SELECT 1 FROM public.client_assignments ca
        WHERE ca.client_id=documents.client_id AND ca.user_id=auth.uid())))
);

DROP POLICY IF EXISTS "tax filing evidence metadata select" ON public.documents;
CREATE POLICY "tax filing evidence metadata select" ON public.documents
FOR SELECT TO authenticated USING (
  public.can_view_module(auth.uid(),'tax') AND tax_return_id IS NOT NULL
  AND EXISTS(SELECT 1 FROM public.tax_returns t WHERE t.id=documents.tax_return_id AND t.client_id=documents.client_id)
);

DROP POLICY IF EXISTS "documents insert any documents user" ON public.documents;
CREATE POLICY "documents insert any documents user" ON public.documents
FOR INSERT TO authenticated WITH CHECK (
  public.can_view_module(auth.uid(),'documents') AND uploaded_by=auth.uid()
  AND (confidentiality <> 'restricted' OR public.is_admin(auth.uid()))
);
DROP POLICY IF EXISTS "documents delete any documents user" ON public.documents;
CREATE POLICY "documents delete any documents user" ON public.documents
FOR DELETE TO authenticated USING (
  public.can_view_module(auth.uid(),'documents')
  AND (confidentiality <> 'restricted' OR public.is_admin(auth.uid()))
);

-- Storage layer must enforce the same restriction independently of metadata RLS.
DROP POLICY IF EXISTS docs_restricted_storage_guard ON storage.objects;
CREATE POLICY docs_restricted_storage_guard ON storage.objects AS RESTRICTIVE
FOR ALL TO authenticated
USING (bucket_id <> 'client-documents' OR NOT public.is_restricted_document_path('client-documents',name) OR public.is_admin(auth.uid()))
WITH CHECK (bucket_id <> 'client-documents' OR NOT public.is_restricted_document_path('client-documents',name) OR public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "docs storage read by rank" ON storage.objects;
CREATE POLICY "docs storage read by rank" ON storage.objects FOR SELECT TO authenticated
USING (
  (bucket_id='client-documents' AND public.can_view_module(auth.uid(),'documents'))
  OR (bucket_id='audit-workpapers' AND public.can_view_module(auth.uid(),'audit'))
  OR (bucket_id='tax-acks' AND public.can_view_module(auth.uid(),'tax'))
);
DROP POLICY IF EXISTS "tax filing evidence storage read" ON storage.objects;
CREATE POLICY "tax filing evidence storage read" ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id='client-documents' AND public.can_view_module(auth.uid(),'tax')
  AND (storage.foldername(name))[2]='tax-returns'
  AND EXISTS(SELECT 1 FROM public.tax_returns t
    WHERE t.id::text=(storage.foldername(name))[3] AND t.client_id::text=(storage.foldername(name))[1])
);
DROP POLICY IF EXISTS "tax filing evidence storage upload" ON storage.objects;
CREATE POLICY "tax filing evidence storage upload" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id='client-documents' AND public.has_full_module(auth.uid(),'tax')
  AND (storage.foldername(name))[2]='tax-returns'
  AND EXISTS(SELECT 1 FROM public.tax_returns t
    WHERE t.id::text=(storage.foldername(name))[3] AND t.client_id::text=(storage.foldername(name))[1])
);
DROP POLICY IF EXISTS "docs storage insert any documents user" ON storage.objects;
CREATE POLICY "docs storage insert any documents user" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id='client-documents' AND public.can_view_module(auth.uid(),'documents'));
DROP POLICY IF EXISTS "docs storage delete any documents user" ON storage.objects;
CREATE POLICY "docs storage delete any documents user" ON storage.objects FOR DELETE TO authenticated
USING (bucket_id='client-documents' AND public.can_view_module(auth.uid(),'documents'));
DROP POLICY IF EXISTS "tax filing storage delete by tax access" ON storage.objects;
CREATE POLICY "tax filing storage delete by tax access" ON storage.objects FOR DELETE TO authenticated
USING (bucket_id='client-documents' AND split_part(name,'/',2)='tax-returns' AND public.can_view_module(auth.uid(),'tax'));

NOTIFY pgrst,'reload schema';
