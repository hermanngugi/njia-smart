import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";

type Staff = { id: string; full_name: string | null };

/**
 * Inline "who is this filing assigned to" control. One place for the
 * assignment logic so the Checklist, the per-type page and the client's Tax
 * tab all behave identically:
 *  - updates tax_returns.assigned_to (the DB stamps assigned_at / assigned_by)
 *  - detects a silently-denied update (RLS returns 0 rows, not an error) and
 *    says so instead of appearing to do nothing
 *  - notifies the new assignee
 */
export function TaxAssigneeSelect({
  returnId, value, staff, assignedAt, label, onChanged, className = "",
}: {
  returnId: string;
  value: string | null | undefined;
  staff: Staff[];
  assignedAt?: string | null;
  label?: string;
  onChanged: () => void;
  className?: string;
}) {
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);

  async function change(next: string) {
    const newId = next || null;
    setBusy(true);
    const { data, error } = await supabase
      .from("tax_returns")
      .update({ assigned_to: newId } as any)
      .eq("id", returnId)
      .select("id");
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    if (!data || data.length === 0) {
      toast.error("You don't have permission to assign this filing.");
      return;
    }
    if (newId && newId !== user?.id) {
      await supabase.from("notifications").insert({
        user_id: newId,
        type: "tax",
        title: "Tax filing assigned to you",
        body: label ?? "You've been assigned a tax filing.",
        link: "/tax",
      } as any);
    }
    toast.success(newId ? "Assigned" : "Unassigned");
    onChanged();
  }

  return (
    <div className={className}>
      <select
        value={value ?? ""}
        disabled={busy}
        onChange={e => change(e.target.value)}
        className="h-7 px-2 rounded border bg-background text-xs max-w-[150px]"
      >
        <option value="">Unassigned</option>
        {staff.map(s => <option key={s.id} value={s.id}>{s.full_name ?? "Unnamed"}</option>)}
      </select>
      {value && assignedAt && (
        <div className="text-[10px] text-muted-foreground mt-0.5" title={`Assigned ${formatDateTime(assignedAt)}`}>
          Assigned {formatDateTime(assignedAt)}
        </div>
      )}
    </div>
  );
}
