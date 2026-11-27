import { useCallback, useEffect, useState } from "react";
import { Check, FileText, Loader2, Lock, Upload } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { CompletionInvoiceDialog, LinkedInvoice } from "@/components/completion-invoice-dialog";
import { openClientFile } from "@/lib/client-files";
import { formatDateTime } from "@/lib/format";
import { filingOpenDate, isFilingOpen } from "@/lib/tax-period";
import { STATE_BADGE, STATE_LABEL, STEPS, dueText, shortDate, stateOf } from "./tax-model";

const db = supabase as any;

type Props = {
  filingId: string | null;
  onClose: () => void;
  onChanged: () => void;
  staff: { id: string; full_name: string | null }[];
  canEdit: boolean;
  isAdmin: boolean;
};

/**
 * One filing, end to end: who owns it, the 4-step checklist (with who/when),
 * the receipt, and the invoice that closes it. The database enforces the rules;
 * this screen just makes the next step obvious.
 */
export function FilingPanel({ filingId, onClose, onChanged, staff, canEdit, isAdmin }: Props) {
  const [row, setRow] = useState<any>(null);
  const [policy, setPolicy] = useState<any>(null);
  const [docs, setDocs] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [notes, setNotes] = useState("");

  const nameOf = useCallback((id?: string | null) => (id ? staff.find(s => s.id === id)?.full_name || "Unnamed" : null), [staff]);

  const load = useCallback(async () => {
    if (!filingId) return;
    setLoading(true);
    const { data, error } = await db.from("tax_returns").select("*, clients(company_name)").eq("id", filingId).maybeSingle();
    if (error || !data) {
      setRow(null);
      setLoading(false);
      if (error) toast.error(error.message);
      return;
    }
    const [pol, d] = await Promise.all([
      db.from("tax_policies").select("*").eq("tax_type", data.return_type).maybeSingle(),
      db.from("documents").select("id, title, file_path, created_at, uploaded_by").eq("tax_return_id", filingId).order("created_at", { ascending: false }),
    ]);
    setRow(data);
    setNotes(data.notes ?? "");
    setPolicy(pol.data ?? null);
    setDocs(d.data ?? []);
    setLoading(false);
  }, [filingId]);

  useEffect(() => { setRow(null); setDocs([]); void load(); }, [load]);

  async function save(patch: Record<string, any>, okMessage?: string) {
    if (!row) return false;
    setBusy(true);
    const { data, error } = await db.from("tax_returns").update(patch).eq("id", row.id).select("id");
    setBusy(false);
    if (error) { toast.error(error.message); return false; }
    if (!data || data.length === 0) { toast.error("You do not have permission to change this filing."); return false; }
    if (okMessage) toast.success(okMessage);
    await load();
    onChanged();
    return true;
  }

  async function uploadReceipt(file: File) {
    if (!row) return;
    setBusy(true);
    const { data: { user } } = await supabase.auth.getUser();
    const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `${row.client_id}/tax-returns/${row.id}/${Date.now()}-${safe}`;
    const up = await supabase.storage.from("client-documents").upload(path, file);
    if (up.error) { setBusy(false); toast.error(up.error.message); return; }
    const { error } = await db.from("documents").insert({
      client_id: row.client_id, tax_return_id: row.id, title: file.name, file_path: path, uploaded_by: user?.id ?? null,
    });
    if (error) {
      await supabase.storage.from("client-documents").remove([path]);
      setBusy(false);
      toast.error(error.message);
      return;
    }
    setBusy(false);
    toast.success("Receipt uploaded");
    await load();
    onChanged();
  }

  async function stopObligation() {
    if (!row) return;
    if (!window.confirm(`Stop tracking ${policy?.label ?? row.return_type} for ${row.clients?.company_name}? Open filings stay on record but disappear from the overview.`)) return;
    setBusy(true);
    const { error } = await db.rpc("set_client_tax_obligation", { _client_id: row.client_id, _tax_type: row.return_type, _active: false });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Obligation stopped");
    onChanged();
    onClose();
  }

  const closed = row?.status === "filed";
  const hasReceipt = docs.length > 0 || !!row?.ack_file_path;
  const cadence = policy?.cadence;
  const windowOpen = row ? isFilingOpen(row.due_date, cadence) : true;
  const state = row ? stateOf(row, cadence) : null;
  const edit = canEdit && !closed;
  const readyToClose = !!row?.docs_received_at && !!row?.prepared_at && hasReceipt && windowOpen;

  let blocker = "";
  if (!row?.docs_received_at) blocker = "Tick “Documents received” first.";
  else if (!row?.prepared_at) blocker = "Mark the return as prepared.";
  else if (!hasReceipt) blocker = "Upload the filing receipt.";
  else if (!windowOpen) blocker = `This period opens for filing on ${shortDate(filingOpenDate(row.due_date, cadence))}.`;

  const stamp = (at?: string | null, by?: string | null) => (at ? `${nameOf(by) ?? "Someone"} · ${formatDateTime(at)}` : null);

  return (
    <>
      <Sheet open={!!filingId} onOpenChange={o => { if (!o) onClose(); }}>
        <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader className="text-left">
            <SheetTitle>{row ? `${row.clients?.company_name ?? "Client"} — ${policy?.label ?? row.return_type}` : "Filing"}</SheetTitle>
            <SheetDescription>
              {row ? (
                <span className="flex flex-wrap items-center gap-2">
                  <span>Due {shortDate(row.due_date)} {row.due_date?.slice(0, 4)}</span>
                  {state && <span className={`text-[11px] px-1.5 py-0.5 rounded-full ${STATE_BADGE[state]}`}>{state === "filed" ? "Filed" : `${STATE_LABEL[state]} · ${dueText(row)}`}</span>}
                </span>
              ) : "Checklist, receipt and invoice for this filing."}
            </SheetDescription>
          </SheetHeader>

          {loading && !row && <div className="py-10 text-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin inline" /></div>}
          {!loading && !row && <div className="py-10 text-center text-sm text-muted-foreground">This filing was not found, or you do not have access to it.</div>}

          {row && (
            <div className="px-4 pb-6 space-y-5">
              {/* Owner */}
              <section>
                <label className="text-xs font-medium text-muted-foreground">Owner — who is responsible</label>
                <select
                  value={row.assigned_to ?? ""}
                  disabled={!canEdit || busy || closed}
                  onChange={e => void save({ assigned_to: e.target.value || null }, "Owner updated")}
                  className="mt-1 h-9 w-full px-3 rounded-md border bg-background text-sm disabled:opacity-60"
                >
                  <option value="">No owner</option>
                  {staff.map(s => <option key={s.id} value={s.id}>{s.full_name || "Unnamed"}</option>)}
                </select>
                {row.assigned_at && <p className="text-[11px] text-muted-foreground mt-1">Assigned {formatDateTime(row.assigned_at)}{nameOf(row.assigned_by) ? ` by ${nameOf(row.assigned_by)}` : ""}</p>}
                {!closed && <p className="text-[11px] text-muted-foreground mt-0.5">The owner carries over to the next period when this one closes.</p>}
              </section>

              {/* Checklist */}
              <section className="space-y-3">
                <h3 className="text-sm font-semibold">Checklist</h3>

                <Step n={1} label={STEPS[0].label} done={!!row.docs_received_at} meta={stamp(row.docs_received_at, row.docs_received_by)}
                  control={<Tick checked={!!row.docs_received_at} disabled={!edit || busy || !!row.prepared_at} title={row.prepared_at ? "Untick “Return prepared” first" : undefined}
                    onChange={v => void save({ docs_received_at: v ? new Date().toISOString() : null })} />} />

                <Step n={2} label={STEPS[1].label} done={!!row.prepared_at} meta={stamp(row.prepared_at, row.prepared_by)}
                  control={<Tick checked={!!row.prepared_at} disabled={!edit || busy || !row.docs_received_at} title={!row.docs_received_at ? "Tick “Documents received” first" : undefined}
                    onChange={v => void save({ prepared_at: v ? new Date().toISOString() : null })} />} />

                <Step n={3} label={STEPS[2].label} done={hasReceipt} meta={hasReceipt ? `${docs.length} file${docs.length === 1 ? "" : "s"}` : null}
                  control={edit ? (
                    <label className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border cursor-pointer hover:bg-muted ${busy ? "opacity-60 pointer-events-none" : ""}`}>
                      <Upload className="h-3.5 w-3.5" /> Upload receipt
                      <input type="file" className="hidden" disabled={busy} onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void uploadReceipt(f); }} />
                    </label>
                  ) : null}>
                  {docs.length > 0 && (
                    <ul className="mt-1.5 space-y-1">
                      {docs.map(d => (
                        <li key={d.id}>
                          <button onClick={() => void openClientFile(d.file_path)} className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline text-left">
                            <FileText className="h-3.5 w-3.5 shrink-0" /><span className="break-all">{d.title}</span>
                            <span className="text-muted-foreground no-underline">· {formatDateTime(d.created_at)}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </Step>

                <Step n={4} label={STEPS[3].label} done={closed} meta={closed ? stamp(row.filed_at, row.filed_by) : null}
                  control={row.invoice_id ? <LinkedInvoice invoiceId={row.invoice_id} /> : null}>
                  {!closed && edit && (
                    <div className="mt-1.5">
                      <button
                        disabled={!readyToClose || busy}
                        onClick={() => (row.invoice_id ? void save({ status: "filed" }, "Filing closed") : setInvoiceOpen(true))}
                        className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md bg-primary text-primary-foreground disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Check className="h-4 w-4" /> {row.invoice_id ? "Close filing" : "Generate invoice & close filing"}
                      </button>
                      {blocker && <p className="text-[11px] text-muted-foreground mt-1 flex items-center gap-1"><Lock className="h-3 w-3" />{blocker}</p>}
                    </div>
                  )}
                </Step>
              </section>

              {/* Notes */}
              <section>
                <label className="text-xs font-medium text-muted-foreground">Notes</label>
                <textarea
                  value={notes}
                  disabled={!canEdit || busy}
                  onChange={e => setNotes(e.target.value)}
                  onBlur={() => { if ((notes ?? "") !== (row.notes ?? "")) void save({ notes: notes.trim() ? notes : null }); }}
                  rows={3}
                  placeholder="Anything the next person should know"
                  className="mt-1 w-full px-3 py-2 rounded-md border bg-background text-sm disabled:opacity-60"
                />
              </section>

              {closed && (
                <section className="rounded-md border bg-emerald-50 dark:bg-emerald-900/20 p-3 text-sm">
                  <div className="font-medium text-emerald-800 dark:text-emerald-200">Filing closed</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{stamp(row.filed_at, row.filed_by) ?? "—"}</div>
                  {isAdmin && (
                    <button disabled={busy} onClick={() => { if (window.confirm("Reopen this filing? Only the latest closed period can be reopened.")) void save({ status: "in_progress" }, "Filing reopened"); }} className="mt-2 text-xs text-primary hover:underline">Reopen (admin)</button>
                  )}
                </section>
              )}

              {canEdit && !closed && (
                <div className="pt-2 border-t">
                  <button disabled={busy} onClick={() => void stopObligation()} className="text-xs text-destructive hover:underline">Stop tracking this obligation for this client</button>
                </div>
              )}
              {!canEdit && <p className="text-xs text-muted-foreground">You can view this filing but not change it.</p>}
            </div>
          )}
        </SheetContent>
      </Sheet>

      {row && (
        <CompletionInvoiceDialog
          open={invoiceOpen}
          onOpenChange={setInvoiceOpen}
          source="tax_returns"
          sourceId={row.id}
          clientName={row.clients?.company_name}
          defaultDescription={`${policy?.label ?? row.return_type} filing - due ${row.due_date}`}
          onInvoiced={async () => { await save({ status: "filed" }, "Filing closed"); }}
        />
      )}
    </>
  );
}

function Tick({ checked, disabled, onChange, title }: { checked: boolean; disabled?: boolean; onChange: (v: boolean) => void; title?: string }) {
  return <input type="checkbox" className="h-5 w-5 accent-emerald-600 disabled:opacity-50" checked={checked} disabled={disabled} title={title} onChange={e => onChange(e.target.checked)} aria-label={checked ? "Done" : "Not done"} />;
}

function Step({ n, label, done, meta, control, children }: { n: number; label: string; done: boolean; meta?: string | null; control?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <div className={`h-6 w-6 rounded-full text-xs flex items-center justify-center shrink-0 mt-0.5 ${done ? "bg-emerald-500 text-white" : "bg-muted text-muted-foreground"}`}>{done ? <Check className="h-3.5 w-3.5" /> : n}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <div className={`text-sm ${done ? "font-medium" : ""}`}>{label}</div>
          {control}
        </div>
        {meta && <div className="text-[11px] text-muted-foreground">{meta}</div>}
        {children}
      </div>
    </div>
  );
}
