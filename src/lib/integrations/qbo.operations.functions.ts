import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { createApprovedQboInvoice, recordApprovedQboPayment } from "@/lib/integrations/qbo.operations.server";

const db = supabaseAdmin as any;
async function assertAccess(userId: string, clientId: string, action: "view" | "sync" | "approve") {
  const { data, error } = await db.rpc("integration_client_access_check", {
    _user_id: userId, _client_id: clientId, _action: action,
  });
  if (error || data !== true) throw new Error("You are not authorised to perform this integration action for this client.");
}
async function connected(clientId: string, integrationId: string) {
  const { data, error } = await db.from("client_integrations")
    .select("id,client_id,external_account_id,status,provider,environment")
    .eq("id", integrationId).eq("client_id", clientId)
    .eq("provider", "quickbooks_online").eq("environment", "sandbox").maybeSingle();
  if (error || !data || data.status !== "connected" || !/^\d{1,30}$/.test(data.external_account_id ?? "")) {
    throw new Error("A connected QuickBooks sandbox company is required.");
  }
  return data;
}
const idSchema = z.string().trim().min(1).max(100);
const money = z.number().finite().positive().max(99999999.99);
const invoiceRequest = z.object({
  customer_id: idSchema, item_id: idSchema,
  description: z.string().trim().min(1).max(500),
  quantity: z.number().finite().positive().max(100000),
  unit_price: money,
});
const paymentRequest = z.object({
  customer_id: idSchema, amount: money, deposit_account_id: idSchema,
  invoice_id: idSchema.optional(),
});

export const requestQboOperation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.discriminatedUnion("operation_type", [
    z.object({ client_id: z.string().uuid(), integration_id: z.string().uuid(), operation_type: z.literal("create_invoice"), payload: invoiceRequest }),
    z.object({ client_id: z.string().uuid(), integration_id: z.string().uuid(), operation_type: z.literal("record_payment"), payload: paymentRequest }),
  ]).parse(input))
  .handler(async ({ data, context }) => {
    await assertAccess(context.userId, data.client_id, "sync");
    const connection = await connected(data.client_id, data.integration_id);
    const idempotencyKey = crypto.randomUUID();
    const { data: operation, error } = await db.from("integration_operations").insert({
      integration_id: connection.id, client_id: data.client_id,
      operation_type: data.operation_type, status: "pending_approval",
      idempotency_key: idempotencyKey, request_payload: data.payload,
      requested_by: context.userId,
    }).select("id,operation_type,status,requested_at").single();
    if (error || !operation) throw new Error("Could not submit the QuickBooks operation for approval.");
    return operation;
  });

export const reviewQboOperation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({
    client_id: z.string().uuid(), operation_id: z.string().uuid(),
    decision: z.enum(["approve", "reject"]), reason: z.string().trim().max(500).optional(),
  }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAccess(context.userId, data.client_id, "approve");
    const { data: operation, error: loadError } = await db.from("integration_operations")
      .select("id,client_id,requested_by,status")
      .eq("id", data.operation_id).eq("client_id", data.client_id).maybeSingle();
    if (loadError || !operation || operation.status !== "pending_approval") throw new Error("This operation is no longer awaiting approval.");
    if (operation.requested_by === context.userId) throw new Error("A different Director/Admin must approve this operation.");
    const update = data.decision === "approve"
      ? { status: "approved", approved_by: context.userId, approved_at: new Date().toISOString(), rejected_reason: null }
      : { status: "rejected", rejected_reason: data.reason || "Rejected by authorised reviewer." };
    const { data: changed, error } = await db.from("integration_operations")
      .update(update).eq("id", data.operation_id).eq("client_id", data.client_id)
      .eq("status", "pending_approval").select("id,status,approved_by,approved_at,rejected_reason").maybeSingle();
    if (error || !changed) throw new Error("The operation changed before your decision could be saved.");
    return changed;
  });

export const executeApprovedQboOperation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({
    client_id: z.string().uuid(), integration_id: z.string().uuid(), operation_id: z.string().uuid(),
  }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAccess(context.userId, data.client_id, "approve");
    const connection = await connected(data.client_id, data.integration_id);
    const { data: operation, error: loadError } = await db.from("integration_operations")
      .select("id,integration_id,client_id,operation_type,status,idempotency_key,request_payload,requested_by,approved_by")
      .eq("id", data.operation_id).eq("integration_id", connection.id)
      .eq("client_id", data.client_id).maybeSingle();
    if (loadError || !operation || operation.status !== "approved" || !operation.approved_by) {
      throw new Error("Only an approved operation can be executed.");
    }
    if (operation.requested_by === operation.approved_by) throw new Error("The requester cannot approve their own operation.");
    const { data: claimed, error: claimError } = await db.from("integration_operations")
      .update({ status: "executing", executed_by: context.userId })
      .eq("id", operation.id).eq("status", "approved").select("id").maybeSingle();
    if (claimError || !claimed) throw new Error("This operation is already being executed or is no longer approved.");

    try {
      const payload = operation.request_payload as Record<string, unknown>;
      const result = operation.operation_type === "create_invoice"
        ? await createApprovedQboInvoice({
            integrationId: connection.id, realmId: connection.external_account_id,
            idempotencyKey: operation.idempotency_key,
            customerId: String(payload.customer_id), itemId: String(payload.item_id),
            description: String(payload.description), quantity: Number(payload.quantity), unitPrice: Number(payload.unit_price),
          })
        : operation.operation_type === "record_payment"
          ? await recordApprovedQboPayment({
              integrationId: connection.id, realmId: connection.external_account_id,
              idempotencyKey: operation.idempotency_key,
              customerId: String(payload.customer_id), amount: Number(payload.amount),
              depositAccountId: String(payload.deposit_account_id),
              ...(typeof payload.invoice_id === "string" ? { invoiceId: payload.invoice_id } : {}),
            })
          : (() => { throw new Error("Unsupported QuickBooks operation."); })();
      const { error } = await db.from("integration_operations").update({
        status: "succeeded", executed_at: new Date().toISOString(),
        external_record_type: operation.operation_type === "create_invoice" ? "Invoice" : "Payment",
        external_record_id: result.id, result_summary: { external_id: result.id, document_number: result.doc_number },
      }).eq("id", operation.id).eq("status", "executing");
      if (error) throw new Error("QuickBooks accepted the operation, but the result could not be recorded. Do not retry manually; reconcile using the idempotency key.");
      return { status: "succeeded" as const, ...result };
    } catch (error) {
      await db.from("integration_operations").update({
        status: "failed", executed_at: new Date().toISOString(),
        error_code: "provider_write_failed",
      }).eq("id", operation.id).eq("status", "executing");
      throw new Error(error instanceof Error ? error.message : "QuickBooks operation failed.");
    }
  });

export const getQboOperations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({
    client_id: z.string().uuid(), integration_id: z.string().uuid(),
  }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAccess(context.userId, data.client_id, "view");
    const connection = await connected(data.client_id, data.integration_id);
    const { data: rows, error } = await db.from("integration_operations")
      .select("id,operation_type,status,request_payload,requested_by,requested_at,approved_by,approved_at,rejected_reason,executed_at,external_record_type,external_record_id,error_code")
      .eq("integration_id", connection.id).eq("client_id", data.client_id)
      .order("requested_at", { ascending: false }).limit(50);
    if (error) throw new Error("Could not load QuickBooks operation history.");
    return rows ?? [];
  });
