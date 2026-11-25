-- Repairs schema drift on the shared service-module tables (ICT, Outsourced
-- Accounting, Payroll Management, Financial & Business Management).
--
-- The tables were first created by an earlier attempt, and CREATE TABLE IF NOT
-- EXISTS never adds columns that were missing then. The module page reads all
-- of the columns below, so a missing one made its project list fail while the
-- ICT dashboard cards (which read fewer columns) still counted the projects.
-- Every statement is idempotent: columns that already exist are left alone.

ALTER TABLE public.service_projects
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS closed_at  timestamptz;

-- updated_at gets its own step: when it is missing, existing projects are
-- backfilled from their creation/close date so "recently updated" ordering is
-- sensible straight away (user triggers are off for that one statement).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'service_projects' AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE public.service_projects ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
    ALTER TABLE public.service_projects DISABLE TRIGGER USER;
    UPDATE public.service_projects SET updated_at = COALESCE(closed_at, created_at, now());
    ALTER TABLE public.service_projects ENABLE TRIGGER USER;
  END IF;
END $$;

ALTER TABLE public.service_projects
  ADD COLUMN IF NOT EXISTS service_type  text NOT NULL DEFAULT 'general',
  ADD COLUMN IF NOT EXISTS stage         text NOT NULL DEFAULT 'onboarding',
  ADD COLUMN IF NOT EXISTS closure_notes text,
  ADD COLUMN IF NOT EXISTS closed_at     timestamptz,
  ADD COLUMN IF NOT EXISTS closed_by     uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS created_at    timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at    timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS invoice_id    uuid REFERENCES public.invoices(id) ON DELETE SET NULL;

ALTER TABLE public.service_milestones
  ADD COLUMN IF NOT EXISTS notes        text,
  ADD COLUMN IF NOT EXISTS assigned_to  uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS stage        text,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS verified     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS verified_by  uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS verified_at  timestamptz;

-- Keep updated_at current on every edit (the list sorts by it).
DROP TRIGGER IF EXISTS trg_service_projects_updated_at ON public.service_projects;
CREATE TRIGGER trg_service_projects_updated_at
BEFORE UPDATE ON public.service_projects
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Make PostgREST pick up the columns straight away.
NOTIFY pgrst, 'reload schema';
