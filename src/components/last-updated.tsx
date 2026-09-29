import { formatDateTime } from "@/lib/format";

/**
 * Small "last updated" stamp reused across modules (clients, tasks,
 * engagements, workpapers, advisory, documents, invoices) — anywhere a
 * record's own updated_at/updated_by columns are populated by the
 * set_record_audit() trigger (see 20260929080000_record_audit_trail.sql).
 */
export function LastUpdated({
  at, byName, className = "",
}: { at?: string | null; byName?: string | null; className?: string }) {
  if (!at) return null;
  return (
    <span className={`text-xs text-muted-foreground ${className}`}>
      Last updated {formatDateTime(at)}{byName ? ` by ${byName}` : ""}
    </span>
  );
}
