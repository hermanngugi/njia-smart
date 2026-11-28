-- Tasks as the place work is shared, handed over and accounted for.
alter table public.tasks
  add column if not exists handover_note text,
  add column if not exists next_action text,
  add column if not exists last_update_at timestamptz,
  add column if not exists is_private boolean not null default false,
  add column if not exists outcome text,
  add column if not exists cancel_reason text;
alter table public.task_comments add column if not exists next_action text;
alter table public.task_comments drop constraint task_comments_kind_check;
alter table public.task_comments add constraint task_comments_kind_check
  check (kind = any (array['note','feedback','report','guidance','system','update']));

-- Who can work on a task: people involved, Director/Admin, and (unless private) full task-module roles.
create or replace function private.task_has_access(_task_id uuid, _user_id uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select coalesce(_user_id is not null and (
    public.is_admin(_user_id)
    or exists (select 1 from public.tasks t where t.id = _task_id
         and (t.assigned_to = _user_id or t.created_by = _user_id or t.supervisor_id = _user_id
              or (not t.is_private and public.has_full_module(_user_id, 'tasks'))))
    or exists (select 1 from public.task_subtasks s where s.task_id = _task_id and s.assigned_to = _user_id)
  ), false);
$$;

-- Who can read a task and comment on it: all staff unless it is private.
create or replace function private.task_can_view(_task_id uuid, _user_id uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select private.task_has_access(_task_id, _user_id)
      or (private.is_staff(_user_id) and exists (select 1 from public.tasks t where t.id = _task_id and not t.is_private));
$$;
revoke all on function private.task_can_view(uuid, uuid) from public, anon;
grant execute on function private.task_can_view(uuid, uuid) to authenticated;

drop policy "tasks select by rank" on public.tasks;
create policy "tasks select by rank" on public.tasks for select to authenticated using (
  (not is_private and private.is_staff((select auth.uid()))) or private.task_has_access(id, (select auth.uid())));

alter policy "task comments read" on public.task_comments using (private.task_can_view(task_id, (select auth.uid())));
alter policy "task subtasks read" on public.task_subtasks using (private.task_can_view(task_id, (select auth.uid())));
alter policy "task outputs read" on public.task_outputs using (private.task_can_view(task_id, (select auth.uid())));
alter policy "task outputs files read" on storage.objects
  using (bucket_id = 'task-outputs' and private.task_can_view(public.task_output_task(name), auth.uid()));

alter policy "task comments write" on public.task_comments with check (
  author_id = (select auth.uid()) and (
    (kind = 'note' and private.task_can_view(task_id, (select auth.uid())))
    or (kind in ('feedback','report','update') and private.task_has_access(task_id, (select auth.uid())))
    or (kind = 'guidance' and private.task_is_supervisor(task_id, (select auth.uid())))));

-- Records stay: tasks are cancelled, not deleted; progress updates cannot be removed.
drop policy "tasks delete owner or admin" on public.tasks;
alter policy "task comments delete" on public.task_comments using (
  kind not in ('system','update') and (author_id = (select auth.uid()) or private.is_admin((select auth.uid()))));

create or replace function public.tg_task_privacy_guard() returns trigger language plpgsql set search_path to 'public' as $$
begin
  if current_user = 'authenticated' and new.is_private is distinct from old.is_private
     and old.created_by is distinct from auth.uid() and not public.is_admin(auth.uid()) then
    raise exception 'Only the person who gave the task or a Director/Admin can change its privacy' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger trg_task_privacy_guard before update of is_private on public.tasks
  for each row execute function public.tg_task_privacy_guard();

-- A progress update refreshes the handover summary on the task.
create or replace function public.tg_task_apply_update() returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  update public.tasks set handover_note = new.body, next_action = new.next_action, last_update_at = now(),
    status = case when status::text = 'todo' then 'in_progress'::public.task_status else status end
  where id = new.task_id;
  return null;
end $$;
create trigger trg_task_apply_update after insert on public.task_comments
  for each row when (new.kind = 'update') execute function public.tg_task_apply_update();

create or replace function public.tg_task_step_touch() returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  update public.tasks set last_update_at = now() where id = new.task_id;
  return null;
end $$;
create trigger trg_task_step_touch after insert or update of done on public.task_subtasks
  for each row execute function public.tg_task_step_touch();

-- History with names, old and new values.
create or replace function public.tg_task_log_events() returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_actor uuid := auth.uid(); v_from text; v_to text;
begin
  if tg_op = 'INSERT' then
    select full_name into v_to from public.profiles where id = new.assigned_to;
    insert into public.task_comments(task_id, author_id, kind, body)
    values (new.id, v_actor, 'system', 'Task created for ' || coalesce(v_to, 'nobody yet') || coalesce(', due ' || to_char(new.due_date, 'DD Mon YYYY'), ''));
    return new;
  end if;
  if new.status is distinct from old.status then
    insert into public.task_comments(task_id, author_id, kind, body) values (new.id, v_actor, 'system',
      'Status changed from ' || replace(old.status::text, '_', ' ') || ' to ' || replace(new.status::text, '_', ' ')
      || case when new.status::text = 'done' then coalesce('. Outcome: ' || new.outcome, '')
              when new.status::text = 'cancelled' then coalesce('. Reason: ' || new.cancel_reason, '')
              when new.status::text = 'waiting_on_client' then coalesce('. Waiting for: ' || new.waiting_reason, '') else '' end);
  end if;
  if new.assigned_to is distinct from old.assigned_to then
    select full_name into v_from from public.profiles where id = old.assigned_to;
    select full_name into v_to from public.profiles where id = new.assigned_to;
    insert into public.task_comments(task_id, author_id, kind, body)
    values (new.id, v_actor, 'system', 'Reassigned from ' || coalesce(v_from, 'nobody') || ' to ' || coalesce(v_to, 'nobody'));
  end if;
  if new.supervisor_id is distinct from old.supervisor_id then
    insert into public.task_comments(task_id, author_id, kind, body) values (new.id, v_actor, 'system', 'Task supervisor changed');
  end if;
  if new.due_date is distinct from old.due_date then
    insert into public.task_comments(task_id, author_id, kind, body) values (new.id, v_actor, 'system',
      'Due date changed from ' || coalesce(to_char(old.due_date, 'DD Mon YYYY'), 'none') || ' to ' || coalesce(to_char(new.due_date, 'DD Mon YYYY'), 'none'));
  end if;
  return new;
end $$;

-- Any staff member may take over an open, non-private task, with a reason.
create or replace function private.take_over_task(_task_id uuid, _reason text)
returns void language plpgsql security definer set search_path to 'public' as $$
declare t public.tasks; me uuid := auth.uid(); my_name text; old_name text;
begin
  if me is null or not private.is_staff(me) then raise exception 'Only staff can take over tasks' using errcode = '42501'; end if;
  if nullif(btrim(_reason), '') is null then raise exception 'Give a reason for taking over'; end if;
  select * into t from public.tasks where id = _task_id for update;
  if not found or (t.is_private and not private.task_has_access(_task_id, me)) or not private.can_access_client(t.client_id) then
    raise exception 'Task not available' using errcode = '42501';
  end if;
  if t.status::text in ('done', 'cancelled') then raise exception 'This task is closed'; end if;
  if t.assigned_to = me then raise exception 'This task is already yours'; end if;
  update public.tasks set assigned_to = me where id = _task_id;
  select full_name into my_name from public.profiles where id = me;
  select full_name into old_name from public.profiles where id = t.assigned_to;
  insert into public.task_comments(task_id, author_id, kind, body)
  values (_task_id, me, 'system', coalesce(my_name, 'A colleague') || ' took over from ' || coalesce(old_name, 'nobody') || '. Reason: ' || btrim(_reason));
  insert into public.notifications(user_id, type, title, body, link, actor_id)
  select distinct u, 'task_taken_over', coalesce(my_name, 'A colleague') || ' took over a task', t.title || ' - ' || btrim(_reason), '/tasks?task=' || _task_id, me
  from unnest(array[t.assigned_to, t.created_by, t.supervisor_id]) u where u is not null and u <> me;
end $$;
revoke all on function private.take_over_task(uuid, text) from public, anon;
grant execute on function private.take_over_task(uuid, text) to authenticated;
create or replace function public.take_over_task(_task_id uuid, _reason text)
returns void language sql security invoker set search_path to 'pg_catalog' as $$ select private.take_over_task(_task_id, _reason) $$;
revoke all on function public.take_over_task(uuid, text) from public, anon;
grant execute on function public.take_over_task(uuid, text) to authenticated;

-- Cancelled tasks must not raise reminders. Patch the existing functions in place so other rules in them are untouched.
do $do$
declare d text;
begin
  d := pg_get_functiondef('public.send_deadline_reminders()'::regprocedure);
  if position('AND t.status <> ''done''' in d) = 0 then raise exception 'send_deadline_reminders has changed'; end if;
  execute replace(d, 'AND t.status <> ''done''', 'AND t.status::text NOT IN (''done'',''cancelled'')');
  d := pg_get_functiondef('public.tg_notify_deadline_row()'::regprocedure);
  if position('IF NEW.status <> ''done'' THEN' in d) = 0 then raise exception 'tg_notify_deadline_row has changed'; end if;
  execute replace(d, 'IF NEW.status <> ''done'' THEN', 'IF NEW.status::text NOT IN (''done'',''cancelled'') THEN');
end $do$;

-- Daily task alerts (07:05 Nairobi). One notification per person, item and day.
create or replace function private.send_task_alerts() returns void language plpgsql security definer set search_path to 'public' as $$
declare today date := (now() at time zone 'Africa/Nairobi')::date;
begin
  insert into public.notifications(user_id, type, title, body, link, dedupe_key)
  with open_tasks as (
    select t.*, (today - t.due_date) as late,
           coalesce((coalesce(t.last_update_at, t.created_at) at time zone 'Africa/Nairobi')::date, today) as touched
    from public.tasks t left join public.clients c on c.id = t.client_id
    where t.status::text not in ('done', 'cancelled') and not coalesce(c.is_paused, false)
  ), alerts(uid, title, body, task_id, key) as (
    select assigned_to, 'Task due today', title, id, 'taskd0:' || id || ':' || due_date from open_tasks where late = 0
    union all
    select u, 'Task OVERDUE', title || ' - ' || late || case when late = 1 then ' day' else ' days' end || ' overdue', id, 'taskod:' || id || ':' || today
    from open_tasks, lateral (select distinct x from unnest(array[assigned_to, case when late >= 3 then created_by end]) x) a(u)
    where status::text <> 'waiting_on_client' and (late in (1, 3, 7) or (late >= 14 and late % 7 = 0))
    union all
    -- no update for 3 working days
    select assigned_to, 'Task needs an update', title, id, 'taskstale:' || id || ':' || today from open_tasks
    where status::text = 'in_progress' and extract(isodow from today) < 6
      and (select count(*) from generate_series(touched + 1, today, interval '1 day') g where extract(isodow from g) < 6) in (3, 6, 9)
    union all
    select assigned_to, 'Chase the client today', title || coalesce(' - ' || waiting_reason, ''), id, 'taskchase:' || id || ':' || today
    from open_tasks where status::text = 'waiting_on_client' and follow_up_on <= today
    union all
    select coalesce(s.assigned_to, t.assigned_to),
           case when s.due_date < today then 'Task step OVERDUE' when s.due_date = today then 'Task step due today' else 'Task step due tomorrow' end,
           s.title || ' - ' || t.title, t.id, 'taskstep:' || s.id || ':' || today
    from public.task_subtasks s join open_tasks t on t.id = s.task_id
    where not s.done and ((s.due_date - today) in (0, 1) or (today - s.due_date) in (1, 3, 7))
  )
  select uid, 'deadline_reminder', title, body, '/tasks?task=' || task_id, key from alerts where uid is not null
  on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing;
end $$;
revoke all on function private.send_task_alerts() from public, anon, authenticated;
select cron.schedule('task-alerts', '5 4 * * *', 'select private.send_task_alerts()');
