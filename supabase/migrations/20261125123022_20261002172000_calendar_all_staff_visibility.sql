-- Allow every staff member to view calendar bookings/highlights.
-- Editing and deletion remain ownership/assignment controlled.

DROP POLICY IF EXISTS "calendar events select own or team" ON public.calendar_events;
DROP POLICY IF EXISTS "calendar events select own" ON public.calendar_events;

CREATE POLICY "calendar events select all staff"
ON public.calendar_events
FOR SELECT TO authenticated
USING (public.is_staff(auth.uid()));

-- Keep creation available to staff only and require the creator to be the
-- authenticated user. Existing update/delete policies are intentionally left
-- unchanged so viewing the calendar does not grant editing/deletion rights.
DROP POLICY IF EXISTS "calendar events insert own" ON public.calendar_events;
CREATE POLICY "calendar events insert own"
ON public.calendar_events
FOR INSERT TO authenticated
WITH CHECK (
  public.is_staff(auth.uid())
  AND created_by = auth.uid()
);
