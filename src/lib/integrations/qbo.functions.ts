import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  buildQboAuthorizationUrl,
  clearQboCredentials,
  createOAuthState,
  getQboConfig,
  hashOAuthState,
  QBO_REQUESTED_SCOPES,
  readQboCredentials,
  revokeQboTokens,
} from "@/lib/integrations/qbo.server";
import {
  captureQboSandboxCharge as requestQboSandboxCapture,
  createQboSandboxCharge as requestQboSandboxCharge,
  getQboCompanyInfo as requestQboCompanyInfo,
  getQboOpenIdUserInfo as requestQboOpenIdUserInfo,
} from "@/lib/integrations/qbo.api.server";

const adminDb = supabaseAdmin as any;

async function assertIntegrationAccess(
  userId: string,
  clientId: string,
  action: "view" | "connect" | "sync" | "disconnect" | "approve",
) {
  const { data, error } = await adminDb.rpc("integration_client_access_check", {
    _user_id: userId,
    _client_id: clientId,
    _action: action,
  });

  if (error || data !== true) {
    throw new Error("You are not authorised to perform this integration action for this client.");
  }
}

export const startQboAuthorization = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ client_id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const config = getQboConfig();
    await assertIntegrationAccess(context.userId, data.client_id, "connect");

    const state = createOAuthState();
    const stateHash = await hashOAuthState(state);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 10 * 60 * 1000).toISOString();

    // Expired authorisation states are safe to clean up opportunistically.
    await adminDb
      .from("integration_auth_states")
      .delete()
      .eq("provider", "quickbooks_online")
      .lt("expires_at", now.toISOString());

    const { error } = await adminDb.from("integration_auth_states").insert({
      client_id: data.client_id,
      provider: "quickbooks_online",
      environment: "sandbox",
      state_hash: stateHash,
      requested_scopes: [...QBO_REQUESTED_SCOPES],
      initiated_by: context.userId,
      expires_at: expiresAt,
    });

    if (error) throw new Error("Could not start QuickBooks authorisation. Please try again.");

    return { authorization_url: buildQboAuthorizationUrl(config, state) };
  });

export const getQboConnectionStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ client_id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    try {
      await assertIntegrationAccess(context.userId, data.client_id, "view");
    } catch {
      return { allowed: false, connection: null };
    }

    const { data: connection, error } = await adminDb
      .from("client_integrations")
      .select(
        "id,status,external_account_id,external_account_name,country_code,last_connected_at,last_synced_at,access_token_expires_at,refresh_token_expires_at,last_error_code",
      )
      .eq("client_id", data.client_id)
      .eq("provider", "quickbooks_online")
      .eq("environment", "sandbox")
      .neq("status", "disconnected")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw new Error("Could not load the QuickBooks connection status.");

    return {
      allowed: true,
      connection: connection ?? null,
    };
  });

export const disconnectQboConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      client_id: z.string().uuid(),
      integration_id: z.string().uuid(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertIntegrationAccess(context.userId, data.client_id, "disconnect");

    const { data: connection, error } = await adminDb
      .from("client_integrations")
      .select("id,client_id,provider,environment,status")
      .eq("id", data.integration_id)
      .eq("client_id", data.client_id)
      .eq("provider", "quickbooks_online")
      .eq("environment", "sandbox")
      .maybeSingle();

    if (error || !connection) throw new Error("QuickBooks connection was not found.");
    if (connection.status === "disconnected") return { ok: true };

    const credentials = await readQboCredentials(data.integration_id);
    await revokeQboTokens(getQboConfig(), credentials);
    await clearQboCredentials(data.integration_id);

    return { ok: true };
  });


async function getConnectedQboIntegration(clientId: string, integrationId: string) {
  const { data: connection, error } = await adminDb
    .from("client_integrations")
    .select("id,client_id,external_account_id,status,provider,environment")
    .eq("id", integrationId)
    .eq("client_id", clientId)
    .eq("provider", "quickbooks_online")
    .eq("environment", "sandbox")
    .maybeSingle();

  if (error || !connection || connection.status !== "connected") {
    throw new Error("A connected QuickBooks sandbox company is required for this test.");
  }

  if (
    typeof connection.external_account_id !== "string" ||
    !/^\d{1,30}$/.test(connection.external_account_id)
  ) {
    throw new Error("The connected QuickBooks company ID is invalid.");
  }

  return connection as {
    id: string;
    client_id: string;
    external_account_id: string;
    status: string;
    provider: string;
    environment: string;
  };
}

const paymentAmountSchema = z
  .string()
  .trim()
  .regex(/^\d{1,8}\.\d{2}$/, "Enter an amount with two decimal places, for example 1.00.")
  .refine((value) => Number(value) > 0, "The amount must be greater than zero.");

export const getQboCompanyInfo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      client_id: z.string().uuid(),
      integration_id: z.string().uuid(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertIntegrationAccess(context.userId, data.client_id, "view");
    const connection = await getConnectedQboIntegration(data.client_id, data.integration_id);
    return requestQboCompanyInfo(connection.id, connection.external_account_id);
  });

export const getQboOpenIdUserInfo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      client_id: z.string().uuid(),
      integration_id: z.string().uuid(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertIntegrationAccess(context.userId, data.client_id, "view");
    const connection = await getConnectedQboIntegration(data.client_id, data.integration_id);
    return requestQboOpenIdUserInfo(connection.id);
  });

export const createQboSandboxCharge = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      client_id: z.string().uuid(),
      integration_id: z.string().uuid(),
      amount: paymentAmountSchema,
      card_token: z.string().trim().min(1).max(512),
      capture: z.boolean().default(false),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    // Payment charges are restricted to Director/Admin by the database permission check.
    await assertIntegrationAccess(context.userId, data.client_id, "approve");
    const connection = await getConnectedQboIntegration(data.client_id, data.integration_id);

    return requestQboSandboxCharge({
      integrationId: connection.id,
      amount: data.amount,
      cardToken: data.card_token,
      capture: data.capture,
    });
  });

export const captureQboSandboxCharge = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      client_id: z.string().uuid(),
      integration_id: z.string().uuid(),
      charge_id: z.string().trim().min(1).max(64),
      amount: paymentAmountSchema,
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertIntegrationAccess(context.userId, data.client_id, "approve");
    const connection = await getConnectedQboIntegration(data.client_id, data.integration_id);

    return requestQboSandboxCapture({
      integrationId: connection.id,
      chargeId: data.charge_id,
      amount: data.amount,
    });
  });
