import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Plus, X, Trash2, Pencil, Upload, FileText, Eye, Download, ChevronDown, ChevronRight, ShieldCheck, Lock, CheckCircle2 } from "lucide-react";
import { formatDate, formatDateTime, STATUS_COLORS, statusLabel } from "@/lib/format";
import { ClientAssignments } from "@/components/client-assignments";
import { ModuleTabBar, ClientsRollupTab, BillingTab, DocumentsTab, type ClientRollupRow } from "@/components/module-extra-tabs";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/_authed/advisory")({
  head: () => ({
    meta: [
      { title: "Advisory Workspace | G.K Nahashon & Company" },
      { name: "description", content: "Manage advisory projects, steps, documents, verification, and close-out." },
      { property: "og:title", content: "Advisory Workspace | G.K Nahashon & Company" },
      { property: "og:description", content: "Manage advisory projects, steps, documents, verification, and close-out." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AdvisoryPage,
});

const STATUSES = ["not_started", "in_progress", "under_review", "completed"];

const STAGES = [
  { key: "onboarding", label: "Onboarding" },
  { key: "evaluation", label: "Evaluation & Analysis" },
  { key: "guidance", label: "Guidance" },
  { key: "invoicing", label: "Invoicing" },
  { key: "action", label: "Action" },
  { key: "closed", label: "Closed" },
];
const stageLabel = (k?: string | null) => STAGES.find(s => s.key === k)?.label ?? "Onboarding";
const MILESTONE_SELECT = "id, title, due_date, done, notes, assigned_to, stage, completed_at, verified, verified_by, verified_at";
const PROJECT_SELECT = `*, clients(company_name), advisory_milestones(${MILESTONE_SELECT})`;

function fmtDateTime(v?: string | null) {
  if (!v) return "—";
  return new Date(v).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function AdvisoryPage() {
  const { isAdmin, user } = useAuth();
  const [tab, setTab] = useState<"projects" | "clients" | "billing" | "documents">("projects");
  const [rows, setRows] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [staff, setStaff] = useState<any[]>([]);
  const [dialog, setDialog] = useState<{ mode: "new" | "edit"; data: any } | null>(null);
  const [milestoneEditor, setMilestoneEditor] = useState<any | null>(null);
  const [msTitle, setMsTitle] = useState("");
  const [msDue, setMsDue] = useState("");
  const [msNotes, setMsNotes] = useState("");
  const [msAssignee, setMsAssignee] = useState("");
  const [msStage, setMsStage] = useState("onboarding");
  const [editingMs, setEditingMs] = useState<string | null>(null);
  const [editMsData, setEditMsData] = useState<any>({});
  const [milestoneDocs, setMilestoneDocs] = useState<Record<string, any[]>>({});
  const [expandedMs, setExpandedMs] = useState<Record<string, boolean>>({});
  const [uploadingMs, setUploadingMs] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ url: string; title: string } | null>(null);
  const [closureNotes, setClosureNotes] = useState("");

  async function load() {
    const [p, c, s] = await Promise.all([
      supabase.from("advisory_projects").select(PROJECT_SELECT).order("created_at", { ascending: false }),
      supabase.from("clients").select("id, company_name").order("company_name"),
      supabase.from("profiles").select("id, full_name"),
    ]);
    setRows(p.data ?? []); setClients(c.data ?? []); setStaff(s.data ?? []);
  }
  useEffect(() => { load(); }, []);

  const staffName = (id?: string | null) => (id ? staff.find(s => s.id === id)?.full_name ?? "Unknown" : "—");

  async function save() {
    if (!dialog) return;
    const { id, clients: _c, advisory_milestones: _m, ...payload } = dialog.data;
    if (!payload.client_id || !payload.title) { toast.error("Client and title required"); return; }
    const op = dialog.mode === "new"
      ? supabase.from("advisory_projects").insert(payload)
      : supabase.from("advisory_projects").update(payload).eq("id", id);
    const { error } = await op;
    if (error) toast.error(error.message);
    else { toast.success("Saved"); setDialog(null); load(); }
  }

  async function remove(id: string) {
    if (!confirm("Delete this advisory project?")) return;
    await supabase.from("advisory_milestones").delete().eq("project_id", id);
    const { error } = await supabase.from("advisory_projects").delete().eq("id", id);
    if (error) toast.error(error.message); else { toast.success("Deleted"); load(); }
  }

  async function reloadEditor() {
    if (!milestoneEditor) return;
    const p = await supabase.from("advisory_projects").select(PROJECT_SELECT).eq("id", milestoneEditor.id).maybeSingle();
    setMilestoneEditor(p.data); load();
  }

  async function setStage(stage: string) {
    if (!milestoneEditor) return;
    const patch: any = { stage };
    if (stage === "closed") { toast.error("Use the close-out section to close this project."); return; }
    const { error } = await supabase.from("advisory_projects").update(patch).eq("id", milestoneEditor.id);
    if (error) toast.error(error.message); else reloadEditor();
  }

  async function closeProject() {
    if (!milestoneEditor) return;
    const ms = milestoneEditor.advisory_milestones ?? [];
    const open = ms.filter((m: any) => !m.done);
    if (open.length && !confirm(`${open.length} step(s) are still open. Close anyway?`)) return;
    const { error } = await supabase.from("advisory_projects").update({
      stage: "closed", status: "completed", closure_notes: closureNotes || null,
      closed_at: new Date().toISOString(), closed_by: user?.id ?? null,
    } as any).eq("id", milestoneEditor.id);
    if (error) toast.error(error.message);
    else { toast.success("Project closed"); setClosureNotes(""); reloadEditor(); }
  }
  async function reopenProject() {
    if (!milestoneEditor) return;
    const { error } = await supabase.from("advisory_projects").update({
      stage: "action", status: "in_progress", closed_at: null, closed_by: null,
    } as any).eq("id", milestoneEditor.id);
    if (error) toast.error(error.message); else { toast.success("Reopened"); reloadEditor(); }
  }

  async function notifyMilestoneAssignee(assigneeId: string, title: string, dueDate?: string | null) {
    if (!assigneeId) return;
    const clientName = milestoneEditor?.clients?.company_name;

    // Give the assignee a task so it shows up on their dashboard / task list.
    await supabase.from("tasks").insert({
      title: `${title} — Advisory`,
      description: clientName ? `Step in Advisory engagement for ${clientName}.` : `Step in Advisory engagement.`,
      client_id: milestoneEditor?.client_id ?? null,
      assigned_to: assigneeId,
      due_date: dueDate || null,
      status: "todo",
      priority: "normal",
      created_by: user?.id ?? null,
    });

    if (assigneeId === user?.id) return;
    await supabase.from("notifications").insert({
      user_id: assigneeId, type: "milestone_assigned",
      title: "Assigned to a task",
      body: clientName ? `${title} — Advisory (${clientName})` : `${title} — Advisory`,
      link: `/advisory`,
    });
  }

  async function addMilestone() {
    if (!milestoneEditor || !msTitle.trim()) return;
    const { error } = await supabase.from("advisory_milestones").insert({
      project_id: milestoneEditor.id, title: msTitle.trim(), due_date: msDue || null, done: false,
      notes: msNotes || null, assigned_to: msAssignee || null, stage: msStage,
    } as any);
    if (error) toast.error(error.message);
    else {
      if (msAssignee) await notifyMilestoneAssignee(msAssignee, msTitle.trim(), msDue);
      setMsTitle(""); setMsDue(""); setMsNotes(""); setMsAssignee(""); reloadEditor();
    }
  }
  async function toggleMilestone(id: string, done: boolean) {
    await supabase.from("advisory_milestones").update({
      done, completed_at: done ? new Date().toISOString() : null,
      ...(done ? {} : { verified: false, verified_by: null, verified_at: null }),
    } as any).eq("id", id);
    reloadEditor();
  }
  async function verifyMilestone(m: any) {
    const next = !m.verified;
    if (next && !m.done) { toast.error("Mark the step complete before verifying."); return; }
    await supabase.from("advisory_milestones").update({
      verified: next, verified_by: next ? user?.id ?? null : null, verified_at: next ? new Date().toISOString() : null,
    } as any).eq("id", m.id);
    reloadEditor();
  }
  async function removeMilestone(id: string) {
    await supabase.from("advisory_milestones").delete().eq("id", id);
    reloadEditor();
  }
  function startEditMs(m: any) {
    setEditingMs(m.id);
    setEditMsData({ title: m.title, due_date: m.due_date ?? "", notes: m.notes ?? "", assigned_to: m.assigned_to ?? "", stage: m.stage ?? "onboarding" });
  }
  async function saveEditMs() {
    if (!editingMs) return;
    const original = milestoneEditor?.advisory_milestones?.find((m: any) => m.id === editingMs);
    const { error } = await supabase.from("advisory_milestones").update({
      title: editMsData.title, due_date: editMsData.due_date || null,
      notes: editMsData.notes || null, assigned_to: editMsData.assigned_to || null, stage: editMsData.stage || null,
    } as any).eq("id", editingMs);
    if (error) toast.error(error.message);
    else {
      if (editMsData.assigned_to && editMsData.assigned_to !== original?.assigned_to) {
        await notifyMilestoneAssignee(editMsData.assigned_to, editMsData.title, editMsData.due_date);
      }
      setEditingMs(null); reloadEditor();
    }
  }

  async function loadMilestoneDocs(milestoneId: string) {
    const { data } = await supabase.from("advisory_milestone_documents" as any).select("*").eq("milestone_id", milestoneId).order("created_at", { ascending: false });
    const rows = (data ?? []) as any[];
    const byId = new Map(staff.map(s => [s.id, s]));
    const enriched = rows.map(r => ({ ...r, uploader: r.uploaded_by ? byId.get(r.uploaded_by) ?? null : null }));
    setMilestoneDocs(d => ({ ...d, [milestoneId]: enriched }));
  }
  async function toggleExpandMs(milestoneId: string) {
    const next = !expandedMs[milestoneId];
    setExpandedMs(s => ({ ...s, [milestoneId]: next }));
    if (next && !milestoneDocs[milestoneId]) await loadMilestoneDocs(milestoneId);
  }
  async function uploadMsDoc(milestoneId: string, file: File) {
    if (!milestoneEditor) return;
    setUploadingMs(milestoneId);
    try {
      const path = `advisory/${milestoneEditor.id}/${milestoneId}/${Date.now()}-${file.name}`;
      const up = await supabase.storage.from("client-documents").upload(path, file);
      if (up.error) throw up.error;
      const { error } = await supabase.from("advisory_milestone_documents" as any).insert({
        milestone_id: milestoneId, title: file.name, file_path: path, uploaded_by: user?.id ?? null,
      });
      if (error) throw error;
      toast.success("Uploaded");
      await loadMilestoneDocs(milestoneId);
    } catch (e: any) {
      toast.error(e.message ?? String(e));
    } finally {
      setUploadingMs(null);
    }
  }
  async function verifyDoc(d: any, milestoneId: string) {
    const next = !d.verified;
    const { error } = await supabase.from("advisory_milestone_documents" as any).update({
      verified: next, verified_by: next ? user?.id ?? null : null, verified_at: next ? new Date().toISOString() : null,
    }).eq("id", d.id);
    if (error) toast.error(error.message); else await loadMilestoneDocs(milestoneId);
  }
  async function viewMsDoc(path: string, title: string) {
    const { data, error } = await supabase.storage.from("client-documents").createSignedUrl(path, 600);
    if (error) toast.error(error.message); else setPreview({ url: data.signedUrl, title });
  }
  async function downloadMsDoc(path: string) {
    const { data, error } = await supabase.storage.from("client-documents").createSignedUrl(path, 60);
    if (error) toast.error(error.message); else window.open(data.signedUrl, "_blank");
  }
  async function removeMsDoc(docId: string, path: string, milestoneId: string) {
    if (!confirm("Delete this document?")) return;
    await supabase.storage.from("client-documents").remove([path]);
    await supabase.from("advisory_milestone_documents" as any).delete().eq("id", docId);
    await loadMilestoneDocs(milestoneId);
  }

  const editorMs: any[] = milestoneEditor?.advisory_milestones ?? [];
  const editorClosed = milestoneEditor?.stage === "closed";
  const editorDone = editorMs.filter(m => m.done).length;
  const editorVerified = editorMs.filter(m => m.verified).length;

  const clientIds = Array.from(new Set(rows.map(r => r.client_id).filter(Boolean)));
  const clientRollup: ClientRollupRow[] = clients
    .filter(c => clientIds.includes(c.id))
    .map(c => {
      const list = rows.filter(r => r.client_id === c.id);
      return { id: c.id, company_name: c.company_name, count: list.length, open: list.filter(r => r.status !== "completed").length };
    });

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div><h1 className="text-2xl font-bold">Advisory</h1><p className="text-sm text-muted-foreground">Consultancy engagements tracked from kick-off to close-out.</p></div>
        {tab === "projects" && (
        <button onClick={() => setDialog({ mode: "new", data: { client_id: "", title: "", description: "", start_date: "", due_date: "", status: "not_started", stage: "onboarding" } })} className="h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm inline-flex items-center gap-2"><Plus className="h-4 w-4" /> New project</button>
        )}
      </div>

      <ModuleTabBar
        active={tab}
        onChange={setTab}
        tabs={[
          { key: "projects", label: "Projects", count: rows.length },
          { key: "clients", label: "Clients", count: clientRollup.length },
          { key: "billing", label: "Billing" },
          { key: "documents", label: "Documents" },
        ]}
      />

      {tab === "projects" && (
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
        {rows.length === 0 && <div className="bg-card border rounded-lg p-8 text-center text-muted-foreground text-sm col-span-full">No advisory projects yet.</div>}
        {rows.map(r => {
          const ms = r.advisory_milestones ?? [];
          const done = ms.filter((m: any) => m.done).length;
          const verified = ms.filter((m: any) => m.verified).length;
          const pct = ms.length ? Math.round((done / ms.length) * 100) : 0;
          const stageIdx = STAGES.findIndex(s => s.key === (r.stage ?? "onboarding"));
          return (
            <div key={r.id} className="bg-card border rounded-lg p-4 hover:border-primary/50 transition">
              <div className="flex justify-between items-start gap-2">
                <div className="flex-1 min-w-0">
                  <div className="font-semibold truncate">{r.title}</div>
                  <div className="text-xs text-muted-foreground truncate">{r.clients?.company_name}</div>
                </div>
                <span className={`text-xs px-2 py-1 rounded-full capitalize whitespace-nowrap ${STATUS_COLORS[r.status] || "bg-muted"}`}>{statusLabel(r.status)}</span>
              </div>
              <div className="mt-2 flex items-center gap-1.5 text-[11px]">
                <span className={`px-2 py-0.5 rounded-full ${r.stage === "closed" ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary"}`}>
                  {r.stage === "closed" ? "Closed" : `Stage ${stageIdx + 1}/5 · ${stageLabel(r.stage)}`}
                </span>
              </div>
              {r.description && <p className="text-sm text-muted-foreground mt-2 line-clamp-2">{r.description}</p>}
              <div className="mt-3 text-xs text-muted-foreground flex justify-between">
                <span>{done}/{ms.length} steps · {verified} verified</span>
                <span>{r.start_date ? `${formatDate(r.start_date)} → ` : ""}{formatDate(r.due_date)}</span>
              </div>
              {r.updated_at && <div className="mt-1 text-[10px] text-muted-foreground">Last updated {formatDateTime(r.updated_at)}</div>}
              <div className="mt-1 h-1.5 bg-muted rounded-full overflow-hidden"><div className="h-full bg-accent" style={{ width: `${pct}%` }} /></div>
              {r.client_id && (
                <div className="mt-2 flex items-center gap-2 text-xs">
                  <span className="text-muted-foreground">Team:</span>
                  <ClientAssignments clientId={r.client_id} compact />
                </div>
              )}
              <div className="mt-3 flex gap-2 text-xs">
                <button onClick={() => { setMilestoneEditor(r); setClosureNotes(r.closure_notes ?? ""); }} className="text-primary hover:underline">Open workspace</button>
                <button onClick={() => setDialog({ mode: "edit", data: r })} className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1"><Pencil className="h-3 w-3" /> Edit</button>
                {isAdmin && <button onClick={() => remove(r.id)} className="text-destructive ml-auto inline-flex items-center gap-1"><Trash2 className="h-3 w-3" /> Delete</button>}
              </div>
            </div>
          );
        })}
      </div>
      )}

      {tab === "clients" && <ClientsRollupTab rows={clientRollup} noun="projects" />}
      {tab === "billing" && <BillingTab serviceLine="Advisory" />}
      {tab === "documents" && <DocumentsTab clientIds={clientIds} />}

      {dialog && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setDialog(null)}>
          <div onClick={e => e.stopPropagation()} className="bg-card w-full max-w-md rounded-lg p-6 space-y-3">
            <div className="flex justify-between"><h2 className="text-lg font-semibold">{dialog.mode === "new" ? "New advisory project" : "Edit project"}</h2><button onClick={() => setDialog(null)}><X className="h-4 w-4" /></button></div>
            <select value={dialog.data.client_id} onChange={e => setDialog({ ...dialog, data: { ...dialog.data, client_id: e.target.value } })} className="w-full h-9 px-3 rounded-md border bg-background text-sm">
              <option value="">Select client…</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
            </select>
            <input placeholder="Title *" value={dialog.data.title} onChange={e => setDialog({ ...dialog, data: { ...dialog.data, title: e.target.value } })} className="w-full h-9 px-3 rounded-md border bg-background text-sm" />
            <textarea placeholder="Scope / description" value={dialog.data.description ?? ""} onChange={e => setDialog({ ...dialog, data: { ...dialog.data, description: e.target.value } })} rows={3} className="w-full px-3 py-2 rounded-md border bg-background text-sm" />
            <div className="grid grid-cols-2 gap-2">
              <select value={dialog.data.status} onChange={e => setDialog({ ...dialog, data: { ...dialog.data, status: e.target.value } })} className="h-9 px-3 rounded-md border bg-background text-sm capitalize">
                {STATUSES.map(s => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
              </select>
              <select value={dialog.data.stage ?? "onboarding"} onChange={e => setDialog({ ...dialog, data: { ...dialog.data, stage: e.target.value } })} className="h-9 px-3 rounded-md border bg-background text-sm">
                {STAGES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs text-muted-foreground">Start date
                <input type="date" value={dialog.data.start_date ?? ""} onChange={e => setDialog({ ...dialog, data: { ...dialog.data, start_date: e.target.value } })} className="mt-1 w-full h-9 px-3 rounded-md border bg-background text-sm" />
              </label>
              <label className="text-xs text-muted-foreground">Target close
                <input type="date" value={dialog.data.due_date ?? ""} onChange={e => setDialog({ ...dialog, data: { ...dialog.data, due_date: e.target.value } })} className="mt-1 w-full h-9 px-3 rounded-md border bg-background text-sm" />
              </label>
            </div>
            <button onClick={save} className="w-full h-10 rounded-md bg-primary text-primary-foreground text-sm font-medium">Save</button>
          </div>
        </div>
      )}

      {milestoneEditor && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setMilestoneEditor(null)}>
          <div onClick={e => e.stopPropagation()} className="bg-card w-full max-w-3xl rounded-lg p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-start">
              <div>
                <h2 className="text-lg font-semibold">{milestoneEditor.title}</h2>
                <p className="text-xs text-muted-foreground">{milestoneEditor.clients?.company_name} · Started {formatDate(milestoneEditor.start_date)} · Target {formatDate(milestoneEditor.due_date)}</p>
              </div>
              <button onClick={() => setMilestoneEditor(null)}><X className="h-4 w-4" /></button>
            </div>

            {/* Stage pipeline */}
            <div className="border rounded-md p-3">
              <div className="text-xs font-medium text-muted-foreground mb-2">Progress stage</div>
              <div className="flex flex-wrap gap-1.5">
                {STAGES.filter(s => s.key !== "closed").map((s, i) => {
                  const current = (milestoneEditor.stage ?? "onboarding") === s.key;
                  const passed = STAGES.findIndex(x => x.key === (milestoneEditor.stage ?? "onboarding")) > i;
                  return (
                    <button key={s.key} disabled={editorClosed} onClick={() => setStage(s.key)}
                      className={`text-xs px-2.5 py-1 rounded-full border transition disabled:opacity-50 ${current ? "bg-primary text-primary-foreground border-primary" : passed ? "bg-accent/20 border-accent/40" : "bg-background hover:border-primary/50"}`}>
                      {i + 1}. {s.label}
                    </button>
                  );
                })}
              </div>
              <div className="mt-2 text-xs text-muted-foreground">{editorDone}/{editorMs.length} steps complete · {editorVerified} verified</div>
            </div>

            <div className="space-y-2 max-h-96 overflow-auto">
              <div className="text-xs font-medium text-muted-foreground">Steps, documents & verification</div>
              {editorMs.length === 0 && <p className="text-sm text-muted-foreground">No steps recorded yet.</p>}
              {editorMs.map((m: any) => {
                const assigneeName = staff.find(s => s.id === m.assigned_to)?.full_name;
                if (editingMs === m.id) {
                  return (
                    <div key={m.id} className="border rounded-md p-2 space-y-2 bg-muted/20">
                      <input value={editMsData.title} onChange={e => setEditMsData({ ...editMsData, title: e.target.value })} className="w-full h-8 px-2 rounded border bg-background text-sm" />
                      <div className="grid grid-cols-3 gap-2">
                        <input type="date" value={editMsData.due_date} onChange={e => setEditMsData({ ...editMsData, due_date: e.target.value })} className="h-8 px-2 rounded border bg-background text-sm" />
                        <select value={editMsData.assigned_to} onChange={e => setEditMsData({ ...editMsData, assigned_to: e.target.value })} className="h-8 px-2 rounded border bg-background text-sm">
                          <option value="">— Unassigned —</option>
                          {staff.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
                        </select>
                        <select value={editMsData.stage} onChange={e => setEditMsData({ ...editMsData, stage: e.target.value })} className="h-8 px-2 rounded border bg-background text-sm">
                          {STAGES.filter(s => s.key !== "closed").map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                        </select>
                      </div>
                      <textarea placeholder="Notes / action taken" value={editMsData.notes} onChange={e => setEditMsData({ ...editMsData, notes: e.target.value })} rows={2} className="w-full px-2 py-1 rounded border bg-background text-sm" />
                      <div className="flex justify-end gap-2">
                        <button onClick={() => setEditingMs(null)} className="text-xs text-muted-foreground">Cancel</button>
                        <button onClick={saveEditMs} className="text-xs px-2 py-1 rounded bg-primary text-primary-foreground">Save</button>
                      </div>
                    </div>
                  );
                }
                return (
                  <div key={m.id} className="py-2 border-b last:border-0">
                    <div className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={m.done} disabled={editorClosed} onChange={e => toggleMilestone(m.id, e.target.checked)} />
                      <button onClick={() => toggleExpandMs(m.id)} className="text-muted-foreground hover:text-foreground" title="Documents">
                        {expandedMs[m.id] ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                      </button>
                      <div className={`flex-1 ${m.done ? "line-through text-muted-foreground" : ""}`}>{m.title}</div>
                      {m.stage && <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted whitespace-nowrap">{stageLabel(m.stage)}</span>}
                      {(milestoneDocs[m.id]?.length ?? 0) > 0 && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted inline-flex items-center gap-1"><FileText className="h-3 w-3" />{milestoneDocs[m.id].length}</span>
                      )}
                      <span className="text-xs text-muted-foreground">{formatDate(m.due_date)}</span>
                      <button onClick={() => verifyMilestone(m)} disabled={editorClosed} title={m.verified ? "Remove verification" : "Verify this step"}
                        className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border disabled:opacity-50 ${m.verified ? "bg-accent/20 border-accent/40 text-foreground" : "text-muted-foreground"}`}>
                        <ShieldCheck className="h-3 w-3" />{m.verified ? "Verified" : "Verify"}
                      </button>
                      <button onClick={() => startEditMs(m)} className="text-muted-foreground hover:text-primary"><Pencil className="h-3.5 w-3.5" /></button>
                      <button onClick={() => removeMilestone(m.id)} className="text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>
                    </div>
                    {(assigneeName || m.notes || m.completed_at || m.verified) && (
                      <div className="ml-6 mt-1 text-xs text-muted-foreground space-y-0.5">
                        <div>
                          {assigneeName && <span>👤 {assigneeName}</span>}
                          {assigneeName && m.notes && <span> · </span>}
                          {m.notes && <span className="whitespace-pre-wrap">{m.notes}</span>}
                        </div>
                        {m.completed_at && <div>Completed {fmtDateTime(m.completed_at)}</div>}
                        {m.verified && <div className="inline-flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> Verified by {staffName(m.verified_by)} · {fmtDateTime(m.verified_at)}</div>}
                      </div>
                    )}
                    {expandedMs[m.id] && (
                      <div className="ml-6 mt-2 border rounded-md p-2 bg-muted/20 space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="text-xs font-medium">Documents</div>
                          <label className={`text-xs inline-flex items-center gap-1 px-2 py-1 rounded bg-primary text-primary-foreground cursor-pointer ${uploadingMs === m.id ? "opacity-60" : ""}`}>
                            <Upload className="h-3 w-3" /> {uploadingMs === m.id ? "Uploading…" : "Upload"}
                            <input type="file" hidden disabled={uploadingMs === m.id} onChange={e => { const f = e.target.files?.[0]; if (f) uploadMsDoc(m.id, f); e.target.value = ""; }} />
                          </label>
                        </div>
                        {(milestoneDocs[m.id] ?? []).length === 0 ? (
                          <div className="text-xs text-muted-foreground py-1">No documents yet.</div>
                        ) : (
                          <div className="divide-y">
                            {milestoneDocs[m.id].map((d: any) => (
                              <div key={d.id} className="flex items-center gap-2 py-1.5 text-xs">
                                <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                <div className="flex-1 truncate">
                                  <div>{d.title}</div>
                                  <div className="text-[10px] text-muted-foreground">
                                    {d.uploader?.full_name ?? "Unknown"} · {formatDate(d.created_at)}
                                    {d.verified && <> · ✔ verified by {staffName(d.verified_by)} {fmtDateTime(d.verified_at)}</>}
                                  </div>
                                </div>
                                <button onClick={() => verifyDoc(d, m.id)} className={`inline-flex items-center gap-1 ${d.verified ? "text-accent-foreground" : "text-muted-foreground"}`}>
                                  <ShieldCheck className="h-3 w-3" />{d.verified ? "Unverify" : "Verify"}
                                </button>
                                <button onClick={() => viewMsDoc(d.file_path, d.title)} className="text-primary inline-flex items-center gap-1"><Eye className="h-3 w-3" />View</button>
                                <button onClick={() => downloadMsDoc(d.file_path)} className="text-primary inline-flex items-center gap-1"><Download className="h-3 w-3" />Get</button>
                                {isAdmin && <button onClick={() => removeMsDoc(d.id, d.file_path, m.id)} className="text-destructive"><Trash2 className="h-3 w-3" /></button>}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {!editorClosed && (
              <div className="border-t pt-3 space-y-2">
                <div className="text-xs font-medium text-muted-foreground">Add step / action</div>
                <input placeholder="Title *" value={msTitle} onChange={e => setMsTitle(e.target.value)} className="w-full h-9 px-3 rounded-md border bg-background text-sm" />
                <div className="grid grid-cols-3 gap-2">
                  <input type="date" value={msDue} onChange={e => setMsDue(e.target.value)} className="h-9 px-3 rounded-md border bg-background text-sm" />
                  <select value={msAssignee} onChange={e => setMsAssignee(e.target.value)} className="h-9 px-3 rounded-md border bg-background text-sm">
                    <option value="">Assign to…</option>
                    {staff.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
                  </select>
                  <select value={msStage} onChange={e => setMsStage(e.target.value)} className="h-9 px-3 rounded-md border bg-background text-sm">
                    {STAGES.filter(s => s.key !== "closed").map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                  </select>
                </div>
                <textarea placeholder="Notes / action taken" value={msNotes} onChange={e => setMsNotes(e.target.value)} rows={2} className="w-full px-3 py-2 rounded-md border bg-background text-sm" />
                <button onClick={addMilestone} className="w-full h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm">Add</button>
              </div>
            )}

            {/* Close-out */}
            <div className="border-t pt-3 space-y-2">
              <div className="text-xs font-medium text-muted-foreground inline-flex items-center gap-1"><Lock className="h-3 w-3" /> Close-out</div>
              {editorClosed ? (
                <div className="text-xs text-muted-foreground space-y-1">
                  <div>Closed by {staffName(milestoneEditor.closed_by)} on {fmtDateTime(milestoneEditor.closed_at)}</div>
                  {milestoneEditor.closure_notes && <div className="whitespace-pre-wrap border rounded-md p-2 bg-muted/20">{milestoneEditor.closure_notes}</div>}
                  <button onClick={reopenProject} className="h-8 px-3 rounded-md border text-xs">Reopen project</button>
                </div>
              ) : (
                <>
                  <textarea placeholder="Closing summary: outcome, deliverables issued, client sign-off…" value={closureNotes} onChange={e => setClosureNotes(e.target.value)} rows={3} className="w-full px-3 py-2 rounded-md border bg-background text-sm" />
                  <button onClick={closeProject} className="w-full h-9 rounded-md bg-accent text-accent-foreground text-sm font-medium">Close project</button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {preview && (
        <div className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center p-4" onClick={() => setPreview(null)}>
          <div onClick={e => e.stopPropagation()} className="bg-card w-full max-w-5xl h-[90vh] rounded-lg flex flex-col overflow-hidden">
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
