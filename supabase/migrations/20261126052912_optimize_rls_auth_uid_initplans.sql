-- RLS initplan optimization: cache request-scoped auth.uid() calls per statement.
-- Reasserts the exact optimized USING/WITH CHECK expressions after live verification.
-- No policy names, commands, roles, permissive modes, data, or grants are changed.

ALTER POLICY "activity insert staff" ON public."activity_log" WITH CHECK (private.is_staff(( SELECT auth.uid() AS uid)));
ALTER POLICY "activity select by rank" ON public."activity_log" USING (private.can_view_module_all(( SELECT auth.uid() AS uid), 'activity'::text));
ALTER POLICY "advisory case controls delete admin" ON public."advisory_case_controls" USING (private.is_admin(( SELECT auth.uid() AS uid)));
ALTER POLICY "advisory case controls insert" ON public."advisory_case_controls" WITH CHECK ((private.can_work_advisory(( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM advisory_projects p
  WHERE (p.id = advisory_case_controls.project_id)))));
ALTER POLICY "advisory case controls read" ON public."advisory_case_controls" USING ((EXISTS ( SELECT 1
   FROM advisory_projects p
  WHERE ((p.id = advisory_case_controls.project_id) AND (private.can_view_module_all(( SELECT auth.uid() AS uid), 'advisory'::text) OR (private.is_module_assigned_only(( SELECT auth.uid() AS uid), 'advisory'::text) AND ((p.created_by = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
           FROM client_assignments ca
          WHERE ((ca.client_id = p.client_id) AND (ca.user_id = ( SELECT auth.uid() AS uid))))))))))));
ALTER POLICY "advisory case controls update" ON public."advisory_case_controls" USING ((private.can_work_advisory(( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM advisory_projects p
  WHERE (p.id = advisory_case_controls.project_id))))) WITH CHECK ((private.can_work_advisory(( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM advisory_projects p
  WHERE (p.id = advisory_case_controls.project_id)))));
ALTER POLICY "advisory documents delete director admin" ON public."advisory_milestone_documents" USING (private.is_admin(( SELECT auth.uid() AS uid)));
ALTER POLICY "advisory documents insert full access" ON public."advisory_milestone_documents" WITH CHECK ((private.can_work_advisory(( SELECT auth.uid() AS uid)) AND (uploaded_by = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM advisory_milestones m
  WHERE (m.id = advisory_milestone_documents.milestone_id)))));
ALTER POLICY "advisory documents select by parent" ON public."advisory_milestone_documents" USING ((EXISTS ( SELECT 1
   FROM (advisory_milestones m
     JOIN advisory_projects p ON ((p.id = m.project_id)))
  WHERE ((m.id = advisory_milestone_documents.milestone_id) AND private.can_view_module(( SELECT auth.uid() AS uid), 'advisory'::text) AND (private.can_view_module_all(( SELECT auth.uid() AS uid), 'advisory'::text) OR (p.created_by = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
           FROM client_assignments ca
          WHERE ((ca.client_id = p.client_id) AND (ca.user_id = ( SELECT auth.uid() AS uid))))))))));
ALTER POLICY "advisory documents update director admin" ON public."advisory_milestone_documents" USING (private.is_admin(( SELECT auth.uid() AS uid))) WITH CHECK (private.is_admin(( SELECT auth.uid() AS uid)));
ALTER POLICY "advisory activities delete director admin" ON public."advisory_milestones" USING (private.is_admin(( SELECT auth.uid() AS uid)));
ALTER POLICY "advisory activities insert full access" ON public."advisory_milestones" WITH CHECK ((private.can_work_advisory(( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM advisory_projects p
  WHERE (p.id = advisory_milestones.project_id)))));
ALTER POLICY "advisory activities select by parent" ON public."advisory_milestones" USING ((EXISTS ( SELECT 1
   FROM advisory_projects p
  WHERE ((p.id = advisory_milestones.project_id) AND (private.can_view_module_all(( SELECT auth.uid() AS uid), 'advisory'::text) OR (private.is_module_assigned_only(( SELECT auth.uid() AS uid), 'advisory'::text) AND ((p.created_by = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
           FROM client_assignments ca
          WHERE ((ca.client_id = p.client_id) AND (ca.user_id = ( SELECT auth.uid() AS uid))))))))))));
ALTER POLICY "advisory activities update full access" ON public."advisory_milestones" USING ((private.can_work_advisory(( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM advisory_projects p
  WHERE (p.id = advisory_milestones.project_id))))) WITH CHECK ((private.can_work_advisory(( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM advisory_projects p
  WHERE (p.id = advisory_milestones.project_id)))));
ALTER POLICY "advisory cases delete director admin" ON public."advisory_projects" USING (private.is_admin(( SELECT auth.uid() AS uid)));
ALTER POLICY "advisory cases insert full access" ON public."advisory_projects" WITH CHECK ((private.can_work_advisory(( SELECT auth.uid() AS uid)) AND (private.is_admin(( SELECT auth.uid() AS uid)) OR (created_by = ( SELECT auth.uid() AS uid)))));
ALTER POLICY "advisory cases select by rank" ON public."advisory_projects" USING ((private.can_view_module_all(( SELECT auth.uid() AS uid), 'advisory'::text) OR (private.is_module_assigned_only(( SELECT auth.uid() AS uid), 'advisory'::text) AND ((created_by = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM client_assignments ca
  WHERE ((ca.client_id = advisory_projects.client_id) AND (ca.user_id = ( SELECT auth.uid() AS uid)))))))));
ALTER POLICY "advisory cases update full access" ON public."advisory_projects" USING (private.can_work_advisory(( SELECT auth.uid() AS uid))) WITH CHECK (private.can_work_advisory(( SELECT auth.uid() AS uid)));
ALTER POLICY "rls_consolidated_advisory_service_templates_delete" ON public."advisory_service_templates" USING (private.is_admin(( SELECT auth.uid() AS uid)));
ALTER POLICY "rls_consolidated_advisory_service_templates_insert" ON public."advisory_service_templates" WITH CHECK (private.is_admin(( SELECT auth.uid() AS uid)));
ALTER POLICY "rls_consolidated_advisory_service_templates_select" ON public."advisory_service_templates" USING ((private.is_admin(( SELECT auth.uid() AS uid)) OR (private.can_view_module_all(( SELECT auth.uid() AS uid), 'advisory'::text) OR private.is_module_assigned_only(( SELECT auth.uid() AS uid), 'advisory'::text))));
ALTER POLICY "rls_consolidated_advisory_service_templates_update" ON public."advisory_service_templates" USING (private.is_admin(( SELECT auth.uid() AS uid))) WITH CHECK (private.is_admin(( SELECT auth.uid() AS uid)));
ALTER POLICY "rls_consolidated_advisory_template_controls_delete" ON public."advisory_template_controls" USING (private.is_admin(( SELECT auth.uid() AS uid)));
ALTER POLICY "rls_consolidated_advisory_template_controls_insert" ON public."advisory_template_controls" WITH CHECK (private.is_admin(( SELECT auth.uid() AS uid)));
ALTER POLICY "rls_consolidated_advisory_template_controls_select" ON public."advisory_template_controls" USING ((private.is_admin(( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM advisory_service_templates t
  WHERE ((t.id = advisory_template_controls.template_id) AND (private.can_view_module_all(( SELECT auth.uid() AS uid), 'advisory'::text) OR private.is_module_assigned_only(( SELECT auth.uid() AS uid), 'advisory'::text)))))));
ALTER POLICY "rls_consolidated_advisory_template_controls_update" ON public."advisory_template_controls" USING (private.is_admin(( SELECT auth.uid() AS uid))) WITH CHECK (private.is_admin(( SELECT auth.uid() AS uid)));
ALTER POLICY "announcements delete all staff" ON public."announcements" USING (private.is_staff(( SELECT auth.uid() AS uid)));
ALTER POLICY "announcements insert all staff" ON public."announcements" WITH CHECK ((private.is_staff(( SELECT auth.uid() AS uid)) AND (author_id = ( SELECT auth.uid() AS uid))));
ALTER POLICY "announcements select all staff" ON public."announcements" USING (private.is_staff(( SELECT auth.uid() AS uid)));
ALTER POLICY "announcements update all staff" ON public."announcements" USING (private.is_staff(( SELECT auth.uid() AS uid))) WITH CHECK (private.is_staff(( SELECT auth.uid() AS uid)));
ALTER POLICY "audit change history insert financial staff" ON public."audit_change_history" WITH CHECK ((private.can_access_financials(( SELECT auth.uid() AS uid)) AND ((actor_id IS NULL) OR (actor_id = ( SELECT auth.uid() AS uid)))));
ALTER POLICY "audit change history read financial staff" ON public."audit_change_history" USING (private.can_access_financials(( SELECT auth.uid() AS uid)));
ALTER POLICY "audit engagement procedures financial staff" ON public."audit_engagement_procedures" USING (private.can_access_financials(( SELECT auth.uid() AS uid))) WITH CHECK (private.can_access_financials(( SELECT auth.uid() AS uid)));
ALTER POLICY "audit evidence links financial staff" ON public."audit_evidence_links" USING (private.can_access_financials(( SELECT auth.uid() AS uid))) WITH CHECK (private.can_access_financials(( SELECT auth.uid() AS uid)));
ALTER POLICY "rls_consolidated_audit_procedure_definitions_delete" ON public."audit_procedure_definitions" USING (private.is_admin(( SELECT auth.uid() AS uid)));
ALTER POLICY "rls_consolidated_audit_procedure_definitions_insert" ON public."audit_procedure_definitions" WITH CHECK (private.is_admin(( SELECT auth.uid() AS uid)));
ALTER POLICY "rls_consolidated_audit_procedure_definitions_select" ON public."audit_procedure_definitions" USING ((private.is_admin(( SELECT auth.uid() AS uid)) OR private.can_access_financials(( SELECT auth.uid() AS uid))));
ALTER POLICY "rls_consolidated_audit_procedure_definitions_update" ON public."audit_procedure_definitions" USING (private.is_admin(( SELECT auth.uid() AS uid))) WITH CHECK (private.is_admin(( SELECT auth.uid() AS uid)));
ALTER POLICY "rls_consolidated_audit_procedure_packs_delete" ON public."audit_procedure_packs" USING (private.is_admin(( SELECT auth.uid() AS uid)));
ALTER POLICY "rls_consolidated_audit_procedure_packs_insert" ON public."audit_procedure_packs" WITH CHECK (private.is_admin(( SELECT auth.uid() AS uid)));
ALTER POLICY "rls_consolidated_audit_procedure_packs_select" ON public."audit_procedure_packs" USING ((private.is_admin(( SELECT auth.uid() AS uid)) OR private.can_access_financials(( SELECT auth.uid() AS uid))));
ALTER POLICY "rls_consolidated_audit_procedure_packs_update" ON public."audit_procedure_packs" USING (private.is_admin(( SELECT auth.uid() AS uid))) WITH CHECK (private.is_admin(( SELECT auth.uid() AS uid)));
ALTER POLICY "audit procedure results financial staff" ON public."audit_procedure_results" USING (private.can_access_financials(( SELECT auth.uid() AS uid))) WITH CHECK (private.can_access_financials(( SELECT auth.uid() AS uid)));
ALTER POLICY "review notes by parent engagement" ON public."audit_review_notes" USING ((EXISTS ( SELECT 1
   FROM engagements e
  WHERE ((e.id = audit_review_notes.engagement_id) AND (private.can_view_module_all(( SELECT auth.uid() AS uid), 'audit'::text) OR (private.is_module_assigned_only(( SELECT auth.uid() AS uid), 'audit'::text) AND ((e.assigned_to = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
           FROM client_assignments ca
          WHERE ((ca.client_id = e.client_id) AND (ca.user_id = ( SELECT auth.uid() AS uid)))))))))))) WITH CHECK (private.can_view_module(( SELECT auth.uid() AS uid), 'audit'::text));
ALTER POLICY "audit risk procedure links financial staff" ON public."audit_risk_procedure_links" USING (private.can_access_financials(( SELECT auth.uid() AS uid))) WITH CHECK ((private.can_access_financials(( SELECT auth.uid() AS uid)) AND ((linked_by IS NULL) OR (linked_by = ( SELECT auth.uid() AS uid)))));
ALTER POLICY "audit risks financial staff" ON public."audit_risks" USING (private.can_access_financials(( SELECT auth.uid() AS uid))) WITH CHECK (private.can_access_financials(( SELECT auth.uid() AS uid)));
ALTER POLICY "audit signoffs read financial staff" ON public."audit_signoffs" USING (private.can_access_financials(( SELECT auth.uid() AS uid)));
ALTER POLICY "workpapers by parent engagement" ON public."audit_workpapers" USING ((EXISTS ( SELECT 1
   FROM engagements e
  WHERE ((e.id = audit_workpapers.engagement_id) AND (private.can_view_module_all(( SELECT auth.uid() AS uid), 'audit'::text) OR (private.is_module_assigned_only(( SELECT auth.uid() AS uid), 'audit'::text) AND ((e.assigned_to = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
           FROM client_assignments ca
          WHERE ((ca.client_id = e.client_id) AND (ca.user_id = ( SELECT auth.uid() AS uid)))))))))))) WITH CHECK (private.can_view_module(( SELECT auth.uid() AS uid), 'audit'::text));
ALTER POLICY "calendar events delete own" ON public."calendar_events" USING ((created_by = ( SELECT auth.uid() AS uid)));
ALTER POLICY "calendar events insert own" ON public."calendar_events" WITH CHECK ((private.is_staff(( SELECT auth.uid() AS uid)) AND (created_by = ( SELECT auth.uid() AS uid))));
ALTER POLICY "calendar events select all staff" ON public."calendar_events" USING (private.is_staff(( SELECT auth.uid() AS uid)));
ALTER POLICY "calendar events update own" ON public."calendar_events" USING (((created_by = ( SELECT auth.uid() AS uid)) OR (assigned_to = ( SELECT auth.uid() AS uid)))) WITH CHECK (((created_by = ( SELECT auth.uid() AS uid)) OR (assigned_to = ( SELECT auth.uid() AS uid))));
ALTER POLICY "chat members insert own readable" ON public."chat_channel_members" WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) AND private.can_read_chat_channel(channel_id, ( SELECT auth.uid() AS uid))));
ALTER POLICY "chat members select members only" ON public."chat_channel_members" USING (((user_id = ( SELECT auth.uid() AS uid)) OR private.can_read_chat_channel(channel_id, ( SELECT auth.uid() AS uid))));
ALTER POLICY "chat members update own readable" ON public."chat_channel_members" USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) AND private.can_read_chat_channel(channel_id, ( SELECT auth.uid() AS uid))));
ALTER POLICY "chat channels insert staff" ON public."chat_channels" WITH CHECK ((private.is_staff(( SELECT auth.uid() AS uid)) AND (created_by = ( SELECT auth.uid() AS uid)) AND ((kind = 'team'::text) OR ((kind = 'client'::text) AND private.can_access_financials(( SELECT auth.uid() AS uid))) OR (kind = ANY (ARRAY['dm'::text, 'group'::text])))));
ALTER POLICY "chat channels select members only" ON public."chat_channels" USING (((created_by = ( SELECT auth.uid() AS uid)) OR private.can_read_chat_channel(id, ( SELECT auth.uid() AS uid))));
ALTER POLICY "chat hides select own" ON public."chat_message_hides" USING ((user_id = ( SELECT auth.uid() AS uid)));
ALTER POLICY "chat messages insert as self in readable chat" ON public."chat_messages" WITH CHECK (((sender_id = ( SELECT auth.uid() AS uid)) AND private.can_read_chat_channel(channel_id, ( SELECT auth.uid() AS uid))));
ALTER POLICY "chat messages select members only" ON public."chat_messages" USING (private.can_read_chat_channel(channel_id, ( SELECT auth.uid() AS uid)));
ALTER POLICY "client assignments delete full only" ON public."client_assignments" USING (private.has_full_module(( SELECT auth.uid() AS uid), 'clients'::text));
ALTER POLICY "client assignments insert full only" ON public."client_assignments" WITH CHECK (private.has_full_module(( SELECT auth.uid() AS uid), 'clients'::text));
ALTER POLICY "client assignments select" ON public."client_assignments" USING ((private.has_full_module(( SELECT auth.uid() AS uid), 'clients'::text) OR (user_id = ( SELECT auth.uid() AS uid))));
ALTER POLICY "client assignments update full only" ON public."client_assignments" USING (private.has_full_module(( SELECT auth.uid() AS uid), 'clients'::text));
ALTER POLICY "client contacts delete full only" ON public."client_contacts" USING (private.has_full_module(( SELECT auth.uid() AS uid), 'clients'::text));
ALTER POLICY "client contacts insert full only" ON public."client_contacts" WITH CHECK (private.has_full_module(( SELECT auth.uid() AS uid), 'clients'::text));
ALTER POLICY "client contacts select by rank" ON public."client_contacts" USING ((EXISTS ( SELECT 1
   FROM clients c
  WHERE ((c.id = client_contacts.client_id) AND (private.can_view_module_all(( SELECT auth.uid() AS uid), 'clients'::text) OR (private.is_module_assigned_only(( SELECT auth.uid() AS uid), 'clients'::text) AND (EXISTS ( SELECT 1
           FROM client_assignments ca
          WHERE ((ca.client_id = c.id) AND (ca.user_id = ( SELECT auth.uid() AS uid)))))))))));
ALTER POLICY "client contacts update full only" ON public."client_contacts" USING (private.has_full_module(( SELECT auth.uid() AS uid), 'clients'::text));
ALTER POLICY "rls_consolidated_client_obligation_assignees_delete" ON public."client_obligation_assignees" USING (private.has_full_module(( SELECT auth.uid() AS uid), 'clients'::text));
ALTER POLICY "rls_consolidated_client_obligation_assignees_insert" ON public."client_obligation_assignees" WITH CHECK (private.has_full_module(( SELECT auth.uid() AS uid), 'clients'::text));
ALTER POLICY "rls_consolidated_client_obligation_assignees_select" ON public."client_obligation_assignees" USING ((private.has_full_module(( SELECT auth.uid() AS uid), 'clients'::text) OR private.is_staff(( SELECT auth.uid() AS uid))));
ALTER POLICY "rls_consolidated_client_obligation_assignees_update" ON public."client_obligation_assignees" USING (private.has_full_module(( SELECT auth.uid() AS uid), 'clients'::text)) WITH CHECK (private.has_full_module(( SELECT auth.uid() AS uid), 'clients'::text));
ALTER POLICY "obligation contacts all staff" ON public."client_obligation_contacts" USING (private.is_staff(( SELECT auth.uid() AS uid))) WITH CHECK (private.is_staff(( SELECT auth.uid() AS uid)));
ALTER POLICY "obligation logins all staff" ON public."client_obligation_logins" USING (private.is_staff(( SELECT auth.uid() AS uid))) WITH CHECK (private.is_staff(( SELECT auth.uid() AS uid)));
ALTER POLICY "client tax obligations delete full only" ON public."client_tax_obligations" USING (private.has_full_module(( SELECT auth.uid() AS uid), 'tax'::text));
ALTER POLICY "client tax obligations insert full only" ON public."client_tax_obligations" WITH CHECK (private.has_full_module(( SELECT auth.uid() AS uid), 'tax'::text));
ALTER POLICY "client tax obligations select by rank" ON public."client_tax_obligations" USING ((EXISTS ( SELECT 1
   FROM clients c
  WHERE ((c.id = client_tax_obligations.client_id) AND (private.can_view_module_all(( SELECT auth.uid() AS uid), 'tax'::text) OR (private.is_module_assigned_only(( SELECT auth.uid() AS uid), 'tax'::text) AND (EXISTS ( SELECT 1
           FROM client_assignments ca
          WHERE ((ca.client_id = c.id) AND (ca.user_id = ( SELECT auth.uid() AS uid)))))))))));
ALTER POLICY "client tax obligations update full only" ON public."client_tax_obligations" USING (private.has_full_module(( SELECT auth.uid() AS uid), 'tax'::text));
ALTER POLICY "clients delete owner or admin" ON public."clients" USING (private.can_delete_record(( SELECT auth.uid() AS uid), 'clients'::text, created_by));
ALTER POLICY "clients insert full only" ON public."clients" WITH CHECK (private.has_full_module(( SELECT auth.uid() AS uid), 'clients'::text));
ALTER POLICY "clients select by rank" ON public."clients" USING ((((NOT COALESCE(is_paused, false)) OR private.is_admin(( SELECT auth.uid() AS uid))) AND (private.can_view_module_all(( SELECT auth.uid() AS uid), 'clients'::text) OR (private.is_module_assigned_only(( SELECT auth.uid() AS uid), 'clients'::text) AND (EXISTS ( SELECT 1
   FROM client_assignments ca
  WHERE ((ca.client_id = clients.id) AND (ca.user_id = ( SELECT auth.uid() AS uid)))))))));
ALTER POLICY "clients update by rank" ON public."clients" USING ((private.has_full_module(( SELECT auth.uid() AS uid), 'clients'::text) OR (private.is_module_assigned_only(( SELECT auth.uid() AS uid), 'clients'::text) AND (EXISTS ( SELECT 1
   FROM client_assignments ca
  WHERE ((ca.client_id = clients.id) AND (ca.user_id = ( SELECT auth.uid() AS uid))))))));
ALTER POLICY "clients_paused_access_guard" ON public."clients" USING (((NOT COALESCE(is_paused, false)) OR private.is_admin(( SELECT auth.uid() AS uid)))) WITH CHECK (((NOT COALESCE(is_paused, false)) OR private.is_admin(( SELECT auth.uid() AS uid))));
ALTER POLICY "rls_consolidated_compliance_events_delete" ON public."compliance_events" USING (private.is_admin(( SELECT auth.uid() AS uid)));
ALTER POLICY "rls_consolidated_compliance_events_insert" ON public."compliance_events" WITH CHECK (private.is_admin(( SELECT auth.uid() AS uid)));
ALTER POLICY "rls_consolidated_compliance_events_select" ON public."compliance_events" USING ((private.is_admin(( SELECT auth.uid() AS uid)) OR private.is_staff(( SELECT auth.uid() AS uid))));
ALTER POLICY "rls_consolidated_compliance_events_update" ON public."compliance_events" USING (private.is_admin(( SELECT auth.uid() AS uid))) WITH CHECK (private.is_admin(( SELECT auth.uid() AS uid)));
ALTER POLICY "documents update by rank" ON public."documents" USING ((private.has_full_module(( SELECT auth.uid() AS uid), 'documents'::text) OR (private.is_module_assigned_only(( SELECT auth.uid() AS uid), 'documents'::text) AND (uploaded_by = ( SELECT auth.uid() AS uid)))));
ALTER POLICY "documents_delete_consolidated" ON public."documents" USING (((private.can_view_module(( SELECT auth.uid() AS uid), 'documents'::text) AND ((confidentiality <> 'restricted'::text) OR private.is_admin(( SELECT auth.uid() AS uid)))) OR private.can_delete_record(( SELECT auth.uid() AS uid), 'documents'::text, uploaded_by)));
ALTER POLICY "documents_insert_consolidated" ON public."documents" WITH CHECK (((private.can_view_module(( SELECT auth.uid() AS uid), 'documents'::text) AND (uploaded_by = ( SELECT auth.uid() AS uid)) AND ((confidentiality <> 'restricted'::text) OR private.is_admin(( SELECT auth.uid() AS uid)))) OR private.has_full_module(( SELECT auth.uid() AS uid), 'documents'::text)));
ALTER POLICY "documents_restricted_guard" ON public."documents" USING (((confidentiality <> 'restricted'::text) OR private.is_admin(( SELECT auth.uid() AS uid)))) WITH CHECK (((confidentiality <> 'restricted'::text) OR private.is_admin(( SELECT auth.uid() AS uid))));
ALTER POLICY "documents_select_consolidated" ON public."documents" USING ((private.can_view_module_all(( SELECT auth.uid() AS uid), 'documents'::text) OR (private.is_module_assigned_only(( SELECT auth.uid() AS uid), 'documents'::text) AND ((uploaded_by = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM client_assignments ca
  WHERE ((ca.client_id = documents.client_id) AND (ca.user_id = ( SELECT auth.uid() AS uid))))))) OR (private.can_view_module(( SELECT auth.uid() AS uid), 'tax'::text) AND (tax_return_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM tax_returns t
  WHERE ((t.id = documents.tax_return_id) AND (t.client_id = documents.client_id)))))));
ALTER POLICY "documents_tax_access_guard" ON public."documents" USING (((tax_return_id IS NULL) OR private.can_view_module(( SELECT auth.uid() AS uid), 'tax'::text))) WITH CHECK (((tax_return_id IS NULL) OR private.can_view_module(( SELECT auth.uid() AS uid), 'tax'::text)));
ALTER POLICY "engagements delete owner or admin" ON public."engagements" USING (private.can_delete_record(( SELECT auth.uid() AS uid), 'audit'::text, created_by));
ALTER POLICY "engagements insert full only" ON public."engagements" WITH CHECK (private.has_full_module(( SELECT auth.uid() AS uid), 'audit'::text));
ALTER POLICY "engagements select by rank" ON public."engagements" USING ((private.can_view_module_all(( SELECT auth.uid() AS uid), 'audit'::text) OR (private.is_module_assigned_only(( SELECT auth.uid() AS uid), 'audit'::text) AND ((assigned_to = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM client_assignments ca
  WHERE ((ca.client_id = engagements.client_id) AND (ca.user_id = ( SELECT auth.uid() AS uid)))))))));
ALTER POLICY "engagements update by rank" ON public."engagements" USING ((private.has_full_module(( SELECT auth.uid() AS uid), 'audit'::text) OR (private.is_module_assigned_only(( SELECT auth.uid() AS uid), 'audit'::text) AND ((assigned_to = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM client_assignments ca
  WHERE ((ca.client_id = engagements.client_id) AND (ca.user_id = ( SELECT auth.uid() AS uid)))))))));
ALTER POLICY "hr documents delete admin or uploader" ON public."hr_documents" USING ((private.is_admin(( SELECT auth.uid() AS uid)) OR (private.is_hr_manager(( SELECT auth.uid() AS uid)) AND (uploaded_by = ( SELECT auth.uid() AS uid)))));
ALTER POLICY "hr documents insert self hr manager" ON public."hr_documents" WITH CHECK (((employee_id = ( SELECT auth.uid() AS uid)) OR private.is_hr_manager(( SELECT auth.uid() AS uid))));
ALTER POLICY "hr documents select self hr manager" ON public."hr_documents" USING (((employee_id = ( SELECT auth.uid() AS uid)) OR private.is_hr_manager(( SELECT auth.uid() AS uid))));
ALTER POLICY "rls_consolidated_hr_employment_delete" ON public."hr_employment" USING (private.is_hr_manager(( SELECT auth.uid() AS uid)));
ALTER POLICY "rls_consolidated_hr_employment_insert" ON public."hr_employment" WITH CHECK (private.is_hr_manager(( SELECT auth.uid() AS uid)));
ALTER POLICY "rls_consolidated_hr_employment_select" ON public."hr_employment" USING ((private.is_hr_manager(( SELECT auth.uid() AS uid)) OR ((employee_id = ( SELECT auth.uid() AS uid)) OR private.is_hr_manager(( SELECT auth.uid() AS uid)) OR (manager_id = ( SELECT auth.uid() AS uid)))));
ALTER POLICY "rls_consolidated_hr_employment_update" ON public."hr_employment" USING (private.is_hr_manager(( SELECT auth.uid() AS uid))) WITH CHECK (private.is_hr_manager(( SELECT auth.uid() AS uid)));
ALTER POLICY "ict assets full module only" ON public."ict_assets" USING (private.has_full_module(( SELECT auth.uid() AS uid), 'ict_service_desk'::text)) WITH CHECK (private.has_full_module(( SELECT auth.uid() AS uid), 'ict_service_desk'::text));
ALTER POLICY "ict case controls delete" ON public."ict_case_controls" USING ((private.has_full_module(( SELECT auth.uid() AS uid), 'ict_service_desk'::text) OR (private.can_work_ict(( SELECT auth.uid() AS uid)) AND (template_control_id IS NULL) AND (status = 'not_started'::text))));
ALTER POLICY "ict case controls insert" ON public."ict_case_controls" WITH CHECK ((private.can_work_ict(( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM ict_tickets t
  WHERE (t.id = ict_case_controls.ticket_id))) AND ((mandatory = false) OR private.has_full_module(( SELECT auth.uid() AS uid), 'ict_service_desk'::text))));
ALTER POLICY "ict case controls update" ON public."ict_case_controls" USING ((private.can_work_ict(( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM ict_tickets t
  WHERE (t.id = ict_case_controls.ticket_id))))) WITH CHECK ((private.can_work_ict(( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM ict_tickets t
  WHERE (t.id = ict_case_controls.ticket_id)))));
ALTER POLICY "rls_consolidated_ict_knowledge_articles_delete" ON public."ict_knowledge_articles" USING ((private.is_admin(( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM user_roles ur
  WHERE ((ur.user_id = ( SELECT auth.uid() AS uid)) AND (ur.role = 'ict_officer'::app_role))))));
ALTER POLICY "rls_consolidated_ict_knowledge_articles_insert" ON public."ict_knowledge_articles" WITH CHECK (((private.is_admin(( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM user_roles ur
  WHERE ((ur.user_id = ( SELECT auth.uid() AS uid)) AND (ur.role = 'ict_officer'::app_role))))) AND ((created_by IS NULL) OR (created_by = ( SELECT auth.uid() AS uid)))));
ALTER POLICY "rls_consolidated_ict_knowledge_articles_select" ON public."ict_knowledge_articles" USING ((private.is_admin(( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM user_roles ur
  WHERE ((ur.user_id = ( SELECT auth.uid() AS uid)) AND (ur.role = 'ict_officer'::app_role)))) OR (private.is_staff(( SELECT auth.uid() AS uid)) AND active)));
ALTER POLICY "rls_consolidated_ict_knowledge_articles_update" ON public."ict_knowledge_articles" USING ((private.is_admin(( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM user_roles ur
  WHERE ((ur.user_id = ( SELECT auth.uid() AS uid)) AND (ur.role = 'ict_officer'::app_role)))))) WITH CHECK (((private.is_admin(( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM user_roles ur
  WHERE ((ur.user_id = ( SELECT auth.uid() AS uid)) AND (ur.role = 'ict_officer'::app_role))))) AND ((created_by IS NULL) OR (created_by = ( SELECT auth.uid() AS uid)))));
ALTER POLICY "ICT vault entries accessible by authorised roles" ON public."ict_password_vault" USING ((private.is_admin(( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM user_roles ur
  WHERE ((ur.user_id = ( SELECT auth.uid() AS uid)) AND (ur.role = 'ict_officer'::app_role))))));
ALTER POLICY "ICT vault entries created by authorised roles" ON public."ict_password_vault" WITH CHECK (((created_by = ( SELECT auth.uid() AS uid)) AND (updated_by = ( SELECT auth.uid() AS uid)) AND (private.is_admin(( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM user_roles ur
  WHERE ((ur.user_id = ( SELECT auth.uid() AS uid)) AND (ur.role = 'ict_officer'::app_role)))))));
ALTER POLICY "ICT vault entries deleted by authorised roles" ON public."ict_password_vault" USING ((private.is_admin(( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM user_roles ur
  WHERE ((ur.user_id = ( SELECT auth.uid() AS uid)) AND (ur.role = 'ict_officer'::app_role))))));
ALTER POLICY "ICT vault entries updated by authorised roles" ON public."ict_password_vault" USING ((private.is_admin(( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM user_roles ur
  WHERE ((ur.user_id = ( SELECT auth.uid() AS uid)) AND (ur.role = 'ict_officer'::app_role)))))) WITH CHECK (((updated_by = ( SELECT auth.uid() AS uid)) AND (private.is_admin(( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM user_roles ur
  WHERE ((ur.user_id = ( SELECT auth.uid() AS uid)) AND (ur.role = 'ict_officer'::app_role)))))));
ALTER POLICY "ICT vault audit read by directors" ON public."ict_password_vault_audit" USING (private.is_admin(( SELECT auth.uid() AS uid)));
ALTER POLICY "ICT vault config initialised by authorised roles" ON public."ict_password_vault_config" WITH CHECK (((created_by = ( SELECT auth.uid() AS uid)) AND (private.is_admin(( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM user_roles ur
  WHERE ((ur.user_id = ( SELECT auth.uid() AS uid)) AND (ur.role = 'ict_officer'::app_role)))))));
ALTER POLICY "ICT vault config readable by authorised roles" ON public."ict_password_vault_config" USING ((private.is_admin(( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM user_roles ur
  WHERE ((ur.user_id = ( SELECT auth.uid() AS uid)) AND (ur.role = 'ict_officer'::app_role))))));
ALTER POLICY "rls_consolidated_ict_service_desk_team_delete" ON public."ict_service_desk_team" USING (private.has_full_module(( SELECT auth.uid() AS uid), 'ict_service_desk'::text));
ALTER POLICY "rls_consolidated_ict_service_desk_team_insert" ON public."ict_service_desk_team" WITH CHECK (private.has_full_module(( SELECT auth.uid() AS uid), 'ict_service_desk'::text));
ALTER POLICY "rls_consolidated_ict_service_desk_team_select" ON public."ict_service_desk_team" USING ((private.has_full_module(( SELECT auth.uid() AS uid), 'ict_service_desk'::text) OR private.is_staff(( SELECT auth.uid() AS uid))));
ALTER POLICY "rls_consolidated_ict_service_desk_team_update" ON public."ict_service_desk_team" USING (private.has_full_module(( SELECT auth.uid() AS uid), 'ict_service_desk'::text)) WITH CHECK (private.has_full_module(( SELECT auth.uid() AS uid), 'ict_service_desk'::text));
ALTER POLICY "rls_consolidated_ict_service_templates_delete" ON public."ict_service_templates" USING (private.has_full_module(( SELECT auth.uid() AS uid), 'ict_service_desk'::text));
ALTER POLICY "rls_consolidated_ict_service_templates_insert" ON public."ict_service_templates" WITH CHECK (private.has_full_module(( SELECT auth.uid() AS uid), 'ict_service_desk'::text));
ALTER POLICY "rls_consolidated_ict_service_templates_select" ON public."ict_service_templates" USING ((private.has_full_module(( SELECT auth.uid() AS uid), 'ict_service_desk'::text) OR private.is_staff(( SELECT auth.uid() AS uid))));
ALTER POLICY "rls_consolidated_ict_service_templates_update" ON public."ict_service_templates" USING (private.has_full_module(( SELECT auth.uid() AS uid), 'ict_service_desk'::text)) WITH CHECK (private.has_full_module(( SELECT auth.uid() AS uid), 'ict_service_desk'::text));
ALTER POLICY "rls_consolidated_ict_template_controls_delete" ON public."ict_template_controls" USING (private.has_full_module(( SELECT auth.uid() AS uid), 'ict_service_desk'::text));
ALTER POLICY "rls_consolidated_ict_template_controls_insert" ON public."ict_template_controls" WITH CHECK (private.has_full_module(( SELECT auth.uid() AS uid), 'ict_service_desk'::text));
ALTER POLICY "rls_consolidated_ict_template_controls_select" ON public."ict_template_controls" USING ((private.has_full_module(( SELECT auth.uid() AS uid), 'ict_service_desk'::text) OR private.is_staff(( SELECT auth.uid() AS uid))));
ALTER POLICY "rls_consolidated_ict_template_controls_update" ON public."ict_template_controls" USING (private.has_full_module(( SELECT auth.uid() AS uid), 'ict_service_desk'::text)) WITH CHECK (private.has_full_module(( SELECT auth.uid() AS uid), 'ict_service_desk'::text));
ALTER POLICY "ict tickets delete full module only" ON public."ict_tickets" USING (private.has_full_module(( SELECT auth.uid() AS uid), 'ict_service_desk'::text));
ALTER POLICY "ict tickets insert own" ON public."ict_tickets" WITH CHECK (((reported_by = ( SELECT auth.uid() AS uid)) AND private.is_staff(( SELECT auth.uid() AS uid))));
ALTER POLICY "ict tickets select own or full module" ON public."ict_tickets" USING (((reported_by = ( SELECT auth.uid() AS uid)) OR private.can_view_module_all(( SELECT auth.uid() AS uid), 'ict_service_desk'::text) OR private.is_ict_team(( SELECT auth.uid() AS uid))));
ALTER POLICY "ict tickets update full module only" ON public."ict_tickets" USING ((private.has_full_module(( SELECT auth.uid() AS uid), 'ict_service_desk'::text) OR private.is_ict_team(( SELECT auth.uid() AS uid)))) WITH CHECK ((private.has_full_module(( SELECT auth.uid() AS uid), 'ict_service_desk'::text) OR private.is_ict_team(( SELECT auth.uid() AS uid))));
ALTER POLICY "rls_consolidated_invoice_handlers_delete" ON public."invoice_handlers" USING (private.has_full_module(( SELECT auth.uid() AS uid), 'accounts'::text));
ALTER POLICY "rls_consolidated_invoice_handlers_insert" ON public."invoice_handlers" WITH CHECK (private.has_full_module(( SELECT auth.uid() AS uid), 'accounts'::text));
ALTER POLICY "rls_consolidated_invoice_handlers_select" ON public."invoice_handlers" USING ((private.has_full_module(( SELECT auth.uid() AS uid), 'accounts'::text) OR (private.has_full_module(( SELECT auth.uid() AS uid), 'accounts'::text) OR private.is_my_invoice(( SELECT auth.uid() AS uid), invoice_id))));
ALTER POLICY "rls_consolidated_invoice_handlers_update" ON public."invoice_handlers" USING (private.has_full_module(( SELECT auth.uid() AS uid), 'accounts'::text)) WITH CHECK (private.has_full_module(( SELECT auth.uid() AS uid), 'accounts'::text));
ALTER POLICY "invoice items delete admin only" ON public."invoice_items" USING (private.has_full_module(( SELECT auth.uid() AS uid), 'accounts'::text));
ALTER POLICY "invoice items insert own or admin" ON public."invoice_items" WITH CHECK ((private.has_full_module(( SELECT auth.uid() AS uid), 'accounts'::text) OR private.is_my_invoice(( SELECT auth.uid() AS uid), invoice_id)));
ALTER POLICY "invoice items select own or admin" ON public."invoice_items" USING ((private.has_full_module(( SELECT auth.uid() AS uid), 'accounts'::text) OR private.is_my_invoice(( SELECT auth.uid() AS uid), invoice_id)));
ALTER POLICY "invoice items update admin only" ON public."invoice_items" USING (private.has_full_module(( SELECT auth.uid() AS uid), 'accounts'::text)) WITH CHECK (private.has_full_module(( SELECT auth.uid() AS uid), 'accounts'::text));
ALTER POLICY "invoices delete owner or admin" ON public."invoices" USING (private.can_delete_record(( SELECT auth.uid() AS uid), 'accounts'::text, created_by));
ALTER POLICY "invoices insert own clients or admin" ON public."invoices" WITH CHECK ((private.has_full_module(( SELECT auth.uid() AS uid), 'accounts'::text) OR ((created_by = ( SELECT auth.uid() AS uid)) AND private.is_my_client(( SELECT auth.uid() AS uid), client_id))));
ALTER POLICY "invoices select own or admin" ON public."invoices" USING ((private.has_full_module(( SELECT auth.uid() AS uid), 'accounts'::text) OR private.is_my_invoice(( SELECT auth.uid() AS uid), id)));
ALTER POLICY "invoices update full only" ON public."invoices" USING (private.has_full_module(( SELECT auth.uid() AS uid), 'accounts'::text));
ALTER POLICY "leave requests cancel own pending" ON public."leave_requests" USING (((employee_id = ( SELECT auth.uid() AS uid)) AND (status = 'pending'::text))) WITH CHECK (((employee_id = ( SELECT auth.uid() AS uid)) AND (status = 'cancelled'::text)));
ALTER POLICY "leave requests select leave workflow" ON public."leave_requests" USING (((employee_id = ( SELECT auth.uid() AS uid)) OR (reliever_id = ( SELECT auth.uid() AS uid)) OR private.is_admin(( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM hr_employment he
  WHERE ((he.employee_id = leave_requests.employee_id) AND (he.manager_id = ( SELECT auth.uid() AS uid)))))));
ALTER POLICY "rls_consolidated_leave_types_delete" ON public."leave_types" USING (private.is_admin(( SELECT auth.uid() AS uid)));
ALTER POLICY "rls_consolidated_leave_types_insert" ON public."leave_types" WITH CHECK (private.is_admin(( SELECT auth.uid() AS uid)));
ALTER POLICY "rls_consolidated_leave_types_select" ON public."leave_types" USING ((private.is_admin(( SELECT auth.uid() AS uid)) OR private.is_staff(( SELECT auth.uid() AS uid))));
ALTER POLICY "rls_consolidated_leave_types_update" ON public."leave_types" USING (private.is_admin(( SELECT auth.uid() AS uid))) WITH CHECK (private.is_admin(( SELECT auth.uid() AS uid)));
ALTER POLICY "notifications delete own" ON public."notifications" USING ((user_id = ( SELECT auth.uid() AS uid)));
ALTER POLICY "notifications insert staff" ON public."notifications" WITH CHECK (private.is_staff(( SELECT auth.uid() AS uid)));
ALTER POLICY "notifications select own" ON public."notifications" USING ((user_id = ( SELECT auth.uid() AS uid)));
ALTER POLICY "notifications update own" ON public."notifications" USING ((user_id = ( SELECT auth.uid() AS uid)));
ALTER POLICY "payments delete owner or admin" ON public."payments" USING (private.can_delete_record(( SELECT auth.uid() AS uid), 'accounts'::text, recorded_by));
ALTER POLICY "payments insert own or admin" ON public."payments" WITH CHECK ((private.has_full_module(( SELECT auth.uid() AS uid), 'accounts'::text) OR ((invoice_id IS NOT NULL) AND private.is_my_invoice(( SELECT auth.uid() AS uid), invoice_id)) OR ((invoice_id IS NULL) AND private.is_my_client(( SELECT auth.uid() AS uid), client_id))));
ALTER POLICY "payments select own or admin" ON public."payments" USING ((private.has_full_module(( SELECT auth.uid() AS uid), 'accounts'::text) OR ((invoice_id IS NOT NULL) AND private.is_my_invoice(( SELECT auth.uid() AS uid), invoice_id)) OR ((invoice_id IS NULL) AND private.is_my_client(( SELECT auth.uid() AS uid), client_id))));
ALTER POLICY "payments update own or admin" ON public."payments" USING ((private.has_full_module(( SELECT auth.uid() AS uid), 'accounts'::text) OR ((invoice_id IS NOT NULL) AND private.is_my_invoice(( SELECT auth.uid() AS uid), invoice_id)) OR ((invoice_id IS NULL) AND private.is_my_client(( SELECT auth.uid() AS uid), client_id)))) WITH CHECK ((private.has_full_module(( SELECT auth.uid() AS uid), 'accounts'::text) OR ((invoice_id IS NOT NULL) AND private.is_my_invoice(( SELECT auth.uid() AS uid), invoice_id)) OR ((invoice_id IS NULL) AND private.is_my_client(( SELECT auth.uid() AS uid), client_id))));
ALTER POLICY "rls_consolidated_payslips_delete" ON public."payslips" USING (private.is_hr_manager(( SELECT auth.uid() AS uid)));
ALTER POLICY "rls_consolidated_payslips_insert" ON public."payslips" WITH CHECK (private.is_hr_manager(( SELECT auth.uid() AS uid)));
ALTER POLICY "rls_consolidated_payslips_select" ON public."payslips" USING ((private.is_hr_manager(( SELECT auth.uid() AS uid)) OR ((employee_id = ( SELECT auth.uid() AS uid)) OR private.is_hr_manager(( SELECT auth.uid() AS uid)))));
ALTER POLICY "rls_consolidated_payslips_update" ON public."payslips" USING (private.is_hr_manager(( SELECT auth.uid() AS uid))) WITH CHECK (private.is_hr_manager(( SELECT auth.uid() AS uid)));
ALTER POLICY "profiles insert self" ON public."profiles" WITH CHECK ((id = ( SELECT auth.uid() AS uid)));
ALTER POLICY "profiles select staff" ON public."profiles" USING (private.is_staff(( SELECT auth.uid() AS uid)));
ALTER POLICY "profiles_update_consolidated" ON public."profiles" USING ((private.is_admin(( SELECT auth.uid() AS uid)) OR (id = ( SELECT auth.uid() AS uid))));
ALTER POLICY "rls_consolidated_quick_links_delete" ON public."quick_links" USING (private.is_admin(( SELECT auth.uid() AS uid)));
ALTER POLICY "rls_consolidated_quick_links_insert" ON public."quick_links" WITH CHECK (private.is_admin(( SELECT auth.uid() AS uid)));
ALTER POLICY "rls_consolidated_quick_links_select" ON public."quick_links" USING ((private.is_admin(( SELECT auth.uid() AS uid)) OR private.is_staff(( SELECT auth.uid() AS uid))));
ALTER POLICY "rls_consolidated_quick_links_update" ON public."quick_links" USING (private.is_admin(( SELECT auth.uid() AS uid))) WITH CHECK (private.is_admin(( SELECT auth.uid() AS uid)));
ALTER POLICY "service milestone documents by parent" ON public."service_milestone_documents" USING ((EXISTS ( SELECT 1
   FROM (service_milestones m
     JOIN service_projects p ON ((p.id = m.project_id)))
  WHERE ((m.id = service_milestone_documents.milestone_id) AND private.can_view_module_all(( SELECT auth.uid() AS uid), p.module))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM (service_milestones m
     JOIN service_projects p ON ((p.id = m.project_id)))
  WHERE ((m.id = service_milestone_documents.milestone_id) AND private.has_full_module(( SELECT auth.uid() AS uid), p.module)))));
ALTER POLICY "service milestones by parent project" ON public."service_milestones" USING ((EXISTS ( SELECT 1
   FROM service_projects p
  WHERE ((p.id = service_milestones.project_id) AND private.can_view_module_all(( SELECT auth.uid() AS uid), p.module))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM service_projects p
  WHERE ((p.id = service_milestones.project_id) AND private.has_full_module(( SELECT auth.uid() AS uid), p.module)))));
ALTER POLICY "service projects delete full only" ON public."service_projects" USING (private.has_full_module(( SELECT auth.uid() AS uid), module));
ALTER POLICY "service projects insert full only" ON public."service_projects" WITH CHECK (private.has_full_module(( SELECT auth.uid() AS uid), module));
ALTER POLICY "service projects select by rank" ON public."service_projects" USING (private.can_view_module_all(( SELECT auth.uid() AS uid), module));
ALTER POLICY "service projects update full only" ON public."service_projects" USING (private.has_full_module(( SELECT auth.uid() AS uid), module));
ALTER POLICY "task comments delete" ON public."task_comments" USING (((kind <> 'system'::text) AND ((author_id = ( SELECT auth.uid() AS uid)) OR private.is_admin(( SELECT auth.uid() AS uid)))));
ALTER POLICY "task comments read" ON public."task_comments" USING (private.task_has_access(task_id, ( SELECT auth.uid() AS uid)));
ALTER POLICY "task comments write" ON public."task_comments" WITH CHECK ((private.task_has_access(task_id, ( SELECT auth.uid() AS uid)) AND (author_id = ( SELECT auth.uid() AS uid)) AND ((kind = ANY (ARRAY['note'::text, 'feedback'::text, 'report'::text])) OR ((kind = 'guidance'::text) AND private.task_is_supervisor(task_id, ( SELECT auth.uid() AS uid))))));
ALTER POLICY "task outputs delete" ON public."task_outputs" USING (((uploaded_by = ( SELECT auth.uid() AS uid)) OR private.task_is_lead(task_id, ( SELECT auth.uid() AS uid))));
ALTER POLICY "task outputs insert" ON public."task_outputs" WITH CHECK ((private.task_has_access(task_id, ( SELECT auth.uid() AS uid)) AND (uploaded_by = ( SELECT auth.uid() AS uid)) AND (split_part(file_path, '/'::text, 1) = (task_id)::text)));
ALTER POLICY "task outputs read" ON public."task_outputs" USING (private.task_has_access(task_id, ( SELECT auth.uid() AS uid)));
ALTER POLICY "task outputs update" ON public."task_outputs" USING (private.task_is_lead(task_id, ( SELECT auth.uid() AS uid))) WITH CHECK (private.task_is_lead(task_id, ( SELECT auth.uid() AS uid)));
ALTER POLICY "task subtasks delete" ON public."task_subtasks" USING (private.task_is_lead(task_id, ( SELECT auth.uid() AS uid)));
ALTER POLICY "task subtasks insert" ON public."task_subtasks" WITH CHECK ((private.task_is_lead(task_id, ( SELECT auth.uid() AS uid)) AND (created_by = ( SELECT auth.uid() AS uid))));
ALTER POLICY "task subtasks read" ON public."task_subtasks" USING (private.task_has_access(task_id, ( SELECT auth.uid() AS uid)));
ALTER POLICY "task subtasks update" ON public."task_subtasks" USING ((private.task_is_lead(task_id, ( SELECT auth.uid() AS uid)) OR (assigned_to = ( SELECT auth.uid() AS uid)))) WITH CHECK ((private.task_is_lead(task_id, ( SELECT auth.uid() AS uid)) OR (assigned_to = ( SELECT auth.uid() AS uid))));
ALTER POLICY "tasks delete owner or admin" ON public."tasks" USING ((private.is_admin(( SELECT auth.uid() AS uid)) OR (created_by = ( SELECT auth.uid() AS uid))));
ALTER POLICY "tasks insert full only" ON public."tasks" WITH CHECK (private.can_view_module(( SELECT auth.uid() AS uid), 'tasks'::text));
ALTER POLICY "tasks select by rank" ON public."tasks" USING (private.task_has_access(id, ( SELECT auth.uid() AS uid)));
ALTER POLICY "tasks update by rank" ON public."tasks" USING (private.task_has_access(id, ( SELECT auth.uid() AS uid))) WITH CHECK (private.task_has_access(id, ( SELECT auth.uid() AS uid)));
ALTER POLICY "tax policies delete admin" ON public."tax_policies" USING (private.is_admin(( SELECT auth.uid() AS uid)));
ALTER POLICY "tax policies insert admin" ON public."tax_policies" WITH CHECK (private.is_admin(( SELECT auth.uid() AS uid)));
ALTER POLICY "tax policies read staff" ON public."tax_policies" USING (private.is_staff(( SELECT auth.uid() AS uid)));
ALTER POLICY "tax policies update admin" ON public."tax_policies" USING (private.is_admin(( SELECT auth.uid() AS uid))) WITH CHECK (private.is_admin(( SELECT auth.uid() AS uid)));
ALTER POLICY "tax assignees by parent return" ON public."tax_return_assignees" USING ((EXISTS ( SELECT 1
   FROM tax_returns t
  WHERE ((t.id = tax_return_assignees.tax_return_id) AND (private.can_view_module_all(( SELECT auth.uid() AS uid), 'tax'::text) OR (private.is_module_assigned_only(( SELECT auth.uid() AS uid), 'tax'::text) AND ((t.assigned_to = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
           FROM client_assignments ca
          WHERE ((ca.client_id = t.client_id) AND (ca.user_id = ( SELECT auth.uid() AS uid)))))))))))) WITH CHECK (private.can_view_module(( SELECT auth.uid() AS uid), 'tax'::text));
ALTER POLICY "tax returns delete owner or admin" ON public."tax_returns" USING (private.can_delete_record(( SELECT auth.uid() AS uid), 'tax'::text, created_by));
ALTER POLICY "tax returns insert full only" ON public."tax_returns" WITH CHECK (private.has_full_module(( SELECT auth.uid() AS uid), 'tax'::text));
ALTER POLICY "tax returns select by rank" ON public."tax_returns" USING ((private.can_view_module_all(( SELECT auth.uid() AS uid), 'tax'::text) OR (private.is_module_assigned_only(( SELECT auth.uid() AS uid), 'tax'::text) AND ((assigned_to = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM client_assignments ca
  WHERE ((ca.client_id = tax_returns.client_id) AND (ca.user_id = ( SELECT auth.uid() AS uid)))))))));
ALTER POLICY "tax returns update by rank" ON public."tax_returns" USING ((private.has_full_module(( SELECT auth.uid() AS uid), 'tax'::text) OR (private.is_module_assigned_only(( SELECT auth.uid() AS uid), 'tax'::text) AND ((assigned_to = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM client_assignments ca
  WHERE ((ca.client_id = tax_returns.client_id) AND (ca.user_id = ( SELECT auth.uid() AS uid)))))))));
ALTER POLICY "rls_consolidated_user_roles_delete" ON public."user_roles" USING (private.is_admin(( SELECT auth.uid() AS uid)));
ALTER POLICY "rls_consolidated_user_roles_insert" ON public."user_roles" WITH CHECK (private.is_admin(( SELECT auth.uid() AS uid)));
ALTER POLICY "rls_consolidated_user_roles_select" ON public."user_roles" USING ((private.is_admin(( SELECT auth.uid() AS uid)) OR (private.is_staff(( SELECT auth.uid() AS uid)) OR (user_id = ( SELECT auth.uid() AS uid)))));
ALTER POLICY "rls_consolidated_user_roles_update" ON public."user_roles" USING (private.is_admin(( SELECT auth.uid() AS uid))) WITH CHECK (private.is_admin(( SELECT auth.uid() AS uid)));
