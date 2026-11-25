-- Activity (audit trail) is now Admin + ICT Officer only — Director is
-- explicitly excluded by the updated matrix. The old policy used is_admin()
-- which also covers Director, so swap it for a module-rank check.
DROP POLICY IF EXISTS "activity select admin" ON public.activity_log;
CREATE POLICY "activity select by rank" ON public.activity_log
  FOR SELECT TO authenticated USING (public.can_view_module_all(auth.uid(), 'activity'));
-- insert stays open to any staff member (the trigger-driven audit trail
-- itself is still written for everyone's actions, only *reading* it back is restricted).
