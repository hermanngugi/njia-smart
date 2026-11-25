-- Move SECURITY DEFINER implementations out of the exposed public API.
-- RLS policies retain their function dependencies (same OIDs) after SET SCHEMA.
-- Public RPC signatures are preserved as SECURITY INVOKER wrappers.
DO $migration$
DECLARE
  r record;
  v_call_args text;
  v_body text;
  v_guard text;
  v_signature text;
  v_volatility text;
  v_i integer;
  v_n integer;
  v_arg_name text;
BEGIN
  CREATE SCHEMA IF NOT EXISTS private;
  REVOKE ALL ON SCHEMA private FROM PUBLIC, anon;
  GRANT USAGE ON SCHEMA private TO authenticated, service_role;

  FOR r IN
    SELECT p.oid, p.proname, p.proargnames,
           p.proargtypes::oid[] AS input_types,
           oidvectortypes(p.proargtypes) AS input_type_names,
           pg_get_function_arguments(p.oid) AS full_args,
           pg_get_function_result(p.oid) AS result_type,
           p.proretset, p.provolatile
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public'
      AND p.prosecdef
      AND has_function_privilege('authenticated',p.oid,'EXECUTE')
      AND p.prokind='f'
    ORDER BY p.proname
  LOOP
    v_n := COALESCE(cardinality(r.input_types),0);
    v_call_args := '';
    v_guard := '';

    FOR v_i IN 1..v_n LOOP
      IF v_i > 1 THEN v_call_args := v_call_args || ', '; END IF;
      v_call_args := v_call_args || '$' || v_i;
      v_arg_name := r.proargnames[v_i];

      -- Permission helpers accepting a user ID may only be queried about
      -- the caller through the public API. Nested definer routines and
      -- policy expressions continue to use the private implementation.
      IF v_arg_name = '_user_id' THEN
        v_guard := format(
          'IF current_user = ''authenticated'' AND $%s IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION ''Cannot inspect another user'' USING ERRCODE = ''42501''; END IF;',
          v_i
        );
      END IF;
    END LOOP;

    v_signature := format('public.%I(%s)',r.proname,r.input_type_names);
    EXECUTE format('ALTER FUNCTION %s SET SCHEMA private',v_signature);

    IF r.provolatile='s' THEN
      v_volatility := 'STABLE';
    ELSIF r.provolatile='i' THEN
      v_volatility := 'IMMUTABLE';
    ELSE
      v_volatility := 'VOLATILE';
    END IF;

    IF r.proretset THEN
      v_body := 'RETURN QUERY SELECT * FROM private.'||quote_ident(r.proname)||'('||v_call_args||');';
    ELSIF r.result_type='void' THEN
      v_body := 'PERFORM private.'||quote_ident(r.proname)||'('||v_call_args||'); RETURN;';
    ELSE
      v_body := 'RETURN private.'||quote_ident(r.proname)||'('||v_call_args||');';
    END IF;

    v_body := 'BEGIN '||v_guard||
      ' IF current_user = ''authenticated'' AND auth.uid() IS NULL THEN RAISE EXCEPTION ''Authentication required'' USING ERRCODE = ''42501''; END IF; '||
      v_body||' END;';

    EXECUTE format(
      'CREATE FUNCTION public.%I(%s) RETURNS %s LANGUAGE plpgsql %s SECURITY INVOKER SET search_path = pg_catalog, public, private AS %L',
      r.proname, r.full_args, r.result_type, v_volatility, v_body
    );

    EXECUTE format('REVOKE ALL ON FUNCTION private.%I(%s) FROM PUBLIC, anon',r.proname,r.input_type_names);
    EXECUTE format('GRANT EXECUTE ON FUNCTION private.%I(%s) TO authenticated, service_role',r.proname,r.input_type_names);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC, anon',r.proname,r.input_type_names);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO authenticated',r.proname,r.input_type_names);
  END LOOP;
END
$migration$;

NOTIFY pgrst, 'reload schema';