export function formatDate(d?: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" });
}
// Date + time, for records where "when exactly" matters (filed, completed,
// paid, assigned). formatDate() above is date-only and is kept for due dates.
export function formatDateTime(d?: string | null) {
  if (!d) return "—";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return "—";
  return dt.toLocaleString("en-KE", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}
export function daysUntil(d?: string | null) {
  if (!d) return null;
  const diff = Math.ceil((new Date(d).getTime() - Date.now()) / 86400000);
  return diff;
}
// Smart overdue: counts whole filing periods missed past the due date, not
// raw days. A return is only "overdue" once at least one full period
// (month / quarter / year, per the type's policy) has elapsed since due date.
export function periodsOverdue(dueDate: string | null | undefined, cadence: string): number {
  if (!dueDate) return 0;
  const due = new Date(dueDate);
  if (isNaN(due.getTime())) return 0;
  const now = new Date();
  if (now <= due) return 0;
  let months = (now.getFullYear() - due.getFullYear()) * 12 + (now.getMonth() - due.getMonth());
  if (now.getDate() < due.getDate()) months -= 1;
  months = Math.max(0, months);
  const periodLen = cadence === "annual" ? 12 : cadence === "quarterly" ? 3 : 1;
  return Math.floor(months / periodLen);
}
export const STATUS_COLORS: Record<string, string> = {
  not_started: "bg-muted text-muted-foreground",
  in_progress: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200",
  waiting_for_documents: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  under_review: "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-200",
  filed: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  completed: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  overdue: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
  urgent: "bg-accent/20 text-accent",
  pending: "bg-muted text-muted-foreground",
  todo: "bg-muted text-muted-foreground",
  blocked: "bg-red-100 text-red-800",
  done: "bg-emerald-100 text-emerald-800",
  low: "bg-muted text-muted-foreground",
  normal: "bg-blue-100 text-blue-800",
  high: "bg-amber-100 text-amber-800",
  draft: "bg-muted text-muted-foreground",
  sent: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200",
  partial: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  paid: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
};
export function statusLabel(s: string) {
  return s.replace(/_/g, " ");
}
