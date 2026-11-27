import { useState } from "react";
import { toast } from "sonner";
import { Send } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import type { Phase } from "./audit-documents";

/** General points raised during the audit. Open points block completing the engagement, so they stay visible here. */
export function AuditNotes({ engagementId, notes, phases, reload }: { engagementId: string; notes: any[]; phases: Phase[]; reload: () => void }) {
  const { user } = useAuth();
  const [text, setText] = useState("");
  const [phase, setPhase] = useState("");
  const [showResolved, setShowResolved] = useState(false);
  const label = (v?: string | null) => phases.find((s) => s.v === v)?.label ?? "General";
  const open = notes.filter((n) => !n.resolved);
  const shown = notes.filter((n) => showResolved || !n.resolved);

  async function add() {
    if (!text.trim()) return;
    const { error } = await supabase.from("audit_review_notes").insert({ engagement_id: engagementId, body: text.trim(), author_id: user?.id, stage: phase || null } as any);
    if (error) toast.error(error.message); else { setText(""); reload(); }
  }
  async function toggle(id: string, resolved: boolean) {
    const how = resolved ? window.prompt("How was this dealt with? (optional)", "") : null;
    if (resolved && how === null) return;
    const { error } = await supabase.from("audit_review_notes").update({
      resolved,
      ...(resolved ? { resolved_by: user?.id ?? null, resolved_at: new Date().toISOString(), resolution_note: how!.trim() || null } : { resolved_by: null, resolved_at: null, resolution_note: null }),
    } as any).eq("id", id);
    if (error) toast.error(error.message); else { toast.success(resolved ? "Resolved" : "Reopened"); reload(); }
  }

  return (
    <div className="bg-card border rounded-lg p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold">Open points {open.length > 0 && <span className="text-xs font-normal text-muted-foreground">({open.length} to resolve)</span>}</h2>
          <p className="text-sm text-muted-foreground">General points on the audit. All must be resolved before the engagement can be completed.</p>
        </div>
        <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} /> Show resolved</label>
      </div>
      <div className="flex flex-wrap gap-2">
        <select value={phase} onChange={(e) => setPhase(e.target.value)} className="h-9 px-2 rounded-md border bg-background text-sm" aria-label="Phase">
          <option value="">Any phase</option>
          {phases.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}
        </select>
        <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void add(); }} placeholder="Write a point…" className="flex-1 min-w-[180px] h-9 px-3 rounded-md border bg-background text-sm" />
        <button onClick={() => void add()} className="h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm inline-flex items-center gap-1"><Send className="h-3.5 w-3.5" /> Add</button>
      </div>
      <div className="space-y-2">
        {shown.length === 0 && <div className="text-sm text-muted-foreground py-3 text-center">{notes.length > 0 ? "All points are resolved." : "No open points."}</div>}
        {shown.map((n) => (
          <div key={n.id} className={`p-3 rounded-md text-sm ${n.resolved ? "bg-muted/40 text-muted-foreground" : "bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-900/40"}`}>
            <div className="flex justify-between gap-2">
              <div className={`flex-1 whitespace-pre-wrap ${n.resolved ? "line-through" : ""}`}>{n.body}</div>
              <button onClick={() => void toggle(n.id, !n.resolved)} className="text-xs text-primary whitespace-nowrap">{n.resolved ? "Reopen" : "Mark resolved"}</button>
            </div>
            <div className="text-xs text-muted-foreground mt-1">{label(n.stage)} · {n.profiles?.full_name} · {formatDate(n.created_at)}{n.resolved && n.resolved_at ? ` · resolved ${formatDate(n.resolved_at)}` : ""}</div>
            {n.resolved && n.resolution_note && <div className="mt-1 text-xs">Resolution: {n.resolution_note}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
