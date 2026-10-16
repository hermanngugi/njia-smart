import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useLiveRefresh } from "@/hooks/use-live-refresh";
import { toast } from "sonner";
import { AlertTriangle, Clock, UserX, LayoutGrid, Check, ChevronDown, ChevronUp, Download, Eye, FileText, Upload } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { CompletionInvoiceDialog } from "@/components/completion-invoice-dialog";
import { daysUntil, periodsOverdue, formatDate, formatDateTime } from "@/lib/format";

export const Route = createFileRoute("/_authed/tax")({
  head: () => ({
    meta: [
      { title: "Tax | G.K Nahashon & Company" },
      { name: "description", content: "Policy-driven tax filing: obligation checklist and filing progress." },
    ],
  }),
  component: TaxPage,
});

const TABS = ["Overview", "Checklist", "Filing Record"] as const;
const ALL_TYPES = "__all__";

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

/** PostgREST returns at most 1000 rows per request, so read a table page by page. */
async function fetchAll(page: (from: number, to: number) => PromiseLike<{ data: any[] | null; error: any }>) {
  const size = 1000;
  const out: any[] = [];
  for (let from = 0; ; from += size) {
    const { data, error } = await page(from, from + size - 1);
    if (error || !data) break;
    out.push(...data);
    if (data.length < size) break;
  }
  return out;
}

function TaxPage() {
  const { user, isAdmin, canCreate } = useAuth();
  const [tab, setTab] = useState<(typeof TABS)[number]>("Overview");
  const [policies, setPolicies] = useState<any[]>([]);
  const [returns, setReturns] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [staff, setStaff] = useState<any[]>([]);
  const [obligations, setObligations] = useState<any[]>([]);
  const [collabByReturn, setCollabByReturn] = useState<Map<string, string[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [busyCell, setBusyCell] = useState<string | null>(null);
  const [invoiceFor, setInvoiceFor] = useState<{ id: string; clientName?: string | null; description: string } | null>(null);
  const [clientFilter, setClientFilter] = useState("");
  const [accFilter, setAccFilter] = useState<"all" | "overdue" | "duesoon" | "unassigned">("all");
  const [checklistType, setChecklistType] = useState<string>(ALL_TYPES);
  const [reportType, setReportType] = useState<string>("");
  const [reportFilter, setReportFilter] = useState<"all" | "filed" | "not_filed">("all");
  const [expandedType, setExpandedType] = useState<string | null>(null);
  const attemptedSchedule = useRef<Set<string>>(new Set());
  const [scheduleFailed, setScheduleFailed] = useState<Set<string>>(new Set());
  const [filingDocs, setFilingDocs] = useState<Record<string, any[]>>({});
  const [uploadingDoc, setUploadingDoc] = useState<string | null>(null);

  async function load(silent = false) {
    if (!silent) setLoading(true);
    const [p, r, c, o, s] = await Promise.all([
      supabase.from("tax_policies").select("*").order("sort_order"),
      fetchAll((a, b) => supabase.from("tax_returns")
        .select("id, client_id, return_type, status, due_date, period_start, period_end, assigned_to, filed_at, filed_by, invoice_id")
        .order("due_date").order("id").range(a, b)),
      supabase.from("clients").select("id, company_name").order("company_name"),
      fetchAll((a, b) => supabase.from("client_tax_obligations").select("*").order("id").range(a, b)),
      supabase.from("profiles").select("id, full_name"),
    ]);
    setPolicies((p.data as any[]) ?? []);
    setReturns(r);
    setClients(c.data ?? []);
    setStaff(s.data ?? []);
    setObligations(o as any[]);
    const returnIds = (r as any[]).map((row: any) => row.id).filter(Boolean);
    const filingDocRows = returnIds.length
      ? await fetchAll((a, b) => supabase.from("documents" as any).select("id, tax_return_id, title, file_path, created_at, uploaded_by").in("tax_return_id", returnIds).order("created_at", { ascending: false }).range(a, b))
      : [];
    const docsByReturn: Record<string, any[]> = {};
    (filingDocRows as any[]).forEach((doc: any) => {
      if (!doc.tax_return_id) return;
      if (!docsByReturn[doc.tax_return_id]) docsByReturn[doc.tax_return_id] = [];
      docsByReturn[doc.tax_return_id].push(doc);
    });
    setFilingDocs(docsByReturn);
    const ca = await fetchAll((a, b) => supabase.from("tax_return_assignees" as any).select("id, tax_return_id, user_id").order("id").range(a, b));
    const cm = new Map<string, string[]>();
    (ca as any[]).forEach((c: any) => { if (!cm.has(c.tax_return_id)) cm.set(c.tax_return_id, []); cm.get(c.tax_return_id)!.push(c.user_id); });
    setCollabByReturn(cm);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);
  useLiveRefresh(["tax_returns", "tax_return_assignees", "client_tax_obligations", "documents"], () => load(true));

  const activePolicies = useMemo(() => policies.filter(p => p.active), [policies]);

  // An active obligation with no filing period at all would sit on "Scheduling…" forever.
  // Ask the database to create its first open period (it only does so when none exists).
  useEffect(() => {
    if (loading || !canCreate("tax")) return;
    const activeTypes = new Set(activePolicies.map(p => p.tax_type));
    const have = new Set(returns.map((r: any) => `${r.client_id}:${r.return_type}`));
    const missing = obligations.filter(o => {
      const k = `${o.client_id}:${o.tax_type}`;
      return o.active && activeTypes.has(o.tax_type) && !have.has(k) && !attemptedSchedule.current.has(k);
    });
    if (missing.length === 0) return;
    missing.forEach(o => attemptedSchedule.current.add(`${o.client_id}:${o.tax_type}`));
    (async () => {
      const failed: string[] = [];
      for (let i = 0; i < missing.length; i += 10) {
        await Promise.all(missing.slice(i, i + 10).map(async o => {
          const { error } = await supabase.rpc("set_client_tax_obligation", { _client_id: o.client_id, _tax_type: o.tax_type, _active: true });
          if (error) failed.push(`${o.client_id}:${o.tax_type}`);
        }));
      }
      if (failed.length) setScheduleFailed(prev => new Set([...prev, ...failed]));
      load(true);
    })();
  }, [loading, obligations, returns, activePolicies]);

  async function scheduleNow(clientId: string, taxType: string) {
    const { error } = await supabase.rpc("set_client_tax_obligation", { _client_id: clientId, _tax_type: taxType, _active: true });
    if (error) { toast.error(error.message); return; }
    setScheduleFailed(prev => { const n = new Set(prev); n.delete(`${clientId}:${taxType}`); return n; });
    load(true);
  }
  function renderMissing(clientId: string, taxType: string) {
    return scheduleFailed.has(`${clientId}:${taxType}`) ? (
      <button type="button" onClick={() => scheduleNow(clientId, taxType)} className="text-xs text-primary hover:underline">Not scheduled — schedule now</button>
    ) : (
      <span className="text-xs text-muted-foreground">Scheduling…</span>
    );
  }

  // Reset back to "All types" if the remembered selection is no longer a
  // valid active policy (e.g. it was deactivated elsewhere).
  useEffect(() => {
    if (checklistType === ALL_TYPES) return;
    if (activePolicies.length && !activePolicies.some(p => p.tax_type === checklistType)) {
      setChecklistType(ALL_TYPES);
    }
  }, [activePolicies]);

  const summary = useMemo(() => {
    const today = todayISO();
    return activePolicies.map(pol => {
      const rows = returns.filter(r => r.return_type === pol.tax_type);
      const open = rows.filter(r => r.status !== "filed");
      const overdue = open.filter(r => r.due_date && r.due_date < today).length;
      const filed = rows.length - open.length;
      const obligated = obligations.filter(o => o.tax_type === pol.tax_type && o.active).length;
      return { ...pol, open: open.length, overdue, filed, obligated };
    });
  }, [activePolicies, returns, obligations]);

  const obligationMap = useMemo(() => {
    const m = new Map<string, boolean>();
    obligations.forEach(o => m.set(`${o.client_id}:${o.tax_type}`, o.active));
    return m;
  }, [obligations]);

  const filteredClients = useMemo(
    () => clients.filter(c => !clientFilter || c.company_name?.toLowerCase().includes(clientFilter.toLowerCase())),
    [clients, clientFilter]
  );

  const staffMap = useMemo(() => new Map(staff.map((s: any) => [s.id, s.full_name])), [staff]);

  const returnsByKey = useMemo(() => {
    const m = new Map<string, any[]>();
    returns.forEach((r: any) => {
      const k = `${r.client_id}:${r.return_type}`;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(r);
    });
    return m;
  }, [returns]);

  // The row that matters right now for a client+type: the earliest-due open
  // filing if one exists, otherwise the most recent filed one.
  function currentReturn(clientId: string, taxType: string) {
    const list = returnsByKey.get(`${clientId}:${taxType}`) ?? [];
    if (list.length === 0) return null;
    const open = list.filter(r => r.status !== "filed").sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? ""));
    if (open.length) return open[0];
    return [...list].sort((a, b) => (b.due_date ?? "").localeCompare(a.due_date ?? ""))[0];
  }

  // Accountability flags computed across ALL clients (not just the text
  // search) so the summary chips always reflect the true picture.
  const accStats = useMemo(() => {
    const overdue = new Set<string>();
    const duesoon = new Set<string>();
    const unassigned = new Set<string>();
    let overdueCells = 0, duesoonCells = 0, unassignedCells = 0;
    clients.forEach(c => {
      activePolicies.forEach(pol => {
        if (!obligationMap.get(`${c.id}:${pol.tax_type}`)) return;
        const cur = currentReturn(c.id, pol.tax_type);
        if (!cur || cur.status === "filed") return;
        const over = periodsOverdue(cur.due_date, pol.cadence);
        const d = daysUntil(cur.due_date);
        if (over >= 1) { overdue.add(c.id); overdueCells++; }
        else if (d !== null && d >= 0 && d <= 7) { duesoon.add(c.id); duesoonCells++; }
        if (!cur.assigned_to) { unassigned.add(c.id); unassignedCells++; }
      });
    });
    return { flagged: { overdue, duesoon, unassigned }, overdueCells, duesoonCells, unassignedCells };
  }, [clients, activePolicies, obligationMap, returnsByKey]);

  const obligatedClientCount = useMemo(
    () => clients.filter(c => activePolicies.some(p => obligationMap.get(`${c.id}:${p.tax_type}`))).length,
    [clients, activePolicies, obligationMap]
  );

  const displayClients = useMemo(() => {
    if (accFilter === "all") return filteredClients;
    const set = accStats.flagged[accFilter];
    return filteredClients.filter(c => set.has(c.id));
  }, [filteredClients, accFilter, accStats]);

  // One row per obligated client x type — the same source data as the
  // checklist, just flattened into a filed / not-filed report.
  const reportRows = useMemo(() => {
    const rows: { key: string; client: any; pol: any; cur: any; filed: boolean }[] = [];
    const scopedPolicies = reportType ? activePolicies.filter(p => p.tax_type === reportType) : activePolicies;
    filteredClients.forEach(c => {
      scopedPolicies.forEach(pol => {
        if (!obligationMap.get(`${c.id}:${pol.tax_type}`)) return;
        const list = returnsByKey.get(`${c.id}:${pol.tax_type}`) ?? [];
        // The period still to be filed (or nothing scheduled yet)...
        if (list.length === 0 || list.some(r => r.status !== "filed")) {
          const cur = currentReturn(c.id, pol.tax_type);
          rows.push({ key: cur?.id ?? `${c.id}:${pol.tax_type}`, client: c, pol, cur, filed: false });
        }
        // ...and every period already filed stays on record with the date it was filed.
        list.filter(r => r.status === "filed")
          .sort((x, y) => (y.filed_at ?? y.due_date ?? "").localeCompare(x.filed_at ?? x.due_date ?? ""))
          .forEach(r => rows.push({ key: r.id, client: c, pol, cur: r, filed: true }));
      });
    });
    return rows;
  }, [filteredClients, activePolicies, reportType, obligationMap, returnsByKey]);

  const filteredReportRows = useMemo(() => {
    if (reportFilter === "all") return reportRows;
    return reportRows.filter(r => (reportFilter === "filed" ? r.filed : !r.filed));
  }, [reportRows, reportFilter]);

  async function uploadFilingDocument(returnId: string, clientId: string, file: File) {
    if (!file || !user?.id) return;
    setUploadingDoc(returnId);
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, "-");
    const path = `tax-filings/${clientId}/${returnId}/${Date.now()}-${safeName}`;
    const upload = await supabase.storage.from("client-documents").upload(path, file, { upsert: false, contentType: file.type || undefined });
    if (upload.error) {
      setUploadingDoc(null);
      toast.error(upload.error.message);
      return;
    }

    const { error: docError } = await supabase.from("documents" as any).insert({
      client_id: clientId,
      tax_return_id: returnId,
      title: file.name,
      file_path: path,
      uploaded_by: user.id,
      version: 1,
    } as any);

    if (docError) {
      await supabase.storage.from("client-documents").remove([path]);
      toast.error(docError.message);
    } else {
      toast.success("Filing proof uploaded");
      await load();
    }
    setUploadingDoc(null);
  }

  function chooseFilingDocument(returnId: string, clientId: string) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.xls,.xlsx";
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) void uploadFilingDocument(returnId, clientId, file);
    };
    input.click();
  }

  async function openFilingDocument(doc: any, download = false) {
    if (!doc?.file_path) return;
    const { data, error } = await supabase.storage.from("client-documents").createSignedUrl(doc.file_path, 600, download ? { download: doc.title || true } : undefined);
    if (error || !data?.signedUrl) {
      toast.error(error?.message ?? "Could not open the filing document.");
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  function filingDocumentCell(row: any) {
    const docs = filingDocs[row.cur?.id] ?? [];
    const latest = docs[0];
    if (!row.cur) return <span className="text-muted-foreground">—</span>;
    return (
      <div className="min-w-[190px] space-y-1">
        {latest ? (
          <>
            <div className="flex items-center gap-1.5 text-xs font-medium max-w-[240px]" title={latest.title}>
              <FileText className="h-3.5 w-3.5 shrink-0 text-primary" />
              <span className="truncate">{latest.title}</span>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => openFilingDocument(latest)} className="text-[11px] text-primary hover:underline inline-flex items-center gap-1">
                <Eye className="h-3 w-3" /> View
              </button>
              <button type="button" onClick={() => openFilingDocument(latest, true)} className="text-[11px] text-primary hover:underline inline-flex items-center gap-1">
                <Download className="h-3 w-3" /> Download
              </button>
              {canCreate("tax") && (
                <button type="button" onClick={() => chooseFilingDocument(row.cur.id, row.client.id)} disabled={uploadingDoc === row.cur.id} className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
                  <Upload className="h-3 w-3" /> {uploadingDoc === row.cur.id ? "Uploading…" : "Replace"}
                </button>
              )}
            </div>
            {docs.length > 1 && <div className="text-[10px] text-muted-foreground">{docs.length} documents linked</div>}
          </>
        ) : canCreate("tax") ? (
          <button type="button" onClick={() => chooseFilingDocument(row.cur.id, row.client.id)} disabled={uploadingDoc === row.cur.id} className="text-xs text-primary hover:underline inline-flex items-center gap-1">
            <Upload className="h-3.5 w-3.5" /> {uploadingDoc === row.cur.id ? "Uploading…" : "Upload filing proof"}
          </button>
        ) : (
          <span className="text-xs text-muted-foreground">No document</span>
        )}
      </div>
    );
  }

  async function toggleObligation(clientId: string, taxType: string, next: boolean) {
    const key = `${clientId}:${taxType}`;
    setBusyCell(key);
    const { error } = await supabase.rpc("set_client_tax_obligation", {
      _client_id: clientId, _tax_type: taxType, _active: next,
    });
    setBusyCell(null);
    if (error) toast.error(error.message);
    else load();
  }

  // Mark a filing filed (or reopen it) directly from the Checklist / Overview,
  // without needing to drill into the per-type page first.
  async function markFiled(returnId: string, filed: boolean, skipInvoice = false) {
    // A filing can't be marked filed until an invoice exists for it.
    if (filed && !skipInvoice) {
      const r = returns.find((x: any) => x.id === returnId);
      if (r && r.status !== "filed" && !r.invoice_id) {
        const c = clients.find((x: any) => x.id === r.client_id);
        const pol = policies.find((x: any) => x.tax_type === r.return_type);
        setInvoiceFor({ id: returnId, clientName: c?.company_name, description: `${pol?.label ?? r.return_type} filing — period ending ${formatDate(r.period_end)}` });
        return;
      }
    }
    setBusyCell(returnId);
    const { data, error } = await supabase.from("tax_returns").update({ status: filed ? "filed" : "pending" }).eq("id", returnId).select("id");
    setBusyCell(null);
    if (error) toast.error(error.message);
    else if (!data || data.length === 0) toast.error("You don't have permission to update this filing.");
    else { toast.success(filed ? "Marked filed — next period scheduled" : "Reopened"); load(true); }
  }

  // The checklist only lists clients who are obligated for that tax type —
  // each row is the client's current filing. Obligations are added from the
  // client's own Tax tab, so un-obligated clients are never listed here.
  function obligatedRows(pol: any) {
    return displayClients.filter(c => obligationMap.get(`${c.id}:${pol.tax_type}`));
  }

  function renderChecklistTable(pol: any, rows: any[] = obligatedRows(pol)) {
    return (
      <div key={pol.tax_type} className="bg-card border rounded-lg overflow-hidden">
        <div className="px-3 py-2 border-b text-xs text-muted-foreground flex items-center justify-between gap-3">
          <span>
            <span className="font-medium text-foreground">{pol.label}</span> — {rows.length} obligated client{rows.length === 1 ? "" : "s"}. Tick "Filed" once submitted to auto-renew the next period.
          </span>
          <span className="capitalize whitespace-nowrap">{pol.cadence} · due day {pol.due_day}</span>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-xs text-muted-foreground border-b">
            <tr><th className="py-2 px-3">Client</th><th className="py-2 px-3">Current filing</th><th className="py-2 px-3 w-28">Filed?</th><th className="py-2 px-3 w-24"></th></tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={4} className="py-8 text-center text-muted-foreground">No obligated clients{clientFilter || accFilter !== "all" ? " match your filters" : ` for ${pol.label} yet — add the obligation from the client's Tax tab`}.</td></tr>}
            {rows.map(c => {
              const key = `${c.id}:${pol.tax_type}`;
              const cur = currentReturn(c.id, pol.tax_type);
              return (
                <tr key={c.id} className="border-b last:border-0 hover:bg-muted/20">
                  <td className="py-1.5 px-3 font-medium">{c.company_name}</td>
                  <td className="py-1.5 px-3">
                    {!cur ? (
                      renderMissing(c.id, pol.tax_type)
                    ) : (
                      <Link to="/tax/$type" params={{ type: pol.tax_type }} search={{ client: c.id }} className="inline-block hover:opacity-80">
                        <ChecklistCell row={cur} cadence={pol.cadence} assigneeName={cur.assigned_to ? staffMap.get(cur.assigned_to) : null} />
                      </Link>
                    )}
                  </td>
                  <td className="py-1.5 px-3">
                    {cur && (
                      <label className="inline-flex items-center gap-1.5 cursor-pointer text-xs" title={cur.status === "filed" ? "Filed — uncheck to reopen" : "Check off once filed"}>
                        <input
                          type="checkbox"
                          checked={cur.status === "filed"}
                          disabled={busyCell === cur.id}
                          onChange={e => markFiled(cur.id, e.target.checked)}
                        />
                        {cur.status === "filed" ? "Filed" : "Mark filed"}
                      </label>
                    )}
                  </td>
                  <td className="py-1.5 px-3 text-right">
                    {isAdmin && (
                      <button
                        type="button"
                        disabled={busyCell === key}
                        onClick={() => { if (confirm(`Stop the ${pol.label} obligation for ${c.company_name}? Open filings stay, but nothing new is scheduled.`)) toggleObligation(c.id, pol.tax_type, false); }}
                        className="text-[11px] text-muted-foreground hover:text-destructive"
                      >
                        Stop
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Tax</h1>
        <p className="text-sm text-muted-foreground">Each tax type follows its own policy — file the current period and the next one is scheduled automatically.</p>
      </div>

      <div className="flex flex-wrap gap-1 border-b">
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)} className={`px-3 py-2 text-sm border-b-2 transition-colors ${tab === t ? "border-primary text-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground"}`}>{t}</button>
        ))}
      </div>

      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}

      {!loading && tab === "Overview" && (
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {summary.length === 0 && (
            <div className="col-span-full bg-card border rounded-lg p-8 text-center text-muted-foreground text-sm">
              No active tax policies yet. Ask an admin to configure one under Settings.
            </div>
          )}
          {summary.map(s => {
            const expanded = expandedType === s.tax_type;
            return (
              <button
                key={s.tax_type}
                onClick={() => setExpandedType(expanded ? null : s.tax_type)}
                className={`text-left bg-card border rounded-lg p-3 hover:border-primary/60 hover:shadow-sm transition block ${expanded ? "ring-2 ring-primary border-primary" : ""}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-medium">{s.label}</div>
                  <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground whitespace-nowrap">
                    <span className="capitalize">{s.cadence} · due {s.due_day}</span>
                    {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                  </div>
                </div>
                <div className="text-2xl font-bold mt-1">{s.open}</div>
                <div className="text-xs text-muted-foreground">
                  open · {s.obligated} client{s.obligated === 1 ? "" : "s"} obligated
                  {s.overdue > 0 && <span className="text-destructive"> · {s.overdue} overdue</span>}
                </div>
              </button>
            );
          })}

          {expandedType && (() => {
            const pol = activePolicies.find(p => p.tax_type === expandedType);
            if (!pol) return null;
            const obligatedClients = clients.filter(c => obligationMap.get(`${c.id}:${pol.tax_type}`));
            return (
              <div className="col-span-full bg-card border rounded-lg overflow-hidden">
                <div className="px-3 py-2 border-b flex items-center justify-between gap-3">
                  <span className="text-sm font-medium">{pol.label} — obligated clients ({obligatedClients.length})</span>
                  <Link to="/tax/$type" params={{ type: pol.tax_type }} className="text-xs text-primary hover:underline whitespace-nowrap">Open full checklist →</Link>
                </div>
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-left text-xs text-muted-foreground border-b">
                    <tr><th className="py-2 px-3">Client</th><th className="py-2 px-3">Current filing</th></tr>
                  </thead>
                  <tbody>
                    {obligatedClients.length === 0 && <tr><td colSpan={2} className="py-6 text-center text-muted-foreground">No clients are obligated for {pol.label} yet — set this up under the Checklist tab.</td></tr>}
                    {obligatedClients.map(c => {
                      const cur = currentReturn(c.id, pol.tax_type);
                      return (
                        <tr key={c.id} className="border-b last:border-0 hover:bg-muted/20">
                          <td className="py-1.5 px-3 font-medium">{c.company_name}</td>
                          <td className="py-1.5 px-3">
                            {!cur ? (
                              renderMissing(c.id, pol.tax_type)
                            ) : (
                              <Link to="/tax/$type" params={{ type: pol.tax_type }} search={{ client: c.id }} className="inline-block hover:opacity-80">
                                <ChecklistCell row={cur} cadence={pol.cadence} assigneeName={cur.assigned_to ? staffMap.get(cur.assigned_to) : null} />
                              </Link>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          })()}
        </div>
      )}

      {!loading && tab === "Checklist" && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2 items-center">
            <div>
              <label className="text-xs font-medium text-muted-foreground mr-2">Tax type</label>
              <select value={checklistType} onChange={e => setChecklistType(e.target.value)} className="h-9 px-3 rounded-md border bg-background text-sm min-w-[180px]">
                <option value={ALL_TYPES}>All types</option>
                {activePolicies.map(p => <option key={p.tax_type} value={p.tax_type}>{p.label}</option>)}
              </select>
            </div>
            <input placeholder="Filter clients…" value={clientFilter} onChange={e => setClientFilter(e.target.value)} className="h-9 w-64 px-3 rounded-md border bg-background text-sm" />
            <div className="flex flex-wrap gap-2 ml-auto">
              <ChecklistChip active={accFilter === "all"} onClick={() => setAccFilter("all")} icon={LayoutGrid} label="All obligated" value={obligatedClientCount} tone="muted" />
              <ChecklistChip active={accFilter === "overdue"} onClick={() => setAccFilter("overdue")} icon={AlertTriangle} label="Overdue" value={accStats.flagged.overdue.size} tone="destructive" />
              <ChecklistChip active={accFilter === "duesoon"} onClick={() => setAccFilter("duesoon")} icon={Clock} label="Due ≤7 days" value={accStats.flagged.duesoon.size} tone="amber" />
              <ChecklistChip active={accFilter === "unassigned"} onClick={() => setAccFilter("unassigned")} icon={UserX} label="Unassigned" value={accStats.flagged.unassigned.size} tone="amber" />
            </div>
          </div>

          {activePolicies.length === 0 ? (
            <p className="text-sm text-muted-foreground p-4">No active tax policies yet. Ask an admin to configure one under Settings.</p>
          ) : checklistType === ALL_TYPES ? (
            (() => {
              const groups = activePolicies
                .map(pol => ({ pol, rows: obligatedRows(pol) }))
                .filter(g => g.rows.length > 0);
              return groups.length === 0 ? (
                <p className="text-sm text-muted-foreground p-4">
                  No obligated clients{clientFilter || accFilter !== "all" ? " match your filters" : " yet — add tax obligations from a client's Tax tab"}.
                </p>
              ) : (
                <div className="space-y-4">
                  {groups.map(g => renderChecklistTable(g.pol, g.rows))}
                </div>
              );
            })()
          ) : (
            (() => {
              const pol = activePolicies.find(p => p.tax_type === checklistType);
              return pol ? renderChecklistTable(pol) : null;
            })()
          )}
        </div>
      )}

      {!loading && tab === "Filing Record" && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2 items-center">
            <div>
              <label className="text-xs font-medium text-muted-foreground mr-2">Tax type</label>
              <select value={reportType} onChange={e => setReportType(e.target.value)} className="h-9 px-3 rounded-md border bg-background text-sm min-w-[180px]">
                <option value="">All types</option>
                {activePolicies.map(p => <option key={p.tax_type} value={p.tax_type}>{p.label}</option>)}
              </select>
            </div>
            <input placeholder="Filter clients…" value={clientFilter} onChange={e => setClientFilter(e.target.value)} className="h-9 w-64 px-3 rounded-md border bg-background text-sm" />
            <div className="flex flex-wrap gap-2 ml-auto">
              <ChecklistChip active={reportFilter === "all"} onClick={() => setReportFilter("all")} icon={LayoutGrid} label="All" value={reportRows.length} tone="muted" />
              <ChecklistChip active={reportFilter === "filed"} onClick={() => setReportFilter("filed")} icon={Check} label="Filed" value={reportRows.filter(r => r.filed).length} tone="muted" />
              <ChecklistChip active={reportFilter === "not_filed"} onClick={() => setReportFilter("not_filed")} icon={AlertTriangle} label="Not filed" value={reportRows.filter(r => !r.filed).length} tone="destructive" />
            </div>
          </div>

          <div className="bg-card border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-xs text-muted-foreground border-b">
                <tr><th className="py-2 px-3">Client</th><th className="py-2 px-3">Tax type</th><th className="py-2 px-3">Status</th><th className="py-2 px-3">Period ending</th><th className="py-2 px-3">Due date</th><th className="py-2 px-3">Assigned to</th><th className="py-2 px-3">Filed on</th><th className="py-2 px-3">Filing document</th></tr>
              </thead>
              <tbody>
                {filteredReportRows.length === 0 && <tr><td colSpan={8} className="py-8 text-center text-muted-foreground">No obligations match this view.</td></tr>}
                {filteredReportRows.map(row => (
                  <tr key={row.key} className="border-b last:border-0 hover:bg-muted/20">
                    <td className="py-1.5 px-3 font-medium">{row.client.company_name}</td>
                    <td className="py-1.5 px-3 text-xs text-muted-foreground">{row.pol.label}</td>
                    <td className="py-1.5 px-3">
                      {row.filed ? (
                        <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200"><Check className="h-3 w-3" /> Filed</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-100">Not filed</span>
                      )}
                    </td>
                    <td className="py-1.5 px-3 text-xs">{row.cur?.period_end ? formatDate(row.cur.period_end) : "—"}</td>
                    <td className="py-1.5 px-3 text-xs">{row.cur?.due_date ? formatDate(row.cur.due_date) : "—"}</td>
                    <td className="py-1.5 px-3 text-xs">
                      {(() => {
                        const ids = [row.cur?.assigned_to, ...(row.cur ? collabByReturn.get(row.cur.id) ?? [] : [])].filter(Boolean) as string[];
                        const names = [...new Set(ids)].map(id => staffMap.get(id) ?? "Unknown");
                        return names.length ? names.join(", ") : <span className="text-muted-foreground">Unassigned</span>;
                      })()}
                    </td>
                    <td className="py-1.5 px-3 text-xs text-muted-foreground">
                      {row.filed && row.cur?.filed_at ? (
                        <>
                          <div>{formatDateTime(row.cur.filed_at)}</div>
                          {row.cur.filed_by && staffMap.get(row.cur.filed_by) && <div className="text-[10px]">by {staffMap.get(row.cur.filed_by)}</div>}
                        </>
                      ) : "—"}
                    </td>
                    <td className="py-1.5 px-3">{filingDocumentCell(row)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">Feeds straight from the checklist — each obligated client's open period, plus every period already filed with the date it was filed. Filter by type or search a client above.</p>
        </div>
      )}

      {invoiceFor && (
        <CompletionInvoiceDialog
          open
          onOpenChange={o => { if (!o) setInvoiceFor(null); }}
          source="tax_returns"
          sourceId={invoiceFor.id}
          clientName={invoiceFor.clientName}
          defaultDescription={invoiceFor.description}
          onInvoiced={async () => { await markFiled(invoiceFor.id, true, true); setInvoiceFor(null); }}
        />
      )}
    </div>
  );
}

function ChecklistChip({ active, onClick, icon: Icon, label, value, tone }: {
  active: boolean; onClick: () => void; icon: any; label: string; value: number; tone: "muted" | "destructive" | "amber";
}) {
  const toneClasses = tone === "destructive"
    ? (active ? "bg-destructive text-destructive-foreground border-destructive" : "border-destructive/30 text-destructive hover:bg-destructive/10")
    : tone === "amber"
    ? (active ? "bg-amber-500 text-white border-amber-500" : "border-amber-400/50 text-amber-700 dark:text-amber-300 hover:bg-amber-500/10")
    : (active ? "bg-primary text-primary-foreground border-primary" : "border-muted-foreground/30 text-muted-foreground hover:bg-muted");
  return (
    <button onClick={onClick} className={`h-8 px-2.5 rounded-full border text-xs inline-flex items-center gap-1.5 transition-colors ${toneClasses}`}>
      <Icon className="h-3.5 w-3.5" /> {label} <span className="font-semibold">{value}</span>
    </button>
  );
}

function ChecklistCell({ row, cadence, assigneeName }: { row: any; cadence: string; assigneeName?: string | null }) {
  const over = periodsOverdue(row.due_date, cadence);
  const d = daysUntil(row.due_date);
  const filed = row.status === "filed";
  const statusClass = filed
    ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200"
    : over >= 1
    ? "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200"
    : row.status === "in_progress"
    ? "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200"
    : "bg-muted text-muted-foreground";
  const initials = assigneeName ? assigneeName.split(" ").map((s: string) => s[0]).slice(0, 2).join("").toUpperCase() : null;

  return (
    <div className="inline-flex flex-col items-center gap-0.5">
      <span className={`text-[11px] px-2 py-0.5 rounded-full capitalize ${statusClass}`}>
        {filed ? "Filed" : row.status.replace(/_/g, " ")}
      </span>
      {!filed && (
        <span className={`text-[10px] ${over >= 1 ? "text-destructive font-medium" : d !== null && d <= 7 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}>
          {over >= 1 ? `${over}× overdue` : d !== null ? (d < 0 ? "overdue" : d === 0 ? "due today" : `due in ${d}d`) : "no due date"}
        </span>
      )}
      {!filed && (
        initials ? (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground" title={assigneeName ?? undefined}>{initials}</span>
        ) : (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-100 inline-flex items-center gap-0.5">
            <UserX className="h-2.5 w-2.5" /> Unassigned
          </span>
        )
      )}
    </div>
  );
}
