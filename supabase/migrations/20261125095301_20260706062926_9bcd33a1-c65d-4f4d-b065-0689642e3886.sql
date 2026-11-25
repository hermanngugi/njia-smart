-- Add persistent user_name to activity_log so the responsible person is recorded
-- at write time, independent of profile edits or RLS visibility.
ALTER TABLE public.activity_log ADD COLUMN IF NOT EXISTS user_name text;

CREATE OR REPLACE FUNCTION public.log_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_user_name text;
  v_entity_id uuid;
  v_action text;
  v_meta jsonb;
  v_changed jsonb := '{}'::jsonb;
  v_key text;
BEGIN
  IF v_user IS NOT NULL THEN
    SELECT COALESCE(NULLIF(p.full_name, ''), u.email, 'Unknown user')
      INTO v_user_name
      FROM auth.users u
      LEFT JOIN public.profiles p ON p.id = u.id
     WHERE u.id = v_user;
  ELSE
    v_user_name := 'System';
  END IF;

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

  INSERT INTO public.activity_log(user_id, user_name, action, entity, entity_id, meta)
  VALUES (v_user, v_user_name, v_action, TG_TABLE_NAME, v_entity_id, v_meta);

  RETURN COALESCE(NEW, OLD);
END;
$function$;

-- Backfill existing rows from current profiles/users
UPDATE public.activity_log a
   SET user_name = COALESCE(NULLIF(p.full_name, ''), u.email, 'Unknown user')
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.id = u.id
 WHERE a.user_id = u.id AND a.user_name IS NULL;

UPDATE public.activity_log SET user_name = 'System' WHERE user_id IS NULL AND user_name IS NULL;