import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Plus, X, Trash2, Pencil, Upload, FileText, Eye, Download, ChevronDown, ChevronRight,
  ShieldCheck, Lock, CheckCircle2, Users, Wallet, FolderOpen, LayoutGrid,
} from "lucide-react";
import { formatDate, STATUS_COLORS, statusLabel } from "@/lib/format";
import { ClientAssignments } from "@/components/client-assignments";
import { CompletionInvoiceDialog, LinkedInvoice } from "@/components/completion-invoice-dialog";
import { useAuth } from "@/lib/auth";
import { serviceLineFor } from "@/lib/service-lines";

export type ServiceModuleKey =
  | "ict"
  | "outsourced_accounting"
  | "payroll_management"
  | "financial_business_management";

const STATUSES = ["not_started", "in_progress", "under_review", "completed"];

const DEFAULT_STAGES = [
  { key: "kickoff", label: "Kick-off" },
  { key: "information", label: "Information gathering" },
  { key: "analysis", label: "Analysis & setup" },
  { key: "draft", label: "Draft deliverable" },
  { key: "review", label: "Internal review" },
  { key: "signoff", label: "Client sign-off" },
  { key: "closed", label: "Closed" },
];

// Onboard client -> collect requirements -> define scope -> assign staff ->
// monitor progress & record activity -> invoicing -> closing. Used by
// Outsourced Accounting, Payroll Management and Financial Business
// Management (ICT keeps the default deliverable-based pipeline above).
export const CLIENT_ENGAGEMENT_STAGES = [
  { key: "onboarding", label: "Onboarding" },
  { key: "requirements", label: "Requirements" },
  { key: "scope", label: "Scope" },
  { key: "assignment", label: "Assignment" },
  { key: "monitoring", label: "Monitoring" },
  { key: "invoicing", label: "Invoicing" },
  { key: "closed", label: "Closed" },
];
const MILESTONE_SELECT = "id, title, due_date, done, notes, assigned_to, stage, completed_at, verified, verified_by, verified_at";
const PROJECT_SELECT = `*, clients(company_name), service_milestones(${MILESTONE_SELECT})`;

function fmtDateTime(v?: string | null) {
  if (!v) return "—";
  return new Date(v).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function ServiceModulePage({
  moduleKey,
  moduleLabel,
  tagline,
  stages = DEFAULT_STAGES,
  projectTemplates = [],
}: {
  moduleKey: ServiceModuleKey;
  moduleLabel: string;
  tagline: string;
  stages?: { key: string; label: string }[];
  projectTemplates?: { serviceType: string; label: string; description: string; milestones: { title: string; stage: string }[] }[];
}) {
  const { isAdmin, user } = useAuth();
  const STAGES = stages;
  const defaultStageKey = STAGES[0]?.key ?? "kickoff";
  const reopenStageKey = STAGES.length > 1 ? STAGES[STAGES.length - 2].key : defaultStageKey;
  const stageLabel = (k?: string | null) => STAGES.find(s => s.key === k)?.label ?? (STAGES[0]?.label ?? "Stage 1");
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
  const [msStage, setMsStage] = useState(defaultStageKey);
  const [editingMs, setEditingMs] = useState<string | null>(null);
  const [editMsData, setEditMsData] = useState<any>({});
  const [milestoneDocs, setMilestoneDocs] = useState<Record<string, any[]>>({});
  const [expandedMs, setExpandedMs] = useState<Record<string, boolean>>({});
  const [uploadingMs, setUploadingMs] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ url: string; title: string } | null>(null);
  const [closureNotes, setClosureNotes] = useState("");
  const [closeInvoiceOpen, setCloseInvoiceOpen] = useState(false);

  const [invoices, setInvoices] = useState<any[]>([]);
  const [docs, setDocs] = useState<any[]>([]);

  async function load() {
    const [p, c, s] = await Promise.all([
      supabase.from("service_projects" as any).select(PROJECT_SELECT).eq("module", moduleKey).order("updated_at", { ascending: false }).order("created_at", { ascending: false }),
      supabase.from("clients").select("id, company_name").order("company_name"),
      supabase.from("profiles").select("id, full_name"),
    ]);
    setRows((p.data as any[]) ?? []); setClients(c.data ?? []); setStaff(s.data ?? []);
  }
  useEffect(() => { load(); }, [moduleKey]);

  const moduleClientIds = Array.from(new Set(rows.map(r => r.client_id).filter(Boolean)));

  async function loadBilling() {
    const { data, error } = await supabase.from("invoices").select("*, clients(company_name)").eq("service_line", serviceLineFor(moduleKey)).order("updated_at", { ascending: false }).order("issue_date", { ascending: false });
    if (error) toast.error(error.message); else setInvoices(data ?? []);
  }
  async function loadDocuments() {
    if (moduleClientIds.length === 0) { setDocs([]); return; }
    const { data, error } = await supabase.from("documents").select("*, clients(company_name)").in("client_id", moduleClientIds).order("updated_at", { ascending: false }).order("created_at", { ascending: false });
    if (error) toast.error(error.message); else setDocs(data ?? []);
  }
  useEffect(() => {
    if (tab === "billing") loadBilling();
    if (tab === "documents") loadDocuments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, rows.length]);

  const staffName = (id?: string | null) => (id ? staff.find(s => s.id === id)?.full_name ?? "Unknown" : "—");

  async function save() {
    if (!dialog) return;
    const { id, clients: _c, service_milestones: _m, invoice_id: _inv, ...payload } = dialog.data;
    if (!payload.client_id || !payload.title) { toast.error("Client and title required"); return; }
    if (dialog.mode === "edit" && payload.status === "completed" && rows.find(r => r.id === id)?.status !== "completed" && !_inv) {
      toast.error("Use Close project in the project's close-out section — an invoice must be generated to complete it."); return;
    }
    if (dialog.mode === "new") {
      const { data: created, error } = await (supabase.from("service_projects" as any)
        .insert({ ...payload, module: moduleKey }) as any).select("id").single();
      if (error) { toast.error(error.message); return; }
      const selectedTemplate = projectTemplates.find(t => t.serviceType === payload.service_type);
      if (selectedTemplate?.milestones.length) {
        const milestoneRows = selectedTemplate.milestones.map((m) => ({
          project_id: created.id,
          title: m.title,
          stage: m.stage,
          done: false,
          notes: `Generated from the ${selectedTemplate.label} project template.`,
        }));
        const { error: milestoneError } = await (supabase.from("service_milestones" as any) as any).insert(milestoneRows);
        if (milestoneError) {
          toast.error(`Project created, but template steps could not be added: ${milestoneError.message}`);
          setDialog(null); load(); return;
        }
      }
      toast.success(selectedTemplate?.milestones.length ? `Project created with ${selectedTemplate.milestones.length} template steps` : "Saved");
      setDialog(null); load();
      return;
    }
    const { error } = await supabase.from("service_projects" as any).update(payload).eq("id", id);
    if (error) toast.error(error.message);
    else { toast.success("Saved"); setDialog(null); load(); }
  }

  async function remove(id: string) {
    if (!confirm(`Delete this ${moduleLabel} project?`)) return;
    await supabase.from("service_milestones" as any).delete().eq("project_id", id);
    const { error } = await supabase.from("service_projects" as any).delete().eq("id", id);
    if (error) toast.error(error.message); else { toast.success("Deleted"); load(); }
  }

  async function reloadEditor() {
    if (!milestoneEditor) return;
    const p = await supabase.from("service_projects" as any).select(PROJECT_SELECT).eq("id", milestoneEditor.id).maybeSingle();
    setMilestoneEditor(p.data); load();
  }

  async function setStage(stage: string) {
    if (!milestoneEditor) return;
    if (stage === "closed") { toast.error("Use the close-out section to close this project."); return; }
    const { error } = await supabase.from("service_projects" as any).update({ stage }).eq("id", milestoneEditor.id);
    if (error) toast.error(error.message); else reloadEditor();
  }

  async function closeProject() {
    if (!milestoneEditor) return;
    const ms = milestoneEditor.service_milestones ?? [];
    const open = ms.filter((m: any) => !m.done);
    if (open.length && !confirm(`${open.length} step(s) are still open. Close anyway?`)) return;
    // Billable work can't be closed without an invoice under the client.
    if (!milestoneEditor.invoice_id) { setCloseInvoiceOpen(true); return; }
    await finishClose();
  }
  async function finishClose() {
    if (!milestoneEditor) return;
    const { error } = await supabase.from("service_projects" as any).update({
      stage: "closed", status: "completed", closure_notes: closureNotes || null,
      closed_at: new Date().toISOString(), closed_by: user?.id ?? null,
    }).eq("id", milestoneEditor.id);
    if (error) toast.error(error.message);
    else { toast.success("Project closed"); setClosureNotes(""); reloadEditor(); }
  }
  async function reopenProject() {
    if (!milestoneEditor) return;
    const { error } = await supabase.from("service_projects" as any).update({
      stage: reopenStageKey, status: "in_progress", closed_at: null, closed_by: null,
    }).eq("id", milestoneEditor.id);
    if (error) toast.error(error.message); else { toast.success("Reopened"); reloadEditor(); }
  }

  async function notifyMilestoneAssignee(assigneeId: string, title: string, dueDate?: string | null) {
    if (!assigneeId) return;
    const clientName = milestoneEditor?.clients?.company_name;
    const link = `/${moduleKey.replace(/_/g, "-")}`;

    // Give the assignee a task so it shows up on their dashboard / task list.
    await supabase.from("tasks").insert({
      title: `${title} — ${moduleLabel}`,
      description: clientName ? `Step in ${moduleLabel} engagement for ${clientName}.` : `Step in ${moduleLabel} engagement.`,
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
      body: clientName ? `${title} — ${moduleLabel} (${clientName})` : `${title} — ${moduleLabel}`,
      link,
    });
  }

  async function addMilestone() {
    if (!milestoneEditor || !msTitle.trim()) return;
    const { error } = await supabase.from("service_milestones" as any).insert({
      project_id: milestoneEditor.id, title: msTitle.trim(), due_date: msDue || null, done: false,
      notes: msNotes || null, assigned_to: msAssignee || null, stage: msStage,
    });
    if (error) toast.error(error.message);
    else {
      if (msAssignee) await notifyMilestoneAssignee(msAssignee, msTitle.trim(), msDue);
      setMsTitle(""); setMsDue(""); setMsNotes(""); setMsAssignee(""); reloadEditor();
    }
  }
  async function toggleMilestone(id: string, done: boolean) {
    await supabase.from("service_milestones" as any).update({
      done, completed_at: done ? new Date().toISOString() : null,
      ...(done ? {} : { verified: false, verified_by: null, verified_at: null }),
    }).eq("id", id);
    reloadEditor();
  }
  async function verifyMilestone(m: any) {
    const next = !m.verified;
    if (next && !m.done) { toast.error("Mark the step complete before verifying."); return; }
    await supabase.from("service_milestones" as any).update({
      verified: next, verified_by: next ? user?.id ?? null : null, verified_at: next ? new Date().toISOString() : null,
    }).eq("id", m.id);
    reloadEditor();
  }
  async function removeMilestone(id: string) {
    await supabase.from("service_milestones" as any).delete().eq("id", id);
    reloadEditor();
  }
  function startEditMs(m: any) {
    setEditingMs(m.id);
    setEditMsData({ title: m.title, due_date: m.due_date ?? "", notes: m.notes ?? "", assigned_to: m.assigned_to ?? "", stage: m.stage ?? defaultStageKey });
  }
  async function saveEditMs() {
    if (!editingMs) return;
    const original = milestoneEditor?.service_milestones?.find((m: any) => m.id === editingMs);
    const { error } = await supabase.from("service_milestones" as any).update({
      title: editMsData.title, due_date: editMsData.due_date || null,
      notes: editMsData.notes || null, assigned_to: editMsData.assigned_to || null, stage: editMsData.stage || null,
    }).eq("id", editingMs);
    if (error) toast.error(error.message);
    else {
      if (editMsData.assigned_to && editMsData.assigned_to !== original?.assigned_to) {
        await notifyMilestoneAssignee(editMsData.assigned_to, editMsData.title, editMsData.due_date);
      }
      setEditingMs(null); reloadEditor();
    }
  }

  async function loadMilestoneDocs(milestoneId: string) {
    const { data } = await supabase.from("service_milestone_documents" as any).select("*").eq("milestone_id", milestoneId).order("created_at", { ascending: false });
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
      const path = `${moduleKey}/${milestoneEditor.id}/${milestoneId}/${Date.now()}-${file.name}`;
      const up = await supabase.storage.from("client-documents").upload(path, file);
      if (up.error) throw up.error;
      const { error } = await supabase.from("service_milestone_documents" as any).insert({
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
    const { error } = await supabase.from("service_milestone_documents" as any).update({
      verified: next, verified_by: next ? user?.id ?? null : null, verified_at: next ? new Date().toISOString() : null,
    }).eq("id", d.id);
    if (error) toast.error(error.message); else await loadMilestoneDocs(milestoneId);
  }
  async function viewDoc(path: string, title: string) {
    const { data, error } = await supabase.storage.from("client-documents").createSignedUrl(path, 600);
    if (error) toast.error(error.message); else setPreview({ url: data.signedUrl, title });
  }
  async function downloadDoc(path: string) {
    const { data, error } = await supabase.storage.from("client-documents").createSignedUrl(path, 60);
    if (error) toast.error(error.message); else window.open(data.signedUrl, "_blank");
  }
  async function removeMsDoc(docId: string, path: string, milestoneId: string) {
    if (!confirm("Delete this document?")) return;
    await supabase.storage.from("client-documents").remove([path]);
    await supabase.from("service_milestone_documents" as any).delete().eq("id", docId);
    await loadMilestoneDocs(milestoneId);
  }

  const editorMs: any[] = milestoneEditor?.service_milestones ?? [];
  const editorClosed = milestoneEditor?.stage === "closed";
  const editorDone = editorMs.filter(m => m.done).length;
  const editorVerified = editorMs.filter(m => m.verified).length;

  const clientRollup = clients
    .filter(c => moduleClientIds.includes(c.id))
    .map(c => {
      const projects = rows.filter(r => r.client_id === c.id);
      const open = projects.filter(p => p.status !== "completed").length;
      return { ...c, projectCount: projects.length, open };
    });

  const TABS = [
    { key: "projects", label: "Projects", icon: LayoutGrid },
    { key: "clients", label: "Clients", icon: Users },
    { key: "billing", label: "Billing", icon: Wallet },
    { key: "documents", label: "Documents", icon: FolderOpen },
  ] as const;

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">{moduleLabel}</h1>
          <p className="text-sm text-muted-foreground">{tagline}</p>
        </div>
        {tab === "projects" && (
          <button onClick={() => setDialog({ mode: "new", data: { client_id: "", title: "", description: "", start_date: "", due_date: "", status: "not_started", stage: defaultStageKey, service_type: projectTemplates[0]?.serviceType ?? "general" } })} className="h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm inline-flex items-center gap-2"><Plus className="h-4 w-4" /> New project</button>
        )}
      </div>

      <div className="flex gap-1 border-b overflow-x-auto">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm border-b-2 -mb-px whitespace-nowrap ${tab === t.key ? "border-primary text-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            <t.icon className="h-3.5 w-3.5" /> {t.label}
            {t.key === "projects" && <span className="ml-1 text-xs">({rows.length})</span>}
            {t.key === "clients" && <span className="ml-1 text-xs">({clientRollup.length})</span>}
          </button>
        ))}
      </div>

      {tab === "projects" && (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
          {rows.length === 0 && <div className="bg-card border rounded-lg p-8 text-center text-muted-foreground text-sm col-span-full">No {moduleLabel.toLowerCase()} projects yet.</div>}
          {rows.map(r => {
            const ms = r.service_milestones ?? [];
            const done = ms.filter((m: any) => m.done).length;
            const verified = ms.filter((m: any) => m.verified).length;
            const pct = ms.length ? Math.round((done / ms.length) * 100) : 0;
            const stageIdx = STAGES.findIndex(s => s.key === (r.stage ?? defaultStageKey));
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
                    {r.stage === "closed" ? "Closed" : `Stage ${stageIdx + 1}/${STAGES.length - 1} · ${stageLabel(r.stage)}`}
                  </span>
                </div>
                {r.description && <p className="text-sm text-muted-foreground mt-2 line-clamp-2">{r.description}</p>}
                <div className="mt-3 text-xs text-muted-foreground flex justify-between">
                  <span>{done}/{ms.length} steps · {verified} verified</span>
                  <span>{r.start_date ? `${formatDate(r.start_date)} → ` : ""}{formatDate(r.due_date)}</span>
                </div>
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

      {tab === "clients" && (
        <div className="bg-card border rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground border-b bg-muted/40">
                <tr><th className="py-2 px-3">Client</th><th>Projects</th><th>Open</th><th>Team</th></tr>
              </thead>
              <tbody>
                {clientRollup.length === 0 && <tr><td colSpan={4} className="py-10 text-center text-muted-foreground">No clients on {moduleLabel} yet.</td></tr>}
                {clientRollup.map(c => (
                  <tr key={c.id} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="py-2 px-3 font-medium">{c.company_name}</td>
                    <td>{c.projectCount}</td>
                    <td>{c.open}</td>
                    <td className="py-2 px-3"><ClientAssignments clientId={c.id} compact /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "billing" && (
        <div className="bg-card border rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground border-b bg-muted/40">
                <tr><th className="py-2 px-3">Client</th><th>Invoice</th><th>Issued</th><th>Due</th><th>Total</th><th>Paid</th><th>Status</th></tr>
              </thead>
              <tbody>
                {invoices.length === 0 && <tr><td colSpan={7} className="py-10 text-center text-muted-foreground">No invoices tagged “{moduleLabel}” yet. Set the Service Line to “{moduleLabel}” when creating an invoice in Accounts.</td></tr>}
                {invoices.map(inv => (
                  <tr key={inv.id} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="py-2 px-3 font-medium">{inv.clients?.company_name}</td>
                    <td>{inv.invoice_number}</td>
                    <td>{formatDate(inv.issue_date)}</td>
                    <td>{formatDate(inv.due_date)}</td>
                    <td>{Number(inv.total ?? 0).toLocaleString()}</td>
                    <td>{Number(inv.amount_paid ?? 0).toLocaleString()}</td>
                    <td><span className={`text-xs px-2 py-1 rounded-full capitalize ${STATUS_COLORS[inv.status] || "bg-muted"}`}>{inv.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "documents" && (
        <div className="bg-card border rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground border-b bg-muted/40">
                <tr><th className="py-2 px-3">Title</th><th>Client</th><th>Uploaded</th><th></th></tr>
              </thead>
              <tbody>
                {docs.length === 0 && <tr><td colSpan={4} className="py-10 text-center text-muted-foreground">No client documents for {moduleLabel} clients yet. Project-level documents live inside each project's workspace.</td></tr>}
                {docs.map(d => (
                  <tr key={d.id} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="py-2 px-3 inline-flex items-center gap-2"><FileText className="h-4 w-4 text-muted-foreground" />{d.title}</td>
                    <td>{d.clients?.company_name}</td>
                    <td className="text-xs text-muted-foreground">{formatDate(d.created_at)}</td>
                    <td className="text-right pr-3 space-x-2 whitespace-nowrap">
                      <button onClick={() => viewDoc(d.file_path, d.title)} className="text-primary text-xs inline-flex items-center gap-1"><Eye className="h-3 w-3" />View</button>
                      <button onClick={() => downloadDoc(d.file_path)} className="text-primary text-xs inline-flex items-center gap-1"><Download className="h-3 w-3" />Download</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {dialog && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setDialog(null)}>
          <div onClick={e => e.stopPropagation()} className="bg-card w-full max-w-md rounded-lg p-6 space-y-3">
            <div className="flex justify-between"><h2 className="text-lg font-semibold">{dialog.mode === "new" ? `New ${moduleLabel} project` : "Edit project"}</h2><button onClick={() => setDialog(null)}><X className="h-4 w-4" /></button></div>
            {dialog.mode === "new" && projectTemplates.length > 0 && (
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">ICT project template</label>
                <select value={dialog.data.service_type ?? projectTemplates[0].serviceType} onChange={e => {
                  const template = projectTemplates.find(t => t.serviceType === e.target.value);
                  setDialog({ ...dialog, data: { ...dialog.data, service_type: e.target.value, description: template?.description ?? dialog.data.description, title: dialog.data.title || template?.label || "" } });
                }} className="w-full h-9 px-3 rounded-md border bg-background text-sm">
                  {projectTemplates.map(t => <option key={t.serviceType} value={t.serviceType}>{t.label}</option>)}
                </select>
                <p className="text-xs text-muted-foreground">A starter checklist will be created automatically. You can edit the steps in the project workspace.</p>
              </div>
            )}
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
              <select value={dialog.data.stage ?? defaultStageKey} onChange={e => setDialog({ ...dialog, data: { ...dialog.data, stage: e.target.value } })} className="h-9 px-3 rounded-md border bg-background text-sm">
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

            <div className="border rounded-md p-3">
              <div className="text-xs font-medium text-muted-foreground mb-2">Progress stage</div>
              <div className="flex flex-wrap gap-1.5">
                {STAGES.filter(s => s.key !== "closed").map((s, i) => {
                  const current = (milestoneEditor.stage ?? defaultStageKey) === s.key;
                  const passed = STAGES.findIndex(x => x.key === (milestoneEditor.stage ?? defaultStageKey)) > i;
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
                                <button onClick={() => viewDoc(d.file_path, d.title)} className="text-primary inline-flex items-center gap-1"><Eye className="h-3 w-3" />View</button>
                                <button onClick={() => downloadDoc(d.file_path)} className="text-primary inline-flex items-center gap-1"><Download className="h-3 w-3" />Get</button>
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

            <div className="border-t pt-3 space-y-2">
              <div className="text-xs font-medium text-muted-foreground inline-flex items-center gap-1"><Lock className="h-3 w-3" /> Close-out</div>
              {editorClosed ? (
                <div className="text-xs text-muted-foreground space-y-1">
                  <div>Closed by {staffName(milestoneEditor.closed_by)} on {fmtDateTime(milestoneEditor.closed_at)}</div>
                  <div className="flex items-center gap-2">Invoice: <LinkedInvoice invoiceId={milestoneEditor.invoice_id} /></div>
                  {milestoneEditor.closure_notes && <div className="whitespace-pre-wrap border rounded-md p-2 bg-muted/20">{milestoneEditor.closure_notes}</div>}
                  <button onClick={reopenProject} className="h-8 px-3 rounded-md border text-xs">Reopen project</button>
                </div>
              ) : (
                <>
                  <textarea placeholder="Closing summary: outcome, deliverables issued, client sign-off…" value={closureNotes} onChange={e => setClosureNotes(e.target.value)} rows={3} className="w-full px-3 py-2 rounded-md border bg-background text-sm" />
                  {!milestoneEditor.invoice_id && <p className="text-[11px] text-muted-foreground">An invoice must be generated under the client to close this project.</p>}
                  <button onClick={closeProject} className="w-full h-9 rounded-md bg-accent text-accent-foreground text-sm font-medium">{milestoneEditor.invoice_id ? "Close project" : "Generate invoice & close project"}</button>
                  <CompletionInvoiceDialog
                    open={closeInvoiceOpen}
                    onOpenChange={setCloseInvoiceOpen}
                    source="service_projects"
                    sourceId={milestoneEditor.id}
                    clientName={milestoneEditor.clients?.company_name}
                    defaultDescription={`${moduleLabel} — ${milestoneEditor.title}`}
                    onInvoiced={finishClose}
                  />
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
