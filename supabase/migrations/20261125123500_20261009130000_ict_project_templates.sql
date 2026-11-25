-- ICT project delivery templates. Existing projects remain valid and are marked
-- as general; only newly created projects selected from the template picker
-- receive generated milestone rows.
ALTER TABLE public.service_projects
  ADD COLUMN IF NOT EXISTS service_type text NOT NULL DEFAULT 'general';

CREATE INDEX IF NOT EXISTS idx_service_projects_module_type
  ON public.service_projects (module, service_type);

COMMENT ON COLUMN public.service_projects.service_type IS
  'Service-specific project template key; currently used by ICT project delivery.';
