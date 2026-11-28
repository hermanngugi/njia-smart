import { createFileRoute, Link, Outlet, useChildMatches } from "@tanstack/react-router";
import { openStoredFile } from "@/lib/client-files";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Plus, X, Trash2, FileText, Wallet, AlertCircle, TrendingUp, Paperclip, Receipt, Download, RefreshCw } from "lucide-react";
import { formatDate, STATUS_COLORS } from "@/lib/format";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/_authed/accounts")({
  validateSearch: (s: Record<string, unknown>) => ({
    filter: s.filter === "outstanding" || s.filter === "overdue" || s.filter === "collected" ? s.filter : undefined,
  }),
  component: AccountsRoute,
});

// /accounts/$id (invoice) and /accounts/quickbooks are child routes. Without an <Outlet />
// the parent keeps rendering this list and the child page never opens.
function AccountsRoute() {
  const childMatches = useChildMatches();
  if (childMatches.length > 0) return <Outlet />;
  return <AccountsPage />;
}

const STATUS = ["draft", "sent", "partial", "paid", "overdue"];
const SERVICE_LINES = [
  "Audit", "Tax", "Advisory", "Accounting", "Bookkeeping",
  "Outsourced Accounting", "Payroll Management", "Financial Business Management", "ICT",
  "Other",
];
const METHODS = ["mpesa", "bank", "cash", "cheque", "card"];

async function openReceipt(path: string) {
  await openStoredFile("payment-receipts", path, 300);
}

function money(n: number) {
  return "KES " + Number(n || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Net N days between issue and due date (0 or less = due on receipt).
function termsOf(issue?: string | null, due?: string | null) {
  if (!issue || !due) return "—";
  const d = Math.round((new Date(due).getTime() - new Date(issue).getTime()) / 86400000);
  return d <= 0 ? "Due on receipt" : `Net ${d}`;
}
function itemsOf(r: any) {
  const list = [...(r.invoice_items ?? [])].sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  return list.map((i: any) => i.description).filter(Boolean).join("; ");
}
function csvCell(v: any) {
  const t = v == null ? "" : String(v);
  return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

function AccountsPage() {
  const { isAdmin, user } = useAuth();
  // Director/Admin see the whole book. Everyone else only sees invoices raised
  // on their own clients (enforced by RLS too) and never the firm-wide totals.
  const restricted = !isAdmin;
  const search = Route.useSearch();
  const [rows, setRows] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [amountFilter, setAmountFilter] = useState<"all" | "outstanding" | "overdue" | "collected">(search.filter ?? "all");
  // Who handled the client's account when the invoice was raised. Kept in its
  // own table (invoice_handlers) and shown only here, never on the invoice.
  const [staff, setStaff] = useState<any[]>([]);
  const [handlersByInvoice, setHandlersByInvoice] = useState<Record<string, string[]>>({});
  const [handlerFilter, setHandlerFilter] = useState<string>("all"); // "all" | "none" | user id
  const [open, setOpen] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  const in30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const [form, setForm] = useState<any>({ client_id: "", issue_date: today, due_date: in30, service_line: "Audit", vat_rate: 16, notes: "", initial_amount: 0, initial_description: "Professional services" });

  // Standalone payments
  const [payments, setPayments] = useState<any[]>([]);
  const [payOpen, setPayOpen] = useState(false);
  const [pay, setPay] = useState<any>({ client_id: "", invoice_id: "", amount: 0, payment_date: today, method: "mpesa", reference: "", notes: "" });
  const [payFile, setPayFile] = useState<File | null>(null);
  const [savingPay, setSavingPay] = useState(false);

  async function load() {
    const [i, c, p, prof] = await Promise.all([
      supabase.from("invoices").select("*, clients(company_name), invoice_items(description, sort_order)").order("issue_date", { ascending: false }),
      supabase.from("clients").select("id, company_name").order("company_name"),
      supabase.from("payments").select("*, clients(company_name), invoices(invoice_number)").order("payment_date", { ascending: false }).limit(50),
      supabase.from("profiles").select("id, full_name").order("full_name"),
    ]);
    if (i.error) toast.error(i.error.message);
    setRows(i.data ?? []);
    // Restricted users can only bill/receive against clients assigned to them
    // (plus clients already on one of their invoices).
    let clientList = c.data ?? [];
    if (restricted && user) {
      const { data: mine } = await supabase.from("client_assignments").select("client_id").eq("user_id", user.id);
      const ids = new Set<string>([...((mine as any[]) ?? []).map(m => m.client_id), ...(i.data ?? []).map((r: any) => r.client_id)]);
      clientList = clientList.filter((cl: any) => ids.has(cl.id));
    }
    setClients(clientList);
    setPayments(p.data ?? []);
    setStaff(prof.data ?? []);

    // Handlers, paged so a large book isn't cut off at the 1000-row default.
    const map: Record<string, string[]> = {};
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.from("invoice_handlers" as any).select("invoice_id, user_id").order("id").range(from, from + 999);
      if (error) { toast.error(error.message); break; }
      ((data as any[]) ?? []).forEach(h => { (map[h.invoice_id] ??= []).push(h.user_id); });
      if (!data || data.length < 1000) break;
    }
    setHandlersByInvoice(map);
  }
  useEffect(() => { load(); }, [user?.id, isAdmin]);

  const staffName = (id: string) => staff.find(s => s.id === id)?.full_name ?? "Unknown";
  const handlerNames = (invoiceId: string) => (handlersByInvoice[invoiceId] ?? []).map(staffName);

  async function createInvoice(e: React.FormEvent) {
    e.preventDefault();
    if (!form.client_id) return toast.error("Select a client");
    const { data: numRes, error: numErr } = await supabase.rpc("next_invoice_number");
    if (numErr) return toast.error(numErr.message);
    const { data: { user } } = await supabase.auth.getUser();
    const { initial_amount, initial_description, ...invForm } = form;
    // service_line is stored as the display label; the database normalizes it too.
    const { data, error } = await supabase.from("invoices")
      .insert({ ...invForm, invoice_number: numRes, created_by: user?.id })
      .select().single();
    if (error) return toast.error(error.message);
    if (Number(initial_amount) > 0) {
      await supabase.from("invoice_items").insert({
        invoice_id: data.id,
        description: initial_description || "Professional services",
        quantity: 1,
        unit_price: Number(initial_amount),
        amount: Number(initial_amount),
        sort_order: 0,
      });
    }
    toast.success("Invoice created");
    setOpen(false);
    window.location.href = `/accounts/${data.id}`;
  }

  async function recordPayment(e: React.FormEvent) {
    e.preventDefault();
    if (!pay.client_id) return toast.error("Select a client");
    if (!pay.amount) return toast.error("Enter amount");
    setSavingPay(true);
    const { data: { user } } = await supabase.auth.getUser();
    let receipt_url: string | null = null;
    let receipt_path: string | null = null;
    if (payFile) {
      const ext = payFile.name.split(".").pop() || "bin";
      const path = `${pay.client_id}/standalone/${Date.now()}.${ext}`;
      const up = await supabase.storage.from("payment-receipts").upload(path, payFile);
      if (up.error) { setSavingPay(false); return toast.error(up.error.message); }
      receipt_path = path;
      receipt_url = supabase.storage.from("payment-receipts").getPublicUrl(path).data.publicUrl;
    }
    const { error } = await supabase.from("payments").insert({
      client_id: pay.client_id,
      invoice_id: pay.invoice_id || null,
      amount: Number(pay.amount),
      payment_date: pay.payment_date,
      method: pay.method,
      reference: pay.reference || null,
      notes: pay.notes || null,
      receipt_url, receipt_path,
      recorded_by: user?.id,
    });
    setSavingPay(false);
    if (error) return toast.error(error.message);
    toast.success("Payment recorded");
    setPayOpen(false);
    setPay({ client_id: "", invoice_id: "", amount: 0, payment_date: today, method: "mpesa", reference: "", notes: "" });
    setPayFile(null);
    load();
  }

  async function del(id: string) {
    if (!confirm("Delete this invoice and its payments?")) return;
    const { error } = await supabase.from("invoices").delete().eq("id", id);
    if (error) toast.error(error.message); else { toast.success("Deleted"); load(); }
  }

  // One person's portfolio = invoices raised on clients they were assigned to.
  const portfolioRows = useMemo(() => rows.filter(r =>
    handlerFilter === "all" ? true
      : handlerFilter === "none" ? (handlersByInvoice[r.id] ?? []).length === 0
      : (handlersByInvoice[r.id] ?? []).includes(handlerFilter)
  ), [rows, handlerFilter, handlersByInvoice]);

  const filtered = useMemo(() => portfolioRows.filter(r =>
    (statusFilter === "all" || r.status === statusFilter) &&
    (amountFilter === "all" ||
      (amountFilter === "outstanding" && Number(r.total || 0) > Number(r.amount_paid || 0)) ||
      (amountFilter === "overdue" && r.status === "overdue" && Number(r.total || 0) > Number(r.amount_paid || 0)) ||
      (amountFilter === "collected" && Number(r.amount_paid || 0) > 0)) &&
    (!q || r.invoice_number?.toLowerCase().includes(q.toLowerCase()) ||
      r.clients?.company_name?.toLowerCase().includes(q.toLowerCase()))
  ), [portfolioRows, q, statusFilter, amountFilter]);

  // Totals follow the selected person's portfolio (all invoices when none is picked).
  const kpi = useMemo(() => {
    const billed = portfolioRows.reduce((s, r) => s + Number(r.total || 0), 0);
    const collected = portfolioRows.reduce((s, r) => s + Number(r.amount_paid || 0), 0);
    const outstanding = billed - collected;
    const overdue = portfolioRows.filter(r => r.status === "overdue").reduce((s, r) => s + (Number(r.total) - Number(r.amount_paid)), 0);
    return { billed, collected, outstanding, overdue };
  }, [portfolioRows]);

  // Exports exactly what is on screen (so a person's portfolio exports as theirs).
  function exportCsv() {
    if (filtered.length === 0) return toast.error("Nothing to export");
    const header = ["Invoice Number", "Customer", "Date", "Due", "Terms", "Item", "Due Receipt", "Handled By", "Service Line", "Total", "Paid", "Status"];
    const lines = filtered.map(r => [
      r.invoice_number, r.clients?.company_name ?? "", r.issue_date ?? "", r.due_date ?? "",
      termsOf(r.issue_date, r.due_date), itemsOf(r),
      (Number(r.total || 0) - Number(r.amount_paid || 0)).toFixed(2),
      handlerNames(r.id).join("; "),
      r.service_line ?? "", Number(r.total || 0).toFixed(2), Number(r.amount_paid || 0).toFixed(2), r.status ?? "",
    ].map(csvCell).join(","));
    const csv = "\uFEFF" + [header.map(csvCell).join(","), ...lines].join("\r\n");
    const who = restricted ? "my" : handlerFilter === "all" ? "all" : handlerFilter === "none" ? "unassigned" : staffName(handlerFilter).toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = `invoices-${who}-${today}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div>
          <h1 className="text-2xl font-bold">Accounts & Billing</h1>
          <p className="text-sm text-muted-foreground">{restricted ? `${rows.length} of your invoices` : `${rows.length} invoices`}</p>
        </div>
        <div className="flex gap-2">
          {!restricted && (
            <Link to="/accounts/quickbooks" className="inline-flex items-center gap-2 px-3 h-9 rounded-md border text-sm font-medium">
              <RefreshCw className="h-4 w-4" /> QuickBooks
            </Link>
          )}
          <button onClick={() => setPayOpen(true)} className="inline-flex items-center gap-2 px-3 h-9 rounded-md border text-sm font-medium">
            <Receipt className="h-4 w-4" /> Record Payment
          </button>
          {!restricted && (
            <button onClick={() => setOpen(true)} className="inline-flex items-center gap-2 px-3 h-9 rounded-md bg-primary text-primary-foreground text-sm font-medium">
              <Plus className="h-4 w-4" /> New Invoice
            </button>
          )}
        </div>
      </div>

      {/* KPIs: firm-wide totals are for Director/Admin only */}
      {!restricted && (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Total Billed" value={money(kpi.billed)} icon={<FileText className="h-4 w-4" />} tone="blue" onClick={() => { setAmountFilter("all"); setStatusFilter("all"); }} />
        <Kpi label="Collected" value={money(kpi.collected)} icon={<Wallet className="h-4 w-4" />} tone="emerald" onClick={() => { setAmountFilter("collected"); setStatusFilter("all"); }} />
        <Kpi label="Outstanding" value={money(kpi.outstanding)} icon={<TrendingUp className="h-4 w-4" />} tone="amber" onClick={() => { setAmountFilter("outstanding"); setStatusFilter("all"); }} />
        <Kpi label="Overdue" value={money(kpi.overdue)} icon={<AlertCircle className="h-4 w-4" />} tone="red" onClick={() => { setAmountFilter("overdue"); setStatusFilter("all"); }} />
      </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search invoice # or client…" className="h-9 px-3 rounded-md border bg-background text-sm w-64" />
        <select value={amountFilter} onChange={e => setAmountFilter(e.target.value as typeof amountFilter)} className="h-9 px-2 rounded-md border bg-background text-sm">
          <option value="all">All balances</option>
          <option value="outstanding">Outstanding</option>
          <option value="overdue">Overdue</option>
          <option value="collected">Has payments</option>
        </select>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="h-9 px-2 rounded-md border bg-background text-sm">
          <option value="all">All statuses</option>
          {STATUS.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        {!restricted && (
          <select value={handlerFilter} onChange={e => setHandlerFilter(e.target.value)} className="h-9 px-2 rounded-md border bg-background text-sm" title="Show one person's portfolio">
            <option value="all">All handlers</option>
            <option value="none">No handler assigned</option>
            {staff.map(s => <option key={s.id} value={s.id}>{s.full_name ?? "Unnamed"}</option>)}
          </select>
        )}
        <button onClick={exportCsv} className="h-9 px-3 rounded-md border text-sm inline-flex items-center gap-2 hover:bg-muted"><Download className="h-4 w-4" /> Export CSV</button>
      </div>

      {/* Table */}
      <div className="rounded-lg border bg-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="text-left p-3">Invoice number</th>
              <th className="text-left p-3">Customer</th>
              <th className="text-left p-3">Date</th>
              <th className="text-left p-3">Due</th>
              <th className="text-left p-3">Terms</th>
              <th className="text-left p-3">Item</th>
              <th className="text-right p-3">Collected</th>
              <th className="text-right p-3">Due receipt</th>
              <th className="text-left p-3">Handled by</th>
              <th className="text-left p-3">Status</th>
              <th className="p-3" />
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={11} className="p-8 text-center text-muted-foreground">No invoices match this view.</td></tr>
            )}
            {filtered.map(r => {
              const bal = Number(r.total || 0) - Number(r.amount_paid || 0);
              const item = itemsOf(r);
              const names = handlerNames(r.id);
              return (
                <tr key={r.id} className="border-t hover:bg-muted/30">
                  <td className="p-3"><Link to="/accounts/$id" params={{ id: r.id }} className="font-medium text-primary">{r.invoice_number}</Link></td>
                  <td className="p-3">{r.clients?.company_name ?? "—"}</td>
                  <td className="p-3">{formatDate(r.issue_date)}</td>
                  <td className="p-3">{formatDate(r.due_date)}</td>
                  <td className="p-3 whitespace-nowrap">{termsOf(r.issue_date, r.due_date)}</td>
                  <td className="p-3 max-w-[260px] truncate" title={item}>{item || "—"}</td>
                  <td className="p-3 text-right whitespace-nowrap text-emerald-700">{money(r.amount_paid)}</td>
                  <td className={`p-3 text-right whitespace-nowrap ${bal > 0 ? "text-amber-700" : ""}`}>{money(bal)}</td>
                  <td className="p-3">
                    {names.length === 0 ? <span className="text-xs text-muted-foreground">—</span> : (
                      <div className="flex flex-wrap gap-1">{names.map((n, i) => <span key={i} className="text-xs px-1.5 py-0.5 rounded bg-muted whitespace-nowrap">{n}</span>)}</div>
                    )}
                  </td>
                  <td className="p-3"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[r.status] ?? "bg-muted"}`}>{r.status}</span></td>
                  <td className="p-3 text-right">
                    {isAdmin && <button onClick={() => del(r.id)} className="p-1 text-muted-foreground hover:text-destructive"><Trash2 className="h-4 w-4" /></button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Recent payments (includes standalone) */}
      <div className="rounded-lg border bg-card overflow-x-auto">
        <div className="p-3 border-b flex items-center justify-between">
          <h2 className="text-sm font-semibold">Recent Payments</h2>
          <span className="text-xs text-muted-foreground">{payments.length} shown</span>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="text-left p-3">Date</th>
              <th className="text-left p-3">Client</th>
              <th className="text-left p-3">Invoice</th>
              <th className="text-left p-3">Method</th>
              <th className="text-left p-3">Reference</th>
              <th className="text-left p-3">Receipt</th>
              <th className="text-right p-3">Amount</th>
            </tr>
          </thead>
          <tbody>
            {payments.length === 0 && <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">No payments recorded yet.</td></tr>}
            {payments.map(p => (
              <tr key={p.id} className="border-t hover:bg-muted/30">
                <td className="p-3">{formatDate(p.payment_date)}</td>
                <td className="p-3">{p.clients?.company_name ?? "—"}</td>
                <td className="p-3">{p.invoice_id
                  ? <Link to="/accounts/$id" params={{ id: p.invoice_id }} className="text-primary font-medium">{p.invoices?.invoice_number ?? "View"}</Link>
                  : <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">Standalone</span>}</td>
                <td className="p-3 capitalize">{p.method}</td>
                <td className="p-3 font-mono text-xs">{p.reference ?? "—"}</td>
                <td className="p-3">{p.receipt_path
                  ? <button onClick={() => openReceipt(p.receipt_path)} className="inline-flex items-center gap-1 text-primary text-xs hover:underline"><FileText className="h-3.5 w-3.5" /> View</button>
                  : <span className="text-xs text-muted-foreground">—</span>}</td>
                <td className="p-3 text-right font-medium text-emerald-700">{money(p.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>


      {open && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setOpen(false)}>
          <form onClick={e => e.stopPropagation()} onSubmit={createInvoice} className="bg-background rounded-lg shadow-xl w-full max-w-lg p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">New Invoice</h2>
              <button type="button" onClick={() => setOpen(false)}><X className="h-4 w-4" /></button>
            </div>
            <div>
              <label className="text-xs font-medium">Client *</label>
              <select required value={form.client_id} onChange={e => setForm({ ...form, client_id: e.target.value })} className="w-full h-9 px-2 border rounded-md bg-background text-sm">
                <option value="">Select client…</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium">Issue Date</label>
                <input type="date" value={form.issue_date} onChange={e => setForm({ ...form, issue_date: e.target.value })} className="w-full h-9 px-2 border rounded-md bg-background text-sm" />
              </div>
              <div>
                <label className="text-xs font-medium">Due Date</label>
                <input type="date" value={form.due_date} onChange={e => setForm({ ...form, due_date: e.target.value })} className="w-full h-9 px-2 border rounded-md bg-background text-sm" />
              </div>
              <div>
                <label className="text-xs font-medium">Service Line</label>
                <select value={form.service_line} onChange={e => setForm({ ...form, service_line: e.target.value })} className="w-full h-9 px-2 border rounded-md bg-background text-sm">
                  {SERVICE_LINES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium">VAT Rate (%)</label>
                <input type="number" step="0.01" value={form.vat_rate} onChange={e => setForm({ ...form, vat_rate: Number(e.target.value) })} className="w-full h-9 px-2 border rounded-md bg-background text-sm" />
              </div>
            </div>
            <div className="rounded-md border p-3 bg-muted/30 space-y-2">
              <div className="text-xs font-semibold uppercase text-muted-foreground">Initial Amount (optional)</div>
              <input placeholder="Description" value={form.initial_description} onChange={e => setForm({ ...form, initial_description: e.target.value })} className="w-full h-9 px-2 border rounded-md bg-background text-sm" />
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">KES</span>
                <input type="number" step="0.01" placeholder="0.00" value={form.initial_amount || ""} onChange={e => setForm({ ...form, initial_amount: Number(e.target.value) })} className="flex-1 h-9 px-2 border rounded-md bg-background text-sm text-right" />
              </div>
              <div className="text-[11px] text-muted-foreground">Adds a first line item. You can add or edit more items after creating.</div>
            </div>
            <div>
              <label className="text-xs font-medium">Notes</label>
              <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} className="w-full px-2 py-1 border rounded-md bg-background text-sm" />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setOpen(false)} className="px-3 h-9 rounded-md border text-sm">Cancel</button>
              <button type="submit" className="px-3 h-9 rounded-md bg-primary text-primary-foreground text-sm">Create Invoice</button>
            </div>
          </form>
        </div>
      )}

      {payOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setPayOpen(false)}>
          <form onClick={e => e.stopPropagation()} onSubmit={recordPayment} className="bg-background rounded-lg shadow-xl w-full max-w-lg p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Record Payment</h2>
              <button type="button" onClick={() => setPayOpen(false)}><X className="h-4 w-4" /></button>
            </div>
            <p className="text-xs text-muted-foreground">Record a payment against an invoice or as a standalone receipt (no invoice yet).</p>
            <div>
              <label className="text-xs font-medium">Client *</label>
              <select required value={pay.client_id} onChange={e => setPay({ ...pay, client_id: e.target.value, invoice_id: "" })} className="w-full h-9 px-2 border rounded-md bg-background text-sm">
                <option value="">Select client…</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium">Link to Invoice (optional)</label>
              <select value={pay.invoice_id} onChange={e => setPay({ ...pay, invoice_id: e.target.value })} className="w-full h-9 px-2 border rounded-md bg-background text-sm" disabled={!pay.client_id}>
                <option value="">— Standalone (no invoice) —</option>
                {rows.filter(r => r.client_id === pay.client_id).map(r => (
                  <option key={r.id} value={r.id}>{r.invoice_number} · Bal {money(Number(r.total) - Number(r.amount_paid))}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium">Amount (KES) *</label>
                <input type="number" step="0.01" required value={pay.amount || ""} onChange={e => setPay({ ...pay, amount: Number(e.target.value) })} className="w-full h-9 px-2 border rounded-md bg-background text-sm text-right" />
              </div>
              <div>
                <label className="text-xs font-medium">Date</label>
                <input type="date" value={pay.payment_date} onChange={e => setPay({ ...pay, payment_date: e.target.value })} className="w-full h-9 px-2 border rounded-md bg-background text-sm" />
              </div>
              <div>
                <label className="text-xs font-medium">Method</label>
                <select value={pay.method} onChange={e => setPay({ ...pay, method: e.target.value })} className="w-full h-9 px-2 border rounded-md bg-background text-sm">
                  {METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium">Reference</label>
                <input value={pay.reference} onChange={e => setPay({ ...pay, reference: e.target.value })} placeholder="MPESA code, cheque #…" className="w-full h-9 px-2 border rounded-md bg-background text-sm" />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium">Notes</label>
              <textarea value={pay.notes} onChange={e => setPay({ ...pay, notes: e.target.value })} rows={2} className="w-full px-2 py-1 border rounded-md bg-background text-sm" />
            </div>
            <div>
              <label className="inline-flex items-center gap-2 text-xs cursor-pointer px-3 h-9 border rounded-md hover:bg-muted">
                <Paperclip className="h-3.5 w-3.5" /> {payFile ? payFile.name : "Attach receipt (image/PDF)"}
                <input type="file" accept="image/*,application/pdf" className="hidden" onChange={e => setPayFile(e.target.files?.[0] ?? null)} />
              </label>
              {payFile && <button type="button" onClick={() => setPayFile(null)} className="ml-2 text-xs text-muted-foreground hover:text-destructive">Clear</button>}
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setPayOpen(false)} className="px-3 h-9 rounded-md border text-sm">Cancel</button>
              <button type="submit" disabled={savingPay} className="px-3 h-9 rounded-md bg-primary text-primary-foreground text-sm disabled:opacity-50">{savingPay ? "Saving…" : "Record Payment"}</button>
            </div>
          </form>
        </div>
      )}
    </div>

  );
}

function Kpi({ label, value, icon, tone, onClick }: { label: string; value: string; icon: React.ReactNode; tone: "blue" | "emerald" | "amber" | "red"; onClick: () => void }) {
  const tones: any = {
    blue: "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-200",
    emerald: "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200",
    amber: "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-200",
    red: "bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-200",
  };
  return (
    <button type="button" onClick={onClick} className="rounded-lg border bg-card p-4 text-left hover:border-primary/60 hover:shadow-sm transition">
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-wider text-muted-foreground">{label}</span>
        <span className={`p-1.5 rounded-md ${tones[tone]}`}>{icon}</span>
      </div>
      <div className="mt-2 text-lg font-bold">{value}</div>
    </button>
  );
}
