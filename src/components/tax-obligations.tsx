import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Plus, Trash2, Upload, Download, Receipt, ChevronDown, ChevronRight, FileText } from "lucide-react";
import { formatDate, formatDateTime, daysUntil, STATUS_COLORS, statusLabel } from "@/lib/format";
import { TaxAssigneeSelect } from "@/components/tax-assignee-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { useAuth } from "@/lib/auth";

const STATUSES = ["pending", "in_progress", "filed"];

function money(n: number) {
  return "KES " + Number(n || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function TaxObligations({ clientId }: { clientId: string }) {
  const { user, isAdmin, canCreate, canDelete } = useAuth();
  const [rows, setRows] = useState<any[]>([]);
  const [policies, setPolicies] = useState<any[]>([]);
  const [staff, setStaff] = useState<any[]>([]);
  const [docs, setDocs] = useState<Record<string, any[]>>({});
  const [invoices, setInvoices] = useState<Record<string, any>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState<any>({ return_types: ["vat"], period_start: "", period_end: "", due_date: new Date().toISOString().slice(0,10), notes: "" });
  const [addBusy, setAddBusy] = useState(false);
  const [uploadFor, setUploadFor] = useState<any>(null);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [billFor, setBillFor] = useState<any>(null);
  const [billForm, setBillForm] = useState<any>({ amount: 0, description: "" });
  const [billBusy, setBillBusy] = useState(false);

  async function load() {
    const [{ data: tax }, { data: pol }, { data: prof }] = await Promise.all([
      supabase.from("tax_returns").select("*").eq("client_id", clientId).order("due_date"),
      supabase.from("tax_policies").select("*").order("sort_order"),
      supabase.from("profiles").select("id, full_name").order("full_name"),
    ]);
    setStaff(prof ?? []);
    const list = tax ?? [];
    setRows(list);
    setPolicies(pol ?? []);
    const ids = list.map((r: any) => r.id);
    const invoiceIds = [...new Set(list.map((r: any) => r.invoice_id).filter(Boolean))];
    const [d, inv] = await Promise.all([
      ids.length ? supabase.from("documents").select("*").in("tax_return_id", ids).order("created_at", { ascending: false }) : Promise.resolve({ data: [] } as any),
      invoiceIds.length ? supabase.from("invoices").select("id, invoice_number, status, total, amount_paid").in("id", invoiceIds) : Promise.resolve({ data: [] } as any),
    ]);
    const byReturn: Record<string, any[]> = {};
    (d.data ?? []).forEach((doc: any) => {
      if (!doc.tax_return_id) return;
      (byReturn[doc.tax_return_id] ??= []).push(doc);
    });
    setDocs(byReturn);
    setInvoices(Object.fromEntries((inv.data ?? []).map((i: any) => [i.id, i])));
  }
  useEffect(() => { load(); }, [clientId]);

  const byType = useMemo(() => {
    const groups: Record<string, { active: any[]; history: any[] }> = {};
    for (const r of rows) {
      (groups[r.return_type] ??= { active: [], history: [] });
      if (r.status === "filed") groups[r.return_type].history.push(r);
      else groups[r.return_type].active.push(r);
    }
    Object.values(groups).forEach(g => {
      g.active.sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? ""));
      g.history.sort((a, b) => (b.due_date ?? "").localeCompare(a.due_date ?? ""));
    });
    return groups;
  }, [rows]);

  const types = Object.keys(byType).sort();
  const activeTypes = useMemo(() => policies.filter(p => p.active), [policies]);
  function typeLabel(t: string) {
    return policies.find(p => p.tax_type === t)?.label ?? t;
  }

  async function setStatus(id: string, status: string) {
    const { data, error } = await supabase.from("tax_returns").update({ status }).eq("id", id).select("id");
    if (error) toast.error(error.message);
    else if (!data || data.length === 0) toast.error("You don't have permission to update this filing.");
    else { if (status === "filed") toast.success("Marked filed — next period added automatically"); load(); }
  }
  async function remove(id: string) {
    const { error } = await supabase.from("tax_returns").delete().eq("id", id);
    if (error) toast.error(error.message); else { toast.success("Removed"); load(); }
  }

  async function submitAdd() {
    if (!addForm.due_date) { toast.error("Due date required"); return; }
    const types: string[] = (addForm.return_types ?? []).filter(Boolean);
    if (types.length === 0) { toast.error("Select at least one tax obligation"); return; }
    setAddBusy(true);
    const payload = types.map(rt => ({
      client_id: clientId, return_type: rt,
      period_start: addForm.period_start || null, period_end: addForm.period_end || null,
      due_date: addForm.due_date, notes: addForm.notes || null,
      created_by: user?.id,
    }));
    const { error } = await supabase.from("tax_returns").insert(payload as any);
    setAddBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Obligation added");
    setAddOpen(false);
    load();
  }

  async function submitUpload() {
    if (!uploadFile || !uploadFor) return;
    setUploadBusy(true);
    const { data: { user } } = await supabase.auth.getUser();
    const path = `${clientId}/${Date.now()}-${uploadFile.name}`;
    const up = await supabase.storage.from("client-documents").upload(path, uploadFile);
    if (up.error) { toast.error(up.error.message); setUploadBusy(false); return; }
    const { error } = await supabase.from("documents").insert({
      client_id: clientId, tax_return_id: uploadFor.id,
      title: uploadFile.name, file_path: path, uploaded_by: user?.id ?? null,
    } as any);
    setUploadBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Document attached");
    setUploadFor(null); setUploadFile(null);
    load();
  }
  async function viewDoc(path: string) {
    const { data, error } = await supabase.storage.from("client-documents").createSignedUrl(path, 300);
    if (error) toast.error(error.message); else window.open(data.signedUrl, "_blank");
  }

  function openBill(row: any) {
    setBillForm({ amount: 0, description: `${typeLabel(row.return_type)} filing — period ${formatDate(row.period_end)}` });
    setBillFor(row);
  }
  async function submitBill() {
    if (!billFor) return;
    setBillBusy(true);
    try {
      const { data: numRes, error: numErr } = await supabase.rpc("next_invoice_number");
      if (numErr) throw numErr;
      const { data: { user } } = await supabase.auth.getUser();
      const today = new Date().toISOString().slice(0, 10);
      const due = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
      const { data: inv, error: invErr } = await supabase.from("invoices")
        .insert({ invoice_number: numRes, client_id: clientId, issue_date: today, due_date: due, service_line: "Tax", vat_rate: 16, created_by: user?.id ?? null } as any)
        .select().single();
      if (invErr) throw invErr;
      const amt = Number(billForm.amount) || 0;
      const { error: itemErr } = await supabase.from("invoice_items").insert({
        invoice_id: inv.id, description: billForm.description || "Tax filing fee",
        quantity: 1, unit_price: amt, amount: amt, sort_order: 0,
      } as any);
      if (itemErr) throw itemErr;
      const { error: linkErr } = await supabase.from("tax_returns").update({ invoice_id: inv.id }).eq("id", billFor.id);
      if (linkErr) throw linkErr;
      toast.success("Invoice created");
      setBillFor(null);
      load();
    } catch (e: any) {
      toast.error(e.message ?? String(e));
    } finally {
      setBillBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        {canCreate("tax") && (
          <Button size="sm" onClick={() => setAddOpen(true)}><Plus className="h-3.5 w-3.5 mr-1" />Add obligation</Button>
        )}
      </div>

      {types.length === 0 && (
        <div className="bg-card border rounded-lg p-8 text-center text-muted-foreground text-sm">No tax obligations yet.</div>
      )}

      {types.map(type => {
        const g = byType[type];
        const isOpen = expanded[type] ?? g.active.length === 0;
        return (
          <div key={type} className="bg-card border rounded-lg overflow-hidden">
            <div className="px-4 py-3 flex items-center justify-between border-b bg-muted/30">
              <div className="font-medium text-sm">{typeLabel(type)}</div>
              <div className="text-xs text-muted-foreground">{g.history.length} filed · {g.active.length} open</div>
            </div>

            {g.active.map(r => {
              const d = daysUntil(r.due_date);
              return (
                <div key={r.id} className="px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 border-b last:border-0">
                  <div className="text-sm">
                    <span className="text-muted-foreground">Due </span>
                    <span className="font-medium">{formatDate(r.due_date)}</span>
                    {r.period_end && <span className="text-muted-foreground"> · period ending {formatDate(r.period_end)}</span>}
                    {d !== null && d < 0 && <span className="ml-2 text-xs text-destructive">{Math.abs(d)}d overdue</span>}
                    {d !== null && d >= 0 && d <= 3 && <span className="ml-2 text-xs text-accent">due in {d}d</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    <TaxAssigneeSelect
                      returnId={r.id}
                      value={r.assigned_to}
                      staff={staff}
                      assignedAt={r.assigned_at}
                      label={`${typeLabel(type)} — due ${formatDate(r.due_date)}`}
                      onChanged={load}
                    />
                    <select value={r.status} onChange={e => setStatus(r.id, e.target.value)} className={`h-7 px-2 rounded text-xs border bg-background capitalize ${STATUS_COLORS[r.status]}`}>
                      {STATUSES.map(s => <option key={s} value={s}>{statusLabel(s)}</option>)}
                    </select>
                    {canDelete("tax", { createdBy: r.created_by }) && (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <button className="text-muted-foreground hover:text-destructive p-1" aria-label="Remove"><Trash2 className="h-3.5 w-3.5" /></button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Remove this obligation?</AlertDialogTitle>
                            <AlertDialogDescription>This removes the pending {typeLabel(type)} filing for this period. Cannot be undone.</AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => remove(r.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Remove</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
                  </div>
                </div>
              );
            })}

            {g.history.length > 0 && (
              <>
                <button onClick={() => setExpanded(e => ({ ...e, [type]: !isOpen }))} className="w-full px-4 py-2 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground border-b last:border-0">
                  {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                  Filing history ({g.history.length})
                </button>
                {isOpen && g.history.map(r => {
                  const rowDocs = docs[r.id] ?? [];
                  const inv = r.invoice_id ? invoices[r.invoice_id] : null;
                  return (
                    <div key={r.id} className="px-4 py-2.5 border-b last:border-0 bg-muted/10">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-sm">
                          <span className="px-1.5 py-0.5 rounded text-xs bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200 mr-2">Filed</span>
                          {r.period_end ? `Period ending ${formatDate(r.period_end)}` : `Due ${formatDate(r.due_date)}`}
                          <span className="text-muted-foreground"> · filed {formatDateTime(r.filed_at)}{r.filed_by && staff.find(s => s.id === r.filed_by) ? ` by ${staff.find(s => s.id === r.filed_by)?.full_name}` : ""}</span>
                          <span className="text-muted-foreground text-xs"> · due {formatDate(r.due_date)}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          {inv ? (
                            <Link to="/accounts/$id" params={{ id: inv.id }} className={`text-xs px-2 py-0.5 rounded-full capitalize ${STATUS_COLORS[inv.status] ?? "bg-muted"}`}>
                              {inv.invoice_number} · {inv.status}
                            </Link>
                          ) : (
                            <button onClick={() => openBill(r)} className="text-xs text-primary inline-flex items-center gap-1"><Receipt className="h-3 w-3" />Bill this filing</button>
                          )}
                          <button onClick={() => { setUploadFor(r); setUploadFile(null); }} className="text-xs text-primary inline-flex items-center gap-1"><Upload className="h-3 w-3" />Attach doc</button>
                        </div>
                      </div>
                      {rowDocs.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-2">
                          {rowDocs.map((doc: any) => (
                            <button key={doc.id} onClick={() => viewDoc(doc.file_path)} className="text-xs inline-flex items-center gap-1 px-2 py-1 rounded border bg-background hover:border-primary/60">
                              <FileText className="h-3 w-3" />{doc.title}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </>
            )}
          </div>
        );
      })}

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Add tax obligation</DialogTitle></DialogHeader>
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <Label className="text-xs">Tax obligations * (select one or more)</Label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 p-2 mt-1 border rounded-md bg-background">
                {activeTypes.map(p => { const t = p.tax_type;
                  const selected = (addForm.return_types ?? []).includes(t);
                  return (
                    <label key={t} className={`flex items-center gap-2 px-2 py-1 rounded cursor-pointer text-xs ${selected ? "bg-primary/10 text-primary" : "hover:bg-muted"}`}>
                      <input type="checkbox" checked={selected} onChange={e => {
                        const cur: string[] = addForm.return_types ?? [];
                        setAddForm({ ...addForm, return_types: e.target.checked ? [...cur, t] : cur.filter(x => x !== t) });
                      }} />
                      {typeLabel(t)}
                    </label>
                  );
                })}
              </div>
            </div>
            <div><Label className="text-xs">Due date *</Label><Input type="date" value={addForm.due_date ?? ""} onChange={e => setAddForm({ ...addForm, due_date: e.target.value })} /></div>
            <div><Label className="text-xs">Period start</Label><Input type="date" value={addForm.period_start ?? ""} onChange={e => setAddForm({ ...addForm, period_start: e.target.value })} /></div>
            <div><Label className="text-xs">Period end</Label><Input type="date" value={addForm.period_end ?? ""} onChange={e => setAddForm({ ...addForm, period_end: e.target.value })} /></div>
            <div className="sm:col-span-2"><Label className="text-xs">Notes</Label><Textarea rows={2} value={addForm.notes ?? ""} onChange={e => setAddForm({ ...addForm, notes: e.target.value })} /></div>
          </div>
          <p className="text-xs text-muted-foreground">Once a filing is marked "Filed", the next period is scheduled automatically and this one moves into filing history.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button onClick={submitAdd} disabled={addBusy}>{addBusy ? "Saving…" : "Add"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!uploadFor} onOpenChange={o => !o && setUploadFor(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Attach filed document</DialogTitle></DialogHeader>
          <p className="text-xs text-muted-foreground">
            {uploadFor && `${typeLabel(uploadFor.return_type)} · period ending ${formatDate(uploadFor.period_end)}`}
          </p>
          <Input type="file" onChange={e => setUploadFile(e.target.files?.[0] ?? null)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setUploadFor(null)}>Cancel</Button>
            <Button onClick={submitUpload} disabled={uploadBusy || !uploadFile}>{uploadBusy ? "Uploading…" : "Attach"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!billFor} onOpenChange={o => !o && setBillFor(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Bill this filing</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label className="text-xs">Description</Label><Input value={billForm.description ?? ""} onChange={e => setBillForm({ ...billForm, description: e.target.value })} /></div>
            <div><Label className="text-xs">Amount ({money(0).split(" ")[0]})</Label><Input type="number" min="0" step="0.01" value={billForm.amount ?? 0} onChange={e => setBillForm({ ...billForm, amount: e.target.value })} /></div>
            <p className="text-xs text-muted-foreground">Creates a draft invoice for this client — you can add more line items or record payment from Accounts.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBillFor(null)}>Cancel</Button>
            <Button onClick={submitBill} disabled={billBusy}>{billBusy ? "Creating…" : "Create invoice"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
