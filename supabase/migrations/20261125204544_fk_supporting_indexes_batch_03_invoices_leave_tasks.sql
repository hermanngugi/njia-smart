-- Invoice, leave, payment, task and related relationships
-- Additive FK-supporting indexes only. No table data, constraints, RLS policies,
-- or existing indexes are modified. Safe to re-run because each index is IF NOT EXISTS.

CREATE INDEX IF NOT EXISTS idx_fk_hr_documents_uploaded_by ON public.hr_documents USING btree (uploaded_by);
CREATE INDEX IF NOT EXISTS idx_fk_hr_employment_manager_id ON public.hr_employment USING btree (manager_id);
CREATE INDEX IF NOT EXISTS idx_fk_hr_employment_updated_by ON public.hr_employment USING btree (updated_by);
CREATE INDEX IF NOT EXISTS idx_fk_ict_assets_assigned_to ON public.ict_assets USING btree (assigned_to);
CREATE INDEX IF NOT EXISTS idx_fk_ict_assets_created_by ON public.ict_assets USING btree (created_by);
CREATE INDEX IF NOT EXISTS idx_fk_ict_case_controls_assigned_to ON public.ict_case_controls USING btree (assigned_to);
CREATE INDEX IF NOT EXISTS idx_fk_ict_case_controls_completed_by ON public.ict_case_controls USING btree (completed_by);
CREATE INDEX IF NOT EXISTS idx_fk_ict_case_controls_created_by ON public.ict_case_controls USING btree (created_by);
CREATE INDEX IF NOT EXISTS idx_fk_ict_case_controls_template_control_id ON public.ict_case_controls USING btree (template_control_id);
CREATE INDEX IF NOT EXISTS idx_fk_ict_case_controls_verified_by ON public.ict_case_controls USING btree (verified_by);
CREATE INDEX IF NOT EXISTS idx_fk_ict_knowledge_articles_created_by ON public.ict_knowledge_articles USING btree (created_by);
CREATE INDEX IF NOT EXISTS idx_fk_ict_knowledge_articles_updated_by ON public.ict_knowledge_articles USING btree (updated_by);
CREATE INDEX IF NOT EXISTS idx_fk_ict_password_vault_audit_actor_id ON public.ict_password_vault_audit USING btree (actor_id);
CREATE INDEX IF NOT EXISTS idx_fk_ict_password_vault_config_created_by ON public.ict_password_vault_config USING btree (created_by);
CREATE INDEX IF NOT EXISTS idx_fk_ict_password_vault_created_by ON public.ict_password_vault USING btree (created_by);
CREATE INDEX IF NOT EXISTS idx_fk_ict_password_vault_updated_by ON public.ict_password_vault USING btree (updated_by);
CREATE INDEX IF NOT EXISTS idx_fk_ict_service_templates_created_by ON public.ict_service_templates USING btree (created_by);
CREATE INDEX IF NOT EXISTS idx_fk_ict_tickets_assigned_to ON public.ict_tickets USING btree (assigned_to);
CREATE INDEX IF NOT EXISTS idx_fk_invoice_items_invoice_id ON public.invoice_items USING btree (invoice_id);
CREATE INDEX IF NOT EXISTS idx_fk_invoices_client_id ON public.invoices USING btree (client_id);
CREATE INDEX IF NOT EXISTS idx_fk_invoices_created_by ON public.invoices USING btree (created_by);
CREATE INDEX IF NOT EXISTS idx_fk_invoices_updated_by ON public.invoices USING btree (updated_by);
CREATE INDEX IF NOT EXISTS idx_fk_leave_requests_archived_by ON public.leave_requests USING btree (archived_by);
CREATE INDEX IF NOT EXISTS idx_fk_leave_requests_balance_reset_by ON public.leave_requests USING btree (balance_reset_by);
CREATE INDEX IF NOT EXISTS idx_fk_leave_requests_decided_by ON public.leave_requests USING btree (decided_by);
CREATE INDEX IF NOT EXISTS idx_fk_leave_requests_employee_id ON public.leave_requests USING btree (employee_id);
CREATE INDEX IF NOT EXISTS idx_fk_leave_requests_leave_type_id ON public.leave_requests USING btree (leave_type_id);
CREATE INDEX IF NOT EXISTS idx_fk_leave_requests_reliever_decided_by ON public.leave_requests USING btree (reliever_decided_by);
