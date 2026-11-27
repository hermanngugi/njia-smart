import { createFileRoute, Link, Outlet, useChildMatches } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Plus, X, Trash2, Pencil, Search } from "lucide-react";
import { STATUS_COLORS, statusLabel } from "@/lib/format";
import { CsvImport } from "@/components/csv-import";
import { CompletionInvoiceDialog } from "@/components/completion-invoice-dialog";
import { daysFromToday, initials, shortDate } from "@/components/tax/tax-model";
import { isDone, isInReview } from "@/lib/audit/guidance";
import { useAuth } from "@/lib/auth";

const FILTERS = ["overdue", "due_soon", "in_review", "no_owner"] as const;
type Chip = (typeof FILTERS)[number];
const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);

export const Route = createFileRoute("/_authed/audit")({
  validateSearch: (s: Record<string, unknown>) => ({
    status: FILTERS.find((x) => x === s.status),
    owner: str(s.owner),
    client: str(s.client),
  }),
  component: AuditRoute,
});

// /audit/$id (an engagement workspace) is a child route of /audit. Without an
// <Outlet /> the parent keeps rendering this list and the workspace never
// opens. Show the child whenever one is matched and the list otherwise.
function AuditRoute() {
  const childMatches = useChildMatches();
  if (childMatches.length > 0) return <Outlet />;
  return <AuditPage />;
}

type Steps = { done: number; total: number; review: number; overdue: number };

function AuditPage() {
  const { user, canCreate, canDelete } = useAuth();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const [rows, setRows] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [staff, setStaff] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ client_id: "", title: "", start_date: "", due_date: "", notes: "", assigned_to: "" });
  const [newClientName, setNewClientName] = useState("");
  const [editRow, setEditRow] = useState<any | null>(null);
  const [invoiceFor, setInvoiceFor] = useState<any | null>(null);
  const [q, setQ] = useState("");
  // Checklist progress per engagement.
  const [steps, setSteps] = useState<Record<string, Steps>>({});

  const setSearch = (patch: Record<string, unknown>) =>
    void navigate({ search: ((prev: Record<string, unknown>) => ({ ...prev, ...patch })) as any, replace: true });

  async function load() {
    const [e, c, p] = await Promise.all([
      supabase.from("engagements").select("*, clients(company_name)").eq("type", "audit").order("created_at", { ascending: false }),
      supabase.from("clients").select("id, company_name").order("company_name"),
      supabase.from("profiles").select("id, full_name").order("full_name"),
    ]);
    setRows(e.data ?? []); setClients(c.data ?? []); setStaff(p.data ?? []);
    const ids = (e.data ?? []).map((r: any) => r.id);
    if (ids.length) {
      const { data: procs, error: procErr } = await (supabase as any)
        .from("audit_engagement_procedures").select("engagement_id, status, due_date").in("engagement_id", ids);
      if (!procErr) {
        const next: Record<string, Steps> = {};
        for (const s of procs ?? []) {
          const row = (next[s.engagement_id] ||= { done: 0, total: 0, review: 0, overdue: 0 });
          row.total += 1;
          if (isDone(s.status)) row.done += 1;
          else {
            if (isInReview(s.status)) row.review += 1;
            if (s.due_date && (daysFromToday(s.due_date) ?? 0) < 0) row.overdue += 1;
          }
        }
        setSteps(next);
      }
    }
  }
  useEffect(() => { void load(); }, []);

  useEffect(() => {
    const ch = supabase
      .channel("audit-list")
      .on("postgres_changes", { event: "*", schema: "public", table: "engagements" }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "audit_engagement_procedures" }, () => void load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const ownerName = (id?: string | null) => staff.find((s) => s.id === id)?.full_name ?? null;

  const flags = (r: any) => {
    const active = r.status !== "completed";
    const d = daysFromToday(r.due_date);
    const st = steps[r.id];
    return {
      overdue: active && ((d !== null && d < 0) || !!st?.overdue),
      due_soon: active && d !== null && d >= 0 && d <= 7,
      in_review: active && !!st?.review,
      no_owner: active && !r.assigned_to,
    } as Record<Chip, boolean>;
  };

  // Totals ignore the filters so the chips always show the whole picture.
  const kpi = useMemo(() => {
    const k: Record<Chip, number> = { overdue: 0, due_soon: 0, in_review: 0, no_owner: 0 };
    for (const r of rows) { const f = flags(r); for (const key of FILTERS) if (f[key]) k[key]++; }
    return k;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, steps]);

  const needle = q.trim().toLowerCase();
  const shown = rows.filter((r) =>
    (!search.status || flags(r)[search.status as Chip]) &&
    (!search.client || r.client_id === search.client) &&
    (!search.owner || (search.owner === "me" ? r.assigned_to === user?.id : search.owner === "none" ? !r.assigned_to : r.assigned_to === search.owner)) &&
    (!needle || `${r.title} ${r.clients?.company_name ?? ""}`.toLowerCase().includes(needle)),
  );
  const filtering = !!(search.status || search.owner || search.client || needle);

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
      assigned_to: form.assigned_to || null,
      type: "audit" as const,
      created_by: user?.id,
    });
    if (error) toast.error(error.message);
    else { toast.success("Audit engagement created"); setOpen(false); setNewClientName(""); setForm({ client_id: "", title: "", start_date: "", due_date: "", notes: "", assigned_to: "" }); void load(); }
  }

  async function remove(id: string) {
    if (!confirm("Remove this audit engagement?")) return;
    const { error } = await supabase.from("engagements").delete().eq("id", id);
    if (error) toast.error(error.message); else { toast.success("Removed"); void load(); }
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
      assigned_to: payload.assigned_to || null,
      notes: payload.notes,
    }).eq("id", id);
    if (error) toast.error(error.message);
    else { toast.success("Updated"); setEditRow(null); void load(); }
  }

  const chip = (label: string, count: number, value: Chip, tone: string) => (
    <button
      key={value}
      onClick={() => setSearch({ status: search.status === value ? undefined : value })}
      className={`text-left rounded-lg border px-3 py-2 min-w-[120px] transition ${search.status === value ? "ring-2 ring-primary" : "hover:bg-muted/60"}`}
    >
      <div className={`text-xl font-semibold ${count ? tone : ""}`}>{count}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </button>
  );

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-end flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Audit</h1>
          <p className="text-sm text-muted-foreground">Every audit engagement, who owns it, and how far along it is.</p>
        </div>
        {canCreate("audit") && (
          <div className="flex gap-2">
            <CsvImport
              table="engagements"
              fields={[
                { key: "client_id", label: "Client ID", required: true },
                { key: "title", label: "Title", required: true },
                { key: "due_date", label: "Due date" },
                { key: "status", label: "Status" },
                { key: "notes", label: "Notes" },
              ]}
              transform={(r) => ({ ...r, type: "audit" })}
              onDone={load}
            />
            <button onClick={() => { setForm((f) => ({ ...f, assigned_to: user?.id ?? "" })); setOpen(true); }} className="h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm inline-flex items-center gap-2"><Plus className="h-4 w-4" /> New audit</button>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {chip("Overdue", kpi.overdue, "overdue", "text-red-600")}
        {chip("Due in 7 days", kpi.due_soon, "due_soon", "text-amber-600")}
        {chip("In review", kpi.in_review, "in_review", "text-purple-600")}
        {chip("No owner", kpi.no_owner, "no_owner", "text-red-600")}
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative">
          <Search className="h-4 w-4 absolute left-2.5 top-2.5 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find an audit or client…" className="h-9 w-56 pl-8 pr-3 rounded-md border bg-background text-sm" />
        </div>
        <select value={search.client ?? ""} onChange={(e) => setSearch({ client: e.target.value || undefined })} className="h-9 px-3 rounded-md border bg-background text-sm" aria-label="Client">
          <option value="">All clients</option>
          {clients.filter((c) => rows.some((r) => r.client_id === c.id)).map((c) => <option key={c.id} value={c.id}>{c.company_name}</option>)}
        </select>
        <select value={search.owner ?? ""} onChange={(e) => setSearch({ owner: e.target.value || undefined })} className="h-9 px-3 rounded-md border bg-background text-sm" aria-label="Owner">
          <option value="">Everyone</option>
          <option value="me">My audits</option>
          <option value="none">No owner</option>
          {staff.map((s) => <option key={s.id} value={s.id}>{s.full_name || "Unnamed"}</option>)}
        </select>
        {filtering && <button onClick={() => { setSearch({ status: undefined, owner: undefined, client: undefined }); setQ(""); }} className="text-xs text-primary hover:underline">Clear filters</button>}
        <div className="ml-auto text-xs text-muted-foreground">{shown.length} audit{shown.length === 1 ? "" : "s"}</div>
      </div>

      <div className="space-y-2">
        {shown.length === 0 && (
          <div className="bg-card border rounded-lg p-8 text-center text-muted-foreground text-sm">{rows.length === 0 ? "No audit engagements yet." : "Nothing matches these filters."}</div>
        )}
        {shown.map((r) => {
          const st = steps[r.id];
          const pct = st?.total ? Math.round((st.done / st.total) * 100) : Number(r.completion_pct ?? 0);
          const f = flags(r);
          const owner = ownerName(r.assigned_to);
          const d = daysFromToday(r.due_date);
          return (
            <div key={r.id} className={`bg-card border border-l-4 rounded-lg p-3 hover:border-primary/50 transition-colors ${f.overdue ? "border-l-red-500" : f.due_soon ? "border-l-amber-400" : r.status === "completed" ? "border-l-emerald-500" : "border-l-blue-400"}`}>
              <div className="flex items-start gap-3 flex-wrap">
                <Link to="/audit/$id" params={{ id: r.id }} className="flex-1 min-w-[200px]">
                  <div className="font-medium">{r.title}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{r.clients?.company_name ?? "No client"}</div>
                  <div className="mt-2 flex items-center gap-2">
                    <div className="h-1.5 flex-1 max-w-xs bg-muted rounded-full overflow-hidden"><div className="h-full bg-primary" style={{ width: `${pct}%` }} /></div>
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {st ? `${st.done} of ${st.total} steps` : "Checklist not started"}{st?.review ? ` · ${st.review} in review` : ""}
                    </span>
                  </div>
                </Link>
                <div className="flex items-center gap-3">
                  <div className="text-right text-xs">
                    <span className={`px-2 py-0.5 rounded-full ${STATUS_COLORS[r.status] || "bg-muted"}`}>{statusLabel(r.status)}</span>
                    <div className={`mt-1 ${f.overdue ? "text-red-600" : "text-muted-foreground"}`}>
                      {r.status === "completed" ? "Completed" : r.due_date ? (d !== null && d < 0 ? `${-d}d overdue` : `Due ${shortDate(r.due_date)}`) : "No due date"}
                      {st?.overdue ? ` · ${st.overdue} step${st.overdue === 1 ? "" : "s"} late` : ""}
                    </div>
                  </div>
                  <span
                    className={`h-7 w-7 rounded-full text-[11px] flex items-center justify-center shrink-0 ${owner ? "bg-primary/10 text-primary" : "border border-dashed text-muted-foreground"}`}
                    title={owner ? `Owner: ${owner}` : "No owner assigned"}
                  >{owner ? initials(owner) : "?"}</span>
                  <button onClick={() => setEditRow({ ...r })} className="text-muted-foreground hover:text-primary p-1" title="Edit engagement"><Pencil className="h-4 w-4" /></button>
                  {canDelete("audit", { createdBy: r.created_by }) && (
                    <button onClick={() => void remove(r.id)} className="text-muted-foreground hover:text-destructive p-1" title="Remove engagement"><Trash2 className="h-4 w-4" /></button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

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
            <div>
              <label className="text-xs font-medium">Owner</label>
              <select value={form.assigned_to} onChange={e=>setForm({...form, assigned_to:e.target.value})} className="mt-1 w-full h-9 px-3 rounded-md border bg-background text-sm">
                <option value="">No owner yet</option>
                {staff.map(s=><option key={s.id} value={s.id}>{s.full_name}</option>)}
              </select>
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
                  {editRow.status === "under_review" && <option value="under_review">Under review</option>}
                  <option value="completed">Completed</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-medium">Owner</label>
                <select value={editRow.assigned_to ?? ""} onChange={e=>setEditRow({...editRow, assigned_to:e.target.value})} className="mt-1 w-full h-9 px-3 rounded-md border bg-background text-sm">
                  <option value="">No owner</option>
                  {staff.map(s=><option key={s.id} value={s.id}>{s.full_name}</option>)}
                </select>
              </div>
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

