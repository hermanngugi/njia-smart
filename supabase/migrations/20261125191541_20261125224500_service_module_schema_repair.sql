-- Njia Smart repair 03: repair shared service-module schema drift.
ALTER TABLE public.service_projects
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS service_type text NOT NULL DEFAULT 'general',
  ADD COLUMN IF NOT EXISTS stage text NOT NULL DEFAULT 'onboarding',
  ADD COLUMN IF NOT EXISTS closure_notes text,
  ADD COLUMN IF NOT EXISTS closed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS invoice_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL;
ALTER TABLE public.service_milestones
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS assigned_to uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS stage text,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS verified boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS verified_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS verified_at timestamptz;
DROP TRIGGER IF EXISTS trg_service_projects_updated_at ON public.service_projects;
CREATE TRIGGER trg_service_projects_updated_at BEFORE UPDATE ON public.service_projects
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
NOTIFY pgrst,'reload schema';