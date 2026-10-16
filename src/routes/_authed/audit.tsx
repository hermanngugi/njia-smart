import { createFileRoute, Link, Outlet, useChildMatches } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Plus, X, Trash2, Pencil } from "lucide-react";
import { formatDate, STATUS_COLORS, statusLabel } from "@/lib/format";
import { CsvImport } from "@/components/csv-import";
import { ClientAssignments } from "@/components/client-assignments";
import { CompletionInvoiceDialog } from "@/components/completion-invoice-dialog";
import { ModuleTabBar, ClientsRollupTab, BillingTab, DocumentsTab, type ClientRollupRow } from "@/components/module-extra-tabs";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/_authed/audit")({ component: AuditRoute });

// /audit/$id (an engagement workspace) is a child route of /audit. Without an
// <Outlet /> the parent keeps rendering this list and the workspace never
// opens. Show the child whenever one is matched and the list otherwise.
function AuditRoute() {
  const childMatches = useChildMatches();
  if (childMatches.length > 0) return <Outlet />;
  return <AuditPage />;
}

function AuditPage() {
  const { user, isAdmin, canCreate, canDelete } = useAuth();
  const [tab, setTab] = useState<"engagements" | "clients" | "billing" | "documents">("engagements");
  const [rows, setRows] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ client_id: "", title: "", start_date: "", due_date: "", notes: "" });
  const [newClientName, setNewClientName] = useState("");
  const [editRow, setEditRow] = useState<any | null>(null);
  const [invoiceFor, setInvoiceFor] = useState<any | null>(null);
  // Checklist progress per engagement: { done, total } of audit procedures.
  const [checklist, setChecklist] = useState<Record<string, { done: number; total: number }>>({});

  async function load() {
    const [e, c] = await Promise.all([
      supabase.from("engagements").select("*, clients(company_name)").eq("type", "audit").order("created_at", { ascending: false }),
      supabase.from("clients").select("id, company_name").order("company_name"),
    ]);
    setRows(e.data ?? []); setClients(c.data ?? []);
    // Real checklist progress (ignored quietly if the audit tables are not set up yet).
    const ids = (e.data ?? []).map((r: any) => r.id);
    if (ids.length) {
      const { data: procs, error: procErr } = await (supabase as any)
        .from("audit_engagement_procedures").select("engagement_id, status").in("engagement_id", ids);
      if (!procErr) {
        const next: Record<string, { done: number; total: number }> = {};
        for (const p of procs ?? []) {
          const row = (next[p.engagement_id] ||= { done: 0, total: 0 });
          row.total += 1;
          if (p.status === "completed" || p.status === "not_applicable") row.done += 1;
        }
        setChecklist(next);
      }
    }
  }
  useEffect(() => { load(); }, []);

  useEffect(() => {
    const ch = supabase
      .channel("audit-list")
      .on("postgres_changes", { event: "*", schema: "public", table: "engagements" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    // See clients/index.tsx for why: waits out any pending token refresh so
    // this insert doesn't race an expired session and fail with a 401.
    await supabase.auth.getSession();
    let clientId = form.client_id;
    if (clientId === "__new__") {
      if (!newClientName.trim()) { toast.error("Enter the new client name"); return; }
      const { data, error } = await supabase.from("clients").insert({ company_name: newClientName.trim(), client_type: "company" }).select("id").single();
      if (error || !data) { toast.error(error?.message ?? "Could not add client"); return; }
      clientId = data.id;
    }
    const { error } = await supabase.from("engagements").insert({
      client_id: clientId,
      title: form.title,
      start_date: form.start_date || null,
      due_date: form.due_date || null,
      notes: form.notes,
      type: "audit" as const,
      created_by: user?.id,
    });
    if (error) toast.error(error.message);
    else { toast.success("Audit engagement created"); setOpen(false); setNewClientName(""); setForm({ client_id:"", title:"", start_date:"", due_date:"", notes:"" }); load(); }
  }

  async function remove(id: string) {
    if (!confirm("Remove this audit engagement?")) return;
    const { error } = await supabase.from("engagements").delete().eq("id", id);
    if (error) toast.error(error.message); else { toast.success("Removed"); load(); }
  }

  async function saveEdit(e: React.FormEvent | null, skipInvoice = false) {
    e?.preventDefault();
    if (!editRow) return;
    const { id, clients: _c, ...payload } = editRow;
    // Completing an audit requires an invoice under the client.
    const before = rows.find(r => r.id === id);
    if (!skipInvoice && payload.status === "completed" && before?.status !== "completed" && !before?.invoice_id) {
      setInvoiceFor({ id, clientName: before?.clients?.company_name, title: payload.title });
      return;
    }
    const { error } = await supabase.from("engagements").update({
      client_id: payload.client_id,
      title: payload.title,
      due_date: payload.due_date || null,
      start_date: payload.start_date || null,
      status: payload.status,
      completion_pct: Number(payload.completion_pct) || 0,
      notes: payload.notes,
    }).eq("id", id);
    if (error) toast.error(error.message);
    else { toast.success("Updated"); setEditRow(null); load(); }
  }

  const grouped = Object.entries(
    rows.reduce((acc: Record<string, any[]>, r) => {
      const key = r.clients?.company_name ?? "Unassigned client";
      (acc[key] ||= []).push(r);
      return acc;
    }, {})
  ).sort((a, b) => a[0].localeCompare(b[0])) as [string, any[]][];

  const clientIds = Array.from(new Set(rows.map(r => r.client_id).filter(Boolean)));
  const clientRollup: ClientRollupRow[] = clients
    .filter(c => clientIds.includes(c.id))
    .map(c => {
      const list = rows.filter(r => r.client_id === c.id);
      return { id: c.id, company_name: c.company_name, count: list.length, open: list.filter(r => r.status !== "completed").length };
    });

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold">Audit</h1>
          <p className="text-sm text-muted-foreground">Engagements aligned with IFRS, ISA and the Kenyan Companies Act.</p>
        </div>
        {tab === "engagements" && canCreate("audit") && (
        <div className="flex gap-2">
          <CsvImport
            table="engagements"
            fields={[
              { key:"client_id", label:"Client ID", required:true },
              { key:"title", label:"Title", required:true },
              { key:"due_date", label:"Due date" },
              { key:"status", label:"Status" },
              { key:"notes", label:"Notes" },
            ]}
            transform={(r)=>({ ...r, type: "audit" })}
            onDone={load}
          />
          {canCreate("audit") && (
            <button onClick={()=>setOpen(true)} className="h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm inline-flex items-center gap-2"><Plus className="h-4 w-4" /> New audit</button>
          )}
        </div>
        )}
      </div>

      <ModuleTabBar
        active={tab}
        onChange={setTab}
        tabs={[
          { key: "engagements", label: "Engagements", count: rows.length },
          { key: "clients", label: "Clients", count: clientRollup.length },
          { key: "billing", label: "Billing" },
          { key: "documents", label: "Documents" },
        ]}
      />

      {tab === "engagements" && (
      <div className="space-y-6">
        {rows.length === 0 && <div className="bg-card border rounded-lg p-8 text-center text-muted-foreground text-sm">No audit engagements yet.</div>}
        {grouped.map(([clientName, list]) => (
        <section key={clientName} className="space-y-2">
          <div className="flex items-baseline justify-between border-b pb-1">
            <h2 className="text-sm font-semibold">{clientName}</h2>
            <span className="text-xs text-muted-foreground">{list.length} engagement{list.length===1?"":"s"}</span>
          </div>
          <div className="grid gap-3">
        {list.map(r => (
          <div key={r.id} className="bg-card border rounded-lg p-4 hover:border-primary/50 transition-colors">
            <div className="flex justify-between items-start gap-3 flex-wrap">
              <Link to="/audit/$id" params={{ id: r.id }} className="flex-1">
                <div className="font-semibold">{r.title}</div>
                <div className="text-xs text-muted-foreground mt-0.5">Started {formatDate(r.start_date)}</div>
              </Link>
              <div className="flex items-start gap-2">
                <div className="text-right">
                  <span className={`text-xs px-2 py-1 rounded-full capitalize ${STATUS_COLORS[r.status] || "bg-muted"}`}>{statusLabel(r.status)}</span>
                  <div className="text-xs text-muted-foreground mt-1">Due {formatDate(r.due_date)}</div>
                </div>
                <button onClick={()=>setEditRow({ ...r })} className="text-muted-foreground hover:text-primary p-1" title="Edit engagement">
                  <Pencil className="h-4 w-4" />
                </button>
                {canDelete("audit", { createdBy: r.created_by }) && (
                  <button onClick={()=>remove(r.id)} className="text-muted-foreground hover:text-destructive p-1" title="Remove engagement">
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
            <Link to="/audit/$id" params={{ id: r.id }} className="block">
              <div className="mt-3 h-1.5 bg-muted rounded-full overflow-hidden">
                <div className="h-full bg-primary" style={{ width: `${r.completion_pct}%` }} />
              </div>
              <div className="mt-2 flex justify-between text-xs text-muted-foreground">
                <span>
                  {checklist[r.id]
                    ? `Checklist: ${checklist[r.id].done} of ${checklist[r.id].total} steps done`
                    : "Checklist not set up yet — open to get started"}
                </span>
                <span>{r.completion_pct}%</span>
              </div>
            </Link>
            {r.client_id && (
              <div className="mt-2 flex items-center gap-2 text-xs">
                <span className="text-muted-foreground">Assigned:</span>
                <ClientAssignments clientId={r.client_id} compact />
              </div>
            )}
          </div>
        ))}
          </div>
        </section>
        ))}
      </div>
      )}

      {tab === "clients" && <ClientsRollupTab rows={clientRollup} noun="engagements" />}
      {tab === "billing" && <BillingTab serviceLine="Audit" />}
      {tab === "documents" && <DocumentsTab clientIds={clientIds} />}


      {open && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={()=>setOpen(false)}>
          <form onClick={e=>e.stopPropagation()} onSubmit={save} className="bg-card w-full max-w-md rounded-lg p-6 space-y-3">
            <div className="flex justify-between"><h2 className="text-lg font-semibold">New audit engagement</h2><button type="button" onClick={()=>setOpen(false)}><X className="h-4 w-4" /></button></div>
            <div>
              <label className="text-xs font-medium">Client *</label>
              <select required value={form.client_id} onChange={e=>setForm({...form, client_id:e.target.value})} className="mt-1 w-full h-9 px-3 rounded-md border bg-background text-sm">
                <option value="">Select…</option>
                {clients.map(c=><option key={c.id} value={c.id}>{c.company_name}</option>)}
                <option value="__new__">+ Add a new client…</option>
              </select>
              {form.client_id === "__new__" && (
                <input required autoFocus placeholder="New client name" value={newClientName} onChange={e=>setNewClientName(e.target.value)} className="mt-2 w-full h-9 px-3 rounded-md border bg-background text-sm" />
              )}
            </div>
            <div><label className="text-xs font-medium">Title *</label><input required value={form.title} onChange={e=>setForm({...form, title:e.target.value})} className="mt-1 w-full h-9 px-3 rounded-md border bg-background text-sm" /></div>
            <div className="grid grid-cols-2 gap-2">
              <div><label className="text-xs font-medium">Start date</label><input type="date" value={form.start_date} onChange={e=>setForm({...form, start_date:e.target.value})} className="mt-1 w-full h-9 px-3 rounded-md border bg-background text-sm" /></div>
              <div><label className="text-xs font-medium">Due date</label><input type="date" value={form.due_date} onChange={e=>setForm({...form, due_date:e.target.value})} className="mt-1 w-full h-9 px-3 rounded-md border bg-background text-sm" /></div>
            </div>
            <textarea placeholder="Notes" value={form.notes} onChange={e=>setForm({...form, notes:e.target.value})} rows={2} className="w-full px-3 py-2 rounded-md border bg-background text-sm" />
            <button className="w-full h-10 rounded-md bg-primary text-primary-foreground text-sm font-medium">Create</button>
          </form>
        </div>
      )}

      {editRow && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={()=>setEditRow(null)}>
          <form onClick={e=>e.stopPropagation()} onSubmit={saveEdit} className="bg-card w-full max-w-md rounded-lg p-6 space-y-3 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between"><h2 className="text-lg font-semibold">Edit audit engagement</h2><button type="button" onClick={()=>setEditRow(null)}><X className="h-4 w-4" /></button></div>
            <div>
              <label className="text-xs font-medium">Client *</label>
              <select required value={editRow.client_id} onChange={e=>setEditRow({...editRow, client_id:e.target.value})} className="mt-1 w-full h-9 px-3 rounded-md border bg-background text-sm">
                {clients.map(c=><option key={c.id} value={c.id}>{c.company_name}</option>)}
              </select>
            </div>
            <div><label className="text-xs font-medium">Title *</label><input required value={editRow.title ?? ""} onChange={e=>setEditRow({...editRow, title:e.target.value})} className="mt-1 w-full h-9 px-3 rounded-md border bg-background text-sm" /></div>
            <div className="grid grid-cols-2 gap-2">
              <div><label className="text-xs font-medium">Start date</label><input type="date" value={editRow.start_date ?? ""} onChange={e=>setEditRow({...editRow, start_date:e.target.value})} className="mt-1 w-full h-9 px-3 rounded-md border bg-background text-sm" /></div>
              <div><label className="text-xs font-medium">Due date</label><input type="date" value={editRow.due_date ?? ""} onChange={e=>setEditRow({...editRow, due_date:e.target.value})} className="mt-1 w-full h-9 px-3 rounded-md border bg-background text-sm" /></div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs font-medium">Status</label>
                <select value={editRow.status} onChange={e=>setEditRow({...editRow, status:e.target.value})} className="mt-1 w-full h-9 px-3 rounded-md border bg-background text-sm">
                  <option value="not_started">Not started</option>
                  <option value="in_progress">In progress</option>
                  <option value="under_review">Under review</option>
                  <option value="completed">Completed</option>
                </select>
              </div>
              <div><label className="text-xs font-medium">Progress %</label><input type="number" min={0} max={100} value={editRow.completion_pct ?? 0} onChange={e=>setEditRow({...editRow, completion_pct:e.target.value})} className="mt-1 w-full h-9 px-3 rounded-md border bg-background text-sm" /></div>
            </div>
            <textarea placeholder="Notes" value={editRow.notes ?? ""} onChange={e=>setEditRow({...editRow, notes:e.target.value})} rows={3} className="w-full px-3 py-2 rounded-md border bg-background text-sm" />
            <button className="w-full h-10 rounded-md bg-primary text-primary-foreground text-sm font-medium">Save changes</button>
          </form>
        </div>
      )}
      {invoiceFor && (
        <CompletionInvoiceDialog
          open
          onOpenChange={o => { if (!o) setInvoiceFor(null); }}
          source="engagements"
          sourceId={invoiceFor.id}
          clientName={invoiceFor.clientName}
          defaultDescription={`Audit — ${invoiceFor.title}`}
          onInvoiced={async () => { await saveEdit(null, true); setInvoiceFor(null); }}
        />
      )}
    </div>
  );
}

