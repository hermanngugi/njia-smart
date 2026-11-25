-- ============================================================================
-- Tasks: weekly planning + only Director/Admin can assign
--
--   1. tasks.week_start  - the week (always a Monday) a task is planned for, so
--      the Weekly plan can show who is occupied in which week.
--   2. Only a Director or Admin can assign, reassign or re-plan a task.
--      Everyone else can still update status and comment on their own tasks.
--
-- The check only applies to direct app/API calls (role "authenticated"). Work
-- done by the database itself on someone's behalf, such as the leave handover
-- that moves tasks to a reliever, runs with its own role and is not blocked.
-- Idempotent: safe to run more than once.
-- ============================================================================

alter table public.tasks add column if not exists week_start date;

create index if not exists idx_tasks_assignee_week on public.tasks (assigned_to, week_start);

-- Whatever day is picked, store the Monday of that week.
create or replace function public.tg_tasks_normalize_week()
returns trigger
language plpgsql
as $$
begin
  if new.week_start is not null then
    new.week_start := date_trunc('week', new.week_start::timestamp)::date;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_tasks_normalize_week on public.tasks;
create trigger trg_tasks_normalize_week
  before insert or update of week_start on public.tasks
  for each row execute function public.tg_tasks_normalize_week();

-- Assigning / reassigning / re-planning is for Director and Admin only.
-- (Deliberately NOT security definer, so current_user is the real caller role.)
create or replace function public.tg_tasks_assignment_guard()
returns trigger
language plpgsql
as $$
begin
  if current_user = 'authenticated'
     and auth.uid() is not null
     and not public.is_admin(auth.uid())
     and (new.assigned_to is distinct from old.assigned_to
          or new.week_start is distinct from old.week_start) then
    raise exception 'Only a director or admin can assign, reassign or re-plan tasks.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_tasks_assignment_guard on public.tasks;
create trigger trg_tasks_assignment_guard
  before update of assigned_to, week_start on public.tasks
  for each row execute function public.tg_tasks_assignment_guard();

notify pgrst, 'reload schema';
