-- 1) Revoke EXECUTE from anon (and public) on SECURITY DEFINER / internal functions
REVOKE ALL ON FUNCTION public.verify_client_portal_password(uuid, text) FROM anon, public;
REVOKE ALL ON FUNCTION public.next_invoice_number() FROM anon, public;
REVOKE ALL ON FUNCTION public.recompute_invoice(uuid) FROM anon, public;
REVOKE ALL ON FUNCTION public.tg_recompute_invoice_items() FROM anon, public;
REVOKE ALL ON FUNCTION public.tg_recompute_invoice_payments() FROM anon, public;
REVOKE ALL ON FUNCTION public.set_updated_at() FROM anon, public;

GRANT EXECUTE ON FUNCTION public.verify_client_portal_password(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.next_invoice_number() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.recompute_invoice(uuid) TO service_role;

-- 2) Fix mutable search_path
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $function$;

-- 3) profiles: explicit self-insert policy
DROP POLICY IF EXISTS "profiles insert self" ON public.profiles;
CREATE POLICY "profiles insert self" ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid());

-- 4) advisory: explicit delete restricted to admins/directors
DROP POLICY IF EXISTS "advisory projects all staff" ON public.advisory_projects;
CREATE POLICY "advisory projects select staff" ON public.advisory_projects
  FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "advisory projects insert staff" ON public.advisory_projects
  FOR INSERT TO authenticated WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "advisory projects update staff" ON public.advisory_projects
  FOR UPDATE TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "advisory projects delete admin" ON public.advisory_projects
  FOR DELETE TO authenticated USING (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "advisory milestones all staff" ON public.advisory_milestones;
CREATE POLICY "advisory milestones select staff" ON public.advisory_milestones
  FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "advisory milestones insert staff" ON public.advisory_milestones
  FOR INSERT TO authenticated WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "advisory milestones update staff" ON public.advisory_milestones
  FOR UPDATE TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "advisory milestones delete admin" ON public.advisory_milestones
  FOR DELETE TO authenticated USING (public.is_admin(auth.uid()));