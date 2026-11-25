-- Trigger functions are not application RPC endpoints. Remove direct EXECUTE
-- grants while preserving their already-installed trigger bindings.
DO $$
DECLARE r record;
BEGIN
 FOR r IN
  SELECT p.oid::regprocedure AS signature
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.prosecdef
    AND p.prorettype::regtype::text IN ('trigger','event_trigger')
 LOOP
  EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC,anon,authenticated',r.signature);
 END LOOP;
END $$;