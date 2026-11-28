-- Five-step audit checklist (version 2). Version 1 rows stay for any checklist already created from them.
insert into public.audit_procedure_packs
  (id, version, title, description, jurisdiction, engagement_kind, standards_basis, effective_from, status)
values
  ('ke-private-financial-audit', 2, 'Kenya — Private-sector financial statement audit', 'Short five-step ISA-based checklist for private-sector financial statement audits in Kenya. Requires professional review before use.',
   'KE', 'private_financial_statement_audit',
   '["ISA", "IESBA Code", "Kenyan company and sector-specific law, where applicable"]'::jsonb,
   date '2026-11-27', 'active')
on conflict (id, version) do nothing;

insert into public.audit_procedure_definitions
  (pack_id, pack_version, procedure_id, title, section_id, required, enabled, standard_references, definition)
values
  ('ke-private-financial-audit', 2, 'accept-engagement', 'Accept the engagement', 'planning', true, true,
   '["ISA 210", "ISA 220 (Revised)", "IESBA Code"]'::jsonb,
   '{"objective": "Confirm acceptance or continuance and team independence, and agree the engagement terms.", "dependencies": [], "requiredFields": ["decision", "teamDeclarations", "threatsAndSafeguards", "termsDate", "approval"], "expectedEvidence": ["Acceptance/continuance assessment and approval", "Team independence declarations, with any threats and safeguards", "Signed engagement letter"], "completionRules": {"requireConclusion": true, "requireEvidence": true, "requireReviewerWhenRequired": true}}'::jsonb),
  ('ke-private-financial-audit', 2, 'plan-audit', 'Plan the audit', 'planning', true, true,
   '["ISA 240", "ISA 300", "ISA 315 (Revised 2019)", "ISA 320", "ISA 330"]'::jsonb,
   '{"objective": "Understand the entity, set materiality, assess the risks (including fraud) and decide how to respond to each.", "dependencies": ["accept-engagement"], "requiredFields": ["entityUnderstanding", "materiality", "riskAssessments", "plannedProcedures"], "expectedEvidence": ["Understanding of the entity and its controls", "Materiality calculation and rationale", "Risks and the planned response to each"], "completionRules": {"requireConclusion": true, "requireEvidence": true, "requireReviewerWhenRequired": true}}'::jsonb),
  ('ke-private-financial-audit', 2, 'perform-work', 'Do the audit work', 'working_papers', true, true,
   '["ISA 230", "ISA 330", "ISA 500"]'::jsonb,
   '{"objective": "Carry out the planned procedures and record the evidence, exceptions and conclusions.", "dependencies": ["plan-audit"], "requiredFields": ["workPerformed", "evidenceReferences", "exceptions", "conclusion"], "expectedEvidence": ["Cross-referenced workpapers and source evidence"], "completionRules": {"requireConclusion": true, "requireEvidence": true, "requireReviewerWhenRequired": true}}'::jsonb),
  ('ke-private-financial-audit', 2, 'evaluate-results', 'Evaluate errors and financial statements', 'financial_statements', true, true,
   '["ISA 450", "ISA 700"]'::jsonb,
   '{"objective": "List misstatements, agree corrections with management, and check the financial statements and disclosures.", "dependencies": ["perform-work"], "requiredFields": ["misstatementSchedule", "correctedStatus", "uncorrectedEvaluation", "disclosureReview"], "expectedEvidence": ["Misstatement schedule", "Management communication, where applicable", "Reviewed financial statements"], "completionRules": {"requireConclusion": true, "requireEvidence": true, "requireReviewerWhenRequired": true}}'::jsonb),
  ('ke-private-financial-audit', 2, 'complete-report', 'Complete and report', 'completion', true, true,
   '["ISA 560", "ISA 570", "ISA 580", "ISA 700"]'::jsonb,
   '{"objective": "Check subsequent events and going concern, obtain written representations and approve the auditor''s report.", "dependencies": ["evaluate-results"], "requiredFields": ["subsequentEvents", "goingConcern", "writtenRepresentations", "reportConclusion"], "expectedEvidence": ["Completion checklist", "Written representations", "Approved audit report"], "completionRules": {"requireConclusion": true, "requireEvidence": true, "requireReviewerWhenRequired": true}}'::jsonb)
on conflict (pack_id, pack_version, procedure_id) do nothing;
