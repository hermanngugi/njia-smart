import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  listQboInvoiceSetup,
  refreshNjiaInvoiceFromQbo,
  saveQboInvoiceSetup,
  sendNjiaInvoiceToQbo,
} from "@/lib/integrations/qbo.invoice.server";

const db = supabaseAdmin as any;
const base = z.object({ client_id: z.string().uuid(), integration_id: z.string().uuid() });

async function assertAccess(userId: string, clientId: string, action: "view" | "sync") {
  const { data, error } = await db.rpc("integration_client_access_check", {
    _user_id: userId, _client_id: clientId, _action: action,
  });
  if (error || data !== true) throw new Error("You are not authorised to perform this QuickBooks action for this client.");
}

async function connectionFor(clientId: string, integrationId: string) {
  const { data, error } = await db.from("client_integrations")
    .select("id,client_id,external_account_id,status,provider,environment,metadata,country_code")
    .eq("id", integrationId).eq("client_id", clientId)
    .eq("provider", "quickbooks_online").eq("environment", "sandbox").maybeSingle();
  if (error || !data || data.status !== "connected" || !/^\d{1,30}$/.test(data.external_account_id ?? "")) {
    throw new Error("A connected QuickBooks sandbox company is required.");
  }
  return data;
}

export const getQboInvoiceSetup = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => base.extend({ invoice_id: z.string().uuid().optional() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAccess(context.userId, data.client_id, "view");
    const connection = await connectionFor(data.client_id, data.integration_id);
    return listQboInvoiceSetup(connection, data.client_id, data.invoice_id);
  });

export const saveQboInvoiceSetupFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => base.extend({
    customer_id: z.string().regex(/^\d{1,30}$/),
    service_item_id: z.string().regex(/^\d{1,30}$/),
  }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAccess(context.userId, data.client_id, "sync");
    const connection = await connectionFor(data.client_id, data.integration_id);
    return saveQboInvoiceSetup(connection, data.client_id, data.customer_id, data.service_item_id);
  });

export const sendNjiaInvoiceToQboFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => base.extend({ invoice_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAccess(context.userId, data.client_id, "sync");
    const connection = await connectionFor(data.client_id, data.integration_id);
    return sendNjiaInvoiceToQbo(connection, data.client_id, data.invoice_id);
  });

export const refreshNjiaInvoiceFromQboFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => base.extend({ invoice_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAccess(context.userId, data.client_id, "sync");
    const connection = await connectionFor(data.client_id, data.integration_id);
    return refreshNjiaInvoiceFromQbo(connection, data.client_id, data.invoice_id);
  });
