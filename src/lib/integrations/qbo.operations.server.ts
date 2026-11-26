import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getFreshQboAccessToken } from "@/lib/integrations/qbo.server";

const COMPANY_API_BASE_URL = "https://sandbox-quickbooks.api.intuit.com/v3/company";
const db = supabaseAdmin as any;

async function qboWrite(integrationId: string, realmId: string, entity: "invoice" | "payment", payload: Record<string, unknown>, idempotencyKey: string) {
  if (!/^\d{1,30}$/.test(realmId)) throw new Error("Invalid QuickBooks company ID.");
  const url = new URL(`${COMPANY_API_BASE_URL}/${encodeURIComponent(realmId)}/${entity}`);
  url.searchParams.set("requestid", idempotencyKey);
  const send = (token: string) => fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store",
    signal: AbortSignal.timeout(25_000),
  });
  let response = await send(await getFreshQboAccessToken(integrationId));
  if (response.status === 401) response = await send(await getFreshQboAccessToken(integrationId, true));
  const raw = await response.text();
  let result: unknown;
  try { result = raw ? JSON.parse(raw) : null; } catch { result = null; }
  if (!response.ok || !result || typeof result !== "object") {
    throw new Error(`QuickBooks ${entity} write failed (HTTP ${response.status}).`);
  }
  const entityResult = (result as Record<string, unknown>)[entity === "invoice" ? "Invoice" : "Payment"];
  if (!entityResult || typeof entityResult !== "object") throw new Error("QuickBooks returned no created record.");
  const record = entityResult as Record<string, unknown>;
  if (typeof record.Id !== "string" && typeof record.Id !== "number") throw new Error("QuickBooks returned no record ID.");
  return { id: String(record.Id), doc_number: typeof record.DocNumber === "string" ? record.DocNumber : null };
}

export async function createApprovedQboInvoice(args: {
  integrationId: string; realmId: string; idempotencyKey: string;
  customerId: string; itemId: string; description: string; quantity: number; unitPrice: number;
}) {
  const amount = Number((args.quantity * args.unitPrice).toFixed(2));
  return qboWrite(args.integrationId, args.realmId, "invoice", {
    CustomerRef: { value: args.customerId },
    Line: [{
      Amount: amount,
      DetailType: "SalesItemLineDetail",
      Description: args.description,
      SalesItemLineDetail: {
        ItemRef: { value: args.itemId },
        Qty: args.quantity,
        UnitPrice: args.unitPrice,
      },
    }],
  }, args.idempotencyKey);
}

export async function recordApprovedQboPayment(args: {
  integrationId: string; realmId: string; idempotencyKey: string;
  customerId: string; amount: number; depositAccountId: string; invoiceId?: string;
}) {
  const payload: Record<string, unknown> = {
    CustomerRef: { value: args.customerId },
    TotalAmt: Number(args.amount.toFixed(2)),
    DepositToAccountRef: { value: args.depositAccountId },
  };
  if (args.invoiceId) {
    payload.Line = [{
      Amount: Number(args.amount.toFixed(2)),
      LinkedTxn: [{ TxnId: args.invoiceId, TxnType: "Invoice" }],
    }];
  }
  return qboWrite(args.integrationId, args.realmId, "payment", payload, args.idempotencyKey);
}
