-- service_projects / service_milestones / service_milestone_documents back
-- the shared "Service Module" workspace for ICT, Outsourced Accounting,
-- Payroll Management and Financial & Business Management
-- (src/components/service-module.tsx). They were still on a blanket
-- is_staff() policy; gate them by the same module-rank model as everything
-- else, keyed off service_projects.module (which already matches our module
-- names 1:1).

DROP POLICY IF EXISTS "service projects staff all" ON public.service_projects;

CREATE POLICY "service projects select by rank" ON public.service_projects
  FOR SELECT TO authenticated USING (public.can_view_module_all(auth.uid(), module::text));
CREATE POLICY "service projects insert full only" ON public.service_projects
  FOR INSERT TO authenticated WITH CHECK (public.has_full_module(auth.uid(), module::text));
CREATE POLICY "service projects update full only" ON public.service_projects
  FOR UPDATE TO authenticated USING (public.has_full_module(auth.uid(), module::text));
CREATE POLICY "service projects delete full only" ON public.service_projects
  FOR DELETE TO authenticated USING (public.has_full_module(auth.uid(), module::text));

DROP POLICY IF EXISTS "service milestones staff all" ON public.service_milestones;

CREATE POLICY "service milestones by parent project" ON public.service_milestones
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.service_projects p
      WHERE p.id = service_milestones.project_id
        AND public.can_view_module_all(auth.uid(), p.module::text)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.service_projects p
      WHERE p.id = service_milestones.project_id
        AND public.has_full_module(auth.uid(), p.module::text)
    )
  );

DROP POLICY IF EXISTS "service milestone documents staff all" ON public.service_milestone_documents;

CREATE POLICY "service milestone documents by parent" ON public.service_milestone_documents
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.service_milestones m
      JOIN public.service_projects p ON p.id = m.project_id
      WHERE m.id = service_milestone_documents.milestone_id
        AND public.can_view_module_all(auth.uid(), p.module::text)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.service_milestones m
      JOIN public.service_projects p ON p.id = m.project_id
      WHERE m.id = service_milestone_documents.milestone_id
        AND public.has_full_module(auth.uid(), p.module::text)
    )
  );
