import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Receipt } from "lucide-react";
import { STATUS_COLORS } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

export type CompletionSource = "tax_returns" | "engagements" | "advisory_projects" | "service_projects";

/**
 * Mandatory "generate the invoice" step shown when a billable task is being
 * completed (tax filed, audit completed, project closed...). It creates the
 * invoice under the client and links it to the record in one database call
 * (create_completion_invoice); only then does the caller finish the
 * completion via `onInvoiced`. The database also refuses to complete a record
 * with no invoice, so this can't be skipped by another screen.
 */
export function CompletionInvoiceDialog({
  open, onOpenChange, source, sourceId, clientName, defaultDescription, onInvoiced,
  requireFile, fileLabel, onUploadFile,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  source: CompletionSource;
  sourceId: string;
  clientName?: string | null;
  defaultDescription?: string;
  onInvoiced: (invoiceId: string) => void | Promise<void>;
  /** Also require a file (e.g. the tax filing receipt) in this same step. */
  requireFile?: boolean;
  fileLabel?: string;
  /** Saves the chosen file; return true when it was stored. */
  onUploadFile?: (file: File) => Promise<boolean>;
}) {
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) { setDescription(defaultDescription ?? ""); setAmount(""); setFile(null); }
  }, [open, sourceId, defaultDescription]);

  async function submit() {
    const amt = Number(amount);
    if (!amt || amt <= 0) { toast.error("Enter the amount to invoice"); return; }
    if (requireFile && !file) { toast.error(`Attach the ${fileLabel ?? "required file"} to continue`); return; }
    setBusy(true);
    if (requireFile && file && onUploadFile) {
      const stored = await onUploadFile(file);
      if (!stored) { setBusy(false); return; }
    }
    const { data, error } = await supabase.rpc("create_completion_invoice" as any, {
      _source: source, _source_id: sourceId, _description: description, _amount: amt,
    } as any);
    if (error || !data) { setBusy(false); toast.error(error?.message ?? "Could not create the invoice"); return; }
    toast.success("Invoice generated");
    try { await onInvoiced(data as unknown as string); } finally { setBusy(false); }
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={o => !busy && onOpenChange(o)}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Generate invoice to complete</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            An invoice is required to complete this task{clientName ? <> for <span className="font-medium text-foreground">{clientName}</span></> : null}. It is created under the client as a draft; you can add line items or record payment from Accounts.
          </p>
          <div><Label className="text-xs">Description</Label><Input value={description} onChange={e => setDescription(e.target.value)} /></div>
          <div><Label className="text-xs">Amount (KES, before VAT) *</Label><Input type="number" min="0" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} /></div>
          {requireFile && (
            <div>
              <Label className="text-xs">{fileLabel ?? "File"} *</Label>
              <Input type="file" onChange={e => setFile(e.target.files?.[0] ?? null)} />
              <p className="text-[11px] text-muted-foreground mt-1">Required before this can be registered as complete.</p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy}><Receipt className="h-3.5 w-3.5 mr-1" />{busy ? "Working…" : "Generate invoice & complete"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Small chip showing the invoice linked to a completed record. */
export function LinkedInvoice({ invoiceId }: { invoiceId?: string | null }) {
  const [inv, setInv] = useState<any>(null);
  useEffect(() => {
    if (!invoiceId) { setInv(null); return; }
    supabase.from("invoices").select("id, invoice_number, status").eq("id", invoiceId).maybeSingle().then(({ data }) => setInv(data));
  }, [invoiceId]);
  if (!invoiceId) return <span className="text-xs text-muted-foreground">No invoice yet</span>;
  if (!inv) return <span className="text-xs text-muted-foreground">Invoice…</span>;
  return (
    <Link to="/accounts/$id" params={{ id: inv.id }} className={`text-xs px-2 py-0.5 rounded-full capitalize ${STATUS_COLORS[inv.status] ?? "bg-muted"}`}>
      {inv.invoice_number} · {inv.status}
    </Link>
  );
}
