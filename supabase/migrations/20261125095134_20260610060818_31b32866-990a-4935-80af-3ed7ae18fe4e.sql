
CREATE TABLE public.advisory_milestone_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  milestone_id uuid NOT NULL REFERENCES public.advisory_milestones(id) ON DELETE CASCADE,
  title text NOT NULL,
  file_path text NOT NULL,
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.advisory_milestone_documents TO authenticated;
GRANT ALL ON public.advisory_milestone_documents TO service_role;

ALTER TABLE public.advisory_milestone_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can view milestone documents"
  ON public.advisory_milestone_documents FOR SELECT
  TO authenticated USING (public.is_staff(auth.uid()));

CREATE POLICY "Staff can insert milestone documents"
  ON public.advisory_milestone_documents FOR INSERT
  TO authenticated WITH CHECK (public.is_staff(auth.uid()));

CREATE POLICY "Staff can update milestone documents"
  ON public.advisory_milestone_documents FOR UPDATE
  TO authenticated USING (public.is_staff(auth.uid()));

CREATE POLICY "Staff can delete milestone documents"
  ON public.advisory_milestone_documents FOR DELETE
  TO authenticated USING (public.is_staff(auth.uid()));

CREATE INDEX idx_amd_milestone ON public.advisory_milestone_documents(milestone_id);
