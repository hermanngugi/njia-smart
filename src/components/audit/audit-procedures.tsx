import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertCircle, ChevronRight, FileCheck2, Link2, Lock, Plus, ShieldAlert, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { PREPARER_STATUS_CHOICES, STATUS_LABEL, STATUS_TONE, isDone } from "@/lib/audit/guidance";
import type { AuditData, ProcedureRow, StaffMember } from "./use-audit-data";

type Filter = "all" | "todo" | "review" | "done";
const inputClass = "mt-1 w-full min-w-0 rounded-md border bg-background px-3 py-2 text-sm";

function actionLabel(status: string) {
  switch (status) {
    case "not_started": return "Start";
    case "in_progress": return "Continue";
    case "review_notes": return "Fix comments";
    case "prepared":
    case "under_review": return "View";
    default: return "View";
  }
}

export function AuditProcedures({
  data, staff, workpapers, focusProcedureId, onFocusHandled,
}: {
  data: AuditData;
  staff: StaffMember[];
  workpapers: Array<{ id: string; title: string }>;
  focusProcedureId?: string | null;
  onFocusHandled?: () => void;
}) {
  const { procedures, sections, total, done, loading, error, initialize, initializing } = data;
  const [filter, setFilter] = useState<Filter>("all");
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    if (focusProcedureId) { setActiveId(focusProcedureId); onFocusHandled?.(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusProcedureId]);

  const titleById = useMemo(() => new Map(procedures.map((p) => [p.procedure_id, p.title])), [procedures]);
  const statusById = useMemo(() => new Map(procedures.map((p) => [p.procedure_id, p.status])), [procedures]);
  const active = procedures.find((p) => p.id === activeId) ?? null;

  const matches = (p: ProcedureRow) =>
    filter === "all" ? true
      : filter === "done" ? isDone(p.status)
      : filter === "review" ? ["prepared", "under_review", "review_notes"].includes(p.status)
      : ["not_started", "in_progress"].includes(p.status);

  const counts = {
    all: total,
    todo: procedures.filter((p) => ["not_started", "in_progress"].includes(p.status)).length,
    review: procedures.filter((p) => ["prepared", "under_review", "review_notes"].includes(p.status)).length,
    done,
  };

  if (error) {
    return (
      <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 space-y-1">
        <h3 className="font-semibold text-sm">The audit database is not set up yet</h3>
        <p className="text-sm">Apply the three audit migrations in order, then refresh this page.</p>
        <p className="text-xs text-muted-foreground">Database message: {error}</p>
      </div>
    );
  }

  if (!loading && total === 0) {
    return (
      <div className="rounded-lg border border-dashed bg-card p-8 text-center space-y-3">
        <FileCheck2 className="h-8 w-8 mx-auto text-primary" />
        <h2 className="font-semibold text-lg">Set up the audit checklist</h2>
        <p className="text-sm text-muted-foreground max-w-xl mx-auto">
          This creates the step-by-step audit programme (Kenya private-sector audit, ISA-based) for this engagement. Each step has an objective, the evidence expected, and a reviewer sign-off. You can safely run this more than once.
        </p>
        <button onClick={() => void initialize()} disabled={initializing} className="h-10 px-5 rounded-md bg-primary text-primary-foreground text-sm font-medium inline-flex items-center gap-2 disabled:opacity-50">
          <Plus className="h-4 w-4" /> {initializing ? "Setting up…" : "Set up checklist"}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-card p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-semibold">Audit checklist</h2>
            <p className="text-sm text-muted-foreground">Work through the steps in order. Click a step to record what you did and your conclusion.</p>
          </div>
          <div className="text-sm font-medium">{done} of {total} done</div>
        </div>
        <div className="h-2 rounded-full bg-muted overflow-hidden"><div className="h-full bg-primary transition-all" style={{ width: `${total ? (done / total) * 100 : 0}%` }} /></div>
        <div className="flex flex-wrap gap-1.5">
          {([["all", "All"], ["todo", "To do"], ["review", "In review"], ["done", "Done"]] as [Filter, string][]).map(([key, label]) => (
            <button key={key} onClick={() => setFilter(key)} className={`px-3 h-8 rounded-full border text-xs ${filter === key ? "bg-primary text-primary-foreground border-primary" : "hover:bg-muted"}`}>
              {label} <span className="opacity-70">({counts[key]})</span>
            </button>
          ))}
        </div>
      </div>

      {loading && <p className="text-sm text-muted-foreground">Loading checklist…</p>}

      {sections.map((section) => {
        const list = section.procedures.filter(matches);
        if (list.length === 0) return null;
        return (
          <section key={section.id} className="space-y-2">
            <div className="flex items-baseline justify-between gap-2 border-b pb-1">
              <div>
                <h3 className="text-sm font-semibold">{section.label}</h3>
                <p className="text-xs text-muted-foreground">{section.description}</p>
              </div>
              <span className="text-xs text-muted-foreground whitespace-nowrap">{section.done} of {section.procedures.length} done</span>
            </div>
            <div className="space-y-2">
              {list.map((p) => {
                const waitingFor = p.dependencies.filter((d) => statusById.has(d) && !isDone(statusById.get(d)!));
                const reviewer = staff.find((s) => s.id === p.assigned_reviewer_id)?.full_name;
                return (
                  <button key={p.id} onClick={() => setActiveId(p.id)} className="w-full text-left rounded-lg border bg-card p-3 hover:border-primary/50 transition-colors">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-sm">{p.title}</span>
                          {p.required && <span className="text-[10px] uppercase tracking-wide text-muted-foreground border rounded px-1">Required</span>}
                          <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_TONE[p.status] ?? "bg-muted"}`}>{STATUS_LABEL[p.status] ?? p.status}</span>
                        </div>
                        {p.objective && <p className="text-xs text-muted-foreground mt-1">{p.objective}</p>}
                        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                          {p.standardRefs.length > 0 && <span>Standard: {p.standardRefs.join(", ")}</span>}
                          {reviewer && <span>Reviewer: {reviewer}</span>}
                          <span>{p.evidenceWorkpaperIds.length} file{p.evidenceWorkpaperIds.length === 1 ? "" : "s"} attached</span>
                          <span>{p.riskIds.length} risk{p.riskIds.length === 1 ? "" : "s"} linked</span>
                        </div>
                        {waitingFor.length > 0 && !isDone(p.status) && (
                          <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-300">Best done after: {waitingFor.map((d) => titleById.get(d) ?? d).join(", ")}</p>
                        )}
                        {p.status === "review_notes" && p.latestSignoff?.comments && (
                          <p className="mt-1.5 text-xs rounded bg-amber-50 dark:bg-amber-900/20 p-2"><strong>Reviewer said:</strong> {p.latestSignoff.comments}</p>
                        )}
                      </div>
                      <span className="inline-flex items-center gap-1 text-xs text-primary font-medium whitespace-nowrap">{actionLabel(p.status)} <ChevronRight className="h-3.5 w-3.5" /></span>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}

      {active && (
        <ProcedureDialog
          key={active.id}
          procedure={active}
          data={data}
          staff={staff}
          workpapers={workpapers}
          onClose={() => setActiveId(null)}
        />
      )}
    </div>
  );
}

function ProcedureDialog({
  procedure, data, staff, workpapers, onClose,
}: {
  procedure: ProcedureRow;
  data: AuditData;
  staff: StaffMember[];
  workpapers: Array<{ id: string; title: string }>;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const p = procedure;
  const locked = p.status === "completed";
  const initialStatus = p.status === "not_started" ? "in_progress" : ["review_notes", "under_review"].includes(p.status) ? "prepared" : p.status;
  const [status, setStatus] = useState(initialStatus === "completed" ? "prepared" : initialStatus);
  const [work, setWork] = useState(p.latest?.work_performed ?? "");
  const [conclusion, setConclusion] = useState(p.latest?.conclusion ?? "");
  const [exceptionText, setExceptionText] = useState(
    Array.isArray(p.latest?.exceptions) ? (p.latest!.exceptions as unknown[]).map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join("\n") : "",
  );
  const [evidenceIds, setEvidenceIds] = useState<string[]>([]);
  const [riskIds, setRiskIds] = useState<string[]>([]);
  const [reviewerId, setReviewerId] = useState(p.assigned_reviewer_id ?? "");
  const [saving, setSaving] = useState(false);

  const reviewers = staff.filter((s) => s.id !== user?.id);

  async function save() {
    if (locked) return;
    if (status === "prepared") {
      if (!work.trim()) return toast.error("Describe the work you performed before marking this ready for review.");
      if (!conclusion.trim()) return toast.error("Write your conclusion before marking this ready for review.");
      if (!reviewerId) return toast.error("Choose who will review this work.");
      if (reviewerId === user?.id) return toast.error("The reviewer must be a different person from you.");
    }
    setSaving(true);
    const db = supabase as any;
    const exceptions = exceptionText.split("\n").map((l) => l.trim()).filter(Boolean);
    const hasContent = !!(work.trim() || conclusion.trim() || exceptions.length);
    const changed =
      work.trim() !== (p.latest?.work_performed ?? "").trim() ||
      conclusion.trim() !== (p.latest?.conclusion ?? "").trim();
    if ((hasContent && (changed || !p.latest)) || status === "prepared") {
      const { error } = await db.from("audit_procedure_results").insert({
        engagement_procedure_id: p.id,
        work_performed: work.trim(),
        conclusion: conclusion.trim() || null,
        exceptions,
        result_data: { recorded_from: "audit-workspace" },
        prepared_by: user?.id ?? null,
      });
      if (error) { toast.error(error.message); setSaving(false); return; }
    }
    const { error: statusError } = await db.from("audit_engagement_procedures").update({
      status, assigned_reviewer_id: reviewerId || null, updated_at: new Date().toISOString(),
    }).eq("id", p.id);
    if (statusError) { toast.error(statusError.message); setSaving(false); await data.reload(); return; }

    const newEvidence = evidenceIds.filter((id) => !p.evidenceWorkpaperIds.includes(id));
    if (newEvidence.length) {
      const { error } = await db.from("audit_evidence_links").upsert(
        newEvidence.map((workpaper_id) => ({ engagement_procedure_id: p.id, workpaper_id, note: "Linked from audit checklist" })),
        { onConflict: "engagement_procedure_id,workpaper_id" },
      );
      if (error) toast.error(`Saved, but attaching files failed: ${error.message}`);
    }
    const newRisks = riskIds.filter((id) => !p.riskIds.includes(id));
    if (newRisks.length) {
      const { error } = await db.from("audit_risk_procedure_links").upsert(
        newRisks.map((risk_id) => ({ risk_id, engagement_procedure_id: p.id, linked_by: user?.id ?? null })),
        { onConflict: "risk_id,engagement_procedure_id" },
      );
      if (error) toast.error(`Saved, but linking risks failed: ${error.message}`);
    }
    setSaving(false);
    toast.success(status === "prepared" ? "Sent for review" : "Saved");
    await data.reload();
    onClose();
  }

  const toggle = (list: string[], id: string, on: boolean) => (on ? [...list, id] : list.filter((x) => x !== id));

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-card w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-lg shadow-xl">
        <div className="sticky top-0 bg-card border-b p-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold">{p.title}</h2>
              <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_TONE[p.status] ?? "bg-muted"}`}>{STATUS_LABEL[p.status] ?? p.status}</span>
            </div>
            {p.objective && <p className="text-sm text-muted-foreground mt-1">{p.objective}</p>}
            {p.standardRefs.length > 0 && <p className="text-xs text-muted-foreground mt-1">Standard: {p.standardRefs.join(", ")}</p>}
          </div>
          <button onClick={onClose} aria-label="Close"><X className="h-4 w-4" /></button>
        </div>

        <div className="p-4 space-y-4">
          {locked && (
            <div className="rounded-md bg-emerald-50 dark:bg-emerald-900/20 p-3 text-sm flex items-start gap-2">
              <Lock className="h-4 w-4 mt-0.5 shrink-0" /> This step has been approved and is locked. Changes after approval need the controlled amendment process.
            </div>
          )}

          {p.status === "review_notes" && p.latestSignoff?.comments && (
            <div className="rounded-md bg-amber-50 dark:bg-amber-900/20 p-3 text-sm">
              <div className="font-medium flex items-center gap-1.5"><AlertCircle className="h-4 w-4" /> The reviewer asked for changes</div>
              <p className="mt-1 whitespace-pre-wrap">{p.latestSignoff.comments}</p>
            </div>
          )}

          {p.expectedEvidence.length > 0 && (
            <div className="rounded-md bg-muted/50 p-3 text-sm">
              <div className="font-medium">Evidence a reviewer will expect</div>
              <ul className="mt-1 list-disc pl-5 text-muted-foreground">{p.expectedEvidence.map((e) => <li key={e}>{e}</li>)}</ul>
            </div>
          )}

          <fieldset disabled={locked} className="space-y-4">
            <label className="block text-sm font-medium">1. What work did you do?
              <textarea className={inputClass} rows={4} value={work} onChange={(e) => setWork(e.target.value)} placeholder="Describe the procedures you performed, when, and how much you tested." />
            </label>
            <label className="block text-sm font-medium">2. What is your conclusion?
              <textarea className={inputClass} rows={3} value={conclusion} onChange={(e) => setConclusion(e.target.value)} placeholder="State what the evidence shows, e.g. “Revenue is fairly stated; no exceptions noted.”" />
            </label>
            <label className="block text-sm font-medium">3. Anything unusual? <span className="font-normal text-muted-foreground">(optional, one per line)</span>
              <textarea className={inputClass} rows={2} value={exceptionText} onChange={(e) => setExceptionText(e.target.value)} placeholder="Exceptions, differences or findings" />
            </label>

            <div>
              <div className="text-sm font-medium flex items-center gap-1.5"><Link2 className="h-4 w-4" /> Attach evidence <span className="font-normal text-muted-foreground">(from the Documents tab)</span></div>
              {workpapers.length === 0 ? (
                <p className="mt-1 text-xs text-muted-foreground">No documents uploaded yet. Upload files in the Documents tab, then attach them here.</p>
              ) : (
                <div className="mt-1 max-h-32 overflow-y-auto rounded-md border p-2 space-y-1">
                  {workpapers.map((w) => {
                    const already = p.evidenceWorkpaperIds.includes(w.id);
                    return (
                      <label key={w.id} className="flex items-center gap-2 text-sm">
                        <input type="checkbox" disabled={already} checked={already || evidenceIds.includes(w.id)} onChange={(e) => setEvidenceIds(toggle(evidenceIds, w.id, e.target.checked))} />
                        <span className="truncate">{w.title}</span>{already && <span className="text-xs text-muted-foreground">attached</span>}
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

            {data.risks.length > 0 && (
              <div>
                <div className="text-sm font-medium flex items-center gap-1.5"><ShieldAlert className="h-4 w-4" /> Which risks does this step address? <span className="font-normal text-muted-foreground">(optional)</span></div>
                <div className="mt-1 max-h-32 overflow-y-auto rounded-md border p-2 space-y-1">
                  {data.risks.map((r) => {
                    const already = p.riskIds.includes(r.id);
                    return (
                      <label key={r.id} className="flex items-center gap-2 text-sm">
                        <input type="checkbox" disabled={already} checked={already || riskIds.includes(r.id)} onChange={(e) => setRiskIds(toggle(riskIds, r.id, e.target.checked))} />
                        <span className="truncate">{r.title}</span>{already && <span className="text-xs text-muted-foreground">linked</span>}
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            <div>
              <div className="text-sm font-medium">4. Where does this stand?</div>
              <div className="mt-1 space-y-1.5">
                {PREPARER_STATUS_CHOICES.map((c) => (
                  <label key={c.value} className={`flex items-start gap-2 rounded-md border p-2 text-sm cursor-pointer ${status === c.value ? "border-primary bg-primary/5" : ""}`}>
                    <input type="radio" name="status" className="mt-1" checked={status === c.value} onChange={() => setStatus(c.value)} />
                    <span><span className="font-medium">{c.label}</span><span className="block text-xs text-muted-foreground">{c.help}</span></span>
                  </label>
                ))}
              </div>
            </div>

            {status === "prepared" && (
              <label className="block text-sm font-medium">Who will review this? <span className="font-normal text-muted-foreground">(must be someone other than you)</span>
                <select className={inputClass} value={reviewerId} onChange={(e) => setReviewerId(e.target.value)}>
                  <option value="">Choose a reviewer…</option>
                  {reviewers.map((s) => <option key={s.id} value={s.id}>{s.full_name ?? s.id}</option>)}
                </select>
              </label>
            )}
          </fieldset>
        </div>

        <div className="sticky bottom-0 bg-card border-t p-4 flex justify-end gap-2">
          <button onClick={onClose} className="h-9 px-3 rounded-md border text-sm hover:bg-muted">{locked ? "Close" : "Cancel"}</button>
          {!locked && (
            <button onClick={() => void save()} disabled={saving} className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50">
              {saving ? "Saving…" : status === "prepared" ? "Send for review" : "Save"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
