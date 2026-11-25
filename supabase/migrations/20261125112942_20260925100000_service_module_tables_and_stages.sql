-- ============================================================================
-- Backing tables for the shared "Service Module" workspace used by ICT,
-- Outsourced Accounting, Payroll Management and Financial Business
-- Management (src/components/service-module.tsx).
--
-- Written idempotently (IF NOT EXISTS / DROP POLICY IF EXISTS) since these
-- tables may already exist from an earlier attempt.
--
-- Outsourced Accounting, Payroll Management and Financial Business
-- Management now run a fixed 7-step pipeline (the 6th value, "closed", is
-- the terminal state used only by close-out, same pattern as Advisory):
--   Onboarding -> Requirements -> Scope -> Assignment -> Monitoring
--   -> Invoicing -> Closed
-- ICT keeps the original deliverable-style pipeline (kickoff..signoff).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.service_projects (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module        text NOT NULL CHECK (module IN ('ict','outsourced_accounting','payroll_management','financial_business_management')),
  client_id     uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  title         text NOT NULL,
  description   text,
  status        text NOT NULL DEFAULT 'not_started',
  stage         text NOT NULL DEFAULT 'onboarding',
  start_date    date,
  due_date      date,
  closure_notes text,
  closed_at     timestamptz,
  closed_by     uuid REFERENCES auth.users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_service_projects_module ON public.service_projects(module);
CREATE INDEX IF NOT EXISTS idx_service_projects_client ON public.service_projects(client_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.service_projects TO authenticated;
GRANT ALL ON public.service_projects TO service_role;
ALTER TABLE public.service_projects ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service projects staff all" ON public.service_projects;
CREATE POLICY "service projects staff all" ON public.service_projects FOR ALL TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

CREATE TABLE IF NOT EXISTS public.service_milestones (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES public.service_projects(id) ON DELETE CASCADE,
  title        text NOT NULL,
  due_date     date,
  done         boolean NOT NULL DEFAULT false,
  notes        text,
  assigned_to  uuid REFERENCES auth.users(id),
  stage        text,
  completed_at timestamptz,
  verified     boolean NOT NULL DEFAULT false,
  verified_by  uuid REFERENCES auth.users(id),
  verified_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_service_milestones_project ON public.service_milestones(project_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.service_milestones TO authenticated;
GRANT ALL ON public.service_milestones TO service_role;
ALTER TABLE public.service_milestones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service milestones staff all" ON public.service_milestones;
CREATE POLICY "service milestones staff all" ON public.service_milestones FOR ALL TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

CREATE TABLE IF NOT EXISTS public.service_milestone_documents (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  milestone_id  uuid NOT NULL REFERENCES public.service_milestones(id) ON DELETE CASCADE,
  title         text NOT NULL,
  file_path     text NOT NULL,
  uploaded_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  verified      boolean NOT NULL DEFAULT false,
  verified_by   uuid REFERENCES auth.users(id),
  verified_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_smd_milestone ON public.service_milestone_documents(milestone_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.service_milestone_documents TO authenticated;
GRANT ALL ON public.service_milestone_documents TO service_role;
ALTER TABLE public.service_milestone_documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service milestone documents staff all" ON public.service_milestone_documents;
CREATE POLICY "service milestone documents staff all" ON public.service_milestone_documents FOR ALL TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

-- Existing rows for the three re-staged modules: remap old free-text stage
-- values (if any) onto the new pipeline so nothing is left in limbo.
UPDATE public.service_projects SET stage = 'onboarding'
  WHERE module IN ('outsourced_accounting','payroll_management','financial_business_management')
    AND stage NOT IN ('onboarding','requirements','scope','assignment','monitoring','invoicing','closed');

UPDATE public.service_milestones sm SET stage = 'onboarding'
  FROM public.service_projects sp
  WHERE sm.project_id = sp.id
    AND sp.module IN ('outsourced_accounting','payroll_management','financial_business_management')
    AND sm.stage IS NOT NULL
    AND sm.stage NOT IN ('onboarding','requirements','scope','assignment','monitoring','invoicing','closed');