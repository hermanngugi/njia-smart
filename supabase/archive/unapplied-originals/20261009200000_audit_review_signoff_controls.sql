-- Phase 3: reviewer assignment, recorded decisions, review-note resolution metadata,
-- and database-enforced gates for procedure and engagement completion.
-- Requires the Phase 1 and Phase 2 audit migrations to have been applied first.

alter table public.audit_engagement_procedures
  add column if not exists assigned_reviewer_id uuid references auth.users(id) on delete set null;

alter table public.audit_signoffs
  add column if not exists result_id uuid references public.audit_procedure_results(id) on delete restrict;

alter table public.audit_review_notes
  add column if not exists resolved_by uuid references auth.users(id) on delete set null,
  add column if not exists resolved_at timestamptz,
  add column if not exists resolution_note text;

create index if not exists audit_engagement_procedures_reviewer_idx
  on public.audit_engagement_procedures(engagement_id, assigned_reviewer_id, status);
create index if not exists audit_signoffs_latest_idx
  on public.audit_signoffs(engagement_procedure_id, signed_at desc);

-- Keep review-note resolution history attributable. The existing resolved flag is retained.
create or replace function public.audit_set_review_note_resolution_metadata()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.resolved is true and coalesce(old.resolved, false) is false then
    new.resolved_by := auth.uid();
    new.resolved_at := now();
  elsif new.resolved is false then
    new.resolved_by := null;
    new.resolved_at := null;
    new.resolution_note := null;
  end if;
  return new;
end;
$$;

drop trigger if exists audit_review_note_resolution_metadata on public.audit_review_notes;
create trigger audit_review_note_resolution_metadata
  before update of resolved on public.audit_review_notes
  for each row execute function public.audit_set_review_note_resolution_metadata();

-- A procedure cannot be marked prepared without recorded work and a conclusion.
-- A procedure cannot be marked under review without an assigned reviewer.
-- Completion must follow a recent approval for the latest prepared result.
create or replace function public.audit_guard_procedure_status()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  latest_result_at timestamptz;
  latest_result_id uuid;
  latest_work text;
  latest_conclusion text;
  latest_decision text;
  latest_signed_at timestamptz;
  signed_result_id uuid;
begin
  if new.status = old.status then
    return new;
  end if;
  if old.status = 'completed' and new.status <> 'completed' then
    raise exception 'Completed procedures cannot be reopened directly; use the controlled amendment process';
  end if;

  if new.status in ('prepared', 'under_review', 'completed') then
    select r.id, r.prepared_at, r.work_performed, r.conclusion
      into latest_result_id, latest_result_at, latest_work, latest_conclusion
      from public.audit_procedure_results r
     where r.engagement_procedure_id = new.id
     order by r.prepared_at desc, r.created_at desc
     limit 1;

    if latest_result_at is null or length(btrim(coalesce(latest_work, ''))) = 0
       or length(btrim(coalesce(latest_conclusion, ''))) = 0 then
      raise exception 'Record work performed and a conclusion before preparing this procedure';
    end if;
  end if;

  if new.status = 'under_review' and new.assigned_reviewer_id is null then
    raise exception 'Assign a reviewer before submitting this procedure for review';
  end if;

  if new.status = 'completed' then
    if new.assigned_reviewer_id is null then
      raise exception 'Assign a reviewer before completing this procedure';
    end if;
    select s.decision, s.signed_at, s.result_id into latest_decision, latest_signed_at, signed_result_id
      from public.audit_signoffs s
     where s.engagement_procedure_id = new.id
       and s.reviewer_id = new.assigned_reviewer_id
     order by s.signed_at desc
     limit 1;
    if latest_decision is distinct from 'approved' or latest_signed_at is null or latest_signed_at < latest_result_at
       or signed_result_id is distinct from latest_result_id then
      raise exception 'A reviewer must approve the latest prepared result before procedure completion';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists audit_guard_procedure_status on public.audit_engagement_procedures;
create trigger audit_guard_procedure_status
  before update of status on public.audit_engagement_procedures
  for each row execute function public.audit_guard_procedure_status();

-- Trusted sign-off RPC. The assigned reviewer must be the signed-in user and must
-- differ from the preparer of the latest result. Direct client inserts are not needed.
create or replace function public.audit_record_procedure_signoff(
  p_engagement_procedure_id uuid,
  p_decision text,
  p_comments text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  proc public.audit_engagement_procedures%rowtype;
  latest_preparer uuid;
  latest_result_at timestamptz;
  latest_result_id uuid;
  latest_work text;
  latest_conclusion text;
begin
  if auth.uid() is null or not public.can_access_financials(auth.uid()) then
    raise exception 'Not authorized to review audit procedures';
  end if;
  if p_decision not in ('approved', 'changes_requested', 'rejected') then
    raise exception 'Invalid review decision';
  end if;
  if p_decision <> 'approved' and length(btrim(coalesce(p_comments, ''))) = 0 then
    raise exception 'Comments are required when requesting changes or rejecting work';
  end if;

  select * into proc from public.audit_engagement_procedures
   where id = p_engagement_procedure_id for update;
  if not found then raise exception 'Audit procedure not found'; end if;
  if proc.assigned_reviewer_id is distinct from auth.uid() then
    raise exception 'Only the assigned reviewer may record this decision';
  end if;
  if proc.status not in ('prepared', 'under_review', 'review_notes') then
    raise exception 'Procedure must be prepared before it can be reviewed';
  end if;

  select r.prepared_by, r.id, r.prepared_at, r.work_performed, r.conclusion
    into latest_preparer, latest_result_id, latest_result_at, latest_work, latest_conclusion
    from public.audit_procedure_results r
   where r.engagement_procedure_id = proc.id
   order by r.prepared_at desc, r.created_at desc limit 1;
  if latest_result_at is null or length(btrim(coalesce(latest_work, ''))) = 0
     or length(btrim(coalesce(latest_conclusion, ''))) = 0 then
    raise exception 'The latest procedure result needs work performed and a conclusion';
  end if;
  if latest_preparer is null or latest_preparer = auth.uid() then
    raise exception 'The preparer must be recorded and cannot approve their own procedure';
  end if;

  insert into public.audit_signoffs(engagement_procedure_id, reviewer_id, decision, comments, result_id)
  values (proc.id, auth.uid(), p_decision, nullif(btrim(p_comments), ''), latest_result_id);

  if p_decision = 'approved' then
    update public.audit_engagement_procedures set status = 'completed', updated_at = now() where id = proc.id;
  else
    update public.audit_engagement_procedures set status = 'review_notes', updated_at = now() where id = proc.id;
  end if;

  insert into public.audit_change_history(engagement_id, entity_type, entity_id, action, after_data, reason, actor_id)
  values (proc.engagement_id, 'audit_procedure_signoff', proc.id::text, 'signed_off',
          jsonb_build_object('decision', p_decision, 'comments', nullif(btrim(p_comments), '')),
          'Reviewer decision recorded', auth.uid());
end;
$$;

revoke all on function public.audit_record_procedure_signoff(uuid, text, text) from public, anon;
grant execute on function public.audit_record_procedure_signoff(uuid, text, text) to authenticated;

-- Prevent the engagement status field from bypassing the review process.
-- Checklist initialization is required before marking an engagement completed.
create or replace function public.audit_guard_engagement_completion()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  has_procedures boolean;
begin
  if new.status::text <> 'completed' or old.status::text = 'completed' then
    return new;
  end if;

  select exists(select 1 from public.audit_engagement_procedures p where p.engagement_id = new.id)
    into has_procedures;
  if not has_procedures then
    raise exception 'Initialize the audit procedure checklist before completing this engagement';
  end if;

  -- Every enabled mandatory definition in an initialized pack must have an instance.
  if exists (
    select 1
      from (select distinct pack_id, pack_version from public.audit_engagement_procedures where engagement_id = new.id) packs
      join public.audit_procedure_definitions d
        on d.pack_id = packs.pack_id and d.pack_version = packs.pack_version
     where d.enabled and d.required
       and not exists (
         select 1 from public.audit_engagement_procedures p
          where p.engagement_id = new.id and p.pack_id = d.pack_id
            and p.pack_version = d.pack_version and p.procedure_id = d.procedure_id
       )
  ) then
    raise exception 'One or more required audit procedures have not been initialized';
  end if;

  if exists (
    select 1 from public.audit_engagement_procedures p
    join public.audit_procedure_definitions d
      on d.pack_id = p.pack_id and d.pack_version = p.pack_version and d.procedure_id = p.procedure_id
    where p.engagement_id = new.id and d.enabled and d.required
      and p.status not in ('completed', 'not_applicable')
  ) then
    raise exception 'All required audit procedures must be completed or marked not applicable';
  end if;

  if exists (select 1 from public.audit_review_notes n where n.engagement_id = new.id and n.resolved = false) then
    raise exception 'Resolve all open audit review notes before completing the engagement';
  end if;

  return new;
end;
$$;

drop trigger if exists audit_guard_engagement_completion on public.engagements;
create trigger audit_guard_engagement_completion
  before update of status on public.engagements
  for each row execute function public.audit_guard_engagement_completion();

-- The sign-off RPC is the supported path for inserting review decisions.
-- RLS policies from Phase 1 remain in force for reads and other existing workflows.

-- Only the assigned reviewer can create a decision, via the checked RPC above.
drop policy if exists "audit signoffs financial staff" on public.audit_signoffs;
drop policy if exists "audit signoffs read financial staff" on public.audit_signoffs;
create policy "audit signoffs read financial staff" on public.audit_signoffs
  for select to authenticated using (public.can_access_financials(auth.uid()));
