-- Multi-person assignees for tax returns (collaboration)
CREATE TABLE public.tax_return_assignees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tax_return_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tax_return_id, user_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tax_return_assignees TO authenticated;
GRANT ALL ON public.tax_return_assignees TO service_role;

ALTER TABLE public.tax_return_assignees ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tax assignees all staff"
ON public.tax_return_assignees
FOR ALL
TO authenticated
USING (is_staff(auth.uid()))
WITH CHECK (is_staff(auth.uid()));

CREATE INDEX idx_tax_return_assignees_return ON public.tax_return_assignees(tax_return_id);
CREATE INDEX idx_tax_return_assignees_user ON public.tax_return_assignees(user_id);