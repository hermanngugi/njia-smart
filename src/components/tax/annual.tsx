import { useEffect, useMemo, useState } from "react";
import { Check, Download, Search } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { todayNairobi } from "@/lib/tax-period";
import { STATE_BADGE, STATE_LABEL, fetchPages, shortDate, stateOf, type TaxFilters } from "./tax-model";
import type { TaxData } from "./use-tax-data";

const db = supabase as any;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const PAGE = 100;

/**
 * The year's record: for every client and tax type, which periods were filed,
 * which are still open or late. Click any period to open its checklist,
 * receipt and invoice.
 */
export function Annual({ data, filters, setFilters, year, setYear, version, onOpen }: {
  data: TaxData;
  filters: TaxFilters;
  setFilters: (patch: Partial<TaxFilters>) => void;
  year: string;
  setYear: (y: string) => void;
  version: number;
  onOpen: (filingId: string) => void;
}) {
  const { policies, clientMap, staffMap } = data;
  const [returns, setReturns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [unfiledOnly, setUnfiledOnly] = useState(false);
  const [shown, setShown] = useState(PAGE);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchPages((a, b) => db.from("tax_returns")
      .select("id, client_id, return_type, due_date, status, assigned_to, invoice_id, filed_at")
      .gte("due_date", `${year}-01-01`).lte("due_date", `${year}-12-31`)
      .order("id").range(a, b))
      .then(rows => { if (!cancelled) setReturns(rows); })
      .catch(e => { if (!cancelled) toast.error(e?.message ?? "Could not load the annual records"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [year, version]);

  const policyOf = useMemo(() => new Map<string, any>(policies.map(p => [p.tax_type, p])), [policies]);

  const rows = useMemo(() => {
    const groups = new Map<string, { client: any; policy: any; periods: any[] }>();
    for (const r of returns) {
      if (filters.type && r.return_type !== filters.type) continue;
      const client = clientMap.get(r.client_id);
      if (!client) continue;
      const key = `${r.client_id}:${r.return_type}`;
      const g = groups.get(key) ?? { client, policy: policyOf.get(r.return_type) ?? { label: r.return_type, tax_type: r.return_type }, periods: [] };
      g.periods.push(r);
      groups.set(key, g);
    }
    const needle = q.trim().toLowerCase();
    return [...groups.values()]
      .filter(g => (!needle || (g.client.company_name ?? "").toLowerCase().includes(needle)) && (!unfiledOnly || g.periods.some(p => p.status !== "filed")))
      .sort((a, b) => (a.client.company_name ?? "").localeCompare(b.client.company_name ?? "") || (a.policy.label ?? "").localeCompare(b.policy.label ?? ""));
  }, [returns, filters.type, clientMap, policyOf, q, unfiledOnly]);

  function exportCsv() {
    if (rows.length === 0) { toast.error("Nothing to export for these filters."); return; }
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [["Client", "Tax type", "Due date", "Status", "Filed on", "Owner", "Invoiced"].map(esc).join(",")];
    for (const g of rows) for (const p of [...g.periods].sort((a, b) => a.due_date.localeCompare(b.due_date))) {
      lines.push([
        g.client.company_name, g.policy.label, p.due_date,
        p.status === "filed" ? "Filed" : stateOf(p, g.policy.cadence) === "overdue" ? "Overdue" : "Open",
        p.filed_at ? new Date(p.filed_at).toLocaleDateString("en-KE") : "",
        p.assigned_to ? staffMap.get(p.assigned_to) ?? "" : "",
        p.invoice_id ? "Yes" : "No",
      ].map(esc).join(","));
    }
    const url = URL.createObjectURL(new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `tax-filings-${year}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const thisYear = Number(todayNairobi().slice(0, 4));
  const years = Array.from({ length: 6 }, (_, i) => String(thisYear - 4 + i));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-center">
        <select value={year} onChange={e => { setYear(e.target.value); setShown(PAGE); }} className="h-9 px-3 rounded-md border bg-background text-sm" aria-label="Year">
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <select value={filters.type ?? ""} onChange={e => setFilters({ type: e.target.value || undefined })} className="h-9 px-3 rounded-md border bg-background text-sm" aria-label="Tax type">
          <option value="">All tax types</option>
          {policies.map(p => <option key={p.tax_type} value={p.tax_type}>{p.label}</option>)}
        </select>
        <div className="relative">
          <Search className="h-4 w-4 absolute left-2.5 top-2.5 text-muted-foreground" />
          <input value={q} onChange={e => { setQ(e.target.value); setShown(PAGE); }} placeholder="Find a client…" className="h-9 w-56 pl-8 pr-3 rounded-md border bg-background text-sm" />
        </div>
        <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={unfiledOnly} onChange={e => setUnfiledOnly(e.target.checked)} /> Only with unfiled periods</label>
        <button onClick={exportCsv} className="ml-auto inline-flex items-center gap-1.5 h-9 px-3 rounded-md border text-sm hover:bg-muted"><Download className="h-4 w-4" /> Export {year}</button>
      </div>

      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1"><span className={`h-3 w-3 rounded-sm ${STATE_BADGE.filed}`} /> Filed</span>
        <span className="inline-flex items-center gap-1"><span className={`h-3 w-3 rounded-sm ${STATE_BADGE.overdue}`} /> Overdue</span>
        <span className="inline-flex items-center gap-1"><span className={`h-3 w-3 rounded-sm ${STATE_BADGE.due_soon}`} /> Due within 7 days</span>
        <span className="inline-flex items-center gap-1"><span className={`h-3 w-3 rounded-sm ${STATE_BADGE.open}`} /> Open</span>
        <span>Columns are the month each filing falls due.</span>
      </div>

      <div className="bg-card border rounded-lg overflow-auto max-h-[70vh]">
        <table className="w-full text-xs border-separate border-spacing-0">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="sticky top-0 left-0 z-30 bg-muted px-3 py-2 min-w-[170px] border-b">Client</th>
              <th className="sticky top-0 z-20 bg-muted px-2 py-2 min-w-[110px] border-b">Tax type</th>
              {MONTHS.map(m => <th key={m} className="sticky top-0 z-20 bg-muted px-1 py-2 w-[46px] text-center border-b">{m}</th>)}
              <th className="sticky top-0 z-20 bg-muted px-2 py-2 text-center border-b">Filed</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={15} className="py-10 text-center text-muted-foreground">Loading…</td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={15} className="py-10 text-center text-muted-foreground">No filings fall due in {year} for these filters.</td></tr>}
            {!loading && rows.slice(0, shown).map(g => {
              const filed = g.periods.filter(p => p.status === "filed").length;
              return (
                <tr key={`${g.client.id}:${g.policy.tax_type}`}>
                  <td className="sticky left-0 z-10 bg-card px-3 py-1.5 border-b font-medium">{g.client.company_name}</td>
                  <td className="px-2 py-1.5 border-b whitespace-nowrap">{g.policy.label}</td>
                  {MONTHS.map((_, m) => {
                    const ps = g.periods.filter(p => Number(p.due_date.slice(5, 7)) - 1 === m);
                    return (
                      <td key={m} className="px-0.5 py-1 border-b text-center">
                        {ps.map(p => {
                          const st = stateOf(p, g.policy.cadence);
                          return (
                            <button key={p.id} onClick={() => onOpen(p.id)} className={`h-6 w-9 rounded text-[10px] inline-flex items-center justify-center hover:ring-2 ring-primary ${STATE_BADGE[st]}`} title={`${g.policy.label} due ${shortDate(p.due_date)} - ${STATE_LABEL[st]}`} aria-label={`${g.policy.label} ${MONTHS[m]} ${STATE_LABEL[st]}`}>
                              {st === "filed" ? <Check className="h-3.5 w-3.5" /> : Number(p.due_date.slice(8, 10))}
                            </button>
                          );
                        })}
                      </td>
                    );
                  })}
                  <td className="px-2 py-1.5 border-b text-center whitespace-nowrap">{filed}/{g.periods.length}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.length > shown && <div className="text-center"><button onClick={() => setShown(s => s + PAGE)} className="text-sm text-primary hover:underline">Show more ({rows.length - shown} left)</button></div>}
    </div>
  );
}
