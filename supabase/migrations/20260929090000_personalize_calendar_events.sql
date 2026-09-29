-- ============================================================================
-- Personalize the calendar per account.
--
-- Previously "calendar events all staff" gave every staff member full
-- SELECT/INSERT/UPDATE/DELETE on every row, so the whole team's calendar
-- was one shared board. Replace it with ownership-scoped policies:
--   - you see an event if you created it, you're the assignee, or you're
--     an admin/director (who still need full visibility for oversight)
--   - you can only create an event as yourself (created_by = auth.uid())
--   - you can only edit/delete your own events, or ones assigned to you,
--     or any event if you're an admin
-- ============================================================================

DROP POLICY IF EXISTS "calendar events all staff" ON public.calendar_events;

CREATE POLICY "calendar events select own" ON public.calendar_events
  FOR SELECT TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR created_by = auth.uid()
    OR assigned_to = auth.uid()
  );

CREATE POLICY "calendar events insert own" ON public.calendar_events
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_staff(auth.uid())
    AND created_by = auth.uid()
  );

CREATE POLICY "calendar events update own" ON public.calendar_events
  FOR UPDATE TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR created_by = auth.uid()
    OR assigned_to = auth.uid()
  )
  WITH CHECK (
    public.is_admin(auth.uid())
    OR created_by = auth.uid()
    OR assigned_to = auth.uid()
  );

CREATE POLICY "calendar events delete own" ON public.calendar_events
  FOR DELETE TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR created_by = auth.uid()
  );
