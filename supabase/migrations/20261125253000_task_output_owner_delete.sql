-- Njia Smart repair 17: align task output Storage deletion with uploader-owned metadata deletion.
DROP POLICY IF EXISTS "task outputs files delete" ON storage.objects;
CREATE POLICY "task outputs files delete" ON storage.objects FOR DELETE TO authenticated
USING(bucket_id='task-outputs' AND (owner=auth.uid() OR public.task_is_lead(public.task_output_task(name),auth.uid())));