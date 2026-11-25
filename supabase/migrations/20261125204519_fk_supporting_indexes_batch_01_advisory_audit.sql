-- Advisory, announcements, audit and chat
-- Additive FK-supporting indexes only. No table data, constraints, RLS policies,
-- or existing indexes are modified. Safe to re-run because each index is IF NOT EXISTS.

CREATE INDEX IF NOT EXISTS idx_fk_advisory_case_controls_assigned_to ON public.advisory_case_controls USING btree (assigned_to);
CREATE INDEX IF NOT EXISTS idx_fk_advisory_case_controls_created_by ON public.advisory_case_controls USING btree (created_by);
CREATE INDEX IF NOT EXISTS idx_fk_advisory_case_controls_template_control_id ON public.advisory_case_controls USING btree (template_control_id);
CREATE INDEX IF NOT EXISTS idx_fk_advisory_case_controls_verified_by ON public.advisory_case_controls USING btree (verified_by);
CREATE INDEX IF NOT EXISTS idx_fk_advisory_milestone_documents_uploaded_by ON public.advisory_milestone_documents USING btree (uploaded_by);
CREATE INDEX IF NOT EXISTS idx_fk_advisory_milestone_documents_verified_by ON public.advisory_milestone_documents USING btree (verified_by);
CREATE INDEX IF NOT EXISTS idx_fk_advisory_milestones_assigned_to ON public.advisory_milestones USING btree (assigned_to);
CREATE INDEX IF NOT EXISTS idx_fk_advisory_milestones_project_id ON public.advisory_milestones USING btree (project_id);
CREATE INDEX IF NOT EXISTS idx_fk_advisory_milestones_verified_by ON public.advisory_milestones USING btree (verified_by);
CREATE INDEX IF NOT EXISTS idx_fk_advisory_projects_client_id ON public.advisory_projects USING btree (client_id);
CREATE INDEX IF NOT EXISTS idx_fk_advisory_projects_closed_by ON public.advisory_projects USING btree (closed_by);
CREATE INDEX IF NOT EXISTS idx_fk_advisory_projects_created_by ON public.advisory_projects USING btree (created_by);
CREATE INDEX IF NOT EXISTS idx_fk_advisory_projects_updated_by ON public.advisory_projects USING btree (updated_by);
CREATE INDEX IF NOT EXISTS idx_fk_advisory_service_templates_created_by ON public.advisory_service_templates USING btree (created_by);
CREATE INDEX IF NOT EXISTS idx_fk_announcements_author_id ON public.announcements USING btree (author_id);
CREATE INDEX IF NOT EXISTS idx_fk_audit_change_history_actor_id ON public.audit_change_history USING btree (actor_id);
CREATE INDEX IF NOT EXISTS idx_fk_audit_engagement_procedures_assigned_reviewer_id ON public.audit_engagement_procedures USING btree (assigned_reviewer_id);
CREATE INDEX IF NOT EXISTS idx_fk_audit_engagement_procedures_assigned_to ON public.audit_engagement_procedures USING btree (assigned_to);
CREATE INDEX IF NOT EXISTS idx_fk_audit_engagement_procedures_created_by ON public.audit_engagement_procedures USING btree (created_by);
CREATE INDEX IF NOT EXISTS idx_fk_audit_engagement_procedures_pack_id_pack_version_procedu ON public.audit_engagement_procedures USING btree (pack_id, pack_version, procedure_id);
CREATE INDEX IF NOT EXISTS idx_fk_audit_evidence_links_linked_by ON public.audit_evidence_links USING btree (linked_by);
CREATE INDEX IF NOT EXISTS idx_fk_audit_evidence_links_workpaper_id ON public.audit_evidence_links USING btree (workpaper_id);
CREATE INDEX IF NOT EXISTS idx_fk_audit_procedure_packs_created_by ON public.audit_procedure_packs USING btree (created_by);
CREATE INDEX IF NOT EXISTS idx_fk_audit_procedure_results_prepared_by ON public.audit_procedure_results USING btree (prepared_by);
CREATE INDEX IF NOT EXISTS idx_fk_audit_review_notes_author_id ON public.audit_review_notes USING btree (author_id);
CREATE INDEX IF NOT EXISTS idx_fk_audit_review_notes_resolved_by ON public.audit_review_notes USING btree (resolved_by);
CREATE INDEX IF NOT EXISTS idx_fk_audit_risk_procedure_links_linked_by ON public.audit_risk_procedure_links USING btree (linked_by);
CREATE INDEX IF NOT EXISTS idx_fk_audit_risks_created_by ON public.audit_risks USING btree (created_by);
