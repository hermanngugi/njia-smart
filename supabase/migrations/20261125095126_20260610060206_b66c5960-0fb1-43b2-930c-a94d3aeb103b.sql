
ALTER TYPE public.tax_return_type ADD VALUE IF NOT EXISTS 'mri';
ALTER TYPE public.tax_return_type ADD VALUE IF NOT EXISTS 'nssf';
ALTER TYPE public.tax_return_type ADD VALUE IF NOT EXISTS 'sha';

ALTER TABLE public.advisory_milestones
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS assigned_to uuid REFERENCES auth.users(id) ON DELETE SET NULL;
