-- Advisory Phase 1: explicit authority boundaries.
-- Director/Admin control case identity, classification, dates, completion and billing links.
-- Advisory handlers may edit professional title/description and perform day-to-day activity work.
-- All authorization is enforced in PostgreSQL; the UI is only a convenience layer.

-- Existing cases created before created_by was added remain visible under existing rank rules.
-- New cases must carry the authenticated creator identity.

-- Explicit Advisory write allow-list. Do not rely only on the generic module rank: the
-- current role/rank matrix intentionally gives some non-Advisory roles broad access elsewhere.
CREATE OR REPLACE FUNCTION public.can_work_advisory(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = _user_id
      AND ur.role IN ('director', 'admin', 'advisory_officer')
  )
$$;


CREATE OR REPLACE FUNCTION public.guard_advisory_case_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.is_admin(auth.uid()) THEN
    RETURN NEW;
  END IF;

  IF auth.uid() IS NULL OR NOT public.can_work_advisory(auth.uid()) THEN
    RAISE EXCEPTION 'You do not have permission to modify Advisory cases.' USING ERRCODE = '42501';
  END IF;

  -- A handler cannot change the case's identity, service classification, ownership,
  -- target dates, financial link, or audit/closure metadata.
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.client_id IS DISTINCT FROM OLD.client_id
     OR NEW.stage IS DISTINCT FROM OLD.stage
     OR NEW.start_date IS DISTINCT FROM OLD.start_date
     OR NEW.due_date IS DISTINCT FROM OLD.due_date
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.closed_at IS DISTINCT FROM OLD.closed_at
     OR NEW.closed_by IS DISTINCT FROM OLD.closed_by
     OR NEW.closure_notes IS DISTINCT FROM OLD.closure_notes THEN
    RAISE EXCEPTION 'Only Director/Admin can change protected Advisory case fields.' USING ERRCODE = '42501';
  END IF;

  -- Preserve the existing invoice-generation flow: a handler may link only an invoice
  -- created by that same authenticated user for this exact client. Other invoice-link
  -- changes remain Director/Admin-only.
  IF NEW.invoice_id IS DISTINCT FROM OLD.invoice_id AND NOT EXISTS (
    SELECT 1 FROM public.invoices i
    WHERE i.id = NEW.invoice_id
      AND i.client_id = NEW.client_id
      AND i.created_by = auth.uid()
      AND OLD.invoice_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Only Director/Admin or the authorized invoice flow can change the invoice link.' USING ERRCODE = '42501';
  END IF;

  -- Completion must go through a controlled close-out flow (implemented in a later phase).
  IF NEW.status IS DISTINCT FROM OLD.status
     AND (NEW.status::text = 'completed' OR OLD.status::text = 'completed') THEN
    RAISE EXCEPTION 'Only Director/Admin can change a completed Advisory case or mark a case completed until completion controls are enabled.' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_advisory_case_update ON public.advisory_projects;
CREATE TRIGGER trg_guard_advisory_case_update
BEFORE UPDATE ON public.advisory_projects
FOR EACH ROW EXECUTE FUNCTION public.guard_advisory_case_update();

-- Case access: view follows module RBAC; creation and edits require full Advisory access.
DROP POLICY IF EXISTS "advisory projects select by rank" ON public.advisory_projects;
DROP POLICY IF EXISTS "advisory projects insert full only" ON public.advisory_projects;
DROP POLICY IF EXISTS "advisory projects update by rank" ON public.advisory_projects;
DROP POLICY IF EXISTS "advisory projects delete owner or admin" ON public.advisory_projects;
DROP POLICY IF EXISTS "advisory projects delete admin" ON public.advisory_projects;
DROP POLICY IF EXISTS "advisory projects select staff" ON public.advisory_projects;
DROP POLICY IF EXISTS "advisory projects insert staff" ON public.advisory_projects;
DROP POLICY IF EXISTS "advisory projects update staff" ON public.advisory_projects;
DROP POLICY IF EXISTS "advisory projects all staff" ON public.advisory_projects;

CREATE POLICY "advisory cases select by rank" ON public.advisory_projects
  FOR SELECT TO authenticated
  USING (
    public.can_view_module_all(auth.uid(), 'advisory')
    OR (
      public.is_module_assigned_only(auth.uid(), 'advisory')
      AND (
        advisory_projects.created_by = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.client_assignments ca
          WHERE ca.client_id = advisory_projects.client_id AND ca.user_id = auth.uid()
        )
      )
    )
  );

CREATE POLICY "advisory cases insert full access" ON public.advisory_projects
  FOR INSERT TO authenticated
  WITH CHECK (
    public.can_work_advisory(auth.uid())
    AND (public.is_admin(auth.uid()) OR created_by = auth.uid())
  );

CREATE POLICY "advisory cases update full access" ON public.advisory_projects
  FOR UPDATE TO authenticated
  USING (public.can_work_advisory(auth.uid()))
  WITH CHECK (public.can_work_advisory(auth.uid()));

-- No handler can delete a case, including one they created. Use cancel/archive in a later phase.
CREATE POLICY "advisory cases delete director admin" ON public.advisory_projects
  FOR DELETE TO authenticated
  USING (public.is_admin(auth.uid()));

-- Activity rows: handlers may create and update work items, but cannot change parent,
-- verification metadata or audit timestamps. Only Director/Admin can delete at this stage,
-- until mandatory vs optional activities are modeled explicitly.
CREATE OR REPLACE FUNCTION public.guard_advisory_activity_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.is_admin(auth.uid()) THEN
    RETURN NEW;
  END IF;

  IF auth.uid() IS NULL OR NOT public.can_work_advisory(auth.uid()) THEN
    RAISE EXCEPTION 'You do not have permission to modify Advisory activities.' USING ERRCODE = '42501';
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.project_id IS DISTINCT FROM OLD.project_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.verified IS DISTINCT FROM OLD.verified
     OR NEW.verified_by IS DISTINCT FROM OLD.verified_by
     OR NEW.verified_at IS DISTINCT FROM OLD.verified_at
     OR NEW.stage IS DISTINCT FROM OLD.stage THEN
    RAISE EXCEPTION 'Only Director/Admin can change protected activity fields.' USING ERRCODE = '42501';
  END IF;

  -- Activity completion timestamps are system-controlled; do not accept client-supplied backdating.
  IF NEW.done IS DISTINCT FROM OLD.done THEN
    NEW.completed_at := CASE WHEN NEW.done THEN now() ELSE NULL END;
  ELSIF NEW.completed_at IS DISTINCT FROM OLD.completed_at THEN
    RAISE EXCEPTION 'Activity completion timestamps are system-controlled.' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_advisory_activity_update ON public.advisory_milestones;
CREATE TRIGGER trg_guard_advisory_activity_update
BEFORE UPDATE ON public.advisory_milestones
FOR EACH ROW EXECUTE FUNCTION public.guard_advisory_activity_update();

DROP POLICY IF EXISTS "advisory milestones by parent project" ON public.advisory_milestones;
DROP POLICY IF EXISTS "advisory milestones select staff" ON public.advisory_milestones;
DROP POLICY IF EXISTS "advisory milestones insert staff" ON public.advisory_milestones;
DROP POLICY IF EXISTS "advisory milestones update staff" ON public.advisory_milestones;
DROP POLICY IF EXISTS "advisory milestones delete admin" ON public.advisory_milestones;
DROP POLICY IF EXISTS "advisory milestones all staff" ON public.advisory_milestones;

CREATE POLICY "advisory activities select by parent" ON public.advisory_milestones
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.advisory_projects p
      WHERE p.id = advisory_milestones.project_id
        AND (
          public.can_view_module_all(auth.uid(), 'advisory')
          OR (
            public.is_module_assigned_only(auth.uid(), 'advisory')
            AND (
              p.created_by = auth.uid()
              OR EXISTS (SELECT 1 FROM public.client_assignments ca WHERE ca.client_id = p.client_id AND ca.user_id = auth.uid())
            )
          )
        )
    )
  );

CREATE POLICY "advisory activities insert full access" ON public.advisory_milestones
  FOR INSERT TO authenticated
  WITH CHECK (
    public.can_work_advisory(auth.uid())
    AND EXISTS (SELECT 1 FROM public.advisory_projects p WHERE p.id = project_id)
  );

CREATE POLICY "advisory activities update full access" ON public.advisory_milestones
  FOR UPDATE TO authenticated
  USING (
    public.can_work_advisory(auth.uid())
    AND EXISTS (SELECT 1 FROM public.advisory_projects p WHERE p.id = project_id)
  )
  WITH CHECK (
    public.can_work_advisory(auth.uid())
    AND EXISTS (SELECT 1 FROM public.advisory_projects p WHERE p.id = project_id)
  );

CREATE POLICY "advisory activities delete director admin" ON public.advisory_milestones
  FOR DELETE TO authenticated USING (public.is_admin(auth.uid()));

-- Uploaded evidence is append-only for handlers. Director/Admin can correct or remove records.
DROP POLICY IF EXISTS "milestone documents by parent" ON public.advisory_milestone_documents;
DROP POLICY IF EXISTS "Staff can view milestone documents" ON public.advisory_milestone_documents;
DROP POLICY IF EXISTS "Staff can insert milestone documents" ON public.advisory_milestone_documents;
DROP POLICY IF EXISTS "Staff can update milestone documents" ON public.advisory_milestone_documents;
DROP POLICY IF EXISTS "Staff can delete milestone documents" ON public.advisory_milestone_documents;

CREATE POLICY "advisory documents select by parent" ON public.advisory_milestone_documents
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.advisory_milestones m
      JOIN public.advisory_projects p ON p.id = m.project_id
      WHERE m.id = advisory_milestone_documents.milestone_id
        AND public.can_view_module(auth.uid(), 'advisory')
        AND (
          public.can_view_module_all(auth.uid(), 'advisory')
          OR p.created_by = auth.uid()
          OR EXISTS (SELECT 1 FROM public.client_assignments ca WHERE ca.client_id = p.client_id AND ca.user_id = auth.uid())
        )
    )
  );

CREATE POLICY "advisory documents insert full access" ON public.advisory_milestone_documents
  FOR INSERT TO authenticated
  WITH CHECK (
    public.can_work_advisory(auth.uid())
    AND uploaded_by = auth.uid()
    AND EXISTS (SELECT 1 FROM public.advisory_milestones m WHERE m.id = milestone_id)
  );

CREATE POLICY "advisory documents update director admin" ON public.advisory_milestone_documents
  FOR UPDATE TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "advisory documents delete director admin" ON public.advisory_milestone_documents
  FOR DELETE TO authenticated USING (public.is_admin(auth.uid()));

COMMENT ON FUNCTION public.can_work_advisory(uuid) IS
  'Advisory Phase 1 allow-list: Director, Admin and Advisory Officer may perform Advisory work actions.';
COMMENT ON FUNCTION public.guard_advisory_case_update() IS
  'Advisory Phase 1: protects case identity, service classification, deadlines, billing link and completion status from handler edits.';
COMMENT ON FUNCTION public.guard_advisory_activity_update() IS
  'Advisory Phase 1: protects activity parent, verification fields and timestamps from handler edits.';
