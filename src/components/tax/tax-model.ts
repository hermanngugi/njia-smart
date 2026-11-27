// Shared definitions for the simplified Tax module.
//
// A filing (one row in tax_returns) moves through four steps. The database
// stamps who/when for steps 1-2 and enforces the closing rules (see
// supabase/migrations/20261126100000_tax_simplified_checklist.sql).
import { isFilingOpen, todayNairobi } from "@/lib/tax-period";

export const STEPS = [
  { key: "docs", label: "Documents received" },
  { key: "prepared", label: "Return prepared" },
  { key: "receipt", label: "Filed - receipt uploaded" },
  { key: "invoice", label: "Invoiced and closed" },
] as const;

export type FilingState = "filed" | "overdue" | "due_soon" | "open" | "not_open";

/** Days from today (Nairobi) to a YYYY-MM-DD date. Negative = in the past. */
export function daysFromToday(date?: string | null): number | null {
  if (!date) return null;
  const a = Date.parse(`${date.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${todayNairobi()}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((a - b) / 86400000);
}

/** Which of the four steps are done for a filing. */
export function stepsDone(row: any, hasReceipt: boolean): boolean[] {
  if (row?.status === "filed") return [true, true, true, true];
  return [!!row?.docs_received_at, !!row?.prepared_at, hasReceipt, !!row?.invoice_id];
}

/** Where a filing stands. "Overdue" means past its due date (matches the reminders). */
export function stateOf(row: any, cadence?: string | null): FilingState {
  if (row?.status === "filed") return "filed";
  const d = daysFromToday(row?.due_date);
  if (d !== null && d < 0) return "overdue";
  if (d !== null && d <= 7) return "due_soon";
  if (!isFilingOpen(row?.due_date, cadence)) return "not_open";
  return "open";
}

export const STATE_LABEL: Record<FilingState, string> = {
  filed: "Filed",
  overdue: "Overdue",
  due_soon: "Due soon",
  open: "Open",
  not_open: "Not yet open",
};

export const STATE_ACCENT: Record<FilingState, string> = {
  filed: "border-l-emerald-500",
  overdue: "border-l-red-500",
  due_soon: "border-l-amber-400",
  open: "border-l-blue-400",
  not_open: "border-l-slate-300 dark:border-l-slate-600",
};

export const STATE_BADGE: Record<FilingState, string> = {
  filed: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  overdue: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
  due_soon: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  open: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200",
  not_open: "bg-muted text-muted-foreground",
};

export function initials(name?: string | null): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return ((parts[0][0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

/** "20 Dec" style short date for a YYYY-MM-DD string. */
export function shortDate(date?: string | null): string {
  if (!date) return "-";
  const dt = new Date(`${date.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(dt.getTime())) return "-";
  return dt.toLocaleDateString("en-KE", { day: "2-digit", month: "short", timeZone: "UTC" });
}

export function dueText(row: any): string {
  if (row?.status === "filed") return "Filed";
  const d = daysFromToday(row?.due_date);
  if (d === null) return "No due date";
  if (d < 0) return `${-d}d overdue`;
  if (d === 0) return "Due today";
  if (d === 1) return "Due tomorrow";
  return `Due ${shortDate(row.due_date)}`;
}

export type TaxFilters = {
  type?: string;
  status?: "open" | "overdue" | "due_soon" | "in_progress" | "no_owner";
  owner?: string; // user id | "me" | "none"
  client?: string; // client id
};

/** Reads one page of a table at a time (PostgREST caps a request at 1000 rows) and fails loudly. */
export async function fetchPages(page: (from: number, to: number) => PromiseLike<{ data: any[] | null; error: any }>) {
  const size = 1000;
  const out: any[] = [];
  for (let from = 0; ; from += size) {
    const { data, error } = await page(from, from + size - 1);
    if (error) throw new Error(error.message ?? "Could not load data");
    if (!data) break;
    out.push(...data);
    if (data.length < size) break;
  }
  return out;
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
