import type { AuditProcedurePack } from "../types";

/**
 * Five-step checklist. Mirrors the pack rows in the database (migration
 * audit_checklist_v2_five_steps); the database holds the objectives and
 * expected evidence, this file only fixes the phase names and the step order.
 */
const rules = { requireConclusion: true, requireEvidence: true, requireReviewerWhenRequired: true };
const base = { packId: "ke-private-financial-audit", version: 2, required: true, enabled: true, completionRules: rules } as const;

export const kenyaPrivateFinancialAuditV2: AuditProcedurePack = {
  id: "ke-private-financial-audit",
  version: 2,
  title: "Kenya — Private-sector financial statement audit",
  description: "Short five-step ISA-based checklist for private-sector financial statement audits in Kenya. Requires professional review before use.",
  jurisdiction: "KE",
  engagementKind: "private_financial_statement_audit",
  standardsBasis: ["ISA", "IESBA Code", "Kenyan company and sector-specific law, where applicable"],
  effectiveFrom: "2026-11-27",
  status: "active",
  sections: [
    { id: "planning", label: "Planning", description: "Accept the engagement, then understand the entity, set materiality and assess risks.", order: 10, enabled: true },
    { id: "working_papers", label: "Fieldwork", description: "Carry out the planned procedures and record evidence and conclusions.", order: 20, enabled: true },
    { id: "financial_statements", label: "Evaluation", description: "List misstatements and check the financial statements and disclosures.", order: 30, enabled: true },
    { id: "completion", label: "Completion", description: "Subsequent events, going concern, representations and the auditor's report.", order: 40, enabled: true },
  ],
  procedures: [
    { ...base, id: "accept-engagement", title: "Accept the engagement", sectionId: "planning", objective: "Confirm acceptance or continuance and team independence, and agree the engagement terms.", standardReferences: ["ISA 210", "ISA 220 (Revised)", "IESBA Code"], dependencies: [], requiredFields: [], expectedEvidence: [] },
    { ...base, id: "plan-audit", title: "Plan the audit", sectionId: "planning", objective: "Understand the entity, set materiality, assess the risks (including fraud) and decide how to respond to each.", standardReferences: ["ISA 240", "ISA 300", "ISA 315 (Revised 2019)", "ISA 320", "ISA 330"], dependencies: ["accept-engagement"], requiredFields: [], expectedEvidence: [] },
    { ...base, id: "perform-work", title: "Do the audit work", sectionId: "working_papers", objective: "Carry out the planned procedures and record the evidence, exceptions and conclusions.", standardReferences: ["ISA 230", "ISA 330", "ISA 500"], dependencies: ["plan-audit"], requiredFields: [], expectedEvidence: [] },
    { ...base, id: "evaluate-results", title: "Evaluate errors and financial statements", sectionId: "financial_statements", objective: "List misstatements, agree corrections with management, and check the financial statements and disclosures.", standardReferences: ["ISA 450", "ISA 700"], dependencies: ["perform-work"], requiredFields: [], expectedEvidence: [] },
    { ...base, id: "complete-report", title: "Complete and report", sectionId: "completion", objective: "Check subsequent events and going concern, obtain written representations and approve the auditor's report.", standardReferences: ["ISA 560", "ISA 570", "ISA 580", "ISA 700"], dependencies: ["evaluate-results"], requiredFields: [], expectedEvidence: [] },
  ],
};
