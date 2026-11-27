/**
 * Plain-language labels, help text and "what should I do next?" logic for the
 * audit workspace. Keep wording here so every audit screen speaks the same way.
 */

export const PACK_ID = "ke-private-financial-audit";
/** Five-step checklist (pack v2). v1 is kept in the database for history but is no longer offered. */
export const PACK_VERSION = 2;

/** Procedure statuses as stored in the database. */
export const STATUS_LABEL: Record<string, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  prepared: "Ready for review",
  under_review: "Ready for review",
  review_notes: "Sent back",
  completed: "Signed off",
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
  { value: "not_started", label: "Not started", help: "Nothing done yet." },
  { value: "in_progress", label: "In progress", help: "Save your progress. Nobody is asked to review yet." },
  { value: "prepared", label: "Ready for review", help: "Work and conclusion are complete. The reviewer checks and signs off, or sends it back with a comment." },
  { value: "not_applicable", label: "Not applicable", help: "This step does not apply to this client." },
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

export type AuditTabKey = "checklist" | "documents" | "review";

/** Steps a reviewer can act on (the database keeps two legacy values for the same stage). */
export const isInReview = (status: string) => status === "prepared" || status === "under_review";
