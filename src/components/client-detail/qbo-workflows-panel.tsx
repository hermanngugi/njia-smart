import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { getQboMirrorRecords, runQboReadOnlySync } from "@/lib/integrations/qbo.sync.functions";
import {
  executeApprovedQboOperation, getQboOperations, requestQboOperation, reviewQboOperation,
} from "@/lib/integrations/qbo.operations.functions";

type Props = { clientId: string; integrationId: string };
type RecordType = "Customer" | "Invoice" | "Payment";
type MirrorRow = {
  id: string; external_record_id: string; display_name: string | null;
  document_number: string | null; transaction_date: string | null; due_date: string | null;
  total_amount: number | null; balance_amount: number | null; currency_code: string | null;
  record_data: Record<string, unknown>;
};
type Operation = {
  id: string; operation_type: string; status: string; request_payload: Record<string, unknown>;
  requested_by: string | null; approved_by: string | null; rejected_reason: string | null;
  external_record_id: string | null; error_code: string | null;
};

export function QboWorkflowsPanel({ clientId, integrationId }: Props) {
  const { isAdmin, roles } = useAuth();
  const canApprove = isAdmin || roles.includes("director");
  const canRequest = canApprove || roles.includes("accountant");
  const [type, setType] = useState<RecordType>("Customer");
  const [rows, setRows] = useState<MirrorRow[]>([]);
  const [operations, setOperations] = useState<Operation[]>([]);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"initial" | "incremental" | "full">("initial");
  const [invoice, setInvoice] = useState({ customer_id: "", item_id: "", description: "", quantity: "1", unit_price: "1.00" });
  const [payment, setPayment] = useState({ customer_id: "", amount: "1.00", deposit_account_id: "", invoice_id: "" });

  async function loadRows(nextType = type) {
    const result = await getQboMirrorRecords({ data: { client_id: clientId, integration_id: integrationId, record_type: nextType, limit: 50 } });
    setRows(result as MirrorRow[]);
  }
  async function loadOperations() {
    const result = await getQboOperations({ data: { client_id: clientId, integration_id: integrationId } });
    setOperations(result as Operation[]);
  }
  useEffect(() => {
    void loadRows().catch((e) => toast.error(e instanceof Error ? e.message : "Could not load mirror."));
    void loadOperations().catch((e) => toast.error(e instanceof Error ? e.message : "Could not load operations."));
  }, [clientId, integrationId]);

  async function sync() {
    setBusy(true);
    try {
      const result = await runQboReadOnlySync({ data: { client_id: clientId, integration_id: integrationId, mode } });
      toast.success(`Sync complete: ${result.records_seen} seen, ${result.records_created} new, ${result.records_updated} updated.`);
      await loadRows();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "QuickBooks sync failed.");
    } finally { setBusy(false); }
  }
  async function submitOperation(operationType: "create_invoice" | "record_payment") {
    setBusy(true);
    try {
      const payload = operationType === "create_invoice"
        ? { customer_id: invoice.customer_id, item_id: invoice.item_id, description: invoice.description, quantity: Number(invoice.quantity), unit_price: Number(invoice.unit_price) }
        : { customer_id: payment.customer_id, amount: Number(payment.amount), deposit_account_id: payment.deposit_account_id, ...(payment.invoice_id ? { invoice_id: payment.invoice_id } : {}) };
      await requestQboOperation({ data: { client_id: clientId, integration_id: integrationId, operation_type: operationType, payload } } as never);
      toast.success("Operation submitted for Director/Admin approval.");
      await loadOperations();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Could not submit operation."); }
    finally { setBusy(false); }
  }
  async function decide(id: string, decision: "approve" | "reject") {
    setBusy(true);
    try {
      await reviewQboOperation({ data: { client_id: clientId, operation_id: id, decision } });
      await loadOperations();
      toast.success(`Operation ${decision}d.`);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Could not review operation."); }
    finally { setBusy(false); }
  }
  async function execute(id: string) {
    setBusy(true);
    try {
      await executeApprovedQboOperation({ data: { client_id: clientId, integration_id: integrationId, operation_id: id } });
      await loadOperations();
      toast.success("QuickBooks operation executed.");
    } catch (e) { toast.error(e instanceof Error ? e.message : "QuickBooks operation failed."); }
    finally { setBusy(false); }
  }

  return <section className="space-y-5 rounded-lg border bg-card p-4 sm:p-5">
    <div>
      <h3 className="font-semibold">Accounting data synchronisation</h3>
      <p className="mt-1 text-sm text-muted-foreground">Imports QuickBooks Customers, Invoices and Payments into a separate read-only mirror. It never creates or overwrites Njia Smart invoices or payment records.</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select className="rounded-md border bg-background px-3 py-2 text-sm" value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
          <option value="initial">Initial sync</option><option value="incremental">Incremental sync</option><option value="full">Full refresh</option>
        </select>
        <Button onClick={sync} disabled={busy}> {busy ? "Working…" : "Run sync"} </Button>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {(["Customer", "Invoice", "Payment"] as const).map((item) =>
          <Button key={item} size="sm" variant={type === item ? "default" : "outline"} onClick={() => { setType(item); void loadRows(item); }}>{item}s</Button>
        )}
      </div>
      <div className="mt-3 overflow-x-auto rounded-md border">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted/50"><tr><th className="p-2">Record</th><th className="p-2">Date</th><th className="p-2">Total</th><th className="p-2">Balance</th><th className="p-2">External ID</th></tr></thead>
          <tbody>{rows.length ? rows.map((row) => <tr key={row.id} className="border-t">
            <td className="p-2">{row.display_name || row.document_number || "—"}</td>
            <td className="p-2">{row.transaction_date || "—"}</td>
            <td className="p-2">{row.total_amount == null ? "—" : `${row.currency_code || ""} ${row.total_amount}`}</td>
            <td className="p-2">{row.balance_amount == null ? "—" : `${row.currency_code || ""} ${row.balance_amount}`}</td>
            <td className="p-2 font-mono text-xs">{row.external_record_id}</td>
          </tr>) : <tr><td className="p-3 text-muted-foreground" colSpan={5}>No mirrored records yet. Run a sync to populate this view.</td></tr>}</tbody>
        </table>
      </div>
    </div>

    <div className="border-t pt-4">
      <h3 className="font-semibold">Controlled QuickBooks operations</h3>
      <p className="mt-1 text-sm text-muted-foreground">Requests are not sent to QuickBooks until a different Director/Admin approves them. Use QuickBooks Customer, Item and Deposit Account IDs from the connected sandbox company.</p>
      {canRequest && <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <form className="space-y-2 rounded-md border p-3" onSubmit={(e) => { e.preventDefault(); void submitOperation("create_invoice"); }}>
          <h4 className="font-medium">Request invoice creation</h4>
          <input required className="w-full rounded-md border bg-background p-2 text-sm" placeholder="QuickBooks Customer ID" value={invoice.customer_id} onChange={(e) => setInvoice({ ...invoice, customer_id: e.target.value })}/>
          <input required className="w-full rounded-md border bg-background p-2 text-sm" placeholder="QuickBooks Item ID" value={invoice.item_id} onChange={(e) => setInvoice({ ...invoice, item_id: e.target.value })}/>
          <input required className="w-full rounded-md border bg-background p-2 text-sm" placeholder="Line description" value={invoice.description} onChange={(e) => setInvoice({ ...invoice, description: e.target.value })}/>
          <div className="grid grid-cols-2 gap-2"><input required type="number" min="0.01" step="0.01" className="w-full rounded-md border bg-background p-2 text-sm" placeholder="Quantity" value={invoice.quantity} onChange={(e) => setInvoice({ ...invoice, quantity: e.target.value })}/><input required type="number" min="0.01" step="0.01" className="w-full rounded-md border bg-background p-2 text-sm" placeholder="Unit price" value={invoice.unit_price} onChange={(e) => setInvoice({ ...invoice, unit_price: e.target.value })}/></div>
          <Button type="submit" disabled={busy}>Submit for approval</Button>
        </form>
        <form className="space-y-2 rounded-md border p-3" onSubmit={(e) => { e.preventDefault(); void submitOperation("record_payment"); }}>
          <h4 className="font-medium">Request payment recording</h4>
          <input required className="w-full rounded-md border bg-background p-2 text-sm" placeholder="QuickBooks Customer ID" value={payment.customer_id} onChange={(e) => setPayment({ ...payment, customer_id: e.target.value })}/>
          <input required type="number" min="0.01" step="0.01" className="w-full rounded-md border bg-background p-2 text-sm" placeholder="Amount" value={payment.amount} onChange={(e) => setPayment({ ...payment, amount: e.target.value })}/>
          <input required className="w-full rounded-md border bg-background p-2 text-sm" placeholder="Deposit account ID" value={payment.deposit_account_id} onChange={(e) => setPayment({ ...payment, deposit_account_id: e.target.value })}/>
          <input className="w-full rounded-md border bg-background p-2 text-sm" placeholder="Invoice ID (optional)" value={payment.invoice_id} onChange={(e) => setPayment({ ...payment, invoice_id: e.target.value })}/>
          <Button type="submit" disabled={busy}>Submit for approval</Button>
        </form>
      </div>}
      <div className="mt-4 space-y-2">
        {operations.length ? operations.map((op) => <div key={op.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3 text-sm">
          <div className="min-w-0"><div className="font-medium">{op.operation_type.replaceAll("_", " ")} · {op.status}</div><div className="mt-1 break-all text-xs text-muted-foreground">Request {op.id}{op.external_record_id ? ` · QuickBooks ID ${op.external_record_id}` : ""}{op.rejected_reason ? ` · ${op.rejected_reason}` : ""}</div><pre className="mt-2 max-w-xl overflow-auto rounded bg-muted p-2 text-xs">{JSON.stringify(op.request_payload, null, 2)}</pre></div>
          <div className="flex flex-wrap gap-2">
            {canApprove && op.status === "pending_approval" && <><Button size="sm" disabled={busy} onClick={() => void decide(op.id, "approve")}>Approve</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => void decide(op.id, "reject")}>Reject</Button></>}
            {canApprove && op.status === "approved" && <Button size="sm" disabled={busy} onClick={() => void execute(op.id)}>Execute</Button>}
          </div>
        </div>) : <p className="text-sm text-muted-foreground">No QuickBooks operations have been requested.</p>}
      </div>
    </div>
  </section>;
}
