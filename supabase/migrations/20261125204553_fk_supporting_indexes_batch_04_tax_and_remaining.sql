-- Tax and remaining foreign-key relationships
-- Additive FK-supporting indexes only. No table data, constraints, RLS policies,
-- or existing indexes are modified. Safe to re-run because each index is IF NOT EXISTS.

CREATE INDEX IF NOT EXISTS idx_fk_leave_requests_reliever_id ON public.leave_requests USING btree (reliever_id);
CREATE INDEX IF NOT EXISTS idx_fk_notifications_actor_id ON public.notifications USING btree (actor_id);
CREATE INDEX IF NOT EXISTS idx_fk_payments_client_id ON public.payments USING btree (client_id);
CREATE INDEX IF NOT EXISTS idx_fk_payments_invoice_id ON public.payments USING btree (invoice_id);
CREATE INDEX IF NOT EXISTS idx_fk_payments_recorded_by ON public.payments USING btree (recorded_by);
CREATE INDEX IF NOT EXISTS idx_fk_payslips_uploaded_by ON public.payslips USING btree (uploaded_by);
CREATE INDEX IF NOT EXISTS idx_fk_quick_links_created_by ON public.quick_links USING btree (created_by);
CREATE INDEX IF NOT EXISTS idx_fk_service_milestone_documents_uploaded_by ON public.service_milestone_documents USING btree (uploaded_by);
CREATE INDEX IF NOT EXISTS idx_fk_service_milestone_documents_verified_by ON public.service_milestone_documents USING btree (verified_by);
CREATE INDEX IF NOT EXISTS idx_fk_service_milestones_assigned_to ON public.service_milestones USING btree (assigned_to);
CREATE INDEX IF NOT EXISTS idx_fk_service_milestones_verified_by ON public.service_milestones USING btree (verified_by);
CREATE INDEX IF NOT EXISTS idx_fk_service_projects_closed_by ON public.service_projects USING btree (closed_by);
CREATE INDEX IF NOT EXISTS idx_fk_task_comments_author_id ON public.task_comments USING btree (author_id);
CREATE INDEX IF NOT EXISTS idx_fk_task_outputs_uploaded_by ON public.task_outputs USING btree (uploaded_by);
CREATE INDEX IF NOT EXISTS idx_fk_task_subtasks_created_by ON public.task_subtasks USING btree (created_by);
CREATE INDEX IF NOT EXISTS idx_fk_tasks_client_id ON public.tasks USING btree (client_id);
CREATE INDEX IF NOT EXISTS idx_fk_tasks_completed_by ON public.tasks USING btree (completed_by);
CREATE INDEX IF NOT EXISTS idx_fk_tasks_created_by ON public.tasks USING btree (created_by);
CREATE INDEX IF NOT EXISTS idx_fk_tasks_supervisor_id ON public.tasks USING btree (supervisor_id);
CREATE INDEX IF NOT EXISTS idx_fk_tasks_updated_by ON public.tasks USING btree (updated_by);
CREATE INDEX IF NOT EXISTS idx_fk_tax_policies_updated_by ON public.tax_policies USING btree (updated_by);
CREATE INDEX IF NOT EXISTS idx_fk_tax_return_assignees_assigned_by ON public.tax_return_assignees USING btree (assigned_by);
CREATE INDEX IF NOT EXISTS idx_fk_tax_returns_assigned_by ON public.tax_returns USING btree (assigned_by);
CREATE INDEX IF NOT EXISTS idx_fk_tax_returns_assigned_to ON public.tax_returns USING btree (assigned_to);
CREATE INDEX IF NOT EXISTS idx_fk_tax_returns_client_id ON public.tax_returns USING btree (client_id);
CREATE INDEX IF NOT EXISTS idx_fk_tax_returns_created_by ON public.tax_returns USING btree (created_by);
CREATE INDEX IF NOT EXISTS idx_fk_tax_returns_filed_by ON public.tax_returns USING btree (filed_by);
CREATE INDEX IF NOT EXISTS idx_fk_tax_returns_return_type ON public.tax_returns USING btree (return_type);
