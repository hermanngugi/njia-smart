-- ============================================================================
-- Notifications: remember WHO triggered each one.
-- actor_id is filled in by the database with the signed-in user who created the
-- notification (so it can't be spoofed from the browser). Used by the
-- "new task assigned" popup to say who sent the task.
-- ============================================================================
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS actor_id uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL;

-- Fast lookup of a person's unread notifications of one kind (the popup queue).
CREATE INDEX IF NOT EXISTS notifications_unread_by_type_idx
  ON public.notifications (user_id, type) WHERE read_at IS NULL;
