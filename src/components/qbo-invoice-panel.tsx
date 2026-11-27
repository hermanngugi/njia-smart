import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { getQboConnectionStatus } from "@/lib/integrations/qbo.functions";
import {
  getQboInvoiceSetup,
  refreshNjiaInvoiceFromQboFn,
  saveQboInvoiceSetupFn,
  sendNjiaInvoiceToQboFn,
} from "@/lib/integrations/qbo.invoice.functions";

type Setup = {
  customers: Array<{ id: string; name: string; email: string | null }>;
  serviceItems: Array<{ id: string; name: string; description: string | null }>;
  customerId: string | null;
  serviceItemId: string | null;
  invoiceLink: { externalId: string; document_number?: string; status?: string; total_amount?: number; amount_paid?: number; balance_amount?: number; syncedAt?: string } | null;
};
type SyncResult = {
  externalId: string;
  documentNumber: string | null;
  status: string;
  total: number;
  amountPaid: number;
  balance: number;
  syncedAt: string;
};

function money(value: number) {
  return new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES" }).format(value || 0);
}

export function QboInvoicePanel({ clientId, invoiceId, invoiceStatus }: {
  clientId: string; invoiceId: string; invoiceStatus: string;
}) {
  const [integrationId, setIntegrationId] = useState<string | null>(null);
  const [setup, setSetup] = useState<Setup | null>(null);
  const [customerId, setCustomerId] = useState("");
  const [serviceItemId, setServiceItemId] = useState("");
  const [sync, setSync] = useState<SyncResult | null>(null);
  const [busy, setBusy] = useState<"load" | "save" | "send" | "refresh" | null>("load");

  async function load() {
    setBusy("load");
    try {
      const status = await getQboConnectionStatus({ data: { client_id: clientId } });
      const connection = status.connection as { id: string; status: string } | null;
      if (!connection || connection.status !== "connected") {
        setIntegrationId(null); setSetup(null); setSync(null); return;
      }
      setIntegrationId(connection.id);
      const result = await getQboInvoiceSetup({ data: { client_id: clientId, integration_id: connection.id, invoice_id: invoiceId } }) as Setup;
      setSetup(result);
      setCustomerId(result.customerId ?? "");
      setServiceItemId(result.serviceItemId ?? "");
      setSync(result.invoiceLink ? { externalId: result.invoiceLink.externalId, documentNumber: result.invoiceLink.document_number ?? null, status: result.invoiceLink.status ?? "sent", total: Number(result.invoiceLink.total_amount ?? 0), amountPaid: Number(result.invoiceLink.amount_paid ?? 0), balance: Number(result.invoiceLink.balance_amount ?? 0), syncedAt: result.invoiceLink.syncedAt ?? new Date().toISOString() } : null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load QuickBooks invoice settings.");
    } finally { setBusy(null); }
  }

  useEffect(() => { void load(); }, [clientId, invoiceId]);

  async function saveSetup() {
    if (!integrationId || !customerId || !serviceItemId) {
      toast.error("Select the QuickBooks Customer and shared Services item first."); return;
    }
    setBusy("save");
    try {
      await saveQboInvoiceSetupFn({ data: { client_id: clientId, integration_id: integrationId, customer_id: customerId, service_item_id: serviceItemId } });
      toast.success("QuickBooks Customer and shared Services item saved for this client.");
      await load();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not save QuickBooks settings."); }
    finally { setBusy(null); }
  }

  async function send() {
    if (!integrationId) return;
    setBusy("send");
    try {
      const result = await sendNjiaInvoiceToQboFn({ data: { client_id: clientId, integration_id: integrationId, invoice_id: invoiceId } }) as SyncResult;
      setSync(result);
      toast.success("Invoice sent to QuickBooks and linked.");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not send invoice to QuickBooks."); }
    finally { setBusy(null); }
  }

  async function refresh() {
    if (!integrationId) return;
    setBusy("refresh");
    try {
      const result = await refreshNjiaInvoiceFromQboFn({ data: { client_id: clientId, integration_id: integrationId, invoice_id: invoiceId } }) as SyncResult;
      setSync(result);
      toast.success("QuickBooks invoice status refreshed.");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not refresh QuickBooks status."); }
    finally { setBusy(null); }
  }

  if (busy === "load") return <section className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">Loading QuickBooks invoice integration…</section>;
  if (!integrationId) return (
    <section className="rounded-lg border bg-card p-4 print:hidden">
      <h3 className="font-semibold">QuickBooks Online</h3>
      <p className="mt-1 text-sm text-muted-foreground">Connect this client's QuickBooks company from the client's Integrations tab before sending invoices.</p>
    </section>
  );

  const linked = Boolean(sync?.externalId);\n  const mappingReady = Boolean(setup?.customerId && setup?.serviceItemId && customerId === setup.customerId && serviceItemId === setup.serviceItemId);
  return (
    <section className="space-y-3 rounded-lg border bg-card p-4 print:hidden">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-semibold">QuickBooks Online</h3>
          <p className="mt-1 text-xs text-muted-foreground">Send this finalised Njia Smart invoice to QuickBooks. Payment recording and bank reconciliation remain in QuickBooks.</p>
        </div>
        {linked && <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-800">Linked</span>}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span className="font-medium">QuickBooks Customer for this client</span>
          <select value={customerId} onChange={e => setCustomerId(e.target.value)} className="h-9 w-full rounded-md border bg-background px-2" disabled={busy !== null}>
            <option value="">Select customer…</option>
            {(setup?.customers ?? []).map(c => <option key={c.id} value={c.id}>{c.name}{c.email ? ` · ${c.email}` : ""}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="font-medium">Shared QuickBooks Services item</span>
          <select value={serviceItemId} onChange={e => setServiceItemId(e.target.value)} className="h-9 w-full rounded-md border bg-background px-2" disabled={busy !== null}>
            <option value="">Select Services item…</option>
            {(setup?.serviceItems ?? []).map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={saveSetup} disabled={busy !== null || !customerId || !serviceItemId}>
          {busy === "save" ? "Saving…" : "Save client mapping"}
        </Button>
        {!linked && (
          <Button type="button" onClick={send} disabled={busy !== null || invoiceStatus === "draft" || !mappingReady}>
            {busy === "send" ? "Sending…" : "Send invoice to QuickBooks"}
          </Button>
        )}
        {linked && <Button type="button" variant="outline" onClick={refresh} disabled={busy !== null}>{busy === "refresh" ? "Refreshing…" : "Refresh payment status"}</Button>}
      </div>
      {invoiceStatus === "draft" && <p className="text-xs text-amber-700">Finalise this invoice in Njia Smart before sending it to QuickBooks.</p>}
      {(!setup?.customerId || !setup?.serviceItemId) && <p className="text-xs text-muted-foreground">Save the client-to-customer match and shared Services item before sending.</p>}
      {sync && (
        <div className="grid gap-2 rounded-md bg-muted/40 p-3 text-sm sm:grid-cols-4">
          <div><div className="text-xs text-muted-foreground">QuickBooks invoice</div><div className="font-medium">{sync.documentNumber || sync.externalId}</div></div>
          <div><div className="text-xs text-muted-foreground">Status</div><div className="font-medium capitalize">{sync.status}</div></div>
          <div><div className="text-xs text-muted-foreground">Amount paid</div><div className="font-medium">{money(sync.amountPaid)}</div></div>
          <div><div className="text-xs text-muted-foreground">Outstanding</div><div className="font-medium">{money(sync.balance)}</div></div>
          <div className="sm:col-span-4 text-xs text-muted-foreground">Last synced: {new Date(sync.syncedAt).toLocaleString()}</div>
          <div className="sm:col-span-4"><a className="text-sm text-primary underline" href={`https://app.sandbox.qbo.intuit.com/app/invoice?txnId=${encodeURIComponent(sync.externalId)}`} target="_blank" rel="noreferrer">Open invoice in QuickBooks</a></div>
        </div>
      )}
    </section>
  );
}
