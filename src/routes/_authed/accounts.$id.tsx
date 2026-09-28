import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ArrowLeft, Plus, Trash2, Printer, Save, Paperclip, FileText } from "lucide-react";
import { formatDate, formatDateTime, STATUS_COLORS } from "@/lib/format";

export const Route = createFileRoute("/_authed/accounts/$id")({ component: InvoiceDetail });

const METHODS = ["mpesa", "bank", "cash", "cheque", "card"];
const STATUS = ["draft", "sent", "partial", "paid", "overdue"];

async function openReceipt(path: string) {
  const { data, error } = await supabase.storage.from("payment-receipts").createSignedUrl(path, 300);
  if (error) return toast.error(error.message);
  window.open(data.signedUrl, "_blank");
}

function money(n: any) {
  return "KES " + Number(n || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function InvoiceDetail() {
  const { id } = useParams({ from: "/_authed/accounts/$id" });
  const [inv, setInv] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [clientAll, setClientAll] = useState<any[]>([]);
  const [statement, setStatement] = useState<{ billed: number; paid: number; balance: number } | null>(null);

  const today = new Date().toISOString().slice(0, 10);
  const [newItem, setNewItem] = useState({ description: "", quantity: 1, unit_price: 0 });
  const [newPay, setNewPay] = useState({ amount: 0, payment_date: today, method: "mpesa", reference: "", notes: "" });
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  async function load() {
    const { data: i } = await supabase.from("invoices").select("*, clients(id, company_name, kra_pin, email, phone)").eq("id", id).single();
    setInv(i);
    const [it, py] = await Promise.all([
      supabase.from("invoice_items").select("*").eq("invoice_id", id).order("sort_order"),
      supabase.from("payments").select("*").eq("invoice_id", id).order("payment_date", { ascending: false }),
    ]);
    setItems(it.data ?? []);
    setPayments(py.data ?? []);
    // Client statement
    if (i?.client_id) {
      const { data: all } = await supabase.from("invoices").select("id, invoice_number, issue_date, due_date, total, amount_paid, status").eq("client_id", i.client_id).order("issue_date", { ascending: false });
      setClientAll(all ?? []);
      const billed = (all ?? []).reduce((s, r) => s + Number(r.total || 0), 0);
      const paid = (all ?? []).reduce((s, r) => s + Number(r.amount_paid || 0), 0);
      setStatement({ billed, paid, balance: billed - paid });
    }
  }
  useEffect(() => { load(); }, [id]);

  async function addItem(e: React.FormEvent) {
    e.preventDefault();
    if (!newItem.description) return;
    const amount = Number(newItem.quantity) * Number(newItem.unit_price);
    const { error } = await supabase.from("invoice_items").insert({ invoice_id: id, ...newItem, amount, sort_order: items.length });
    if (error) toast.error(error.message);
    else { setNewItem({ description: "", quantity: 1, unit_price: 0 }); load(); }
  }
  async function delItem(iid: string) {
    await supabase.from("invoice_items").delete().eq("id", iid);
    load();
  }
  async function updItem(iid: string, patch: any) {
    if (patch.quantity != null || patch.unit_price != null) {
      const it = items.find(x => x.id === iid);
      patch.amount = Number(patch.quantity ?? it.quantity) * Number(patch.unit_price ?? it.unit_price);
    }
    await supabase.from("invoice_items").update(patch).eq("id", iid);
    load();
  }

  async function addPayment(e: React.FormEvent) {
    e.preventDefault();
    if (!newPay.amount) return toast.error("Enter amount");
    setUploading(true);
    const { data: { user } } = await supabase.auth.getUser();
    let receipt_url: string | null = null;
    let receipt_path: string | null = null;
    if (receiptFile) {
      const ext = receiptFile.name.split(".").pop() || "bin";
      const path = `${inv.client_id}/${id}/${Date.now()}.${ext}`;
      const up = await supabase.storage.from("payment-receipts").upload(path, receiptFile);
      if (up.error) { setUploading(false); return toast.error(up.error.message); }
      receipt_path = path;
      receipt_url = supabase.storage.from("payment-receipts").getPublicUrl(path).data.publicUrl;
    }
    const { error } = await supabase.from("payments").insert({ invoice_id: id, client_id: inv.client_id, ...newPay, receipt_url, receipt_path, recorded_by: user?.id });
    setUploading(false);
    if (error) toast.error(error.message);
    else { toast.success("Payment recorded"); setNewPay({ amount: 0, payment_date: today, method: "mpesa", reference: "", notes: "" }); setReceiptFile(null); load(); }
  }
  async function delPayment(pid: string) {
    if (!confirm("Delete this payment?")) return;
    const p = payments.find(x => x.id === pid);
    if (p?.receipt_path) await supabase.storage.from("payment-receipts").remove([p.receipt_path]);
    await supabase.from("payments").delete().eq("id", pid);
    load();
  }

  async function updInv(patch: any) {
    const { error } = await supabase.from("invoices").update(patch).eq("id", id);
    if (error) toast.error(error.message); else load();
  }

  if (!inv) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;

  const balance = Number(inv.total || 0) - Number(inv.amount_paid || 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between print:hidden">
        <Link to="/accounts" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Back to invoices</Link>
        <div className="flex gap-2">
          <button onClick={() => window.print()} className="inline-flex items-center gap-2 px-3 h-9 rounded-md border text-sm"><Printer className="h-4 w-4" /> Print / PDF</button>
        </div>
      </div>

      {/* Printable invoice */}
      <div className="rounded-lg border bg-card p-6 print:border-0 print:shadow-none">
        <div className="flex items-start justify-between mb-6">
          <div>
            <div className="text-xl font-bold">G.K Nahashon & Company</div>
            <div className="text-xs text-muted-foreground">Certified Public Accountants, Auditors, Tax & Advisory</div>
            <div className="text-xs text-muted-foreground">Nairobi, Kenya</div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold text-primary">INVOICE</div>
            <div className="text-sm font-mono">{inv.invoice_number}</div>
            <span className={`inline-block mt-1 px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[inv.status] ?? "bg-muted"}`}>{inv.status}</span>
            {inv.status === "paid" && inv.paid_at && <div className="text-[11px] text-muted-foreground mt-1">Paid {formatDateTime(inv.paid_at)}</div>}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-6 text-sm mb-6">
          <div>
            <div className="text-xs uppercase text-muted-foreground mb-1">Bill To</div>
            <div className="font-semibold">{inv.clients?.company_name}</div>
            {inv.clients?.kra_pin && <div className="text-xs">KRA PIN: {inv.clients.kra_pin}</div>}
            {inv.clients?.email && <div className="text-xs">{inv.clients.email}</div>}
            {inv.clients?.phone && <div className="text-xs">{inv.clients.phone}</div>}
          </div>
          <div className="text-right space-y-1">
            <div><span className="text-xs text-muted-foreground">Issue Date: </span>{formatDate(inv.issue_date)}</div>
            <div><span className="text-xs text-muted-foreground">Due Date: </span>{formatDate(inv.due_date)}</div>
            <div><span className="text-xs text-muted-foreground">Service: </span>{inv.service_line ?? "—"}</div>
          </div>
        </div>

        {/* Items */}
        <table className="w-full text-sm mb-4">
          <thead className="border-b">
            <tr className="text-xs uppercase text-muted-foreground">
              <th className="text-left py-2">Description</th>
              <th className="text-right py-2 w-20">Qty</th>
              <th className="text-right py-2 w-32">Unit Price</th>
              <th className="text-right py-2 w-32">Amount</th>
              <th className="w-10 print:hidden" />
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && <tr><td colSpan={5} className="py-4 text-center text-muted-foreground">No line items yet.</td></tr>}
            {items.map(it => (
              <tr key={it.id} className="border-b">
                <td className="py-2"><input defaultValue={it.description} onBlur={e => e.target.value !== it.description && updItem(it.id, { description: e.target.value })} className="w-full bg-transparent border-0 focus:outline-none focus:ring-1 focus:ring-ring rounded px-1" /></td>
                <td className="py-2 text-right"><input type="number" step="0.01" defaultValue={it.quantity} onBlur={e => Number(e.target.value) !== Number(it.quantity) && updItem(it.id, { quantity: Number(e.target.value) })} className="w-16 text-right bg-transparent border-0 focus:ring-1 rounded" /></td>
                <td className="py-2 text-right"><input type="number" step="0.01" defaultValue={it.unit_price} onBlur={e => Number(e.target.value) !== Number(it.unit_price) && updItem(it.id, { unit_price: Number(e.target.value) })} className="w-28 text-right bg-transparent border-0 focus:ring-1 rounded" /></td>
                <td className="py-2 text-right font-medium">{money(it.amount)}</td>
                <td className="py-2 text-right print:hidden"><button onClick={() => delItem(it.id)} className="text-muted-foreground hover:text-destructive"><Trash2 className="h-4 w-4" /></button></td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Add item */}
        <form onSubmit={addItem} className="grid grid-cols-12 gap-2 mb-4 print:hidden">
          <input placeholder="Description" value={newItem.description} onChange={e => setNewItem({ ...newItem, description: e.target.value })} className="col-span-6 h-9 px-2 border rounded-md bg-background text-sm" />
          <input type="number" step="0.01" placeholder="Qty" value={newItem.quantity} onChange={e => setNewItem({ ...newItem, quantity: Number(e.target.value) })} className="col-span-2 h-9 px-2 border rounded-md bg-background text-sm text-right" />
          <input type="number" step="0.01" placeholder="Unit price" value={newItem.unit_price} onChange={e => setNewItem({ ...newItem, unit_price: Number(e.target.value) })} className="col-span-2 h-9 px-2 border rounded-md bg-background text-sm text-right" />
          <button type="submit" className="col-span-2 h-9 rounded-md bg-primary text-primary-foreground text-sm inline-flex items-center justify-center gap-1"><Plus className="h-4 w-4" /> Add</button>
        </form>

        {/* Totals */}
        <div className="flex justify-end">
          <div className="w-full max-w-xs space-y-1 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span>{money(inv.subtotal)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">VAT ({inv.vat_rate}%)</span><span>{money(inv.vat_amount)}</span></div>
            <div className="flex justify-between border-t pt-1 font-bold text-base"><span>Total</span><span>{money(inv.total)}</span></div>
            <div className="flex justify-between text-emerald-700"><span>Amount Paid</span><span>{money(inv.amount_paid)}</span></div>
            <div className="flex justify-between border-t pt-1 font-bold text-base"><span>Balance Due</span><span className={balance > 0 ? "text-amber-700" : "text-emerald-700"}>{money(balance)}</span></div>
          </div>
        </div>

        {inv.notes && <div className="mt-4 text-xs text-muted-foreground border-t pt-3"><strong>Notes:</strong> {inv.notes}</div>}
      </div>

      {/* Controls: status, dates, notes */}
      <div className="rounded-lg border bg-card p-4 print:hidden">
        <h3 className="text-sm font-semibold mb-3">Invoice Settings</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <div>
            <label className="text-xs font-medium">Status</label>
            <select value={inv.status} onChange={e => updInv({ status: e.target.value })} className="w-full h-9 px-2 border rounded-md bg-background">
              {STATUS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium">Due Date</label>
            <input type="date" defaultValue={inv.due_date} onBlur={e => e.target.value !== inv.due_date && updInv({ due_date: e.target.value })} className="w-full h-9 px-2 border rounded-md bg-background" />
          </div>
          <div>
            <label className="text-xs font-medium">VAT %</label>
            <input type="number" step="0.01" defaultValue={inv.vat_rate} onBlur={e => Number(e.target.value) !== Number(inv.vat_rate) && updInv({ vat_rate: Number(e.target.value) })} className="w-full h-9 px-2 border rounded-md bg-background" />
          </div>
          <div>
            <label className="text-xs font-medium">Service Line</label>
            <input defaultValue={inv.service_line ?? ""} onBlur={e => e.target.value !== inv.service_line && updInv({ service_line: e.target.value })} className="w-full h-9 px-2 border rounded-md bg-background" />
          </div>
        </div>
        <div className="mt-3">
          <label className="text-xs font-medium">Notes</label>
          <textarea defaultValue={inv.notes ?? ""} onBlur={e => e.target.value !== (inv.notes ?? "") && updInv({ notes: e.target.value })} rows={2} className="w-full px-2 py-1 border rounded-md bg-background text-sm" />
        </div>
      </div>

      {/* Payments */}
      <div className="rounded-lg border bg-card p-4 print:hidden">
        <h3 className="text-sm font-semibold mb-3">Payments</h3>
        <form onSubmit={addPayment} className="grid grid-cols-12 gap-2 mb-4">
          <input type="number" step="0.01" placeholder="Amount" value={newPay.amount || ""} onChange={e => setNewPay({ ...newPay, amount: Number(e.target.value) })} className="col-span-2 h-9 px-2 border rounded-md bg-background text-sm" />
          <input type="date" value={newPay.payment_date} onChange={e => setNewPay({ ...newPay, payment_date: e.target.value })} className="col-span-2 h-9 px-2 border rounded-md bg-background text-sm" />
          <select value={newPay.method} onChange={e => setNewPay({ ...newPay, method: e.target.value })} className="col-span-2 h-9 px-2 border rounded-md bg-background text-sm">
            {METHODS.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
          <input placeholder="Reference (e.g. MPESA code)" value={newPay.reference} onChange={e => setNewPay({ ...newPay, reference: e.target.value })} className="col-span-3 h-9 px-2 border rounded-md bg-background text-sm" />
          <input placeholder="Notes" value={newPay.notes} onChange={e => setNewPay({ ...newPay, notes: e.target.value })} className="col-span-2 h-9 px-2 border rounded-md bg-background text-sm" />
          <button type="submit" disabled={uploading} className="col-span-1 h-9 rounded-md bg-primary text-primary-foreground text-sm inline-flex items-center justify-center disabled:opacity-50"><Save className="h-4 w-4" /></button>
          <div className="col-span-12 flex items-center gap-2">
            <label className="inline-flex items-center gap-2 text-xs cursor-pointer px-2 h-8 border rounded-md hover:bg-muted">
              <Paperclip className="h-3.5 w-3.5" /> {receiptFile ? receiptFile.name : "Attach receipt (image/PDF)"}
              <input type="file" accept="image/*,application/pdf" className="hidden" onChange={e => setReceiptFile(e.target.files?.[0] ?? null)} />
            </label>
            {receiptFile && <button type="button" onClick={() => setReceiptFile(null)} className="text-xs text-muted-foreground hover:text-destructive">Clear</button>}
          </div>
        </form>
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="text-left p-2">Date</th>
              <th className="text-left p-2">Method</th>
              <th className="text-left p-2">Reference</th>
              <th className="text-left p-2">Notes</th>
              <th className="text-left p-2">Receipt</th>
              <th className="text-right p-2">Amount</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {payments.length === 0 && <tr><td colSpan={7} className="p-4 text-center text-muted-foreground">No payments recorded.</td></tr>}
            {payments.map(p => (
              <tr key={p.id} className="border-t">
                <td className="p-2">{formatDate(p.payment_date)}</td>
                <td className="p-2 capitalize">{p.method}</td>
                <td className="p-2 font-mono text-xs">{p.reference ?? "—"}</td>
                <td className="p-2 text-xs">{p.notes ?? "—"}</td>
                <td className="p-2">
                  {p.receipt_path
                    ? <button onClick={() => openReceipt(p.receipt_path)} className="inline-flex items-center gap-1 text-primary text-xs hover:underline"><FileText className="h-3.5 w-3.5" /> View</button>
                    : <span className="text-xs text-muted-foreground">—</span>}
                </td>
                <td className="p-2 text-right font-medium text-emerald-700">{money(p.amount)}</td>
                <td className="p-2 text-right"><button onClick={() => delPayment(p.id)} className="text-muted-foreground hover:text-destructive"><Trash2 className="h-4 w-4" /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>


      {/* Client statement */}
      {statement && (
        <div className="rounded-lg border bg-card p-4 print:hidden">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold">Client Statement — {inv.clients?.company_name}</h3>
            <div className="text-xs text-muted-foreground">All invoices for this client</div>
          </div>
          <div className="grid grid-cols-3 gap-3 mb-3 text-sm">
            <div className="rounded-md border p-3"><div className="text-xs text-muted-foreground">Total Billed</div><div className="font-bold">{money(statement.billed)}</div></div>
            <div className="rounded-md border p-3"><div className="text-xs text-muted-foreground">Total Paid</div><div className="font-bold text-emerald-700">{money(statement.paid)}</div></div>
            <div className="rounded-md border p-3"><div className="text-xs text-muted-foreground">Outstanding Balance</div><div className={`font-bold ${statement.balance > 0 ? "text-amber-700" : "text-emerald-700"}`}>{money(statement.balance)}</div></div>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="text-left p-2">Invoice #</th>
                <th className="text-left p-2">Issued</th>
                <th className="text-left p-2">Due</th>
                <th className="text-right p-2">Total</th>
                <th className="text-right p-2">Paid</th>
                <th className="text-right p-2">Balance</th>
                <th className="text-left p-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {clientAll.map(r => {
                const bal = Number(r.total) - Number(r.amount_paid);
                return (
                  <tr key={r.id} className="border-t">
                    <td className="p-2"><Link to="/accounts/$id" params={{ id: r.id }} className="text-primary font-medium">{r.invoice_number}</Link></td>
                    <td className="p-2">{formatDate(r.issue_date)}</td>
                    <td className="p-2">{formatDate(r.due_date)}</td>
                    <td className="p-2 text-right">{money(r.total)}</td>
                    <td className="p-2 text-right text-emerald-700">{money(r.amount_paid)}</td>
                    <td className={`p-2 text-right ${bal > 0 ? "text-amber-700" : ""}`}>{money(bal)}</td>
                    <td className="p-2"><span className={`px-2 py-0.5 rounded-full text-xs ${STATUS_COLORS[r.status] ?? "bg-muted"}`}>{r.status}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
