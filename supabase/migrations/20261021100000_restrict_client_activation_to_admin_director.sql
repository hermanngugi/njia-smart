-- Restrict client activation/deactivation to Admin and Director.
-- Staff may continue updating other client fields under existing RLS policies.
-- This trigger blocks direct API/SQL updates to the pause-state fields for all
-- other authenticated roles, regardless of what the UI exposes.

CREATE OR REPLACE FUNCTION public.guard_client_activation_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (
    NEW.is_paused IS DISTINCT FROM OLD.is_paused
    OR NEW.paused_at IS DISTINCT FROM OLD.paused_at
    OR NEW.paused_by IS DISTINCT FROM OLD.paused_by
  ) AND NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only an Admin or Director can activate or deactivate a client.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_client_activation_changes ON public.clients;
CREATE TRIGGER guard_client_activation_changes
BEFORE UPDATE ON public.clients
FOR EACH ROW
EXECUTE FUNCTION public.guard_client_activation_changes();

COMMENT ON FUNCTION public.guard_client_activation_changes() IS
  'Allows only Admin/Director roles to change clients.is_paused, paused_at, or paused_by; does not restrict other client field updates.';
