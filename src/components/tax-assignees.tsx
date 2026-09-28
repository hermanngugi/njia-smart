import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { UserPlus, X, Users } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";

type Row = { id: string; user_id: string; role: string | null; created_at?: string | null; assigned_by?: string | null; profile?: { full_name: string | null } | null };

export function TaxAssignees({ taxReturnId, compact = false }: { taxReturnId: string; compact?: boolean }) {
  const { user, isAdmin } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [profiles, setProfiles] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState("");

  async function load() {
    const [a, p] = await Promise.all([
      supabase.from("tax_return_assignees" as any).select("*").eq("tax_return_id", taxReturnId),
      supabase.from("profiles").select("id, full_name").order("full_name"),
    ]);
    const byId = new Map((p.data ?? []).map((x: any) => [x.id, x]));
    setProfiles(p.data ?? []);
    setRows(((a.data as any[]) ?? []).map((r) => ({ ...r, profile: byId.get(r.user_id) ?? null })));
  }
  useEffect(() => { if (taxReturnId) load(); }, [taxReturnId]);

  async function add() {
    if (!userId) return;
    const { error } = await supabase.from("tax_return_assignees" as any).insert({ tax_return_id: taxReturnId, user_id: userId, role: role || null, assigned_by: user?.id ?? null } as any);
    if (error) toast.error(error.message);
    else {
      // notify the assignee
      await supabase.from("notifications").insert({
        user_id: userId,
        title: "Assigned to a tax return",
        body: role || "You've been added as a collaborator.",
        type: "tax",
        link: "/tax",
      } as any);
      setUserId(""); setRole(""); setOpen(false); load();
    }
  }
  async function remove(id: string) {
    const { error } = await supabase.from("tax_return_assignees" as any).delete().eq("id", id);
    if (error) toast.error(error.message); else load();
  }
  function canRemove(r: Row) {
    return isAdmin || r.assigned_by == null || r.assigned_by === user?.id;
  }

  const available = profiles.filter(p => !rows.some(r => r.user_id === p.id));

  if (compact) {
    return (
      <div className="flex flex-wrap gap-1 items-center">
        {rows.length === 0 ? (
          <span className="text-xs text-muted-foreground">—</span>
        ) : rows.slice(0, 3).map(r => (
          <span key={r.id} className="text-xs px-1.5 py-0.5 rounded bg-muted" title={r.created_at ? `Added ${formatDateTime(r.created_at)}` : undefined}>{r.profile?.full_name ?? "?"}</span>
        ))}
        {rows.length > 3 && <span className="text-xs text-muted-foreground">+{rows.length - 3}</span>}
        <button onClick={() => setOpen(o => !o)} className="text-xs text-primary inline-flex items-center gap-0.5" title="Add collaborator">
          <UserPlus className="h-3 w-3" />
        </button>
        {open && (
          <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setOpen(false)}>
            <div onClick={e => e.stopPropagation()} className="bg-card w-full max-w-sm rounded-lg border shadow-lg p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Add collaborator</h3>
                <button onClick={() => setOpen(false)} aria-label="Close"><X className="h-4 w-4" /></button>
              </div>
              <select value={userId} onChange={e => setUserId(e.target.value)} className="w-full h-9 px-2 rounded border bg-background text-sm">
                <option value="">Select staff…</option>
                {available.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
              </select>
              <input value={role} onChange={e => setRole(e.target.value)} placeholder="Role (e.g. Preparer, Reviewer)" className="w-full h-9 px-2 rounded border bg-background text-sm" />
              <div className="flex justify-end gap-2">
                <button onClick={() => setOpen(false)} className="h-8 px-3 rounded border text-xs">Cancel</button>
                <button onClick={add} disabled={!userId} className="h-8 px-3 rounded bg-primary text-primary-foreground text-xs disabled:opacity-50">Add</button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="bg-card border rounded-lg p-4">
      <div className="flex justify-between items-center mb-3">
        <h3 className="font-semibold inline-flex items-center gap-2"><Users className="h-4 w-4" /> Collaborators</h3>
        <button onClick={() => setOpen(o => !o)} className="text-xs text-primary inline-flex items-center gap-1"><UserPlus className="h-3 w-3" /> Add</button>
      </div>
      {open && (
        <div className="flex flex-wrap gap-2 mb-3 p-2 border rounded-md bg-muted/30">
          <select value={userId} onChange={e => setUserId(e.target.value)} className="h-8 px-2 rounded border bg-background text-sm flex-1 min-w-[140px]">
            <option value="">Select staff…</option>
            {available.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
          </select>
          <input value={role} onChange={e => setRole(e.target.value)} placeholder="Role (e.g. Preparer, Reviewer)" className="h-8 px-2 rounded border bg-background text-sm flex-1 min-w-[140px]" />
          <button onClick={add} className="h-8 px-3 rounded bg-primary text-primary-foreground text-xs">Add</button>
        </div>
      )}
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No collaborators yet.</p>
      ) : (
        <div className="space-y-1">
          {rows.map(r => (
            <div key={r.id} className="flex items-center justify-between text-sm py-1">
              <div>
                <span className="font-medium">{r.profile?.full_name ?? "Unknown"}</span>
                {r.role && <span className="text-xs text-muted-foreground ml-2">{r.role}</span>}
                {r.created_at && <span className="text-[11px] text-muted-foreground ml-2">· added {formatDateTime(r.created_at)}</span>}
              </div>
              {canRemove(r) && <button onClick={() => remove(r.id)} className="text-muted-foreground hover:text-destructive"><X className="h-3.5 w-3.5" /></button>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
