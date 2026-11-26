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
  readQboCredentials,
  revokeQboTokens,
} from "@/lib/integrations/qbo.server";

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
      requested_scopes: ["com.intuit.quickbooks.accounting"],
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
