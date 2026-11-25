-- Njia Smart repair 15: apply paused-client access guard to client document objects in Storage.
CREATE OR REPLACE FUNCTION public.document_path_client_accessible(_path text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_segment text:=split_part(COALESCE(_path,''),'/',1); v_client uuid;
BEGIN
 IF v_segment !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RETURN false; END IF;
 v_client:=v_segment::uuid;
 RETURN public.can_access_client(v_client);
END;
$$;
REVOKE ALL ON FUNCTION public.document_path_client_accessible(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.document_path_client_accessible(text) TO authenticated,service_role;

DROP POLICY IF EXISTS paused_client_document_storage_guard ON storage.objects;
CREATE POLICY paused_client_document_storage_guard ON storage.objects AS RESTRICTIVE
FOR ALL TO authenticated
USING(bucket_id<>'client-documents' OR public.document_path_client_accessible(name))
WITH CHECK(bucket_id<>'client-documents' OR public.document_path_client_accessible(name));
NOTIFY pgrst,'reload schema';