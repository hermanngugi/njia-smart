-- Client, document, HR and ICT relationships
-- Additive FK-supporting indexes only. No table data, constraints, RLS policies,
-- or existing indexes are modified. Safe to re-run because each index is IF NOT EXISTS.

CREATE INDEX IF NOT EXISTS idx_fk_audit_signoffs_result_id ON public.audit_signoffs USING btree (result_id);
CREATE INDEX IF NOT EXISTS idx_fk_audit_signoffs_reviewer_id ON public.audit_signoffs USING btree (reviewer_id);
CREATE INDEX IF NOT EXISTS idx_fk_audit_workpapers_engagement_id ON public.audit_workpapers USING btree (engagement_id);
CREATE INDEX IF NOT EXISTS idx_fk_audit_workpapers_updated_by ON public.audit_workpapers USING btree (updated_by);
CREATE INDEX IF NOT EXISTS idx_fk_audit_workpapers_uploaded_by ON public.audit_workpapers USING btree (uploaded_by);
CREATE INDEX IF NOT EXISTS idx_fk_chat_channels_created_by ON public.chat_channels USING btree (created_by);
CREATE INDEX IF NOT EXISTS idx_fk_chat_message_hides_message_id ON public.chat_message_hides USING btree (message_id);
CREATE INDEX IF NOT EXISTS idx_fk_chat_messages_sender_id ON public.chat_messages USING btree (sender_id);
CREATE INDEX IF NOT EXISTS idx_fk_client_assignments_user_id ON public.client_assignments USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_fk_client_contacts_client_id ON public.client_contacts USING btree (client_id);
CREATE INDEX IF NOT EXISTS idx_fk_client_obligation_assignees_assigned_by ON public.client_obligation_assignees USING btree (assigned_by);
CREATE INDEX IF NOT EXISTS idx_fk_client_obligation_assignees_tax_type ON public.client_obligation_assignees USING btree (tax_type);
CREATE INDEX IF NOT EXISTS idx_fk_client_obligation_contacts_tax_type ON public.client_obligation_contacts USING btree (tax_type);
CREATE INDEX IF NOT EXISTS idx_fk_client_obligation_logins_tax_type ON public.client_obligation_logins USING btree (tax_type);
CREATE INDEX IF NOT EXISTS idx_fk_client_obligation_logins_updated_by ON public.client_obligation_logins USING btree (updated_by);
CREATE INDEX IF NOT EXISTS idx_fk_client_tax_obligations_tax_type ON public.client_tax_obligations USING btree (tax_type);
CREATE INDEX IF NOT EXISTS idx_fk_clients_created_by ON public.clients USING btree (created_by);
CREATE INDEX IF NOT EXISTS idx_fk_clients_paused_by ON public.clients USING btree (paused_by);
CREATE INDEX IF NOT EXISTS idx_fk_clients_portal_password_updated_by ON public.clients USING btree (portal_password_updated_by);
CREATE INDEX IF NOT EXISTS idx_fk_clients_updated_by ON public.clients USING btree (updated_by);
CREATE INDEX IF NOT EXISTS idx_fk_documents_engagement_id ON public.documents USING btree (engagement_id);
CREATE INDEX IF NOT EXISTS idx_fk_documents_updated_by ON public.documents USING btree (updated_by);
CREATE INDEX IF NOT EXISTS idx_fk_documents_uploaded_by ON public.documents USING btree (uploaded_by);
CREATE INDEX IF NOT EXISTS idx_fk_engagements_assigned_to ON public.engagements USING btree (assigned_to);
CREATE INDEX IF NOT EXISTS idx_fk_engagements_client_id ON public.engagements USING btree (client_id);
CREATE INDEX IF NOT EXISTS idx_fk_engagements_created_by ON public.engagements USING btree (created_by);
CREATE INDEX IF NOT EXISTS idx_fk_engagements_updated_by ON public.engagements USING btree (updated_by);
CREATE INDEX IF NOT EXISTS idx_fk_hr_documents_employee_id ON public.hr_documents USING btree (employee_id);
