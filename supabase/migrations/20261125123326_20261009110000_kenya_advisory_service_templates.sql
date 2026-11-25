-- Kenya service templates and regulatory controls (Advisory-only).
-- Seeded controls are operational prompts, not legal opinions. Every case requires an applicability review.

CREATE TABLE IF NOT EXISTS public.advisory_service_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_type text NOT NULL CHECK (service_type IN ('brs','cbk','company','financial','pbora')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  title text NOT NULL,
  regulator text,
  legal_basis text,
  source_url text,
  source_checked_at date,
  effective_from date NOT NULL DEFAULT CURRENT_DATE,
  effective_to date,
  active boolean NOT NULL DEFAULT true,
  review_required boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(service_type, version),
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE TABLE IF NOT EXISTS public.advisory_template_controls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.advisory_service_templates(id) ON DELETE CASCADE,
  control_key text NOT NULL,
  category text NOT NULL DEFAULT 'case_setup',
  title text NOT NULL,
  guidance text,
  evidence_hint text,
  mandatory boolean NOT NULL DEFAULT false,
  applicability_check boolean NOT NULL DEFAULT false,
  legal_reference text,
  source_url text,
  sort_order integer NOT NULL DEFAULT 100,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(template_id, control_key)
);

CREATE TABLE IF NOT EXISTS public.advisory_case_controls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.advisory_projects(id) ON DELETE CASCADE,
  template_control_id uuid REFERENCES public.advisory_template_controls(id) ON DELETE SET NULL,
  control_key text NOT NULL,
  category text NOT NULL,
  title text NOT NULL,
  guidance text,
  evidence_hint text,
  mandatory boolean NOT NULL DEFAULT false,
  applicability_check boolean NOT NULL DEFAULT false,
  legal_reference text,
  source_url text,
  status text NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started','in_progress','evidence_received','verified','not_applicable','needs_clarification')),
  applicability text NOT NULL DEFAULT 'not_assessed' CHECK (applicability IN ('not_assessed','applicable','not_applicable','needs_review')),
  due_date date,
  evidence_note text,
  reviewer_note text,
  assigned_to uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  verified_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  verified_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(project_id, control_key)
);

CREATE INDEX IF NOT EXISTS advisory_service_templates_active_idx ON public.advisory_service_templates(service_type, active, effective_from);
CREATE INDEX IF NOT EXISTS advisory_template_controls_template_idx ON public.advisory_template_controls(template_id, active, sort_order);
CREATE INDEX IF NOT EXISTS advisory_case_controls_project_idx ON public.advisory_case_controls(project_id, status, due_date);

ALTER TABLE public.advisory_service_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.advisory_template_controls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.advisory_case_controls ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "advisory templates read" ON public.advisory_service_templates;
CREATE POLICY "advisory templates read" ON public.advisory_service_templates FOR SELECT TO authenticated
USING (public.can_view_module_all(auth.uid(), 'advisory') OR public.is_module_assigned_only(auth.uid(), 'advisory'));
DROP POLICY IF EXISTS "advisory templates manage" ON public.advisory_service_templates;
CREATE POLICY "advisory templates manage" ON public.advisory_service_templates FOR ALL TO authenticated
USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "advisory template controls read" ON public.advisory_template_controls;
CREATE POLICY "advisory template controls read" ON public.advisory_template_controls FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.advisory_service_templates t WHERE t.id = template_id AND (public.can_view_module_all(auth.uid(), 'advisory') OR public.is_module_assigned_only(auth.uid(), 'advisory'))));
DROP POLICY IF EXISTS "advisory template controls manage" ON public.advisory_template_controls;
CREATE POLICY "advisory template controls manage" ON public.advisory_template_controls FOR ALL TO authenticated
USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "advisory case controls read" ON public.advisory_case_controls;
CREATE POLICY "advisory case controls read" ON public.advisory_case_controls FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.advisory_projects p WHERE p.id = project_id AND (public.can_view_module_all(auth.uid(), 'advisory') OR (public.is_module_assigned_only(auth.uid(), 'advisory') AND (p.created_by = auth.uid() OR EXISTS (SELECT 1 FROM public.client_assignments ca WHERE ca.client_id = p.client_id AND ca.user_id = auth.uid()))))));
DROP POLICY IF EXISTS "advisory case controls insert" ON public.advisory_case_controls;
CREATE POLICY "advisory case controls insert" ON public.advisory_case_controls FOR INSERT TO authenticated
WITH CHECK (public.can_work_advisory(auth.uid()) AND EXISTS (SELECT 1 FROM public.advisory_projects p WHERE p.id = project_id));
DROP POLICY IF EXISTS "advisory case controls update" ON public.advisory_case_controls;
CREATE POLICY "advisory case controls update" ON public.advisory_case_controls FOR UPDATE TO authenticated
USING (public.can_work_advisory(auth.uid()) AND EXISTS (SELECT 1 FROM public.advisory_projects p WHERE p.id = project_id))
WITH CHECK (public.can_work_advisory(auth.uid()) AND EXISTS (SELECT 1 FROM public.advisory_projects p WHERE p.id = project_id));
DROP POLICY IF EXISTS "advisory case controls delete admin" ON public.advisory_case_controls;
CREATE POLICY "advisory case controls delete admin" ON public.advisory_case_controls FOR DELETE TO authenticated USING (public.is_admin(auth.uid()));

CREATE OR REPLACE FUNCTION public.guard_advisory_case_control_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.is_admin(auth.uid()) THEN
    IF NEW.status = 'verified' AND OLD.status IS DISTINCT FROM NEW.status THEN
      IF NULLIF(btrim(COALESCE(NEW.evidence_note, '')), '') IS NULL THEN
        RAISE EXCEPTION 'Add an evidence or assessment note before verifying this control.' USING ERRCODE = '22023';
      END IF;
      IF NEW.applicability IN ('not_assessed', 'needs_review') THEN
        RAISE EXCEPTION 'Assess applicability before verifying this control.' USING ERRCODE = '22023';
      END IF;
      NEW.verified_by := auth.uid(); NEW.verified_at := now();
    ELSIF NEW.status <> 'verified' AND OLD.status = 'verified' THEN
      NEW.verified_by := NULL; NEW.verified_at := NULL;
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
  END IF;
  IF auth.uid() IS NULL OR NOT public.can_work_advisory(auth.uid()) THEN
    RAISE EXCEPTION 'You do not have permission to update Advisory controls.' USING ERRCODE = '42501';
  END IF;
  IF NEW.project_id IS DISTINCT FROM OLD.project_id OR NEW.control_key IS DISTINCT FROM OLD.control_key
    OR NEW.title IS DISTINCT FROM OLD.title OR NEW.category IS DISTINCT FROM OLD.category
    OR NEW.template_control_id IS DISTINCT FROM OLD.template_control_id
    OR NEW.guidance IS DISTINCT FROM OLD.guidance OR NEW.evidence_hint IS DISTINCT FROM OLD.evidence_hint
    OR NEW.mandatory IS DISTINCT FROM OLD.mandatory OR NEW.applicability_check IS DISTINCT FROM OLD.applicability_check
    OR NEW.legal_reference IS DISTINCT FROM OLD.legal_reference OR NEW.source_url IS DISTINCT FROM OLD.source_url
    OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR NEW.verified_by IS DISTINCT FROM OLD.verified_by OR NEW.verified_at IS DISTINCT FROM OLD.verified_at THEN
    RAISE EXCEPTION 'Only Director/Admin may change protected control definitions or verification metadata.' USING ERRCODE = '42501';
  END IF;
  IF NEW.status = 'verified' OR OLD.status = 'verified' THEN
    RAISE EXCEPTION 'Only Director/Admin may verify or reopen a verified regulatory control.' USING ERRCODE = '42501';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_guard_advisory_case_control_update ON public.advisory_case_controls;
CREATE TRIGGER trg_guard_advisory_case_control_update BEFORE UPDATE ON public.advisory_case_controls
FOR EACH ROW EXECUTE FUNCTION public.guard_advisory_case_control_update();

-- Initial template versions. Sources are official pages; controls are prompts and must be reviewed against the client's exact circumstances.
INSERT INTO public.advisory_service_templates(service_type, version, title, regulator, legal_basis, source_url, source_checked_at, review_required)
VALUES
 ('brs',1,'Kenya BRS - Business Registration & Registry Changes','Business Registration Service','Companies Act, 2015; Registration of Business Names Act; Limited Liability Partnerships Act','https://brs.go.ke/companies-registry/',CURRENT_DATE,true),
 ('cbk',1,'Kenya CBK - Digital Credit Provider Licensing & Oversight','Central Bank of Kenya','Central Bank of Kenya Act and Digital Credit Providers Regulations, 2022','https://www.centralbank.go.ke/2022/03/21/central-bank-of-kenya-digital-credit-providers-regulations-2022/',CURRENT_DATE,true),
 ('pbora',1,'Kenya PBORA - PBO Registration & Post-registration','Public Benefit Organizations Regulatory Authority','Public Benefit Organizations Act, 2013 and Public Benefit Organizations Regulations, 2026','https://www.pbora.go.ke/registration',CURRENT_DATE,true),
 ('company',1,'Kenya Company Advisory - Applicability & Corporate Records','BRS / other regulator as applicable','Confirm governing law and regulatory route for the specific engagement','https://brs.go.ke/companies-registry/',CURRENT_DATE,true),
 ('financial',1,'Kenya Financial Advisory - Scope & Licensing Gate','CMA / CBK / other regulator as applicable','Confirm whether the proposed activity requires authorisation by a Kenyan regulator','https://www.cma.or.ke/',CURRENT_DATE,true)
ON CONFLICT(service_type, version) DO NOTHING;

-- BRS checklist: items vary by entity type and transaction; the first item is an applicability gate.
INSERT INTO public.advisory_template_controls(template_id,control_key,category,title,guidance,evidence_hint,mandatory,applicability_check,legal_reference,source_url,sort_order)
SELECT t.id,v.control_key,v.category,v.title,v.guidance,v.evidence_hint,v.mandatory,v.applicability_check,v.legal_reference,v.source_url,v.sort_order
FROM public.advisory_service_templates t CROSS JOIN (VALUES
 ('route_check','scope','Confirm entity type and exact BRS transaction','Determine whether this is a business name, company, LLP, change filing, official search or another registry service.','Client instruction / engagement scope',true,true,'Confirm against the current BRS service and prescribed form','https://brs.go.ke/companies-registry/',10),
 ('identity_authority','documents','Confirm identity and authority of applicants/signatories','Check current identity details and that the person instructing or signing is authorised for this transaction.','IDs and authority evidence as applicable',true,false,'Transaction-specific BRS form and guidance','https://brs.go.ke/forms/',20),
 ('entity_records','documents','Collect existing entity records where applicable','Collect existing registration documents, current company particulars and relevant registry search/records.','Certificate, current official search or registry record where relevant',true,false,'Transaction-specific BRS form and guidance','https://brs.go.ke/forms/',30),
 ('prescribed_forms','filing','Check current prescribed forms and supporting documents','Use the latest form and confirm every attachment against the live BRS guidance before filing.','Current form and completed supporting pack',true,false,'BRS forms and applicable law','https://brs.go.ke/forms/',40),
 ('fees_submission','filing','Confirm current official fee and submission channel','Confirm the current fee and portal/channel at time of filing; do not rely on historic amounts.','Payment proof and submission receipt',true,false,'Current BRS fee schedule / portal', 'https://brs.go.ke/',50),
 ('registry_query','follow_up','Track registry queries and corrections','Record any query, response deadline, correction and resubmission.','Query notice and response copy if issued',false,false,'Case-specific registry correspondence','https://brs.go.ke/',60),
 ('final_output','closeout','Verify and deliver final registry output','Confirm names, identifiers and filed particulars against the client instruction before handover.','Issued certificate, extract or filing confirmation',true,false,'Output issued by BRS', 'https://brs.go.ke/',70)
) AS v(control_key,category,title,guidance,evidence_hint,mandatory,applicability_check,legal_reference,source_url,sort_order)
WHERE t.service_type='brs' AND t.version=1 ON CONFLICT(template_id,control_key) DO NOTHING;

-- CBK digital credit providers: only use after confirming the client's activity falls within DCP scope.
INSERT INTO public.advisory_template_controls(template_id,control_key,category,title,guidance,evidence_hint,mandatory,applicability_check,legal_reference,source_url,sort_order)
SELECT t.id,v.control_key,v.category,v.title,v.guidance,v.evidence_hint,v.mandatory,v.applicability_check,v.legal_reference,v.source_url,v.sort_order
FROM public.advisory_service_templates t CROSS JOIN (VALUES
 ('dcp_scope','scope','Confirm whether the business is a Digital Credit Provider','Assess the actual lending model, delivery channels and applicable exclusions before treating this as a CBK DCP application.','Written scope assessment and business model',true,true,'Digital Credit Providers Regulations, 2022','https://www.centralbank.go.ke/2022/03/21/central-bank-of-kenya-digital-credit-providers-regulations-2022/',10),
 ('ownership_management','documents','Collect ownership, directors and management information','Check the current CBK application requirements and fit-and-proper information required for the applicant.','Current corporate and management particulars',true,false,'Current CBK DCP application requirements','https://www.centralbank.go.ke/2022/03/21/central-bank-of-kenya-digital-credit-providers-regulations-2022/',20),
 ('funding_evidence','documents','Assess source of funds and capital evidence','Identify the source and supporting evidence required for the proposed applicant under current CBK requirements.','Source-of-funds and funding evidence',true,false,'DCP Regulations, 2022; confirm current application checklist','https://www.centralbank.go.ke/wp-content/uploads/2022/03/L-.N.-No.-46-Central-Bank-of-Kenya-Digital-Credit-Providers-Regulations-2022.pdf',30),
 ('governance_policies','governance','Review governance, lending and consumer-protection policies','Map required policies to the current business model and regulator checklist; record gaps for client action.','Policy pack and gap assessment',true,false,'DCP Regulations, 2022','https://www.centralbank.go.ke/2022/03/21/central-bank-of-kenya-digital-credit-providers-regulations-2022/',40),
 ('data_protection','governance','Assess data protection and personal-information handling','Check whether ODPC registration and other data-protection obligations apply; record the basis and actions separately.','Data flows, privacy notice, ODPC status where applicable',true,true,'Data Protection Act, 2019 and applicable regulations','https://www.odpc.go.ke/faqs/',50),
 ('aml_cft','governance','Screen AML/CFT obligations for applicability','Confirm the obligations that apply to this business and document any specialist escalation required.','Applicability assessment and relevant controls',true,true,'Applicable Kenyan AML/CFT laws and CBK requirements','https://www.centralbank.go.ke/',60),
 ('application_submission','filing','Prepare and submit the current CBK application pack','Use the latest CBK checklist, record the submission reference and keep the exact submitted version.','Application pack and acknowledgement',true,false,'Current CBK application requirements','https://www.centralbank.go.ke/',70),
 ('annual_obligations','post_approval','Record annual fees, returns and post-licensing obligations','If licensed, confirm the current annual fee, return deadline and conditions directly against current CBK directions.','Licence conditions and compliance calendar',false,false,'DCP Regulations, 2022; confirm current requirements','https://www.centralbank.go.ke/wp-content/uploads/2022/03/L-.N.-No.-46-Central-Bank-of-Kenya-Digital-Credit-Providers-Regulations-2022.pdf',80)
) AS v(control_key,category,title,guidance,evidence_hint,mandatory,applicability_check,legal_reference,source_url,sort_order)
WHERE t.service_type='cbk' AND t.version=1 ON CONFLICT(template_id,control_key) DO NOTHING;

-- PBORA: regulations were gazetted in March 2026; validate current requirements and route for each applicant.
INSERT INTO public.advisory_template_controls(template_id,control_key,category,title,guidance,evidence_hint,mandatory,applicability_check,legal_reference,source_url,sort_order)
SELECT t.id,v.control_key,v.category,v.title,v.guidance,v.evidence_hint,v.mandatory,v.applicability_check,v.legal_reference,v.source_url,v.sort_order
FROM public.advisory_service_templates t CROSS JOIN (VALUES
 ('pbo_route','scope','Confirm the correct PBORA application route','Distinguish registration, bestowment of PBO status, exemption, transition or post-registration service.','Client brief and route decision',true,true,'PBO Act and PBO Regulations, 2026','https://www.pbora.go.ke/registration',10),
 ('name_objectives','documents','Confirm proposed name and public-benefit objectives','Check the proposed name and that objectives clearly state charitable/public-benefit purpose and intended beneficiaries.','Name/portal confirmation and objectives',true,false,'Current PBORA application guidance','https://www.pbora.go.ke/registration',20),
 ('constitution','documents','Review constitution against current PBORA model/guidance','Compare the signed constitution to the current prototype and the applicant type; do not reuse an old template without review.','Signed constitution and review notes',true,false,'PBORA PBO Regulations, 2026 and current prototype constitution','https://www.pbora.go.ke/downloads',30),
 ('officials_details','documents','Collect officials and governance particulars','Use the current prescribed format and confirm officials, signatures and identification requirements for this route.','Officials list, particulars, signatures and IDs as applicable',true,false,'Current PBORA registration requirements','https://pbora.go.ke/register-pbo',40),
 ('meeting_minutes','documents','Collect valid resolution / meeting minutes','Check that minutes record the relevant resolution and satisfy current timing and signature requirements.','Signed minutes and resolution',true,false,'Current PBORA registration requirements','https://pbora.go.ke/register-pbo',50),
 ('budget_addresses','documents','Collect proposed budget and organisation contact details','Confirm the current budget period, physical/postal address, contacts and intended operating counties or geographic scope.','Budget, addresses and operating-area details',true,false,'Current PBORA registration requirements','https://pbora.go.ke/register-pbo',60),
 ('clearance_documents','documents','Check current clearance and photo requirements','Confirm which officials require police clearance, photographs, passport or other supporting material for this application.','Clearance/photo/ID checklist marked applicable or not applicable',true,true,'Current PBORA application checklist','https://pbora.go.ke/register-pbo',70),
 ('portal_fees','filing','Submit through the current PBORA channel and confirm fees','Verify the live prescribed fee and online process before advising or collecting any amount.','Submission acknowledgement and payment proof',true,false,'Current PBORA fee schedule and portal','https://pbora.go.ke/register-pbo',80),
 ('post_registration','post_registration','Assess post-registration and recurring obligations','Provide a separate follow-up list for reporting, material changes, renewals or other duties applicable to this organisation.','Post-registration obligations memo and dates',false,true,'PBO Act and PBO Regulations, 2026','https://www.pbora.go.ke/downloads',90)
) AS v(control_key,category,title,guidance,evidence_hint,mandatory,applicability_check,legal_reference,source_url,sort_order)
WHERE t.service_type='pbora' AND t.version=1 ON CONFLICT(template_id,control_key) DO NOTHING;

-- Generic company advisory: intentionally prompts the case handler to select the correct transaction and law.
INSERT INTO public.advisory_template_controls(template_id,control_key,category,title,guidance,evidence_hint,mandatory,applicability_check,legal_reference,source_url,sort_order)
SELECT t.id,v.control_key,v.category,v.title,v.guidance,v.evidence_hint,v.mandatory,v.applicability_check,v.legal_reference,v.source_url,v.sort_order
FROM public.advisory_service_templates t CROSS JOIN (VALUES
 ('scope_law','scope','Record the client objective and identify governing law','Identify whether the work is a corporate change, governance review, restructuring, statutory filing or other advisory scope.','Engagement scope and legal/regulatory route',true,true,'Confirm law and regulator for this matter','https://brs.go.ke/companies-registry/',10),
 ('records_review','documents','Review current corporate records and instructions','Obtain only records relevant to the selected service and verify them against available official records.','Current records and client authority',true,false,'Transaction-specific requirements', 'https://brs.go.ke/forms/',20),
 ('regulatory_gate','compliance','Check additional licences, permits and regulator approvals','Determine whether county permits, tax, data protection, sector regulator or other approvals apply; do not assume all apply.','Applicability matrix and source links',true,true,'Confirm with relevant Kenyan authority', 'https://brs.go.ke/',30),
 ('advice_review','review','Document advice, assumptions and client approval','Record assumptions, limitations, decision points and any specialist review required before advice is issued.','Advice memo and approval record',true,false,'Engagement terms and professional procedures',NULL,40),
 ('handover','closeout','Complete client handover and follow-up plan','Provide final documents, next steps, owners and dates where applicable.','Handover note and client acknowledgement',true,false,'Case-specific deliverables',NULL,50)
) AS v(control_key,category,title,guidance,evidence_hint,mandatory,applicability_check,legal_reference,source_url,sort_order)
WHERE t.service_type='company' AND t.version=1 ON CONFLICT(template_id,control_key) DO NOTHING;

-- Financial advisory template avoids asserting CMA/CBK authorisation until activity scope is assessed.
INSERT INTO public.advisory_template_controls(template_id,control_key,category,title,guidance,evidence_hint,mandatory,applicability_check,legal_reference,source_url,sort_order)
SELECT t.id,v.control_key,v.category,v.title,v.guidance,v.evidence_hint,v.mandatory,v.applicability_check,v.legal_reference,v.source_url,v.sort_order
FROM public.advisory_service_templates t CROSS JOIN (VALUES
 ('financial_scope','scope','Define the financial advisory service and client decision','Record whether work is modelling, analysis, dividend planning, fundraising, investment advice or another service.','Engagement scope and client objective',true,true,'Determine relevant regulator from actual activity','https://www.cma.or.ke/',10),
 ('licensing_gate','compliance','Assess whether the activity requires regulatory authorisation','Check the current CMA, CBK or other regulator perimeter before providing regulated services; escalate uncertainty.','Written authorisation/applicability assessment',true,true,'Current laws, regulations and regulator guidance', 'https://www.cma.or.ke/',20),
 ('data_inputs','documents','Validate financial data and assumptions','Record sources, periods, reconciliations, assumptions and client confirmation of inputs.','Financial statements, management accounts and assumptions',true,false,'Engagement-specific analysis requirements',NULL,30),
 ('methodology_review','review','Document methodology, limitations and independent review','Record model methodology, scenarios, limitations and reviewer sign-off appropriate to the engagement.','Model/analysis, version and review notes',true,false,'Engagement terms and professional procedures',NULL,40),
 ('advice_handover','closeout','Issue advice and document agreed next steps','Confirm final deliverables, client decisions, action owners and any regulator approval dependencies.','Final report / presentation and action plan',true,false,'Case-specific deliverables',NULL,50)
) AS v(control_key,category,title,guidance,evidence_hint,mandatory,applicability_check,legal_reference,source_url,sort_order)
WHERE t.service_type='financial' AND t.version=1 ON CONFLICT(template_id,control_key) DO NOTHING;

COMMENT ON TABLE public.advisory_service_templates IS 'Versioned Kenyan Advisory service templates; all regulatory requirements must be verified against current official guidance.';
COMMENT ON TABLE public.advisory_template_controls IS 'Reusable service control prompts and evidence hints; not a legal determination.';
COMMENT ON TABLE public.advisory_case_controls IS 'Case-specific snapshot of applicable controls, status, evidence notes and authorised review metadata.';
