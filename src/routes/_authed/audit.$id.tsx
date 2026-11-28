import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { openStoredFile, signedFileUrl } from "@/lib/client-files";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ArrowLeft, Upload, Download, Eye, Trash2, FileText, X } from "lucide-react";
import { formatDate, formatDateTime } from "@/lib/format";
import { useAuth } from "@/lib/auth";
import { ClientAssignments } from "@/components/client-assignments";
import { CompletionInvoiceDialog, LinkedInvoice } from "@/components/completion-invoice-dialog";
import { ModuleTabBar } from "@/components/module-extra-tabs";
import { getAuditWorkspaceSections } from "@/lib/audit/registry";
import { useAuditData } from "@/components/audit/use-audit-data";
import { computeNextStep } from "@/lib/audit/guidance";
import { AuditProcedures } from "@/components/audit/audit-procedures";
import { AuditRisks } from "@/components/audit/audit-risks";
import { AuditReviewQueue } from "@/components/audit/audit-review-queue";

export const Route = createFileRoute("/_authed/audit/$id")({ component: AuditDetail });

const STATUSES = ["not_started", "in_progress", "under_review", "completed"];
const STATUS_TEXT: Record<string, string> = {
  not_started: "Not started", in_progress: "In progress", under_review: "Under review", completed: "Completed",
};
// Stage names come from the active procedure pack so they match the checklist phases.
const STAGES = getAuditWorkspaceSections().map(({ id, label }) => ({ v: id, label }));
const stageLabel = (v?: string | null) => STAGES.find((s) => s.v === v)?.label ?? "General";
const selectClass = "h-9 px-2 rounded-md border bg-background text-sm";

function AuditDetail() {
  const { id } = useParams({ from: "/_authed/audit/$id" });
  const { user, isAdmin } = useAuth();
  const audit = useAuditData(id);
  const [tab, setTab] = useState<"checklist" | "risks" | "files">("checklist");
  const [reviewOnly, setReviewOnly] = useState(false);
  const [focusProcedureId, setFocusProcedureId] = useState<string | null>(null);
  const [e, setE] = useState<any>(null);
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [wp, setWp] = useState<any[]>([]);
  const [notes, setNotes] = useState<any[]>([]);
  const [staff, setStaff] = useState<any[]>([]);
  const [noteText, setNoteText] = useState("");
  const [openTasks, setOpenTasks] = useState(0);
  const [showResolved, setShowResolved] = useState(false);
  const [wpCategory, setWpCategory] = useState<string>("working_papers");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ url: string; title: string } | null>(null);

  async function load() {
    const [eRes, wpRes, nRes, pRes, tRes] = await Promise.all([
      supabase.from("engagements").select("*, clients(company_name)").eq("id", id).maybeSingle(),
      supabase.from("audit_workpapers").select("*").eq("engagement_id", id).order("created_at", { ascending: false }),
      supabase.from("audit_review_notes").select("*").eq("engagement_id", id).order("created_at"),
      supabase.from("profiles").select("id, full_name"),
      supabase.from("tasks").select("id", { count: "exact", head: true }).eq("engagement_id", id).neq("status", "done"),
    ]);
    const byId = new Map((pRes.data ?? []).map((p: any) => [p.id, p]));
    setE(eRes.data);
    setStaff(pRes.data ?? []);
    setWp((wpRes.data ?? []).map((r: any) => ({ ...r, profiles: r.uploaded_by ? byId.get(r.uploaded_by) ?? null : null })));
    setNotes((nRes.data ?? []).map((r: any) => ({ ...r, profiles: r.author_id ? byId.get(r.author_id) ?? null : null })));
    setOpenTasks(tRes.count ?? 0);
  }
  useEffect(() => { load(); }, [id]);

  // Live updates scoped to this engagement only
  useEffect(() => {
    const ch = supabase
      .channel(`audit-${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "engagements", filter: `id=eq.${id}` }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "audit_workpapers", filter: `engagement_id=eq.${id}` }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "audit_review_notes", filter: `engagement_id=eq.${id}` }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks", filter: `engagement_id=eq.${id}` }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "audit_engagement_procedures", filter: `engagement_id=eq.${id}` }, () => { void audit.reload(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "audit_risks", filter: `engagement_id=eq.${id}` }, () => { void audit.reload(); })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function saveField(field: string, value: any, skipInvoice = false) {
    // Completing an audit requires an invoice under the client.
    if (!skipInvoice && field === "status" && value === "completed" && e?.status !== "completed" && !e?.invoice_id) {
      setInvoiceOpen(true);
      return;
    }
    const { error } = await supabase.from("engagements").update({ [field]: value } as any).eq("id", id);
    if (error) toast.error(error.message); else { toast.success("Saved"); load(); }
  }

  async function uploadWp(ev: React.ChangeEvent<HTMLInputElement>) {
    const file = ev.target.files?.[0]; if (!file) return;
    setBusy(true);
    const path = `${id}/${wpCategory}/${Date.now()}-${file.name}`;
    const up = await supabase.storage.from("audit-workpapers").upload(path, file);
    if (up.error) { toast.error(up.error.message); setBusy(false); return; }
    const { error } = await supabase.from("audit_workpapers").insert({
      engagement_id: id, title: file.name, file_path: path, uploaded_by: user?.id, category: wpCategory,
    } as any);
    setBusy(false); ev.target.value = "";
    if (error) toast.error(error.message); else { toast.success("Uploaded"); load(); }
  }
  async function viewWp(path: string, title: string) {
    const res = await signedFileUrl("audit-workpapers", path, 600);
    if ("error" in res) toast.error(res.error); else setPreview({ url: res.url, title });
  }
  async function downloadWp(path: string) {
    await openStoredFile("audit-workpapers", path, 60);
  }
  async function removeWp(wpId: string, path: string) {
    if (!confirm("Delete workpaper?")) return;
    await supabase.storage.from("audit-workpapers").remove([path]);
    await supabase.from("audit_workpapers").delete().eq("id", wpId);
    load();
  }

  async function addNote() {
    if (!noteText.trim()) return;
    const { error } = await supabase.from("audit_review_notes").insert({ engagement_id: id, body: noteText.trim(), author_id: user?.id } as any);
    if (error) toast.error(error.message); else { setNoteText(""); load(); }
  }
  async function toggleNote(nid: string, resolved: boolean) {
    const resolutionNote = resolved ? window.prompt("Document how this review note was addressed (optional):", "") : null;
    if (resolved && resolutionNote === null) return;
    const { error } = await supabase.from("audit_review_notes").update({
      resolved,
      ...(resolved ? { resolved_by: user?.id ?? null, resolved_at: new Date().toISOString(), resolution_note: resolutionNote!.trim() || null } : { resolved_by: null, resolved_at: null, resolution_note: null }),
    } as any).eq("id", nid);
    if (error) toast.error(error.message); else { toast.success(resolved ? "Review note resolved" : "Review note reopened"); load(); }
  }

  // Engagement progress always follows the checklist.
  const pct = audit.total > 0 ? Math.round((audit.done / audit.total) * 100) : null;
  useEffect(() => {
    if (audit.loading || pct === null || !e || e.id !== id || e.completion_pct === pct) return;
    supabase.from("engagements").update({ completion_pct: pct }).eq("id", id).then(({ error }) => { if (!error) load(); });
  }, [pct, e?.completion_pct, audit.loading]);

  if (!e) return <div className="text-sm text-muted-foreground">Loading…</div>;

  const openNotes = notes.filter((n) => !n.resolved);
  const shownNotes = showResolved ? notes : openNotes;
  const waitingReview = audit.procedures.filter((p) => ["prepared", "under_review", "review_notes"].includes(p.status)).length;
  const next = computeNextStep({
    procedures: audit.procedures.map((p) => ({ id: p.id, title: p.title, status: p.status, required: p.required, dependencies: p.dependencies, procedureId: p.procedure_id, assigned_reviewer_id: p.assigned_reviewer_id })),
    userId: user?.id ?? null,
    openRisks: audit.risks.filter((r) => r.status !== "closed").length,
  });
  const goNext = () => {
    setTab("checklist");
    setReviewOnly(next.tab === "review");
    if (next.procedureId) setFocusProcedureId(next.procedureId);
  };

  return (
    <div className="space-y-4">
      <Link to="/audit" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1"><ArrowLeft className="h-3 w-3" /> Back to audits</Link>

      {/* Header */}
      <div className="bg-card border rounded-lg p-5">
        <div className="flex flex-wrap justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">{e.title}</h1>
            <div className="text-sm text-muted-foreground">{e.clients?.company_name}</div>
            {e.updated_at && <div className="text-xs text-muted-foreground mt-1">Last updated {formatDateTime(e.updated_at)}</div>}
          </div>
          <div className="flex flex-col items-end gap-1">
            <select value={e.status} onChange={(ev) => saveField("status", ev.target.value)} className={selectClass} aria-label="Audit status">
              {STATUSES.map((s) => <option key={s} value={s}>{STATUS_TEXT[s]}</option>)}
            </select>
            {e.invoice_id && <LinkedInvoice invoiceId={e.invoice_id} />}
          </div>
          <CompletionInvoiceDialog
            open={invoiceOpen}
            onOpenChange={setInvoiceOpen}
            source="engagements"
            sourceId={e.id}
            clientName={e.clients?.company_name}
            defaultDescription={`Audit — ${e.title}`}
            onInvoiced={() => saveField("status", "completed", true)}
          />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span>{e.due_date ? `Due ${formatDate(e.due_date)}` : "No due date"}</span>
          <span>{audit.total > 0 ? `${audit.done} of ${audit.total} steps done` : "Checklist not set up"}</span>
          <Link to="/tasks" search={{ engagement: id } as any} className="text-primary hover:underline">{openTasks} open task{openTasks === 1 ? "" : "s"} · view or add</Link>
        </div>
        {!audit.loading && !audit.error && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md bg-primary/5 px-3 py-2">
            <span className="text-sm"><span className="font-medium">Next:</span> {next.title}</span>
            {next.tab !== "overview" && <button type="button" onClick={goNext} className="h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium">{next.actionLabel}</button>}
          </div>
        )}
        <details className="mt-3">
          <summary className="cursor-pointer text-sm text-primary">Dates, notes and team</summary>
          <div className="mt-3 grid sm:grid-cols-2 gap-3">
            <label className="text-xs font-medium">Start date
              <input type="date" defaultValue={e.start_date || ""} onBlur={(ev) => saveField("start_date", ev.target.value || null)} className="mt-1 w-full h-9 px-3 rounded-md border bg-background text-sm" />
            </label>
            <label className="text-xs font-medium">Due date
              <input type="date" defaultValue={e.due_date || ""} onBlur={(ev) => saveField("due_date", ev.target.value || null)} className="mt-1 w-full h-9 px-3 rounded-md border bg-background text-sm" />
            </label>
            <label className="text-xs font-medium sm:col-span-2">Notes
              <textarea defaultValue={e.notes || ""} onBlur={(ev) => saveField("notes", ev.target.value)} rows={2} className="mt-1 w-full px-3 py-2 rounded-md border bg-background text-sm" />
            </label>
          </div>
          {e.client_id && <div className="mt-3"><h2 className="text-sm font-semibold mb-2">Audit team</h2><ClientAssignments clientId={e.client_id} /></div>}
        </details>
      </div>

      <ModuleTabBar
        active={tab}
        onChange={setTab}
        tabs={[
          { key: "checklist", label: "Checklist", count: audit.total > 0 ? audit.total - audit.done : undefined },
          { key: "risks", label: "Risks", count: audit.risks.length },
          { key: "files", label: "Files", count: wp.length },
        ]}
      />

      {tab === "checklist" && (
        <div className="space-y-4">
          <div className="flex gap-1.5">
            {([[false, "All steps"], [true, `Waiting for review (${waitingReview})`]] as const).map(([v, label]) => (
              <button key={String(v)} type="button" onClick={() => setReviewOnly(v)} className={`text-xs px-2.5 py-1 rounded-full border ${reviewOnly === v ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-muted"}`}>{label}</button>
            ))}
          </div>
          {reviewOnly ? (
            <AuditReviewQueue data={audit} staff={staff} />
          ) : (
            <AuditProcedures
              data={audit}
              staff={staff}
              workpapers={wp.map((w) => ({ id: w.id, title: w.title }))}
              focusProcedureId={focusProcedureId}
              onFocusHandled={() => setFocusProcedureId(null)}
            />
          )}

          <div className="bg-card border rounded-lg p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold">Open points ({openNotes.length})</h2>
              <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><input type="checkbox" checked={showResolved} onChange={(ev) => setShowResolved(ev.target.checked)} /> Show resolved</label>
            </div>
            <form onSubmit={(ev) => { ev.preventDefault(); addNote(); }} className="flex gap-2">
              <input value={noteText} onChange={(ev) => setNoteText(ev.target.value)} placeholder="Raise a point to be resolved…" className="flex-1 min-w-0 h-9 px-3 rounded-md border bg-background text-sm" />
              <button className="h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm">Add</button>
            </form>
            <div className="space-y-2">
              {shownNotes.length === 0 && <div className="text-sm text-muted-foreground py-2">No open points.</div>}
              {shownNotes.map((n) => (
                <div key={n.id} className={`p-3 rounded-md text-sm ${n.resolved ? "bg-muted/40 text-muted-foreground" : "bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-900/40"}`}>
                  <div className="flex justify-between gap-2">
                    <div className={`flex-1 whitespace-pre-wrap ${n.resolved ? "line-through" : ""}`}>{n.body}</div>
                    <button onClick={() => toggleNote(n.id, !n.resolved)} className="text-xs text-primary whitespace-nowrap">{n.resolved ? "Reopen" : "Mark resolved"}</button>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">{n.profiles?.full_name} · {formatDate(n.created_at)}{n.resolved && n.resolved_at ? ` · resolved ${formatDate(n.resolved_at)}` : ""}</div>
                  {n.resolved && n.resolution_note && <div className="mt-1 text-xs">Resolution: {n.resolution_note}</div>}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === "risks" && <AuditRisks engagementId={id} data={audit} />}

      {tab === "files" && (
        <div className="bg-card border rounded-lg p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <label className={`h-9 px-3 inline-flex items-center gap-2 rounded-md bg-primary text-primary-foreground text-sm cursor-pointer ${busy ? "opacity-60" : ""}`}>
              <Upload className="h-4 w-4" /> {busy ? "Uploading…" : "Upload file"}
              <input type="file" hidden onChange={uploadWp} disabled={busy} />
            </label>
            <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">Phase (optional)
              <select value={wpCategory} onChange={(ev) => setWpCategory(ev.target.value)} className={selectClass}>
                {STAGES.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}
              </select>
            </label>
          </div>
          <div className="divide-y border rounded-md">
            {wp.length === 0 && <div className="text-sm text-muted-foreground py-6 text-center">No files yet.</div>}
            {wp.map((w) => (
              <div key={w.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
                <FileText className="h-4 w-4 text-muted-foreground" />
                <div className="flex-1 min-w-[160px]">
                  <div>{w.title}</div>
                  <div className="text-xs text-muted-foreground">{stageLabel(w.category ?? "working_papers")} · {w.profiles?.full_name} · {formatDate(w.created_at)}</div>
                </div>
                <button onClick={() => viewWp(w.file_path, w.title)} className="text-primary text-xs inline-flex items-center gap-1"><Eye className="h-3 w-3" />View</button>
                <button onClick={() => downloadWp(w.file_path)} className="text-primary text-xs inline-flex items-center gap-1"><Download className="h-3 w-3" />Download</button>
                {isAdmin && <button onClick={() => removeWp(w.id, w.file_path)} className="text-destructive" aria-label="Delete document"><Trash2 className="h-3.5 w-3.5" /></button>}
              </div>
            ))}
          </div>
        </div>
      )}

      {preview && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={() => setPreview(null)}>
          <div onClick={(ev) => ev.stopPropagation()} className="bg-card w-full max-w-5xl h-[90vh] rounded-lg flex flex-col overflow-hidden">
            <div className="flex justify-between items-center p-3 border-b">
              <div className="font-semibold text-sm truncate">{preview.title}</div>
              <button onClick={() => setPreview(null)}><X className="h-4 w-4" /></button>
            </div>
            <iframe src={preview.url} className="flex-1 w-full" title={preview.title} />
          </div>
        </div>
      )}
    </div>
  );
}
