ALTER TABLE public.clients
  ADD COLUMN portal_password text,
  ADD COLUMN portal_password_updated_at timestamptz,
  ADD COLUMN portal_password_updated_by uuid REFERENCES auth.users(id);