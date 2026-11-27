import { useMemo, useState } from "react";
import { Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  STATE_ACCENT, STATE_BADGE, STATE_LABEL, STEPS, dueText, initials, stateOf, stepsDone,
  type FilingState, type TaxFilters,
} from "./tax-model";
import type { TaxData } from "./use-tax-data";

const db = supabase as any;
const PAGE = 100;

type Cell = { policy: any; has: boolean; row: any | null; state: FilingState | null };

export function Overview({ data, filters, setFilters, userId, canEdit, onOpen, onAnnual }: {
  data: TaxData;
  filters: TaxFilters;
  setFilters: (patch: Partial<TaxFilters>) => void;
  userId?: string;
  canEdit: boolean;
  onOpen: (filingId: string) => void;
  onAnnual: () => void;
}) {
  const { policies, clients, obligations, current, receiptIds, staff, staffMap, filedThisYear, reload } = data;
  const [q, setQ] = useState("");
  const [shown, setShown] = useState(PAGE);

  const types = useMemo(() => policies.filter(p => !filters.type || p.tax_type === filters.type), [policies, filters.type]);

  // One row per client, one cell per tax type.
  const allRows = useMemo(() => {
    return clients
      .filter(c => !c.is_paused)
      .map(client => ({
        client,
        cells: types.map((policy): Cell => {
          const key = `${client.id}:${policy.tax_type}`;
          const has = obligations.has(key);
          const row = has ? current.get(key) ?? null : null;
          return { policy, has, row, state: row ? stateOf(row, policy.cadence) : null };
        }),
      }))
      .filter(r => r.cells.some(c => c.has));
  }, [clients, types, obligations, current]);

  // Totals ignore the owner/status filters so the chips always show the whole picture.
  const kpi = useMemo(() => {
    const k = { overdue: 0, due_soon: 0, in_progress: 0, no_owner: 0 };
    for (const r of allRows) for (const c of r.cells) {
      if (!c.row) continue;
      if (c.state === "overdue") k.overdue++;
      if (c.state === "due_soon") k.due_soon++;
      if (c.row.docs_received_at) k.in_progress++;
      if (!c.row.assigned_to) k.no_owner++;
    }
    return k;
  }, [allRows]);

  const filtering = !!(filters.status || filters.owner || filters.client);
  const matches = (c: Cell): boolean => {
    if (!c.row) return false;
    if (filters.owner === "me" && c.row.assigned_to !== userId) return false;
    if (filters.owner === "none" && c.row.assigned_to) return false;
    if (filters.owner && filters.owner !== "me" && filters.owner !== "none" && c.row.assigned_to !== filters.owner) return false;
    switch (filters.status) {
      case "overdue": return c.state === "overdue";
      case "due_soon": return c.state === "due_soon";
      case "in_progress": return !!c.row.docs_received_at;
      case "no_owner": return !c.row.assigned_to;
      default: return true;
    }
  };

  const needle = q.trim().toLowerCase();
  const rows = allRows.filter(r =>
    (!filters.client || r.client.id === filters.client) &&
    (!needle || (r.client.company_name ?? "").toLowerCase().includes(needle)) &&
    (!(filters.status || filters.owner) || r.cells.some(matches)),
  );

  async function addObligation(clientId: string, taxType: string) {
    const { error } = await db.rpc("set_client_tax_obligation", { _client_id: clientId, _tax_type: taxType, _active: true });
    if (error) { toast.error(error.message); return; }
    toast.success("Obligation added");
    await reload();
  }

  const chip = (label: string, count: number, value: TaxFilters["status"], tone: string) => (
    <button
      key={label}
      onClick={() => setFilters({ status: filters.status === value ? undefined : value })}
      className={`text-left rounded-lg border px-3 py-2 min-w-[120px] transition ${filters.status === value ? "ring-2 ring-primary" : "hover:bg-muted/60"}`}
    >
      <div className={`text-xl font-semibold ${tone}`}>{count}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </button>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {chip("Overdue", kpi.overdue, "overdue", kpi.overdue ? "text-red-600" : "")}
        {chip("Due in 7 days", kpi.due_soon, "due_soon", kpi.due_soon ? "text-amber-600" : "")}
        {chip("In progress", kpi.in_progress, "in_progress", "")}
        {chip("No owner", kpi.no_owner, "no_owner", kpi.no_owner ? "text-red-600" : "")}
        <button onClick={onAnnual} className="text-left rounded-lg border px-3 py-2 min-w-[120px] hover:bg-muted/60" title="Open the annual records">
          <div className="text-xl font-semibold text-emerald-600">{filedThisYear}</div>
          <div className="text-xs text-muted-foreground">Filed this year →</div>
        </button>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative">
          <Search className="h-4 w-4 absolute left-2.5 top-2.5 text-muted-foreground" />
          <input value={q} onChange={e => { setQ(e.target.value); setShown(PAGE); }} placeholder="Find a client…" className="h-9 w-56 pl-8 pr-3 rounded-md border bg-background text-sm" />
        </div>
        <select value={filters.type ?? ""} onChange={e => setFilters({ type: e.target.value || undefined })} className="h-9 px-3 rounded-md border bg-background text-sm" aria-label="Tax type">
          <option value="">All tax types</option>
          {policies.map(p => <option key={p.tax_type} value={p.tax_type}>{p.label}</option>)}
        </select>
        <select value={filters.owner ?? ""} onChange={e => setFilters({ owner: e.target.value || undefined })} className="h-9 px-3 rounded-md border bg-background text-sm" aria-label="Owner">
          <option value="">Everyone</option>
          <option value="me">My filings</option>
          <option value="none">No owner</option>
          {staff.map(s => <option key={s.id} value={s.id}>{s.full_name || "Unnamed"}</option>)}
        </select>
        {(filtering || filters.type) && (
          <button onClick={() => { setFilters({ type: undefined, status: undefined, owner: undefined, client: undefined }); setQ(""); }} className="text-xs text-primary hover:underline">Clear filters</button>
        )}
        <div className="ml-auto text-xs text-muted-foreground">{rows.length} client{rows.length === 1 ? "" : "s"}</div>
      </div>

      <div className="bg-card border rounded-lg overflow-auto max-h-[70vh]">
        <table className="w-full text-sm border-separate border-spacing-0">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th className="sticky top-0 left-0 z-30 bg-muted px-3 py-2 min-w-[180px] border-b">Client</th>
              {types.map(p => <th key={p.tax_type} className="sticky top-0 z-20 bg-muted px-3 py-2 min-w-[150px] border-b whitespace-nowrap">{p.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {data.loading && <tr><td colSpan={types.length + 1} className="py-10 text-center text-muted-foreground">Loading…</td></tr>}
            {!data.loading && rows.length === 0 && (
              <tr><td colSpan={types.length + 1} className="py-10 text-center text-muted-foreground">
                {allRows.length === 0 ? "No client has a tax obligation yet. Add one from a client's page, or from a client row once one exists." : "Nothing matches these filters."}
              </td></tr>
            )}
            {rows.slice(0, shown).map(({ client, cells }) => (
              <tr key={client.id}>
                <td className="sticky left-0 z-10 bg-card px-3 py-2 border-b font-medium">{client.company_name}</td>
                {cells.map(c => {
                  const dim = filtering && !matches(c);
                  return (
                    <td key={c.policy.tax_type} className="px-2 py-1.5 border-b align-top">
                      {!c.has ? (
                        canEdit && !filtering ? (
                          <button onClick={() => void addObligation(client.id, c.policy.tax_type)} className="h-7 w-7 rounded border border-dashed text-muted-foreground hover:text-primary hover:border-primary flex items-center justify-center" title={`Add ${c.policy.label} for this client`} aria-label={`Add ${c.policy.label}`}>
                            <Plus className="h-3.5 w-3.5" />
                          </button>
                        ) : <span className="text-muted-foreground/40">—</span>
                      ) : !c.row ? (
                        <span className="text-xs text-muted-foreground">No open filing</span>
                      ) : (
                        <FilingCell cell={c} hasReceipt={receiptIds.has(c.row.id)} ownerName={c.row.assigned_to ? staffMap.get(c.row.assigned_to) : null} dim={dim} onOpen={() => onOpen(c.row.id)} />
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > shown && (
        <div className="text-center"><button onClick={() => setShown(s => s + PAGE)} className="text-sm text-primary hover:underline">Show more ({rows.length - shown} left)</button></div>
      )}
    </div>
  );
}

function FilingCell({ cell, hasReceipt, ownerName, dim, onOpen }: { cell: Cell; hasReceipt: boolean; ownerName?: string | null; dim: boolean; onOpen: () => void }) {
  const { row, state } = cell;
  const done = stepsDone(row, hasReceipt);
  const count = done.filter(Boolean).length;
  const st = state as FilingState;
  return (
    <button
      onClick={onOpen}
      className={`w-full text-left rounded-md border border-l-4 ${STATE_ACCENT[st]} bg-background px-2 py-1.5 hover:shadow-sm hover:bg-muted/40 transition ${dim ? "opacity-30" : ""}`}
      title={`${cell.policy.label}: ${STATE_LABEL[st]} - ${count}/4 steps done. Click to open.`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className={`text-[11px] px-1.5 py-0.5 rounded-full whitespace-nowrap ${STATE_BADGE[st]}`}>{dueText(row)}</span>
        <span
          className={`h-5 w-5 rounded-full text-[10px] flex items-center justify-center shrink-0 ${ownerName ? "bg-primary/10 text-primary" : "border border-dashed text-muted-foreground"}`}
          title={ownerName ? `Owner: ${ownerName}` : "No owner assigned"}
        >{ownerName ? initials(ownerName) : "?"}</span>
      </div>
      <div className="mt-1.5 flex gap-0.5" aria-label={`${count} of 4 steps done`}>
        {STEPS.map((s, i) => <span key={s.key} title={`${s.label}${done[i] ? " - done" : ""}`} className={`h-1.5 flex-1 rounded-full ${done[i] ? "bg-emerald-500" : "bg-muted-foreground/20"}`} />)}
      </div>
    </button>
  );
}
