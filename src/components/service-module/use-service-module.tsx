import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { notifyUser } from "@/lib/notify";
import { signedClientFileUrl, openClientFile } from "@/lib/client-files";
import { useAuth } from "@/lib/auth";
import { Users, Wallet, FolderOpen, LayoutGrid } from "lucide-react";
import { useRouterState } from "@tanstack/react-router";
import { serviceLineFor } from "@/lib/service-lines";
import { DEFAULT_STAGES, PROJECT_SELECT, ServiceModuleProps } from "./constants";

export function useServiceModule({
  moduleKey,
  moduleLabel,
  tagline,
  stages = DEFAULT_STAGES,
  projectTemplates = [],
}: ServiceModuleProps) {
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

  // Dashboard click-through: /ict?tab=projects&filter=active&project=<id> (also used by
  // the other service modules). tab picks the tab, filter narrows the list, project
  // opens that project's workspace. "ts" changes on every click so a repeat click re-applies.
  const search = useRouterState({ select: (st) => st.location.search }) as Record<string, unknown>;
  const urlTab = typeof search.tab === "string" ? search.tab : undefined;
  const urlFilter = typeof search.filter === "string" ? search.filter : undefined;
  const urlProject = typeof search.project === "string" ? search.project : undefined;
  const urlTs = String(search.ts ?? "");
  const [projectFilter, setProjectFilter] = useState<string | null>(null);
  const [billingFilter, setBillingFilter] = useState<string | null>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const openedProject = useRef("");

  useEffect(() => {
    if (!urlTab || !["projects", "clients", "billing", "documents"].includes(urlTab)) return;
    setTab(urlTab as typeof tab);
    setProjectFilter(urlTab === "projects" ? (urlFilter ?? null) : null);
    setBillingFilter(urlTab === "billing" ? (urlFilter ?? null) : null);
    const t = window.setTimeout(() => topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 150);
    return () => window.clearTimeout(t);
  }, [urlTab, urlFilter, urlTs]);

  async function load() {
    const [first, c, s] = await Promise.all([
      supabase.from("service_projects" as any).select(PROJECT_SELECT).eq("module", moduleKey).order("updated_at", { ascending: false }).order("created_at", { ascending: false }),
      supabase.from("clients").select("id, company_name").order("company_name"),
      supabase.from("profiles").select("id, full_name"),
    ]);
    let p: any = first;
    if (p.error) {
      // Previously this failure was swallowed and the list just said "No projects yet".
      // Show the reason, then retry with the same lean query the dashboard cards use so
      // the projects still appear even if a newer column is missing in this database.
      toast.error(`${moduleLabel} projects: ${p.error.message}`);
      p = await supabase.from("service_projects" as any)
        .select("*, clients(company_name), service_milestones(id, title, due_date, done)")
        .eq("module", moduleKey).order("created_at", { ascending: false });
      if (p.error) toast.error(`${moduleLabel} projects (retry): ${p.error.message}`);
    }
    setRows((p.data as any[]) ?? []); setClients(c.data ?? []); setStaff(s.data ?? []);
  }
  useEffect(() => { load(); }, [moduleKey]);

  useEffect(() => {
    if (!urlProject || rows.length === 0) return;
    const key = `${urlProject}:${urlTs}`;
    if (openedProject.current === key) return;
    const r = rows.find(x => x.id === urlProject);
    if (!r) return;
    openedProject.current = key;
    setMilestoneEditor(r);
    setClosureNotes(r.closure_notes ?? "");
  }, [urlProject, urlTs, rows]);

  const todayStr = new Date().toISOString().slice(0, 10);
  const isOpenProject = (r: any) => r.status !== "completed" && r.status !== "cancelled";
  const lateSteps = (r: any) => (r.service_milestones ?? []).filter((m: any) => m.due_date && m.due_date < todayStr && !m.done).length;
  const visibleRows = rows.filter(r =>
    !projectFilter ? true
      : projectFilter === "active" ? isOpenProject(r)
      : projectFilter === "overdue" ? lateSteps(r) > 0
      : projectFilter === "risk" ? isOpenProject(r) && ((!!r.due_date && r.due_date < todayStr) || lateSteps(r) > 0)
      : true);
  const projectFilterLabel: Record<string, string> = { active: "Active projects", overdue: "Projects with overdue milestones", risk: "Projects at risk" };
  const visibleInvoices = billingFilter === "balance" ? invoices.filter(i => Number(i.total ?? 0) > Number(i.amount_paid ?? 0)) : invoices;

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

    if (assigneeId === user?.id) return;
    await notifyUser({
      user_id: assigneeId, type: "milestone_assigned",
      title: "Assigned to a milestone",
      body: `${clientName ? `${title} — ${moduleLabel} (${clientName})` : `${title} — ${moduleLabel}`}${dueDate ? ` · due ${dueDate}` : ""}`,
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
    const res = await signedClientFileUrl(path, 600);
    if ("error" in res) toast.error(res.error); else setPreview({ url: res.url, title });
  }
  async function downloadDoc(path: string) {
    await openClientFile(path);
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
  return {
    isAdmin,
    user,
    STAGES,
    defaultStageKey,
    reopenStageKey,
    stageLabel,
    tab,
    setTab,
    rows,
    setRows,
    clients,
    setClients,
    staff,
    setStaff,
    dialog,
    setDialog,
    milestoneEditor,
    setMilestoneEditor,
    msTitle,
    setMsTitle,
    msDue,
    setMsDue,
    msNotes,
    setMsNotes,
    msAssignee,
    setMsAssignee,
    msStage,
    setMsStage,
    editingMs,
    setEditingMs,
    editMsData,
    setEditMsData,
    milestoneDocs,
    setMilestoneDocs,
    expandedMs,
    setExpandedMs,
    uploadingMs,
    setUploadingMs,
    preview,
    setPreview,
    closureNotes,
    setClosureNotes,
    closeInvoiceOpen,
    setCloseInvoiceOpen,
    invoices,
    setInvoices,
    docs,
    setDocs,
    search,
    urlTab,
    urlFilter,
    urlProject,
    urlTs,
    projectFilter,
    setProjectFilter,
    billingFilter,
    setBillingFilter,
    topRef,
    openedProject,
    load,
    todayStr,
    isOpenProject,
    lateSteps,
    visibleRows,
    projectFilterLabel,
    visibleInvoices,
    moduleClientIds,
    loadBilling,
    loadDocuments,
    staffName,
    save,
    remove,
    reloadEditor,
    setStage,
    closeProject,
    finishClose,
    reopenProject,
    notifyMilestoneAssignee,
    addMilestone,
    toggleMilestone,
    verifyMilestone,
    removeMilestone,
    startEditMs,
    saveEditMs,
    loadMilestoneDocs,
    toggleExpandMs,
    uploadMsDoc,
    verifyDoc,
    viewDoc,
    downloadDoc,
    removeMsDoc,
    editorMs,
    editorClosed,
    editorDone,
    editorVerified,
    clientRollup,
    TABS,
    moduleKey,
    moduleLabel,
    tagline,
    projectTemplates,
  };
}

export type ServiceModuleCtx = ReturnType<typeof useServiceModule>;
