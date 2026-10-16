import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ArrowLeft, Upload, Download, Eye, Trash2, FileText, Send, X } from "lucide-react";
import { formatDate, formatDateTime, STATUS_COLORS, statusLabel } from "@/lib/format";
import { useAuth } from "@/lib/auth";
import { ClientAssignments } from "@/components/client-assignments";
import { CompletionInvoiceDialog, LinkedInvoice } from "@/components/completion-invoice-dialog";
import { ModuleTabBar } from "@/components/module-extra-tabs";
import { getAuditWorkspaceSections } from "@/lib/audit/registry";
import type { AuditTabKey } from "@/lib/audit/guidance";
import { useAuditData } from "@/components/audit/use-audit-data";
import { AuditOverview } from "@/components/audit/audit-overview";
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
  const [tab, setTab] = useState<AuditTabKey>("overview");
  const [focusProcedureId, setFocusProcedureId] = useState<string | null>(null);
  const [stageFilter, setStageFilter] = useState<string>("all");
  const [e, setE] = useState<any>(null);
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [wp, setWp] = useState<any[]>([]);
  const [notes, setNotes] = useState<any[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [staff, setStaff] = useState<any[]>([]);
  const [noteText, setNoteText] = useState("");
  const [noteStage, setNoteStage] = useState<string>("");
  const [wpTitle, setWpTitle] = useState("");
  const [wpCategory, setWpCategory] = useState<string>("working_papers");
  const [showResolved, setShowResolved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ url: string; title: string } | null>(null);
  const [newTask, setNewTask] = useState({ title: "", assigned_to: "", due_date: "", stage: "" });

  async function load() {
    const [eRes, wpRes, nRes, pRes, tRes] = await Promise.all([
      supabase.from("engagements").select("*, clients(company_name)").eq("id", id).maybeSingle(),
      supabase.from("audit_workpapers").select("*").eq("engagement_id", id).order("created_at", { ascending: false }),
      supabase.from("audit_review_notes").select("*").eq("engagement_id", id).order("created_at"),
      supabase.from("profiles").select("id, full_name"),
      supabase.from("tasks").select("*").eq("engagement_id", id).order("created_at"),
    ]);
    const byId = new Map((pRes.data ?? []).map((p: any) => [p.id, p]));
    setE(eRes.data);
    setStaff(pRes.data ?? []);
    setWp((wpRes.data ?? []).map((r: any) => ({ ...r, profiles: r.uploaded_by ? byId.get(r.uploaded_by) ?? null : null })));
    setNotes((nRes.data ?? []).map((r: any) => ({ ...r, profiles: r.author_id ? byId.get(r.author_id) ?? null : null })));
    setTasks((tRes.data ?? []).map((r: any) => ({ ...r, assignee: r.assigned_to ? byId.get(r.assigned_to) ?? null : null })));
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
      engagement_id: id, title: wpTitle || file.name, file_path: path, uploaded_by: user?.id, category: wpCategory,
    } as any);
    setBusy(false); ev.target.value = "";
    if (error) toast.error(error.message); else { toast.success("Uploaded"); setWpTitle(""); load(); }
  }
  async function viewWp(path: string, title: string) {
    const { data, error } = await supabase.storage.from("audit-workpapers").createSignedUrl(path, 600);
    if (error) toast.error(error.message); else setPreview({ url: data.signedUrl, title });
  }
  async function downloadWp(path: string) {
    const { data, error } = await supabase.storage.from("audit-workpapers").createSignedUrl(path, 60);
    if (error) toast.error(error.message); else window.open(data.signedUrl, "_blank");
  }
  async function removeWp(wpId: string, path: string) {
    if (!confirm("Delete workpaper?")) return;
    await supabase.storage.from("audit-workpapers").remove([path]);
    await supabase.from("audit_workpapers").delete().eq("id", wpId);
    load();
  }

  async function addNote() {
    if (!noteText.trim()) return;
    const { error } = await supabase.from("audit_review_notes").insert({ engagement_id: id, body: noteText.trim(), author_id: user?.id, stage: noteStage || null } as any);
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

  async function addTask() {
    if (!newTask.title.trim()) return;
    const payload: any = {
      title: newTask.title.trim(),
      engagement_id: id,
      client_id: e?.client_id,
      assigned_to: newTask.assigned_to || null,
      due_date: newTask.due_date || null,
      created_by: user?.id,
      stage: newTask.stage || null,
    };
    const { error } = await supabase.from("tasks").insert(payload);
    if (error) toast.error(error.message);
    else {
      if (payload.assigned_to) {
        await supabase.from("notifications").insert({
          user_id: payload.assigned_to, type: "task",
          title: `Assigned: ${payload.title}`, body: `Audit: ${e?.title} — ${stageLabel(payload.stage)}`, link: `/audit/${id}`,
        });
      }
      setNewTask({ title: "", assigned_to: "", due_date: "", stage: "" });
      load();
    }
  }
  async function setTaskStatus(tid: string, status: string) {
    await supabase.from("tasks").update({ status: status as any }).eq("id", tid);
    load();
  }
  async function removeTask(tid: string) {
    if (!confirm("Delete task?")) return;
    await supabase.from("tasks").delete().eq("id", tid);
    load();
  }

  if (!e) return <div className="text-sm text-muted-foreground">Loading…</div>;

  const inStage = (stage?: string | null, fallback?: string) =>
    stageFilter === "all" || ((stage ?? fallback ?? null) === stageFilter);
  const shownDocs = wp.filter((w) => inStage(w.category, "working_papers"));
  const openTasks = tasks.filter((t) => t.status !== "done");
  const shownTasks = [...tasks.filter((t) => inStage(t.stage))].sort((a, b) => Number(a.status === "done") - Number(b.status === "done"));
  const openNotes = notes.filter((n) => !n.resolved);
  const shownNotes = notes.filter((n) => inStage(n.stage) && (showResolved || !n.resolved));
  const waitingReview = audit.procedures.filter((p) => ["prepared", "under_review", "review_notes"].includes(p.status)).length;

  const go = (t: AuditTabKey, procedureId?: string) => {
    setTab(t);
    if (procedureId) setFocusProcedureId(procedureId);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const StageFilter = () => (
    <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
      Show
      <select value={stageFilter} onChange={(ev) => setStageFilter(ev.target.value)} className={selectClass}>
        <option value="all">All phases</option>
        {STAGES.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}
      </select>
    </label>
  );

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
            <span className={`h-fit text-xs px-2 py-1 rounded-full capitalize ${STATUS_COLORS[e.status]}`}>{STATUS_TEXT[e.status] ?? statusLabel(e.status)}</span>
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
        <div className="mt-3">
          <div className="flex justify-between text-xs text-muted-foreground mb-1"><span>Engagement progress</span><span>{e.completion_pct}%</span></div>
          <div className="h-2 rounded-full bg-muted overflow-hidden"><div className="h-full bg-primary transition-all" style={{ width: `${e.completion_pct}%` }} /></div>
        </div>
        <details className="mt-3">
          <summary className="cursor-pointer text-sm text-primary">Edit engagement details (status, dates, progress, notes)</summary>
          <div className="mt-3 grid sm:grid-cols-4 gap-3">
            <div>
              <label className="text-xs font-medium">Start date</label>
              <input type="date" defaultValue={e.start_date || ""} onBlur={(ev) => saveField("start_date", ev.target.value || null)} className="mt-1 w-full h-9 px-3 rounded-md border bg-background text-sm" />
            </div>
            <div>
              <label className="text-xs font-medium">Status</label>
              <select value={e.status} onChange={(ev) => saveField("status", ev.target.value)} className="mt-1 w-full h-9 px-3 rounded-md border bg-background text-sm">
                {STATUSES.map((s) => <option key={s} value={s}>{STATUS_TEXT[s]}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium">Progress ({e.completion_pct}%)</label>
              <input type="range" min={0} max={100} step={5} value={e.completion_pct} onChange={(ev) => setE({ ...e, completion_pct: Number(ev.target.value) })} onMouseUp={(ev) => saveField("completion_pct", Number((ev.target as HTMLInputElement).value))} onTouchEnd={(ev) => saveField("completion_pct", Number((ev.target as HTMLInputElement).value))} className="mt-2 w-full" />
            </div>
            <div>
              <label className="text-xs font-medium">Due date</label>
              <input type="date" defaultValue={e.due_date || ""} onBlur={(ev) => saveField("due_date", ev.target.value || null)} className="mt-1 w-full h-9 px-3 rounded-md border bg-background text-sm" />
            </div>
          </div>
          <div className="mt-3">
            <label className="text-xs font-medium">Notes</label>
            <textarea defaultValue={e.notes || ""} onBlur={(ev) => saveField("notes", ev.target.value)} rows={2} className="mt-1 w-full px-3 py-2 rounded-md border bg-background text-sm" />
          </div>
        </details>
      </div>

      <ModuleTabBar
        active={tab}
        onChange={setTab}
        tabs={[
          { key: "overview", label: "Overview" },
          { key: "procedures", label: "Checklist", count: audit.total > 0 ? audit.total - audit.done : undefined },
          { key: "risks", label: "Risks", count: audit.risks.length },
          { key: "documents", label: "Documents", count: wp.length },
          { key: "tasks", label: "Tasks", count: openTasks.length },
          { key: "review", label: "Review", count: waitingReview + openNotes.length },
        ]}
      />

      {tab === "overview" && (
        <AuditOverview
          data={audit}
          userId={user?.id ?? null}
          completionPct={e.completion_pct ?? 0}
          workpaperCount={wp.length}
          openTasks={openTasks.length}
          openNotes={openNotes.length}
          onGo={go}
          onApplyProgress={(pct) => saveField("completion_pct", pct)}
          team={e.client_id ? (
            <div className="rounded-lg border bg-card p-4">
              <h2 className="font-semibold mb-2">Audit team</h2>
              <ClientAssignments clientId={e.client_id} />
            </div>
          ) : null}
        />
      )}

      {tab === "procedures" && (
        <AuditProcedures
          data={audit}
          staff={staff}
          workpapers={wp.map((w) => ({ id: w.id, title: w.title }))}
          focusProcedureId={focusProcedureId}
          onFocusHandled={() => setFocusProcedureId(null)}
        />
      )}

      {tab === "risks" && <AuditRisks engagementId={id} data={audit} />}

      {tab === "documents" && (
        <div className="bg-card border rounded-lg p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-semibold">Documents</h2>
              <p className="text-sm text-muted-foreground">Upload working papers and evidence. Attach them to checklist steps from the Checklist tab.</p>
            </div>
            <StageFilter />
          </div>
          <div className="flex flex-wrap gap-2">
            <select value={wpCategory} onChange={(ev) => setWpCategory(ev.target.value)} className={selectClass} aria-label="Phase for the new document">
              {STAGES.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}
            </select>
            <input placeholder="Document title (optional)" value={wpTitle} onChange={(ev) => setWpTitle(ev.target.value)} className="flex-1 min-w-[180px] h-9 px-3 rounded-md border bg-background text-sm" />
            <label className={`h-9 px-3 inline-flex items-center gap-2 rounded-md bg-primary text-primary-foreground text-sm cursor-pointer ${busy ? "opacity-60" : ""}`}>
              <Upload className="h-4 w-4" /> {busy ? "Uploading…" : "Upload file"}
              <input type="file" hidden onChange={uploadWp} disabled={busy} />
            </label>
          </div>
          <div className="divide-y border rounded-md">
            {shownDocs.length === 0 && <div className="text-sm text-muted-foreground py-6 text-center">{wp.length === 0 ? "No documents yet. Upload your first file above." : "No documents in this phase."}</div>}
            {shownDocs.map((w) => (
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

      {tab === "tasks" && (
        <div className="bg-card border rounded-lg p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-semibold">Tasks</h2>
              <p className="text-sm text-muted-foreground">Things to do on this audit. Tick a task when it is done.</p>
            </div>
            <StageFilter />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto_auto_auto] gap-2">
            <input value={newTask.title} onChange={(ev) => setNewTask({ ...newTask, title: ev.target.value })} onKeyDown={(ev) => { if (ev.key === "Enter") addTask(); }} placeholder="What needs doing?" className="h-9 px-3 rounded-md border bg-background text-sm" />
            <select value={newTask.stage} onChange={(ev) => setNewTask({ ...newTask, stage: ev.target.value })} className={selectClass} aria-label="Phase">
              <option value="">Any phase</option>
              {STAGES.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}
            </select>
            <select value={newTask.assigned_to} onChange={(ev) => setNewTask({ ...newTask, assigned_to: ev.target.value })} className={selectClass} aria-label="Assign to">
              <option value="">Assign to…</option>
              {staff.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
            </select>
            <input type="date" value={newTask.due_date} onChange={(ev) => setNewTask({ ...newTask, due_date: ev.target.value })} className={selectClass} aria-label="Due date" />
            <button onClick={addTask} className="h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm inline-flex items-center justify-center gap-1"><Send className="h-3.5 w-3.5" /> Add task</button>
          </div>
          <div className="border rounded-md px-2">
            {shownTasks.length === 0 && <div className="text-sm text-muted-foreground py-6 text-center">{tasks.length === 0 ? "No tasks yet." : "No tasks in this phase."}</div>}
            {shownTasks.map((t) => (
              <div key={t.id} className="flex flex-wrap items-center gap-2 py-2 border-b last:border-0 text-sm">
                <input type="checkbox" checked={t.status === "done"} onChange={(ev) => setTaskStatus(t.id, ev.target.checked ? "done" : "todo")} aria-label={`Mark ${t.title} done`} />
                <div className="flex-1 min-w-[160px]">
                  <div className={t.status === "done" ? "line-through text-muted-foreground" : ""}>{t.title}</div>
                  <div className="text-[11px] text-muted-foreground">{stageLabel(t.stage)}{t.status === "done" && t.completed_at ? ` · Done ${formatDateTime(t.completed_at)}` : ""}</div>
                </div>
                <span className="text-xs text-muted-foreground">{t.assignee?.full_name ?? "Unassigned"}</span>
                <span className="text-xs text-muted-foreground">{formatDate(t.due_date)}</span>
                <select value={t.status} onChange={(ev) => setTaskStatus(t.id, ev.target.value)} className="h-7 px-2 rounded text-xs border bg-background" aria-label="Task status">
                  {[["todo", "To do"], ["in_progress", "In progress"], ["done", "Done"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
                <button onClick={() => removeTask(t.id)} className="text-destructive" aria-label="Delete task"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "review" && (
        <div className="space-y-6">
          <AuditReviewQueue data={audit} staff={staff} />

          <div className="bg-card border rounded-lg p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="font-semibold">Review notes</h2>
                <p className="text-sm text-muted-foreground">General points raised during the audit. Resolve each one and say how it was dealt with.</p>
              </div>
              <div className="flex items-center gap-3">
                <StageFilter />
                <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><input type="checkbox" checked={showResolved} onChange={(ev) => setShowResolved(ev.target.checked)} /> Show resolved</label>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <select value={noteStage} onChange={(ev) => setNoteStage(ev.target.value)} className={selectClass} aria-label="Phase for the new note">
                <option value="">Any phase</option>
                {STAGES.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}
              </select>
              <input value={noteText} onChange={(ev) => setNoteText(ev.target.value)} onKeyDown={(ev) => { if (ev.key === "Enter") addNote(); }} placeholder="Write a review note…" className="flex-1 min-w-[180px] h-9 px-3 rounded-md border bg-background text-sm" />
              <button onClick={addNote} className="h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm inline-flex items-center gap-1"><Send className="h-3.5 w-3.5" /> Add note</button>
            </div>
            <div className="space-y-2">
              {shownNotes.length === 0 && <div className="text-sm text-muted-foreground py-4 text-center">{openNotes.length === 0 && notes.length > 0 ? "All review notes are resolved." : "No review notes to show."}</div>}
              {shownNotes.map((n) => (
                <div key={n.id} className={`p-3 rounded-md text-sm ${n.resolved ? "bg-muted/40 text-muted-foreground" : "bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-900/40"}`}>
                  <div className="flex justify-between gap-2">
                    <div className={`flex-1 whitespace-pre-wrap ${n.resolved ? "line-through" : ""}`}>{n.body}</div>
                    <button onClick={() => toggleNote(n.id, !n.resolved)} className="text-xs text-primary whitespace-nowrap">{n.resolved ? "Reopen" : "Mark resolved"}</button>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">{stageLabel(n.stage)} · {n.profiles?.full_name} · {formatDate(n.created_at)}{n.resolved && n.resolved_at ? ` · resolved ${formatDate(n.resolved_at)}` : ""}</div>
                  {n.resolved && n.resolution_note && <div className="mt-1 text-xs">Resolution: {n.resolution_note}</div>}
                </div>
              ))}
            </div>
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
