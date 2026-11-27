import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertCircle, ChevronDown, FileCheck2, Lock, Plus, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { PREPARER_STATUS_CHOICES, STATUS_LABEL, STATUS_TONE, isDone, isInReview } from "@/lib/audit/guidance";
import { daysFromToday, initials, shortDate } from "@/components/tax/tax-model";
import { AuditRisks } from "./audit-risks";
import type { AuditData, ProcedureRow, StaffMember } from "./use-audit-data";

type Filter = "all" | "todo" | "review" | "done";
const inputClass = "mt-1 w-full min-w-0 rounded-md border bg-background px-3 py-2 text-sm";

function dueChip(p: ProcedureRow) {
  if (!p.due_date || isDone(p.status)) return null;
  const d = daysFromToday(p.due_date);
  if (d === null) return null;
  const tone = d < 0 ? "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200" : d <= 3 ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200" : "bg-muted text-muted-foreground";
  return <span className={`text-[11px] px-1.5 py-0.5 rounded-full whitespace-nowrap ${tone}`}>{d < 0 ? `${-d}d overdue` : d === 0 ? "Due today" : `Due ${shortDate(p.due_date)}`}</span>;
}

export function AuditProcedures({
  engagementId, data, staff, workpapers, focusProcedureId, onFocusHandled,
}: {
  engagementId: string;
  data: AuditData;
  staff: StaffMember[];
  workpapers: Array<{ id: string; title: string }>;
  focusProcedureId?: string | null;
  onFocusHandled?: () => void;
}) {
  const { procedures, sections, total, done, loading, error, initialize, initializing } = data;
  const [filter, setFilter] = useState<Filter>("all");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [risksOpen, setRisksOpen] = useState(false);

  useEffect(() => {
    if (focusProcedureId) { setActiveId(focusProcedureId); onFocusHandled?.(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusProcedureId]);

  const titleById = useMemo(() => new Map(procedures.map((p) => [p.procedure_id, p.title])), [procedures]);
  const statusById = useMemo(() => new Map(procedures.map((p) => [p.procedure_id, p.status])), [procedures]);
  const nameOf = (id: string | null) => staff.find((s) => s.id === id)?.full_name ?? null;
  const active = procedures.find((p) => p.id === activeId) ?? null;

  const matches = (p: ProcedureRow) =>
    filter === "all" ? true
      : filter === "done" ? isDone(p.status)
      : filter === "review" ? isInReview(p.status)
      : !isDone(p.status) && !isInReview(p.status);

  const counts = {
    all: total,
    todo: procedures.filter((p) => !isDone(p.status) && !isInReview(p.status)).length,
    review: procedures.filter((p) => isInReview(p.status)).length,
    done,
  };

  if (error) {
    return (
      <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 space-y-1">
        <h3 className="font-semibold text-sm">The audit checklist could not be loaded</h3>
        <p className="text-xs text-muted-foreground">Database message: {error}</p>
      </div>
    );
  }

  if (!loading && total === 0) {
    return (
      <div className="rounded-lg border border-dashed bg-card p-8 text-center space-y-3">
        <FileCheck2 className="h-8 w-8 mx-auto text-primary" />
        <h2 className="font-semibold text-lg">Start the audit checklist</h2>
        <p className="text-sm text-muted-foreground max-w-xl mx-auto">
          Five steps from accepting the engagement to the signed report. Each step gets an owner, a due date, a conclusion and a reviewer sign-off.
        </p>
        <button onClick={() => void initialize()} disabled={initializing} className="h-10 px-5 rounded-md bg-primary text-primary-foreground text-sm font-medium inline-flex items-center gap-2 disabled:opacity-50">
          <Plus className="h-4 w-4" /> {initializing ? "Setting up…" : "Start checklist"}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          {([["all", "All"], ["todo", "To do"], ["review", "In review"], ["done", "Signed off"]] as [Filter, string][]).map(([key, label]) => (
            <button key={key} onClick={() => setFilter(key)} className={`px-3 h-8 rounded-full border text-xs ${filter === key ? "bg-primary text-primary-foreground border-primary" : "hover:bg-muted"}`}>
              {label} <span className="opacity-70">({counts[key]})</span>
            </button>
          ))}
        </div>
        <div className="text-sm font-medium">{done} of {total} signed off</div>
      </div>

      {loading && <p className="text-sm text-muted-foreground">Loading checklist…</p>}

      {sections.map((section) => {
        const list = section.procedures.filter(matches);
        const showRisks = section.id === "planning";
        if (list.length === 0 && !showRisks) return null;
        return (
          <section key={section.id} className="space-y-2">
            <div className="flex items-baseline justify-between gap-2 border-b pb-1">
              <div>
                <h3 className="text-sm font-semibold">{section.label}</h3>
                <p className="text-xs text-muted-foreground">{section.description}</p>
              </div>
              <span className="text-xs text-muted-foreground whitespace-nowrap">{section.done} of {section.procedures.length}</span>
            </div>

            {showRisks && (
              <div className="rounded-lg border bg-card">
                <button onClick={() => setRisksOpen((v) => !v)} className="w-full flex items-center justify-between gap-2 px-3 py-2 text-sm font-medium text-left" aria-expanded={risksOpen}>
                  <span>Risks <span className="text-xs font-normal text-muted-foreground">({data.risks.length}) - record what could go wrong and how you will respond</span></span>
                  <ChevronDown className={`h-4 w-4 transition-transform ${risksOpen ? "rotate-180" : ""}`} />
                </button>
                {risksOpen && <div className="border-t p-3"><AuditRisks engagementId={engagementId} data={data} /></div>}
              </div>
            )}

            <div className="space-y-2">
              {list.map((p) => {
                const waitingFor = p.dependencies.filter((d) => statusById.has(d) && !isDone(statusById.get(d)!));
                const owner = nameOf(p.assigned_to);
                const reviewer = nameOf(p.assigned_reviewer_id);
                return (
                  <button key={p.id} onClick={() => setActiveId(p.id)} className="w-full text-left rounded-lg border bg-card p-3 hover:border-primary/50 transition-colors">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-sm">{p.title}</span>
                          <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_TONE[p.status] ?? "bg-muted"}`}>{STATUS_LABEL[p.status] ?? p.status}</span>
                          {dueChip(p)}
                        </div>
                        {p.objective && <p className="text-xs text-muted-foreground mt-1">{p.objective}</p>}
                        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                          {p.standardRefs.length > 0 && <span>{p.standardRefs.join(", ")}</span>}
                          {reviewer && <span>Reviewer: {reviewer}</span>}
                          <span>{p.evidenceWorkpaperIds.length} file{p.evidenceWorkpaperIds.length === 1 ? "" : "s"}</span>
                        </div>
                        {waitingFor.length > 0 && !isDone(p.status) && (
                          <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-300">Best done after: {waitingFor.map((d) => titleById.get(d) ?? d).join(", ")}</p>
                        )}
                        {p.status === "review_notes" && p.latestSignoff?.comments && (
                          <p className="mt-1.5 text-xs rounded bg-amber-50 dark:bg-amber-900/20 p-2"><strong>Reviewer said:</strong> {p.latestSignoff.comments}</p>
                        )}
                      </div>
                      <span
                        className={`h-6 w-6 rounded-full text-[10px] flex items-center justify-center shrink-0 ${owner ? "bg-primary/10 text-primary" : "border border-dashed text-muted-foreground"}`}
                        title={owner ? `Owner: ${owner}` : "No owner assigned"}
                      >{owner ? initials(owner) : "?"}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}

      {active && (
        <StepPanel key={active.id} procedure={active} data={data} staff={staff} workpapers={workpapers} onClose={() => setActiveId(null)} />
      )}
    </div>
  );
}

function StepPanel({
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
  // Review states other than "signed off" show as "ready for review" or "in progress" for the preparer.
  const initialStatus = p.status === "under_review" ? "prepared" : p.status === "review_notes" ? "in_progress" : p.status;
  const [status, setStatus] = useState(initialStatus === "completed" ? "prepared" : initialStatus);
  const [owner, setOwner] = useState(p.assigned_to ?? "");
  const [due, setDue] = useState(p.due_date ?? "");
  const [work, setWork] = useState(p.latest?.work_performed ?? "");
  const [conclusion, setConclusion] = useState(p.latest?.conclusion ?? "");
  const [evidenceIds, setEvidenceIds] = useState<string[]>([]);
  const [reviewerId, setReviewerId] = useState(p.assigned_reviewer_id ?? "");
  const [saving, setSaving] = useState(false);

  const reviewers = staff.filter((s) => s.id !== user?.id);
  const toggle = (list: string[], id: string, on: boolean) => (on ? [...list, id] : list.filter((x) => x !== id));

  async function save() {
    if (locked) return;
    if (status === "prepared") {
      if (!work.trim()) return toast.error("Describe the work you did before marking this ready for review.");
      if (!conclusion.trim()) return toast.error("Write your conclusion (include any exceptions) before marking this ready for review.");
      if (!reviewerId) return toast.error("Choose who will review this step.");
      if (reviewerId === user?.id) return toast.error("The reviewer must be a different person from you.");
    }
    setSaving(true);
    const db = supabase as any;
    const changed =
      work.trim() !== (p.latest?.work_performed ?? "").trim() ||
      conclusion.trim() !== (p.latest?.conclusion ?? "").trim();
    // A new result row is written whenever the text changes or the step goes for review,
    // so the reviewer always signs off the exact words they read.
    if ((changed && (work.trim() || conclusion.trim())) || (status === "prepared" && (changed || p.status !== "prepared" || !p.latest))) {
      const { error } = await db.from("audit_procedure_results").insert({
        engagement_procedure_id: p.id,
        work_performed: work.trim(),
        conclusion: conclusion.trim() || null,
        exceptions: [],
        result_data: { recorded_from: "audit-checklist" },
        prepared_by: user?.id ?? null,
      });
      if (error) { toast.error(error.message); setSaving(false); return; }
    }
    // Whoever starts a step becomes its owner unless someone is already set.
    const ownerId = owner || (status !== "not_started" ? user?.id ?? null : null);
    const { error: stepError } = await db.from("audit_engagement_procedures").update({
      status,
      assigned_to: ownerId,
      due_date: due || null,
      assigned_reviewer_id: status === "prepared" || reviewerId ? reviewerId || null : null,
      updated_at: new Date().toISOString(),
    }).eq("id", p.id);
    if (stepError) { toast.error(stepError.message); setSaving(false); await data.reload(); return; }

    const newEvidence = evidenceIds.filter((id) => !p.evidenceWorkpaperIds.includes(id));
    if (newEvidence.length) {
      const { error } = await db.from("audit_evidence_links").upsert(
        newEvidence.map((workpaper_id) => ({ engagement_procedure_id: p.id, workpaper_id, note: "Attached from audit checklist" })),
        { onConflict: "engagement_procedure_id,workpaper_id" },
      );
      if (error) toast.error(`Saved, but attaching files failed: ${error.message}`);
    }
    setSaving(false);
    toast.success(status === "prepared" ? "Sent for review" : "Saved");
    await data.reload();
    onClose();
  }

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
            {p.standardRefs.length > 0 && <p className="text-xs text-muted-foreground mt-1">{p.standardRefs.join(", ")}</p>}
          </div>
          <button onClick={onClose} aria-label="Close"><X className="h-4 w-4" /></button>
        </div>

        <div className="p-4 space-y-4">
          {locked && (
            <div className="rounded-md bg-emerald-50 dark:bg-emerald-900/20 p-3 text-sm flex items-start gap-2">
              <Lock className="h-4 w-4 mt-0.5 shrink-0" /> This step is signed off and locked. Changes after sign-off need the controlled amendment process.
            </div>
          )}

          {p.status === "review_notes" && p.latestSignoff?.comments && (
            <div className="rounded-md bg-amber-50 dark:bg-amber-900/20 p-3 text-sm">
              <div className="font-medium flex items-center gap-1.5"><AlertCircle className="h-4 w-4" /> The reviewer sent this back</div>
              <p className="mt-1 whitespace-pre-wrap">{p.latestSignoff.comments}</p>
            </div>
          )}

          <fieldset disabled={locked} className="space-y-4">
            <div className="grid sm:grid-cols-3 gap-3">
              <label className="block text-sm font-medium">Status
                <select className={inputClass} value={status} onChange={(e) => setStatus(e.target.value)}>
                  {PREPARER_STATUS_CHOICES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </label>
              <label className="block text-sm font-medium">Owner
                <select className={inputClass} value={owner} onChange={(e) => setOwner(e.target.value)}>
                  <option value="">{status === "not_started" ? "No owner yet" : "Me"}</option>
                  {staff.map((s) => <option key={s.id} value={s.id}>{s.full_name ?? s.id}</option>)}
                </select>
              </label>
              <label className="block text-sm font-medium">Due date
                <input type="date" className={inputClass} value={due} onChange={(e) => setDue(e.target.value)} />
              </label>
            </div>
            <p className="-mt-2 text-xs text-muted-foreground">{PREPARER_STATUS_CHOICES.find((c) => c.value === status)?.help}</p>

            <label className="block text-sm font-medium">Work done
              <textarea className={inputClass} rows={4} value={work} onChange={(e) => setWork(e.target.value)} placeholder="What you did, when, and how much you tested." />
            </label>
            <label className="block text-sm font-medium">Conclusion <span className="font-normal text-muted-foreground">(include any exceptions or differences)</span>
              <textarea className={inputClass} rows={3} value={conclusion} onChange={(e) => setConclusion(e.target.value)} placeholder="What the evidence shows, e.g. “Revenue is fairly stated. One cut-off error of KES 40,000, corrected.”" />
            </label>

            <div>
              <div className="text-sm font-medium">Attachments <span className="font-normal text-muted-foreground">(upload files in the Documents tab first)</span></div>
              {workpapers.length === 0 ? (
                <p className="mt-1 text-xs text-muted-foreground">No documents uploaded yet.</p>
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

            {status === "prepared" && (
              <label className="block text-sm font-medium">Reviewer <span className="font-normal text-muted-foreground">(someone other than you)</span>
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
