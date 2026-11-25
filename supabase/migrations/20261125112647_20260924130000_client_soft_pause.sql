-- Soft-pause for clients: distinct from the workflow `status` and from
-- deletion — a paused client is hidden from "active" views but its data,
-- history and relationships are untouched, and it can be resumed any time.
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS is_paused boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS paused_at timestamptz,
  ADD COLUMN IF NOT EXISTS paused_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_clients_is_paused ON public.clients(is_paused);
