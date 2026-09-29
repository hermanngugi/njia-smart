-- ============================================================================
-- Balance personalization with an explicit choice, instead of an admin
-- override: the creator marks each event 'private' (only them + whoever
-- it's assigned to) or 'team' (anyone on staff can see it). No role gets
-- a blanket bypass — a director's own calendar is exactly as personal as
-- anyone else's unless they choose to share an event.
-- ============================================================================

ALTER TABLE public.calendar_events
  ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'private'
    CHECK (visibility IN ('private', 'team'));

DROP POLICY IF EXISTS "calendar events select own" ON public.calendar_events;
DROP POLICY IF EXISTS "calendar events update own" ON public.calendar_events;
DROP POLICY IF EXISTS "calendar events delete own" ON public.calendar_events;

CREATE POLICY "calendar events select own or team" ON public.calendar_events
  FOR SELECT TO authenticated
  USING (
    visibility = 'team'
    OR created_by = auth.uid()
    OR assigned_to = auth.uid()
  );

CREATE POLICY "calendar events update own" ON public.calendar_events
  FOR UPDATE TO authenticated
  USING (created_by = auth.uid() OR assigned_to = auth.uid())
  WITH CHECK (created_by = auth.uid() OR assigned_to = auth.uid());

CREATE POLICY "calendar events delete own" ON public.calendar_events
  FOR DELETE TO authenticated
  USING (created_by = auth.uid());

-- Insert policy is unchanged (you can only ever create as yourself) — no
-- edit needed there.
