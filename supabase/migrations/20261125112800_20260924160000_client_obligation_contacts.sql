-- Per tax-obligation portal access + extra contacts.
--
-- Different tax types are often filed through different portals (iTax,
-- NSSF, SHA...) with their own login and their own point of contact at the
-- client, separate from the client's general contacts list and separate
-- from their client-portal login. One row of "login" details per
-- client+tax_type, and any number of extra contacts per client+tax_type.

CREATE TABLE IF NOT EXISTS public.client_obligation_logins (
  client_id      uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  tax_type       text NOT NULL REFERENCES public.tax_policies(tax_type),
  login_email    text,
  login_password text,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     uuid REFERENCES auth.users(id),
  PRIMARY KEY (client_id, tax_type)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_obligation_logins TO authenticated;
GRANT ALL ON public.client_obligation_logins TO service_role;
ALTER TABLE public.client_obligation_logins ENABLE ROW LEVEL SECURITY;

CREATE POLICY "obligation logins all staff" ON public.client_obligation_logins FOR ALL TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

CREATE TABLE IF NOT EXISTS public.client_obligation_contacts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id  uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  tax_type   text NOT NULL REFERENCES public.tax_policies(tax_type),
  name       text NOT NULL,
  email      text,
  phone      text,
  notes      text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_obligation_contacts TO authenticated;
GRANT ALL ON public.client_obligation_contacts TO service_role;
ALTER TABLE public.client_obligation_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "obligation contacts all staff" ON public.client_obligation_contacts FOR ALL TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

CREATE INDEX IF NOT EXISTS idx_obligation_contacts_client_type ON public.client_obligation_contacts(client_id, tax_type);
