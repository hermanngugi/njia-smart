
-- Generic audit trigger function
CREATE OR REPLACE FUNCTION public.log_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_entity_id uuid;
  v_action text;
  v_meta jsonb;
  v_changed jsonb := '{}'::jsonb;
  v_key text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_action := 'create';
    v_entity_id := (to_jsonb(NEW)->>'id')::uuid;
    v_meta := jsonb_build_object('new', to_jsonb(NEW));
  ELSIF TG_OP = 'UPDATE' THEN
    v_action := 'update';
    v_entity_id := (to_jsonb(NEW)->>'id')::uuid;
    FOR v_key IN SELECT jsonb_object_keys(to_jsonb(NEW)) LOOP
      IF to_jsonb(NEW)->v_key IS DISTINCT FROM to_jsonb(OLD)->v_key
         AND v_key NOT IN ('updated_at') THEN
        v_changed := v_changed || jsonb_build_object(v_key, jsonb_build_object('from', to_jsonb(OLD)->v_key, 'to', to_jsonb(NEW)->v_key));
      END IF;
    END LOOP;
    IF v_changed = '{}'::jsonb THEN
      RETURN NEW;
    END IF;
    v_meta := jsonb_build_object('changed', v_changed);
  ELSIF TG_OP = 'DELETE' THEN
    v_action := 'delete';
    v_entity_id := (to_jsonb(OLD)->>'id')::uuid;
    v_meta := jsonb_build_object('old', to_jsonb(OLD));
  END IF;

  INSERT INTO public.activity_log(user_id, action, entity, entity_id, meta)
  VALUES (v_user, v_action, TG_TABLE_NAME, v_entity_id, v_meta);

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Attach to key tables
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'clients','tasks','tax_returns','engagements','advisory_projects',
    'advisory_milestones','announcements','audit_workpapers','audit_review_notes',
    'documents','calendar_events','client_assignments','tax_return_assignees',
    'user_roles','profiles'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_log_activity ON public.%I', t);
    EXECUTE format('CREATE TRIGGER trg_log_activity AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.log_activity()', t);
  END LOOP;
END $$;

-- Helpful index
CREATE INDEX IF NOT EXISTS activity_log_created_at_idx ON public.activity_log(created_at DESC);
CREATE INDEX IF NOT EXISTS activity_log_entity_idx ON public.activity_log(entity, entity_id);
CREATE INDEX IF NOT EXISTS activity_log_user_idx ON public.activity_log(user_id);
