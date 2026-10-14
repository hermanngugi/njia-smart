/**
 * Plain-language labels, help text and "what should I do next?" logic for the
 * audit workspace. Keep wording here so every audit screen speaks the same way.
 */

export const PACK_ID = "ke-private-financial-audit";
export const PACK_VERSION = 1;

/** Procedure statuses as stored in the database. */
export const STATUS_LABEL: Record<string, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  prepared: "Ready for review",
  under_review: "Being reviewed",
  review_notes: "Changes requested",
  completed: "Done",
  not_applicable: "Not applicable",
};

export const STATUS_TONE: Record<string, string> = {
  not_started: "bg-muted text-muted-foreground",
  in_progress: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200",
  prepared: "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-200",
  under_review: "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-200",
  review_notes: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  completed: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  not_applicable: "bg-muted text-muted-foreground",
};

export const isDone = (status: string) => status === "completed" || status === "not_applicable";

/** What the preparer can set. Review outcomes are only set through sign-off. */
export const PREPARER_STATUS_CHOICES: { value: string; label: string; help: string }[] = [
  { value: "in_progress", label: "Still working on it", help: "Save your progress. Nobody is asked to review yet." },
  { value: "prepared", label: "Ready for review", help: "Work and conclusion are complete. A reviewer will check and approve it." },
  { value: "not_applicable", label: "Not applicable to this audit", help: "This step does not apply to this client." },
];

export const RISK_STATUS_LABEL: Record<string, string> = {
  identified: "Identified",
  assessed: "Assessed",
  responded: "Response planned",
  closed: "Closed",
};

export const ASSERTIONS: { id: string; label: string; help: string }[] = [
  { id: "existence", label: "Existence", help: "The asset, liability or transaction really exists or happened." },
  { id: "completeness", label: "Completeness", help: "Nothing that should be recorded has been left out." },
  { id: "accuracy", label: "Accuracy", help: "Amounts and data are recorded correctly." },
  { id: "valuation", label: "Valuation", help: "Balances are carried at the right amount." },
  { id: "rights_and_obligations", label: "Rights & obligations", help: "The client owns its assets and owes its liabilities." },
  { id: "cutoff", label: "Cut-off", help: "Transactions fall in the correct period." },
  { id: "classification", label: "Classification", help: "Items are recorded in the right accounts." },
  { id: "presentation", label: "Presentation", help: "Items are disclosed and described properly in the statements." },
];

export const COMMON_AREAS = [
  "Revenue", "Trade receivables", "Inventory", "Cash and bank", "Property, plant and equipment",
  "Trade payables", "Borrowings", "Payroll", "Taxation", "Related parties", "Going concern", "Financial statements as a whole",
];

const LEVEL: Record<string, number> = { low: 1, moderate: 2, high: 3 };

/** Simple likelihood × impact rating shown next to each risk. */
export function riskRating(likelihood: string | null, impact: string | null): { label: string; tone: string } {
  const l = likelihood ? LEVEL[likelihood] : 0;
  const i = impact ? LEVEL[impact] : 0;
  if (!l || !i) return { label: "Not rated", tone: "bg-muted text-muted-foreground" };
  const score = l * i;
  if (score >= 6) return { label: "High risk", tone: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200" };
  if (score >= 3) return { label: "Medium risk", tone: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200" };
  return { label: "Low risk", tone: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200" };
}

export type AuditTabKey = "overview" | "procedures" | "risks" | "documents" | "tasks" | "review";

export type NextStep = {
  title: string;
  detail: string;
  tab: AuditTabKey;
  actionLabel: string;
  procedureId?: string;
};

type StepProcedure = {
  id: string;
  title: string;
  status: string;
  required: boolean;
  dependencies: string[];
  procedureId: string;
  assigned_reviewer_id: string | null;
};

/**
 * One clear "do this next" suggestion for the signed-in person.
 * Order: set up checklist → fix review comments → review what is waiting for
 * me → hand-off work that has no reviewer → next procedure → wrap up.
 */
export function computeNextStep(input: {
  procedures: StepProcedure[];
  userId: string | null;
  openRisks: number;
}): NextStep {
  const { procedures, userId } = input;
  if (procedures.length === 0) {
    return {
      title: "Set up the audit checklist",
      detail: "This creates the step-by-step programme for this audit so you can track every procedure from start to sign-off.",
      tab: "procedures",
      actionLabel: "Set up checklist",
    };
  }

  const changes = procedures.find((p) => p.status === "review_notes");
  if (changes) {
    return {
      title: `Address the reviewer’s comments: ${changes.title}`,
      detail: "A reviewer asked for changes. Update the work, then mark it ready for review again.",
      tab: "procedures",
      actionLabel: "Open this step",
      procedureId: changes.id,
    };
  }

  const mine = procedures.filter((p) => p.assigned_reviewer_id === userId && (p.status === "prepared" || p.status === "under_review"));
  if (userId && mine.length > 0) {
    return {
      title: `${mine.length} step${mine.length === 1 ? " is" : "s are"} waiting for your review`,
      detail: "Read the work and conclusion, then approve it or send it back with comments.",
      tab: "review",
      actionLabel: "Go to review",
    };
  }

  const noReviewer = procedures.find((p) => p.status === "prepared" && !p.assigned_reviewer_id);
  if (noReviewer) {
    return {
      title: `Choose a reviewer for: ${noReviewer.title}`,
      detail: "This step is ready but nobody has been asked to review it.",
      tab: "review",
      actionLabel: "Assign reviewer",
    };
  }

  const statusOf = new Map(procedures.map((p) => [p.procedureId, p.status]));
  const next = procedures.find(
    (p) =>
      (p.status === "not_started" || p.status === "in_progress") &&
      p.dependencies.every((d) => {
        const s = statusOf.get(d);
        return s === undefined || isDone(s);
      }),
  );
  if (next) {
    return {
      title: `${next.status === "in_progress" ? "Continue" : "Start"}: ${next.title}`,
      detail: input.openRisks === 0 && next.status === "not_started"
        ? "Tip: record the risks you have identified in the Risks tab as you go."
        : "This is the next step in the audit programme.",
      tab: "procedures",
      actionLabel: next.status === "in_progress" ? "Continue" : "Start",
      procedureId: next.id,
    };
  }

  const waiting = procedures.filter((p) => !isDone(p.status));
  if (waiting.length > 0) {
    return {
      title: `${waiting.length} step${waiting.length === 1 ? " is" : "s are"} with reviewers`,
      detail: "Nothing for you to do right now. Follow up with the assigned reviewers.",
      tab: "review",
      actionLabel: "See review status",
    };
  }

  return {
    title: "All procedures are complete",
    detail: "Every step is approved or not applicable. You can now mark the engagement as completed (an invoice is required).",
    tab: "overview",
    actionLabel: "Review summary",
  };
}
