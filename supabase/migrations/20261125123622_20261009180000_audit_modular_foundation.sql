-- Modular audit foundation. Additive only: existing engagements, workpapers,
-- review notes, tasks, and their policies are intentionally left untouched.

create table if not exists public.audit_procedure_packs (
  id text not null,
  version integer not null check (version > 0),
  title text not null,
  description text not null default '',
  jurisdiction text not null default 'KE' check (jurisdiction = 'KE'),
  engagement_kind text not null,
  standards_basis jsonb not null default '[]'::jsonb,
  effective_from date not null,
  status text not null default 'draft' check (status in ('draft', 'active', 'retired')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (id, version)
);

create table if not exists public.audit_procedure_definitions (
  pack_id text not null,
  pack_version integer not null,
  procedure_id text not null,
  title text not null,
  section_id text not null,
  required boolean not null default true,
  enabled boolean not null default true,
  standard_references jsonb not null default '[]'::jsonb,
  definition jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (pack_id, pack_version, procedure_id),
  foreign key (pack_id, pack_version)
    references public.audit_procedure_packs(id, version) on delete restrict
);

create table if not exists public.audit_engagement_procedures (
  id uuid primary key default gen_random_uuid(),
  engagement_id uuid not null references public.engagements(id) on delete cascade,
  pack_id text not null,
  pack_version integer not null,
  procedure_id text not null,
  status text not null default 'not_started'
    check (status in ('not_started', 'in_progress', 'prepared', 'under_review', 'review_notes', 'completed', 'not_applicable')),
  assigned_to uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (engagement_id, pack_id, pack_version, procedure_id),
  foreign key (pack_id, pack_version, procedure_id)
    references public.audit_procedure_definitions(pack_id, pack_version, procedure_id) on delete restrict
);

create table if not exists public.audit_risks (
  id uuid primary key default gen_random_uuid(),
  engagement_id uuid not null references public.engagements(id) on delete cascade,
  title text not null,
  description text not null default '',
  financial_statement_area text,
  assertions jsonb not null default '[]'::jsonb,
  likelihood text check (likelihood in ('low', 'moderate', 'high')),
  impact text check (impact in ('low', 'moderate', 'high')),
  significant_risk boolean not null default false,
  planned_response text,
  status text not null default 'identified' check (status in ('identified', 'assessed', 'responded', 'closed')),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.audit_procedure_results (
  id uuid primary key default gen_random_uuid(),
  engagement_procedure_id uuid not null references public.audit_engagement_procedures(id) on delete cascade,
  work_performed text not null default '',
  conclusion text,
  exceptions jsonb not null default '[]'::jsonb,
  result_data jsonb not null default '{}'::jsonb,
  prepared_by uuid references auth.users(id) on delete set null default auth.uid(),
  prepared_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.audit_evidence_links (
  id uuid primary key default gen_random_uuid(),
  engagement_procedure_id uuid not null references public.audit_engagement_procedures(id) on delete cascade,
  workpaper_id uuid not null references public.audit_workpapers(id) on delete restrict,
  note text,
  linked_by uuid references auth.users(id) on delete set null default auth.uid(),
  linked_at timestamptz not null default now(),
  unique (engagement_procedure_id, workpaper_id)
);

create table if not exists public.audit_signoffs (
  id uuid primary key default gen_random_uuid(),
  engagement_procedure_id uuid not null references public.audit_engagement_procedures(id) on delete cascade,
  reviewer_id uuid not null references auth.users(id) on delete restrict,
  decision text not null check (decision in ('approved', 'changes_requested', 'rejected')),
  comments text,
  signed_at timestamptz not null default now()
);

-- Append-only application audit trail for workflow changes. Updates/deletes are
-- intentionally not granted through RLS; privileged database administrators
-- remain responsible for platform-level controls and retention.
create table if not exists public.audit_change_history (
  id bigint generated always as identity primary key,
  engagement_id uuid references public.engagements(id) on delete set null,
  entity_type text not null,
  entity_id text not null,
  action text not null check (action in ('created', 'updated', 'status_changed', 'signed_off', 'linked', 'retired')),
  before_data jsonb,
  after_data jsonb,
  reason text,
  actor_id uuid references auth.users(id) on delete set null default auth.uid(),
  occurred_at timestamptz not null default now()
);

create index if not exists audit_engagement_procedures_engagement_idx
  on public.audit_engagement_procedures(engagement_id, status);
create index if not exists audit_risks_engagement_idx on public.audit_risks(engagement_id, status);
create index if not exists audit_procedure_results_instance_idx
  on public.audit_procedure_results(engagement_procedure_id, prepared_at desc);
create index if not exists audit_change_history_engagement_idx
  on public.audit_change_history(engagement_id, occurred_at desc);

alter table public.audit_procedure_packs enable row level security;
alter table public.audit_procedure_definitions enable row level security;
alter table public.audit_engagement_procedures enable row level security;
alter table public.audit_risks enable row level security;
alter table public.audit_procedure_results enable row level security;
alter table public.audit_evidence_links enable row level security;
alter table public.audit_signoffs enable row level security;
alter table public.audit_change_history enable row level security;

-- Staff with access to the financial modules can read published pack metadata.
drop policy if exists "audit procedure packs read financial staff" on public.audit_procedure_packs;
create policy "audit procedure packs read financial staff" on public.audit_procedure_packs
  for select to authenticated using (public.can_access_financials(auth.uid()));
drop policy if exists "audit procedure packs admin manage" on public.audit_procedure_packs;
create policy "audit procedure packs admin manage" on public.audit_procedure_packs
  for all to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

drop policy if exists "audit procedure definitions read financial staff" on public.audit_procedure_definitions;
create policy "audit procedure definitions read financial staff" on public.audit_procedure_definitions
  for select to authenticated using (public.can_access_financials(auth.uid()));
drop policy if exists "audit procedure definitions admin manage" on public.audit_procedure_definitions;
create policy "audit procedure definitions admin manage" on public.audit_procedure_definitions
  for all to authenticated using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

-- Engagement-level operational data uses the same financial access boundary as
-- existing engagement records. More granular reviewer/assignment rules follow
-- in the next implementation phase.
create policy "audit engagement procedures financial staff" on public.audit_engagement_procedures
  for all to authenticated using (public.can_access_financials(auth.uid()))
  with check (public.can_access_financials(auth.uid()));
create policy "audit risks financial staff" on public.audit_risks
  for all to authenticated using (public.can_access_financials(auth.uid()))
  with check (public.can_access_financials(auth.uid()));
create policy "audit procedure results financial staff" on public.audit_procedure_results
  for all to authenticated using (public.can_access_financials(auth.uid()))
  with check (public.can_access_financials(auth.uid()));
create policy "audit evidence links financial staff" on public.audit_evidence_links
  for all to authenticated using (public.can_access_financials(auth.uid()))
  with check (public.can_access_financials(auth.uid()));
create policy "audit signoffs financial staff" on public.audit_signoffs
  for all to authenticated using (public.can_access_financials(auth.uid()))
  with check (public.can_access_financials(auth.uid()));
create policy "audit change history read financial staff" on public.audit_change_history
  for select to authenticated using (public.can_access_financials(auth.uid()));
create policy "audit change history insert financial staff" on public.audit_change_history
  for insert to authenticated with check (
    public.can_access_financials(auth.uid()) and (actor_id is null or actor_id = auth.uid())
  );

-- Seed the initial version. These are metadata and workflow prompts, not copied
-- standards text and not a declaration of compliance with any standard.
insert into public.audit_procedure_packs
  (id, version, title, description, jurisdiction, engagement_kind, standards_basis, effective_from, status)
values
  ('ke-private-financial-audit', 1,
   'Kenya — Private-sector financial statement audit',
   'Starter ISA-based workflow pack. Requires firm-methodology and professional review before use.',
   'KE', 'private_financial_statement_audit',
   '["ISA", "IESBA Code", "Kenyan company and sector-specific law, where applicable"]'::jsonb,
   date '2026-10-09', 'active')
on conflict (id, version) do nothing;

insert into public.audit_procedure_definitions
  (pack_id, pack_version, procedure_id, title, section_id, required, enabled, standard_references, definition)
values
  ('ke-private-financial-audit', 1, 'acceptance-continuance', 'Acceptance and continuance', 'planning', true, true,
   '["ISA 220 (Revised)", "IESBA Code"]'::jsonb,
   '{"objective":"Document acceptance or continuance considerations and approval.","dependencies":[],"requiredFields":["decision","assessment","approvedBy"],"expectedEvidence":["Acceptance/continuance assessment","Approval record"],"completionRules":{"requireConclusion":true,"requireEvidence":true,"requireReviewerWhenRequired":true}}'::jsonb),
  ('ke-private-financial-audit', 1, 'independence-ethics', 'Independence and ethics', 'planning', true, true,
   '["IESBA Code", "ISA 220 (Revised)"]'::jsonb,
   '{"objective":"Record relevant independence confirmations and threats/safeguards.","dependencies":["acceptance-continuance"],"requiredFields":["teamDeclarations","threatsAndSafeguards","conclusion"],"expectedEvidence":["Team declarations","Threats and safeguards assessment"],"completionRules":{"requireConclusion":true,"requireEvidence":true,"requireReviewerWhenRequired":true}}'::jsonb),
  ('ke-private-financial-audit', 1, 'engagement-terms', 'Agree engagement terms', 'planning', true, true,
   '["ISA 210"]'::jsonb,
   '{"objective":"Document the agreed terms and responsibilities for the engagement.","dependencies":["acceptance-continuance"],"requiredFields":["termsDate","responsibilities","approval"],"expectedEvidence":["Signed engagement letter or equivalent record"],"completionRules":{"requireConclusion":true,"requireEvidence":true,"requireReviewerWhenRequired":true}}'::jsonb),
  ('ke-private-financial-audit', 1, 'entity-understanding-risk', 'Understand entity and assess risks', 'risk', true, true,
   '["ISA 315 (Revised 2019)"]'::jsonb,
   '{"objective":"Identify and assess risks of material misstatement at financial statement and assertion levels.","dependencies":["engagement-terms"],"requiredFields":["entityUnderstanding","riskAssessments","significantRisks"],"expectedEvidence":["Risk assessment documentation","Relevant process/control understanding"],"completionRules":{"requireConclusion":true,"requireEvidence":true,"requireReviewerWhenRequired":true}}'::jsonb),
  ('ke-private-financial-audit', 1, 'materiality', 'Determine materiality', 'planning', true, true,
   '["ISA 320"]'::jsonb,
   '{"objective":"Document materiality judgments and the basis for amounts selected.","dependencies":["entity-understanding-risk"],"requiredFields":["benchmark","overallMateriality","performanceMateriality","basis"],"expectedEvidence":["Materiality calculation and rationale"],"completionRules":{"requireConclusion":true,"requireEvidence":true,"requireReviewerWhenRequired":true}}'::jsonb),
  ('ke-private-financial-audit', 1, 'responses-to-risk', 'Design responses to assessed risks', 'programs', true, true,
   '["ISA 330", "ISA 315 (Revised 2019)"]'::jsonb,
   '{"objective":"Link planned procedures to assessed risks and assertions.","dependencies":["entity-understanding-risk","materiality"],"requiredFields":["riskLinks","plannedProcedures","timingAndExtent"],"expectedEvidence":["Risk-to-procedure mapping","Approved audit program"],"completionRules":{"requireConclusion":true,"requireEvidence":true,"requireReviewerWhenRequired":true}}'::jsonb),
  ('ke-private-financial-audit', 1, 'audit-evidence', 'Evaluate audit evidence', 'working_papers', true, true,
   '["ISA 500", "ISA 230"]'::jsonb,
   '{"objective":"Document procedures performed, evidence obtained, exceptions and conclusions.","dependencies":["responses-to-risk"],"requiredFields":["workPerformed","evidenceReferences","exceptions","conclusion"],"expectedEvidence":["Cross-referenced workpapers and source evidence"],"completionRules":{"requireConclusion":true,"requireEvidence":true,"requireReviewerWhenRequired":true}}'::jsonb),
  ('ke-private-financial-audit', 1, 'misstatements', 'Evaluate identified misstatements', 'financial_statements', true, true,
   '["ISA 450"]'::jsonb,
   '{"objective":"Accumulate and evaluate misstatements and document disposition.","dependencies":["audit-evidence"],"requiredFields":["misstatementSchedule","correctedStatus","uncorrectedEvaluation"],"expectedEvidence":["Misstatement schedule","Management communication where applicable"],"completionRules":{"requireConclusion":true,"requireEvidence":true,"requireReviewerWhenRequired":true}}'::jsonb),
  ('ke-private-financial-audit', 1, 'completion-and-report', 'Completion and reporting', 'completion', true, true,
   '["ISA 560", "ISA 570", "ISA 580", "ISA 700"]'::jsonb,
   '{"objective":"Document completion matters and the basis for the auditor report.","dependencies":["misstatements"],"requiredFields":["subsequentEvents","goingConcern","writtenRepresentations","reportConclusion"],"expectedEvidence":["Completion checklist","Written representations","Approved report"],"completionRules":{"requireConclusion":true,"requireEvidence":true,"requireReviewerWhenRequired":true}}'::jsonb)
on conflict (pack_id, pack_version, procedure_id) do nothing;
