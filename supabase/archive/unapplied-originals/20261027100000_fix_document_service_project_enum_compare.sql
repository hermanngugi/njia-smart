-- Fix: uploading a document linked to a service project (ICT, Outsourced
-- Accounting, Payroll Management, Financial Business Management) failed with
--   operator does not exist: service_module_type = text
-- service_projects.module is the enum service_module_type, while
-- documents.service_line is text. The document link check compared them
-- directly; it now casts the enum to text. Nothing else in the function changed.

CREATE OR REPLACE FUNCTION public.validate_document_client_links()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.confidentiality = 'restricted' AND NOT public.is_admin(auth.uid()) THEN
    IF NEW.confidentiality <> 'restricted' THEN
      RAISE EXCEPTION 'Only director/admin may remove restricted access from a document';
    END IF;
    IF NEW.file_path IS DISTINCT FROM OLD.file_path
       OR NEW.storage_bucket IS DISTINCT FROM OLD.storage_bucket
       OR NEW.client_id IS DISTINCT FROM OLD.client_id THEN
      RAISE EXCEPTION 'Only director/admin may move a restricted document';
    END IF;
  END IF;

  -- Preserve the existing Tax upload flow: older clients only set tax_return_id.
  IF NEW.tax_return_id IS NOT NULL THEN
    NEW.document_group := 'service';
    NEW.service_line := 'tax';
    IF NEW.category IS NULL OR NEW.category = 'general_supporting' THEN NEW.category := 'tax_filing'; END IF;
  ELSIF NEW.engagement_id IS NOT NULL THEN
    NEW.document_group := 'service';
    SELECT e.type::text INTO NEW.service_line FROM public.engagements e WHERE e.id = NEW.engagement_id;
    IF NEW.category IS NULL OR NEW.category = 'general_supporting' THEN
      NEW.category := CASE NEW.service_line
        WHEN 'tax' THEN 'tax_filing'
        WHEN 'advisory' THEN 'advisory_assignment'
        ELSE 'audit_evidence'
      END;
    END IF;
  END IF;

  IF NEW.document_group = 'client_master' THEN
    NEW.service_line := NULL;
    NEW.engagement_id := NULL;
    NEW.tax_return_id := NULL;
    NEW.service_project_id := NULL;
    NEW.advisory_project_id := NULL;
  ELSIF NEW.service_line IS NULL THEN
    RAISE EXCEPTION 'Choose a service line for service documents';
  END IF;

  IF NEW.engagement_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.engagements e WHERE e.id = NEW.engagement_id AND e.client_id = NEW.client_id
  ) THEN
    RAISE EXCEPTION 'The selected audit engagement does not belong to this client';
  END IF;

  IF NEW.tax_return_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.tax_returns tr WHERE tr.id = NEW.tax_return_id AND tr.client_id = NEW.client_id
  ) THEN
    RAISE EXCEPTION 'The selected tax return does not belong to this client';
  END IF;

  IF NEW.service_project_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.service_projects sp
    WHERE sp.id = NEW.service_project_id AND sp.client_id = NEW.client_id
      AND sp.module::text = NEW.service_line
  ) THEN
    RAISE EXCEPTION 'The selected service project does not belong to this client or service';
  END IF;

  IF NEW.advisory_project_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.advisory_projects ap
    WHERE ap.id = NEW.advisory_project_id AND ap.client_id = NEW.client_id
      AND NEW.service_line = 'advisory'
  ) THEN
    RAISE EXCEPTION 'The selected advisory project does not belong to this client';
  END IF;

  IF NEW.document_group = 'service' AND NEW.engagement_id IS NULL
     AND NEW.tax_return_id IS NULL AND NEW.service_project_id IS NULL
     AND NEW.advisory_project_id IS NULL THEN
    -- Service documents may be general to a service line, without a specific
    -- project/period; the service_line still categorizes and links them.
    NULL;
  END IF;
  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
