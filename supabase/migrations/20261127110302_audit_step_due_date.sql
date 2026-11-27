-- Audit checklist steps get their own due date (owner already exists as assigned_to).
alter table public.audit_engagement_procedures add column if not exists due_date date;
create index if not exists audit_engagement_procedures_due_idx on public.audit_engagement_procedures (due_date) where status not in ('completed','not_applicable');
