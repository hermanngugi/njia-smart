-- Njia Smart repair 05: task workspace, weekly planning and waiting lifecycle.
-- Consolidates the unapplied weekly planning, workspace and waiting-status drafts.
ALTER TYPE public.task_status ADD VALUE IF NOT EXISTS 'waiting_on_client';

ALTER TABLE public.tasks
 ADD COLUMN IF NOT EXISTS week_start date,
 ADD COLUMN IF NOT EXISTS supervisor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 ADD COLUMN IF NOT EXISTS progress smallint NOT NULL DEFAULT 0,
 ADD COLUMN IF NOT EXISTS needs_guidance boolean NOT NULL DEFAULT false,
 ADD COLUMN IF NOT EXISTS waiting_since timestamptz,
 ADD COLUMN IF NOT EXISTS waiting_reason text,
 ADD COLUMN IF NOT EXISTS follow_up_on date;
ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_progress_range;
ALTER TABLE public.tasks ADD CONSTRAINT tasks_progress_range CHECK(progress BETWEEN 0 AND 100);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee_week ON public.tasks(assigned_to,week_start);

ALTER TABLE public.task_comments
 ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'note',
 ADD COLUMN IF NOT EXISTS action text,
 ADD COLUMN IF NOT EXISTS ask_guidance boolean NOT NULL DEFAULT false;
ALTER TABLE public.task_comments DROP CONSTRAINT IF EXISTS task_comments_kind_check;
ALTER TABLE public.task_comments ADD CONSTRAINT task_comments_kind_check CHECK(kind IN ('note','feedback','report','guidance','system'));
ALTER TABLE public.task_comments DROP CONSTRAINT IF EXISTS task_comments_action_check;
ALTER TABLE public.task_comments ADD CONSTRAINT task_comments_action_check CHECK(action IS NULL OR action IN ('approved','changes_requested','continue'));
CREATE INDEX IF NOT EXISTS idx_task_comments_task_created ON public.task_comments(task_id,created_at);

CREATE TABLE IF NOT EXISTS public.task_subtasks(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
 title text NOT NULL CHECK(length(trim(title))>0),assigned_to uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 due_date date,done boolean NOT NULL DEFAULT false,done_at timestamptz,
 created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_task_subtasks_task ON public.task_subtasks(task_id);
CREATE INDEX IF NOT EXISTS idx_task_subtasks_assignee ON public.task_subtasks(assigned_to);
ALTER TABLE public.task_subtasks ENABLE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.task_subtasks TO authenticated;
GRANT ALL ON public.task_subtasks TO service_role;

CREATE TABLE IF NOT EXISTS public.task_outputs(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
 file_path text NOT NULL,file_name text NOT NULL,note text,is_final boolean NOT NULL DEFAULT false,
 uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT task_outputs_file_path_task_prefix CHECK(split_part(file_path,'/',1)=task_id::text)
);
CREATE INDEX IF NOT EXISTS idx_task_outputs_task ON public.task_outputs(task_id);
ALTER TABLE public.task_outputs ENABLE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.task_outputs TO authenticated;
GRANT ALL ON public.task_outputs TO service_role;

CREATE OR REPLACE FUNCTION public.task_has_access(_task_id uuid,_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT COALESCE(_user_id IS NOT NULL AND (
  public.has_full_module(_user_id,'tasks')
  OR EXISTS(SELECT 1 FROM public.tasks t WHERE t.id=_task_id AND (t.assigned_to=_user_id OR t.created_by=_user_id OR t.supervisor_id=_user_id))
  OR EXISTS(SELECT 1 FROM public.task_subtasks s WHERE s.task_id=_task_id AND s.assigned_to=_user_id)
 ),false);
$$;
CREATE OR REPLACE FUNCTION public.task_is_lead(_task_id uuid,_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT COALESCE(_user_id IS NOT NULL AND (public.is_admin(_user_id) OR EXISTS(
  SELECT 1 FROM public.tasks t WHERE t.id=_task_id AND (t.assigned_to=_user_id OR t.created_by=_user_id OR t.supervisor_id=_user_id)
 )),false);
$$;
CREATE OR REPLACE FUNCTION public.task_is_supervisor(_task_id uuid,_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT COALESCE(_user_id IS NOT NULL AND (public.is_admin(_user_id) OR EXISTS(
  SELECT 1 FROM public.tasks t WHERE t.id=_task_id AND (t.created_by=_user_id OR t.supervisor_id=_user_id)
 )),false);
$$;
REVOKE ALL ON FUNCTION public.task_has_access(uuid,uuid),public.task_is_lead(uuid,uuid),public.task_is_supervisor(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.task_has_access(uuid,uuid),public.task_is_lead(uuid,uuid),public.task_is_supervisor(uuid,uuid) TO authenticated,service_role;

DROP POLICY IF EXISTS "tasks select by rank" ON public.tasks;
CREATE POLICY "tasks select by rank" ON public.tasks FOR SELECT TO authenticated USING(public.task_has_access(id,auth.uid()));
DROP POLICY IF EXISTS "tasks update by rank" ON public.tasks;
CREATE POLICY "tasks update by rank" ON public.tasks FOR UPDATE TO authenticated
USING(public.task_has_access(id,auth.uid()))
WITH CHECK(public.task_has_access(id,auth.uid()));

CREATE OR REPLACE FUNCTION public.tg_tasks_normalize_week()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN IF NEW.week_start IS NOT NULL THEN NEW.week_start:=date_trunc('week',NEW.week_start::timestamp)::date; END IF; RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS trg_tasks_normalize_week ON public.tasks;
CREATE TRIGGER trg_tasks_normalize_week BEFORE INSERT OR UPDATE OF week_start ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.tg_tasks_normalize_week();

CREATE OR REPLACE FUNCTION public.tg_tasks_assignment_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF current_user='authenticated' AND auth.uid() IS NOT NULL AND NOT public.is_admin(auth.uid())
 AND (NEW.assigned_to IS DISTINCT FROM OLD.assigned_to OR NEW.week_start IS DISTINCT FROM OLD.week_start) THEN
  RAISE EXCEPTION 'Only Director/Admin can assign, reassign or re-plan tasks' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_tasks_assignment_guard ON public.tasks;
CREATE TRIGGER trg_tasks_assignment_guard BEFORE UPDATE OF assigned_to,week_start ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.tg_tasks_assignment_guard();

CREATE OR REPLACE FUNCTION public.tg_task_supervisor_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF current_user='authenticated' AND auth.uid() IS NOT NULL AND NOT public.is_admin(auth.uid())
 AND NEW.created_by IS DISTINCT FROM auth.uid() AND NEW.supervisor_id IS DISTINCT FROM OLD.supervisor_id THEN
  RAISE EXCEPTION 'Only task creator or Director/Admin can change supervisor' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_task_supervisor_guard ON public.tasks;
CREATE TRIGGER trg_task_supervisor_guard BEFORE UPDATE OF supervisor_id ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.tg_task_supervisor_guard();

CREATE OR REPLACE FUNCTION public.tg_task_waiting_on_client()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF NEW.status::text='waiting_on_client' THEN
  IF TG_OP='INSERT' OR OLD.status::text IS DISTINCT FROM 'waiting_on_client' THEN NEW.waiting_since:=now();
  ELSE NEW.waiting_since:=COALESCE(NEW.waiting_since,now()); END IF;
  IF NULLIF(btrim(NEW.waiting_reason),'') IS NULL THEN RAISE EXCEPTION 'A reason is required when a task is waiting on the client'; END IF;
 ELSE
  NEW.waiting_since:=NULL; NEW.waiting_reason:=NULL; NEW.follow_up_on:=NULL;
 END IF;
 RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_task_waiting_on_client ON public.tasks;
CREATE TRIGGER trg_task_waiting_on_client BEFORE INSERT OR UPDATE OF status,waiting_reason,follow_up_on ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.tg_task_waiting_on_client();

DROP POLICY IF EXISTS "task comments by parent task" ON public.task_comments;
DROP POLICY IF EXISTS "task comments read" ON public.task_comments;
DROP POLICY IF EXISTS "task comments write" ON public.task_comments;
DROP POLICY IF EXISTS "task comments delete" ON public.task_comments;
CREATE POLICY "task comments read" ON public.task_comments FOR SELECT TO authenticated USING(public.task_has_access(task_id,auth.uid()));
CREATE POLICY "task comments write" ON public.task_comments FOR INSERT TO authenticated WITH CHECK(
 public.task_has_access(task_id,auth.uid()) AND author_id=auth.uid()
 AND (kind IN ('note','feedback','report') OR (kind='guidance' AND public.task_is_supervisor(task_id,auth.uid())))
);
CREATE POLICY "task comments delete" ON public.task_comments FOR DELETE TO authenticated USING(kind<>'system' AND (author_id=auth.uid() OR public.is_admin(auth.uid())));

DROP POLICY IF EXISTS "task subtasks read" ON public.task_subtasks;
DROP POLICY IF EXISTS "task subtasks insert" ON public.task_subtasks;
DROP POLICY IF EXISTS "task subtasks update" ON public.task_subtasks;
DROP POLICY IF EXISTS "task subtasks delete" ON public.task_subtasks;
CREATE POLICY "task subtasks read" ON public.task_subtasks FOR SELECT TO authenticated USING(public.task_has_access(task_id,auth.uid()));
CREATE POLICY "task subtasks insert" ON public.task_subtasks FOR INSERT TO authenticated WITH CHECK(public.task_is_lead(task_id,auth.uid()) AND created_by=auth.uid());
CREATE POLICY "task subtasks update" ON public.task_subtasks FOR UPDATE TO authenticated
USING(public.task_is_lead(task_id,auth.uid()) OR assigned_to=auth.uid())
WITH CHECK(public.task_is_lead(task_id,auth.uid()) OR assigned_to=auth.uid());
CREATE POLICY "task subtasks delete" ON public.task_subtasks FOR DELETE TO authenticated USING(public.task_is_lead(task_id,auth.uid()));

DROP POLICY IF EXISTS "task outputs read" ON public.task_outputs;
DROP POLICY IF EXISTS "task outputs insert" ON public.task_outputs;
DROP POLICY IF EXISTS "task outputs update" ON public.task_outputs;
DROP POLICY IF EXISTS "task outputs delete" ON public.task_outputs;
CREATE POLICY "task outputs read" ON public.task_outputs FOR SELECT TO authenticated USING(public.task_has_access(task_id,auth.uid()));
CREATE POLICY "task outputs insert" ON public.task_outputs FOR INSERT TO authenticated WITH CHECK(public.task_has_access(task_id,auth.uid()) AND uploaded_by=auth.uid() AND split_part(file_path,'/',1)=task_id::text);
CREATE POLICY "task outputs update" ON public.task_outputs FOR UPDATE TO authenticated USING(public.task_is_lead(task_id,auth.uid())) WITH CHECK(public.task_is_lead(task_id,auth.uid()));
CREATE POLICY "task outputs delete" ON public.task_outputs FOR DELETE TO authenticated USING(uploaded_by=auth.uid() OR public.task_is_lead(task_id,auth.uid()));

CREATE OR REPLACE FUNCTION public.tg_task_subtask_done_at()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN IF NEW.done AND (TG_OP='INSERT' OR OLD.done IS DISTINCT FROM true) THEN NEW.done_at:=now(); ELSIF NOT NEW.done THEN NEW.done_at:=NULL; END IF; RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS trg_task_subtask_done_at ON public.task_subtasks;
CREATE TRIGGER trg_task_subtask_done_at BEFORE INSERT OR UPDATE OF done ON public.task_subtasks FOR EACH ROW EXECUTE FUNCTION public.tg_task_subtask_done_at();

CREATE OR REPLACE FUNCTION public.tg_task_subtasks_progress()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_old uuid; v_new uuid;
BEGIN
 IF TG_OP<>'INSERT' THEN v_old:=OLD.task_id; END IF;
 IF TG_OP<>'DELETE' THEN v_new:=NEW.task_id; END IF;
 IF v_old IS NOT NULL THEN
  UPDATE public.tasks t SET progress=CASE WHEN x.total=0 THEN 0 ELSE round(x.done*100.0/x.total)::smallint END
  FROM (SELECT count(*) total,count(*) FILTER(WHERE done) done FROM public.task_subtasks WHERE task_id=v_old) x
  WHERE t.id=v_old AND t.status::text<>'done';
 END IF;
 IF v_new IS NOT NULL AND v_new IS DISTINCT FROM v_old THEN
  UPDATE public.tasks t SET progress=CASE WHEN x.total=0 THEN 0 ELSE round(x.done*100.0/x.total)::smallint END
  FROM (SELECT count(*) total,count(*) FILTER(WHERE done) done FROM public.task_subtasks WHERE task_id=v_new) x
  WHERE t.id=v_new AND t.status::text<>'done';
 ELSIF v_new IS NOT NULL AND v_old IS NULL THEN
  UPDATE public.tasks t SET progress=CASE WHEN x.total=0 THEN 0 ELSE round(x.done*100.0/x.total)::smallint END
  FROM (SELECT count(*) total,count(*) FILTER(WHERE done) done FROM public.task_subtasks WHERE task_id=v_new) x
  WHERE t.id=v_new AND t.status::text<>'done';
 END IF;
 RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_task_subtasks_progress ON public.task_subtasks;
CREATE TRIGGER trg_task_subtasks_progress AFTER INSERT OR UPDATE OF done,task_id OR DELETE ON public.task_subtasks FOR EACH ROW EXECUTE FUNCTION public.tg_task_subtasks_progress();

CREATE OR REPLACE FUNCTION public.tg_task_progress_on_done()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN IF NEW.status::text='done' THEN NEW.progress:=100; END IF; RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS trg_task_progress_on_done ON public.tasks;
CREATE TRIGGER trg_task_progress_on_done BEFORE INSERT OR UPDATE OF status ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.tg_task_progress_on_done();

CREATE OR REPLACE FUNCTION public.tg_task_guidance_flag()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NEW.kind='report' AND NEW.ask_guidance THEN UPDATE public.tasks SET needs_guidance=true WHERE id=NEW.task_id AND NOT needs_guidance;
 ELSIF NEW.kind='guidance' THEN UPDATE public.tasks SET needs_guidance=false WHERE id=NEW.task_id AND needs_guidance; END IF;
 RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_task_guidance_flag ON public.task_comments;
CREATE TRIGGER trg_task_guidance_flag AFTER INSERT ON public.task_comments FOR EACH ROW EXECUTE FUNCTION public.tg_task_guidance_flag();

CREATE OR REPLACE FUNCTION public.tg_task_log_events()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_actor uuid:=auth.uid();
BEGIN
 IF TG_OP='INSERT' THEN
  INSERT INTO public.task_comments(task_id,author_id,kind,body) VALUES(NEW.id,v_actor,'system','Task created');
 ELSE
  IF NEW.status IS DISTINCT FROM OLD.status THEN INSERT INTO public.task_comments(task_id,author_id,kind,body) VALUES(NEW.id,v_actor,'system','Status changed from '||OLD.status::text||' to '||NEW.status::text); END IF;
  IF NEW.assigned_to IS DISTINCT FROM OLD.assigned_to THEN INSERT INTO public.task_comments(task_id,author_id,kind,body) VALUES(NEW.id,v_actor,'system','Task assignment changed'); END IF;
  IF NEW.supervisor_id IS DISTINCT FROM OLD.supervisor_id THEN INSERT INTO public.task_comments(task_id,author_id,kind,body) VALUES(NEW.id,v_actor,'system','Task supervisor changed'); END IF;
  IF NEW.due_date IS DISTINCT FROM OLD.due_date THEN INSERT INTO public.task_comments(task_id,author_id,kind,body) VALUES(NEW.id,v_actor,'system','Task due date changed'); END IF;
 END IF;
 RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_task_log_events ON public.tasks;
CREATE TRIGGER trg_task_log_events AFTER INSERT OR UPDATE OF status,assigned_to,supervisor_id,due_date ON public.tasks FOR EACH ROW EXECUTE FUNCTION public.tg_task_log_events();

INSERT INTO storage.buckets(id,name,public) VALUES('task-outputs','task-outputs',false) ON CONFLICT(id) DO NOTHING;
CREATE OR REPLACE FUNCTION public.task_output_task(_name text)
RETURNS uuid LANGUAGE sql IMMUTABLE SET search_path=public AS $$
 SELECT CASE WHEN split_part(_name,'/',1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN split_part(_name,'/',1)::uuid ELSE NULL END;
$$;
DROP POLICY IF EXISTS "task outputs files read" ON storage.objects;
DROP POLICY IF EXISTS "task outputs files write" ON storage.objects;
DROP POLICY IF EXISTS "task outputs files delete" ON storage.objects;
CREATE POLICY "task outputs files read" ON storage.objects FOR SELECT TO authenticated USING(bucket_id='task-outputs' AND public.task_has_access(public.task_output_task(name),auth.uid()));
CREATE POLICY "task outputs files write" ON storage.objects FOR INSERT TO authenticated WITH CHECK(bucket_id='task-outputs' AND public.task_has_access(public.task_output_task(name),auth.uid()));
CREATE POLICY "task outputs files delete" ON storage.objects FOR DELETE TO authenticated USING(bucket_id='task-outputs' AND public.task_is_lead(public.task_output_task(name),auth.uid()));

DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['tasks','task_comments','task_subtasks','task_outputs'] LOOP
  BEGIN EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I',t);
  EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_object THEN NULL; END;
 END LOOP;
END $$;
NOTIFY pgrst,'reload schema';