import type { AuditProcedurePack } from "../types";

/**
 * Five-step checklist. A workflow scaffold, not a substitute for licensed
 * standards text or practitioner judgment.
 */
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
    { id: "planning", label: "Planning", description: "Accept the engagement and plan the audit.", order: 10, enabled: true },
    { id: "working_papers", label: "Audit work", description: "Perform the work and keep the supporting evidence.", order: 20, enabled: true },
    { id: "financial_statements", label: "Financial statements", description: "Evaluate misstatements, balances and disclosures.", order: 30, enabled: true },
    { id: "completion", label: "Completion and report", description: "Final checks and the auditor's report.", order: 40, enabled: true },
  ],
  procedures: [
    {
      id: "accept-engagement", packId: "ke-private-financial-audit", version: 2,
      title: "Accept the engagement", objective: "Confirm acceptance or continuance and team independence, and agree the engagement terms.", sectionId: "planning",
      standardReferences: ["ISA 210", "ISA 220 (Revised)", "IESBA Code"], required: true, enabled: true, dependencies: [],
      requiredFields: ["decision", "teamDeclarations", "threatsAndSafeguards", "termsDate", "approval"], expectedEvidence: ["Acceptance/continuance assessment and approval", "Team independence declarations, with any threats and safeguards", "Signed engagement letter"],
      completionRules: { requireConclusion: true, requireEvidence: true, requireReviewerWhenRequired: true },
    },
    {
      id: "plan-audit", packId: "ke-private-financial-audit", version: 2,
      title: "Plan the audit", objective: "Understand the entity, set materiality, assess the risks (including fraud) and decide how to respond to each.", sectionId: "planning",
      standardReferences: ["ISA 240", "ISA 300", "ISA 315 (Revised 2019)", "ISA 320", "ISA 330"], required: true, enabled: true, dependencies: ["accept-engagement"],
      requiredFields: ["entityUnderstanding", "materiality", "riskAssessments", "plannedProcedures"], expectedEvidence: ["Understanding of the entity and its controls", "Materiality calculation and rationale", "Risks and the planned response to each"],
      completionRules: { requireConclusion: true, requireEvidence: true, requireReviewerWhenRequired: true },
    },
    {
      id: "perform-work", packId: "ke-private-financial-audit", version: 2,
      title: "Do the audit work", objective: "Carry out the planned procedures and record the evidence, exceptions and conclusions.", sectionId: "working_papers",
      standardReferences: ["ISA 230", "ISA 330", "ISA 500"], required: true, enabled: true, dependencies: ["plan-audit"],
      requiredFields: ["workPerformed", "evidenceReferences", "exceptions", "conclusion"], expectedEvidence: ["Cross-referenced workpapers and source evidence"],
      completionRules: { requireConclusion: true, requireEvidence: true, requireReviewerWhenRequired: true },
    },
    {
      id: "evaluate-results", packId: "ke-private-financial-audit", version: 2,
      title: "Evaluate errors and financial statements", objective: "List misstatements, agree corrections with management, and check the financial statements and disclosures.", sectionId: "financial_statements",
      standardReferences: ["ISA 450", "ISA 700"], required: true, enabled: true, dependencies: ["perform-work"],
      requiredFields: ["misstatementSchedule", "correctedStatus", "uncorrectedEvaluation", "disclosureReview"], expectedEvidence: ["Misstatement schedule", "Management communication, where applicable", "Reviewed financial statements"],
      completionRules: { requireConclusion: true, requireEvidence: true, requireReviewerWhenRequired: true },
    },
    {
      id: "complete-report", packId: "ke-private-financial-audit", version: 2,
      title: "Complete and report", objective: "Check subsequent events and going concern, obtain written representations and approve the auditor's report.", sectionId: "completion",
      standardReferences: ["ISA 560", "ISA 570", "ISA 580", "ISA 700"], required: true, enabled: true, dependencies: ["evaluate-results"],
      requiredFields: ["subsequentEvents", "goingConcern", "writtenRepresentations", "reportConclusion"], expectedEvidence: ["Completion checklist", "Written representations", "Approved audit report"],
      completionRules: { requireConclusion: true, requireEvidence: true, requireReviewerWhenRequired: true },
    },
  ],
};
