CREATE TABLE public.calendar_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'reminder',
  event_date DATE NOT NULL,
  event_time TIME,
  recurrence TEXT NOT NULL DEFAULT 'once',
  client_id UUID,
  engagement_id UUID,
  assigned_to UUID,
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.calendar_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "calendar events all staff" ON public.calendar_events
  FOR ALL TO authenticated
  USING (public.is_staff(auth.uid()))
  WITH CHECK (public.is_staff(auth.uid()));

CREATE INDEX idx_calendar_events_date ON public.calendar_events(event_date);