-- Njia Smart repair 11: notification actor integrity and task workspace guardrails.
ALTER TABLE public.notifications ALTER COLUMN actor_id SET DEFAULT auth.uid();

CREATE OR REPLACE FUNCTION public.tg_notifications_actor_integrity()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF auth.uid() IS NOT NULL THEN NEW.actor_id:=auth.uid(); END IF;
 ELSIF TG_OP='UPDATE' AND current_user='authenticated' THEN
  NEW.actor_id:=OLD.actor_id;
 END IF;
 RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_notifications_actor_integrity ON public.notifications;
CREATE TRIGGER trg_notifications_actor_integrity BEFORE INSERT OR UPDATE OF actor_id ON public.notifications
FOR EACH ROW EXECUTE FUNCTION public.tg_notifications_actor_integrity();

CREATE OR REPLACE FUNCTION public.tg_task_subtask_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF current_user='authenticated' AND auth.uid() IS NOT NULL
 AND NOT public.task_is_lead(OLD.task_id,auth.uid())
 AND (NEW.task_id IS DISTINCT FROM OLD.task_id OR NEW.title IS DISTINCT FROM OLD.title
  OR NEW.assigned_to IS DISTINCT FROM OLD.assigned_to OR NEW.due_date IS DISTINCT FROM OLD.due_date) THEN
  RAISE EXCEPTION 'Only task lead, supervisor or Director/Admin can change subtask title, owner or date' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_task_subtask_guard ON public.task_subtasks;
CREATE TRIGGER trg_task_subtask_guard BEFORE UPDATE ON public.task_subtasks FOR EACH ROW EXECUTE FUNCTION public.tg_task_subtask_guard();

CREATE OR REPLACE FUNCTION public.tg_task_subtask_log()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_task uuid; v_body text;
BEGIN
 IF TG_OP='DELETE' THEN v_task:=OLD.task_id; v_body:='Subtask removed: '||OLD.title;
 ELSIF TG_OP='INSERT' THEN v_task:=NEW.task_id; v_body:='Subtask added: '||NEW.title;
 ELSIF NEW.done IS DISTINCT FROM OLD.done THEN v_task:=NEW.task_id; v_body:=CASE WHEN NEW.done THEN 'Subtask completed: ' ELSE 'Subtask reopened: ' END||NEW.title;
 ELSIF NEW.assigned_to IS DISTINCT FROM OLD.assigned_to THEN v_task:=NEW.task_id; v_body:='Subtask assignment changed: '||NEW.title;
 ELSE RETURN NULL; END IF;
 INSERT INTO public.task_comments(task_id,author_id,kind,body) VALUES(v_task,auth.uid(),'system',v_body);
 RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_task_subtask_log ON public.task_subtasks;
CREATE TRIGGER trg_task_subtask_log AFTER INSERT OR UPDATE OF done,assigned_to OR DELETE ON public.task_subtasks
FOR EACH ROW EXECUTE FUNCTION public.tg_task_subtask_log();

CREATE OR REPLACE FUNCTION public.tg_task_output_log()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_task uuid; v_body text;
BEGIN
 IF TG_OP='INSERT' THEN v_task:=NEW.task_id; v_body:='Task output added: '||NEW.file_name;
 ELSIF TG_OP='DELETE' THEN v_task:=OLD.task_id; v_body:='Task output removed: '||OLD.file_name;
 ELSIF NEW.is_final IS DISTINCT FROM OLD.is_final AND NEW.is_final THEN v_task:=NEW.task_id; v_body:='Marked final output: '||NEW.file_name;
 ELSE RETURN NULL; END IF;
 INSERT INTO public.task_comments(task_id,author_id,kind,body) VALUES(v_task,auth.uid(),'system',v_body);
 RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_task_output_log ON public.task_outputs;
CREATE TRIGGER trg_task_output_log AFTER INSERT OR UPDATE OF is_final OR DELETE ON public.task_outputs
FOR EACH ROW EXECUTE FUNCTION public.tg_task_output_log();
NOTIFY pgrst,'reload schema';