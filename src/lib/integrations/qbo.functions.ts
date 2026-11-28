import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  buildQboAuthorizationUrl, clearQboCredentials, createOAuthState, getQboConfig, hashOAuthState,
  QBO_REQUESTED_SCOPES, readQboCredentials, revokeQboTokens,
} from "@/lib/integrations/qbo.server";
import { assertCompanyAccess, companyOverview, getCompanyConnection, syncCompany } from "@/lib/integrations/qbo.company.server";

const db = supabaseAdmin as any;

/** Connection status plus, when connected, the comparison with Njia Smart's invoices. */
export const getQboCompany = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    try { await assertCompanyAccess(context.userId, "view"); }
    catch { return { allowed: false as const }; }
    let status;
    try { status = await getCompanyConnection(); }
    catch (e) { return { allowed: true as const, configured: false as const, message: e instanceof Error ? e.message : "QuickBooks is not configured." }; }
    const overview = status.connection?.status === "connected" ? await companyOverview(status.connection.id) : null;
    return { allowed: true as const, configured: true as const, ...status, overview };
  });

export const startQboCompanyAuthorization = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertCompanyAccess(context.userId, "manage");
    const config = getQboConfig();
    const state = createOAuthState();
    const now = new Date();
    await db.from("integration_auth_states").delete().eq("provider", "quickbooks_online").lt("expires_at", now.toISOString());
    const { error } = await db.from("integration_auth_states").insert({
      client_id: null, provider: "quickbooks_online", environment: config.environment,
      state_hash: await hashOAuthState(state), requested_scopes: [...QBO_REQUESTED_SCOPES],
      initiated_by: context.userId, expires_at: new Date(now.getTime() + 10 * 60 * 1000).toISOString(),
    });
    if (error) throw new Error("Could not start QuickBooks authorisation. Please try again.");
    return { authorization_url: buildQboAuthorizationUrl(config, state) };
  });

export const refreshQboCompany = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertCompanyAccess(context.userId, "view");
    const { connection } = await getCompanyConnection();
    if (!connection || connection.status !== "connected") throw new Error("QuickBooks is not connected.");
    return await syncCompany(connection.id);
  });

export const disconnectQboCompany = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ integration_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertCompanyAccess(context.userId, "manage");
    const { data: row, error } = await db.from("client_integrations").select("id,status")
      .eq("id", data.integration_id).is("client_id", null).eq("provider", "quickbooks_online").maybeSingle();
    if (error || !row) throw new Error("QuickBooks connection was not found.");
    if (row.status === "disconnected") return { ok: true };
    await revokeQboTokens(getQboConfig(), await readQboCredentials(data.integration_id));
    await clearQboCredentials(data.integration_id);
    await db.from("qbo_invoices").delete().eq("integration_id", data.integration_id);
    await db.from("qbo_payments").delete().eq("integration_id", data.integration_id);
    return { ok: true };
  });
