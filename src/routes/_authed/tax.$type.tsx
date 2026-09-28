import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ArrowLeft, Trash2, Save, X } from "lucide-react";
import { formatDate, formatDateTime, daysUntil, periodsOverdue, STATUS_COLORS } from "@/lib/format";
import { TaxAssigneeSelect } from "@/components/tax-assignee-select";
import { TaxAssignees } from "@/components/tax-assignees";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/_authed/tax/$type")({
  validateSearch: (s: Record<string, unknown>) => ({
    client: typeof s.client === "string" ? s.client : undefined,
  }),
  component: TaxTypePage,
});

const STATUSES = ["pending","in_progress","filed","overdue"];

function TaxTypePage() {
  const { type } = useParams({ from: "/_authed/tax/$type" });
  const search = Route.useSearch();
  const { user, isAdmin, canDelete } = useAuth();
  const [rows, setRows] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [staff, setStaff] = useState<any[]>([]);
  const [filter, setFilter] = useState({ client: search.client ?? "", assignee: "", status: "" });
  const [editing, setEditing] = useState<any>(null);
  const [policy, setPolicy] = useState<any>(null);

  const [docCounts, setDocCounts] = useState<Record<string, number>>({});
  const [invoices, setInvoices] = useState<Record<string, any>>({});

  async function load() {
    const [t, c, p, pol] = await Promise.all([
      supabase.from("tax_returns").select("*, clients(company_name)").eq("return_type", type as any).order("due_date"),
      supabase.from("clients").select("id, company_name").order("company_name"),
      supabase.from("profiles").select("id, full_name"),
      supabase.from("tax_policies").select("*").eq("tax_type", type).maybeSingle(),
    ]);
    setPolicy(pol.data ?? null);
    const byId = new Map((p.data ?? []).map((x: any) => [x.id, x]));
    const list = t.data ?? [];
    setRows(list.map((r: any) => ({ ...r, assignee: r.assigned_to ? byId.get(r.assigned_to) ?? null : null })));
    setClients(c.data ?? []);
    setStaff(p.data ?? []);

    const ids = list.map((r: any) => r.id);
    const invoiceIds = [...new Set(list.map((r: any) => r.invoice_id).filter(Boolean))];
    const [d, inv] = await Promise.all([
      ids.length ? supabase.from("documents").select("tax_return_id").in("tax_return_id", ids) : Promise.resolve({ data: [] } as any),
      invoiceIds.length ? supabase.from("invoices").select("id, invoice_number, status").in("id", invoiceIds) : Promise.resolve({ data: [] } as any),
    ]);
    const counts: Record<string, number> = {};
    (d.data ?? []).forEach((row: any) => { if (row.tax_return_id) counts[row.tax_return_id] = (counts[row.tax_return_id] ?? 0) + 1; });
    setDocCounts(counts);
    setInvoices(Object.fromEntries((inv.data ?? []).map((i: any) => [i.id, i])));
  }
  useEffect(() => { load(); }, [type]);

  const filtered = useMemo(() => rows.filter(r =>
    (!filter.client || r.client_id === filter.client) &&
    (!filter.assignee || r.assigned_to === filter.assignee) &&
    (!filter.status || r.status === filter.status)
  ), [rows, filter]);

  async function setStatus(id: string, status: string) {
    const { data, error } = await supabase.from("tax_returns").update({ status: status as any }).eq("id", id).select("id");
    if (error) toast.error(error.message);
    else if (!data || data.length === 0) toast.error("You don't have permission to update this filing.");
    else load();
  }
  async function remove(id: string) {
    if (!confirm("Remove this tax return?")) return;
    const { error } = await supabase.from("tax_returns").delete().eq("id", id);
    if (error) toast.error(error.message); else load();
  }
  async function saveEdit() {
    const { id, clients: _c, assignee: _a, ...payload } = editing;
    const before = rows.find(r => r.id === id);
    const { data, error } = await supabase.from("tax_returns").update(payload).eq("id", id).select("id");
    if (error) { toast.error(error.message); return; }
    if (!data || data.length === 0) { toast.error("You don't have permission to edit this filing."); return; }
    if (payload.assigned_to && payload.assigned_to !== before?.assigned_to && payload.assigned_to !== user?.id) {
      await supabase.from("notifications").insert({
        user_id: payload.assigned_to, type: "tax", title: "Tax filing assigned to you",
        body: `${label} — ${before?.clients?.company_name ?? "client"}`, link: "/tax",
      } as any);
    }
    toast.success("Saved"); setEditing(null); load();
  }

  const label = policy?.label ?? type.toUpperCase();
  const cadence = policy?.cadence ?? "monthly";
  const periodWord = cadence === "annual" ? "yr" : "mo";
  const summary = {
    total: rows.length,
    pending: rows.filter(r => r.status === "pending").length,
    inProgress: rows.filter(r => r.status === "in_progress").length,
    filed: rows.filter(r => r.status === "filed").length,
    overdue: rows.filter(r => r.status !== "filed" && periodsOverdue(r.due_date, cadence) >= 1).length,
  };

  return (
    <div className="space-y-4">
      <Link to="/tax" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1"><ArrowLeft className="h-3 w-3" /> Back to tax</Link>

      <div>
        <h1 className="text-2xl font-bold">{label} returns</h1>
        <p className="text-sm text-muted-foreground">
          All clients and filings under this tax category.
          {policy && <span className="capitalize"> · {policy.cadence}, due day {policy.due_day}</span>}
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: "Total", val: summary.total },
          { label: "Pending", val: summary.pending },
          { label: "In progress", val: summary.inProgress },
          { label: "Filed", val: summary.filed },
          { label: "Overdue", val: summary.overdue, tone: "text-destructive" },
        ].map(s => (
          <div key={s.label} className="bg-card border rounded-lg p-3">
            <div className="text-xs text-muted-foreground">{s.label}</div>
            <div className={`text-2xl font-bold ${s.tone ?? ""}`}>{s.val}</div>
          </div>
        ))}
      </div>

      <div className="bg-card border rounded-lg p-3 flex flex-wrap gap-2 items-center">
        <span className="text-xs font-medium text-muted-foreground">Filter:</span>
        <select value={filter.client} onChange={e => setFilter({ ...filter, client: e.target.value })} className="h-8 px-2 rounded-md border bg-background text-xs">
          <option value="">All clients</option>
          {clients.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
        </select>
        <select value={filter.assignee} onChange={e => setFilter({ ...filter, assignee: e.target.value })} className="h-8 px-2 rounded-md border bg-background text-xs">
          <option value="">All assignees</option>
          {staff.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
        </select>
        <select value={filter.status} onChange={e => setFilter({ ...filter, status: e.target.value })} className="h-8 px-2 rounded-md border bg-background text-xs">
          <option value="">All statuses</option>
          {STATUSES.map(s => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
        </select>
        {(filter.client || filter.assignee || filter.status) && (
          <button onClick={() => setFilter({ client: "", assignee: "", status: "" })} className="text-xs text-muted-foreground hover:text-foreground">Clear</button>
        )}
      </div>

      <div className="bg-card border rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground border-b bg-muted/40">
              <tr><th className="py-2 px-3">Client</th><th>Period</th><th>Due</th><th>Status</th><th>Filed</th><th>Assignee</th><th>Team</th><th>Docs</th><th>Billing</th><th>Notes</th><th></th></tr>
            </thead>
            <tbody>
              {filtered.length === 0 && <tr><td colSpan={11} className="py-10 text-center text-muted-foreground">No returns match your filters.</td></tr>}
              {filtered.map(r => {
                const d = daysUntil(r.due_date);
                const over = periodsOverdue(r.due_date, cadence);
                return (
                  <tr key={r.id} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="py-2 px-3 font-medium">{r.clients?.company_name}</td>
                    <td>{formatDate(r.period_end)}</td>
                    <td>
                      {formatDate(r.due_date)}
                      {over >= 1 && r.status !== "filed" && <span className="ml-2 text-xs text-destructive">{over} {periodWord}{over > 1 ? "s" : ""} overdue</span>}
                      {over < 1 && d !== null && d >= 0 && d <= 3 && r.status !== "filed" && <span className="ml-2 text-xs text-accent">in {d}d</span>}
                    </td>
                    <td>
                      <label className="inline-flex items-center gap-2 cursor-pointer" title={r.status === "filed" ? "Filed — uncheck to reopen" : "Check off once filed"}>
                        <input
                          type="checkbox"
                          checked={r.status === "filed"}
                          onChange={e => setStatus(r.id, e.target.checked ? "filed" : "pending")}
                        />
                        <span className={`h-6 px-2 inline-flex items-center rounded text-xs border bg-background capitalize ${STATUS_COLORS[r.status]}`}>
                          {r.status.replace(/_/g, " ")}
                        </span>
                      </label>
                      {r.status !== "filed" && (
                        <button
                          onClick={() => setStatus(r.id, r.status === "in_progress" ? "pending" : "in_progress")}
                          className="block mt-1 text-[10px] text-muted-foreground hover:text-foreground"
                        >
                          {r.status === "in_progress" ? "Mark not started" : "Mark in progress"}
                        </button>
                      )}
                    </td>
                    <td className="text-xs whitespace-nowrap">
                      {r.status === "filed" && r.filed_at ? (
                        <>
                          <div>{formatDateTime(r.filed_at)}</div>
                          {r.filed_by && staff.find(s => s.id === r.filed_by) && (
                            <div className="text-[10px] text-muted-foreground">by {staff.find(s => s.id === r.filed_by)?.full_name}</div>
                          )}
                        </>
                      ) : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="text-xs">
                      <TaxAssigneeSelect
                        returnId={r.id}
                        value={r.assigned_to}
                        staff={staff}
                        assignedAt={r.assigned_at}
                        label={`${label} — ${r.clients?.company_name ?? "client"}`}
                        onChanged={load}
                      />
                    </td>
                    <td className="py-2 px-3 relative"><TaxAssignees taxReturnId={r.id} compact /></td>
                    <td className="text-xs text-muted-foreground">{docCounts[r.id] ? `${docCounts[r.id]} file${docCounts[r.id] > 1 ? "s" : ""}` : "—"}</td>
                    <td className="text-xs">
                      {r.invoice_id && invoices[r.invoice_id] ? (
                        <Link to="/accounts/$id" params={{ id: r.invoice_id }} className={`px-1.5 py-0.5 rounded-full capitalize ${STATUS_COLORS[invoices[r.invoice_id].status] ?? "bg-muted"}`}>
                          {invoices[r.invoice_id].status}
                        </Link>
                      ) : r.status === "filed" ? (
                        <span className="text-muted-foreground">Unbilled</span>
                      ) : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="text-xs text-muted-foreground max-w-[200px] truncate" title={r.notes || ""}>{r.notes || "—"}</td>
                    <td className="py-2 px-3 text-right whitespace-nowrap">
                      <button onClick={() => setEditing(r)} className="text-xs text-primary mr-2">Edit</button>
                      {canDelete("tax", { createdBy: r.created_by }) && (
                        <button onClick={() => remove(r.id)} className="text-muted-foreground hover:text-destructive" title="Remove">
                          <Trash2 className="h-3.5 w-3.5 inline" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setEditing(null)}>
          <div onClick={e => e.stopPropagation()} className="bg-card w-full max-w-md rounded-lg p-6 space-y-3">
            <div className="flex justify-between"><h2 className="text-lg font-semibold">Edit return</h2><button onClick={() => setEditing(null)}><X className="h-4 w-4" /></button></div>
            <div>
              <label className="text-xs font-medium">Status</label>
              <select value={editing.status} onChange={e => setEditing({ ...editing, status: e.target.value })} className="mt-1 w-full h-9 px-3 rounded-md border bg-background text-sm capitalize">
                {STATUSES.map(s => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
              </select>
              {editing.filed_at && <p className="mt-1 text-[11px] text-muted-foreground">Filed {formatDateTime(editing.filed_at)}</p>}
            </div>
            <div>
              <label className="text-xs font-medium">Assignee</label>
              <select value={editing.assigned_to ?? ""} onChange={e => setEditing({ ...editing, assigned_to: e.target.value || null })} className="mt-1 w-full h-9 px-3 rounded-md border bg-background text-sm">
                <option value="">— Unassigned —</option>
                {staff.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
              </select>
              {editing.assigned_to && editing.assigned_at && <p className="mt-1 text-[11px] text-muted-foreground">Assigned {formatDateTime(editing.assigned_at)}</p>}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div><label className="text-xs font-medium">Period start</label><input type="date" value={editing.period_start ?? ""} onChange={e => setEditing({ ...editing, period_start: e.target.value || null })} className="mt-1 w-full h-9 px-3 rounded-md border bg-background text-sm" /></div>
              <div><label className="text-xs font-medium">Period end</label><input type="date" value={editing.period_end ?? ""} onChange={e => setEditing({ ...editing, period_end: e.target.value || null })} className="mt-1 w-full h-9 px-3 rounded-md border bg-background text-sm" /></div>
            </div>
            <div><label className="text-xs font-medium">Due date</label><input type="date" value={editing.due_date ?? ""} onChange={e => setEditing({ ...editing, due_date: e.target.value })} className="mt-1 w-full h-9 px-3 rounded-md border bg-background text-sm" /></div>
            <div><label className="text-xs font-medium">Notes</label><textarea value={editing.notes ?? ""} onChange={e => setEditing({ ...editing, notes: e.target.value })} rows={3} className="mt-1 w-full px-3 py-2 rounded-md border bg-background text-sm" /></div>
            <button onClick={saveEdit} className="w-full h-10 rounded-md bg-primary text-primary-foreground text-sm font-medium inline-flex items-center justify-center gap-2"><Save className="h-4 w-4" /> Save</button>
          </div>
        </div>
      )}
    </div>
  );
}
