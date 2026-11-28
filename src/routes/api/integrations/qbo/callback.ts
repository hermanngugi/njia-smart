import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  credentialBundle, exchangeQboAuthorizationCode, getQboConfig, hashOAuthState,
  QBO_REQUESTED_SCOPES, revokeQboTokens, storeQboCredentials, tokenExpiryDates,
} from "@/lib/integrations/qbo.server";
import { assertCompanyAccess } from "@/lib/integrations/qbo.company.server";

const adminDb = supabaseAdmin as any;

function callbackError(message: string, status = 400) {
  return new Response(message, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });
}

function returnUrl(redirectUri: string, result: string) {
  const url = new URL("/accounts/quickbooks", new URL(redirectUri).origin);
  url.searchParams.set("qbo", result);
  return url;
}

async function consumeAuthorizationState(state: string, environment: string) {
  if (!/^[a-f0-9]{64}$/i.test(state)) return null;
  const now = new Date().toISOString();
  // The UPDATE is atomic, so a second callback cannot consume the same state.
  const { data, error } = await adminDb
    .from("integration_auth_states")
    .update({ consumed_at: now })
    .eq("state_hash", await hashOAuthState(state))
    .eq("provider", "quickbooks_online")
    .eq("environment", environment)
    .is("client_id", null)
    .is("consumed_at", null)
    .gt("expires_at", now)
    .select("id,initiated_by")
    .maybeSingle();
  if (error || !data) return null;
  return data as { id: string; initiated_by: string | null };
}

export const Route = createFileRoute("/api/integrations/qbo/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const state = url.searchParams.get("state") ?? "";
        if (!state) return callbackError("QuickBooks authorisation state is missing.");

        let config: ReturnType<typeof getQboConfig>;
        try { config = getQboConfig(); } catch { return callbackError("QuickBooks configuration is incomplete.", 503); }

        const authorizationState = await consumeAuthorizationState(state, config.environment);
        if (!authorizationState?.initiated_by) {
          return callbackError("This QuickBooks authorisation request is invalid, expired or already used.");
        }

        if (url.searchParams.get("error")) return Response.redirect(returnUrl(config.redirectUri, "denied"), 303);

        const code = url.searchParams.get("code") ?? "";
        const realmId = url.searchParams.get("realmId") ?? "";
        if (!code || code.length > 4096 || !/^\d{1,30}$/.test(realmId)) {
          return Response.redirect(returnUrl(config.redirectUri, "invalid_response"), 303);
        }

        try { await assertCompanyAccess(authorizationState.initiated_by, "manage"); }
        catch { return Response.redirect(returnUrl(config.redirectUri, "permission_changed"), 303); }

        let integrationId: string | null = null;
        let createdNew = false;
        let issuedTokens: Awaited<ReturnType<typeof exchangeQboAuthorizationCode>> | null = null;

        try {
          // One company connection per environment. Reconnecting the same company reuses its row.
          const existing = await adminDb.from("client_integrations").select("id,external_account_id")
            .is("client_id", null).eq("provider", "quickbooks_online").eq("environment", config.environment)
            .neq("status", "disconnected").maybeSingle();
          if (existing.error) throw new Error("Could not check the existing connection.");
          if (existing.data && existing.data.external_account_id !== realmId) {
            return Response.redirect(returnUrl(config.redirectUri, "other_company_connected"), 303);
          }

          if (existing.data) {
            integrationId = existing.data.id;
          } else {
            const inserted = await adminDb.from("client_integrations").insert({
              client_id: null, provider: "quickbooks_online", environment: config.environment,
              external_account_id: realmId, status: "pending", scopes: [...QBO_REQUESTED_SCOPES],
              metadata: { scope: "company" },
              connected_by: authorizationState.initiated_by, created_by: authorizationState.initiated_by,
            }).select("id").single();
            if (inserted.error || !inserted.data?.id) {
              if (inserted.error?.code === "23505") return Response.redirect(returnUrl(config.redirectUri, "other_company_connected"), 303);
              throw new Error("Could not create the QuickBooks connection record.");
            }
            integrationId = inserted.data.id;
            createdNew = true;
          }

          // Intuit authorization codes are one-time use. Exchange once only.
          const tokens = await exchangeQboAuthorizationCode(config, code);
          issuedTokens = tokens;
          const expiries = tokenExpiryDates(tokens);
          await storeQboCredentials({
            integrationId: integrationId!,
            credentials: credentialBundle(tokens, expiries.hardExpiryAt),
            accessTokenExpiresAt: expiries.accessTokenExpiresAt,
            refreshTokenExpiresAt: expiries.refreshTokenExpiresAt,
            connectedBy: authorizationState.initiated_by,
          });
          return Response.redirect(returnUrl(config.redirectUri, "connected"), 303);
        } catch (error) {
          // Never log authorization codes, tokens, secrets or raw provider payloads.
          console.error("[QBO OAuth] Callback failed:", error instanceof Error ? error.name : "UnknownError");
          if (issuedTokens) {
            try { await revokeQboTokens(config, credentialBundle(issuedTokens)); } catch { /* keep response generic */ }
          }
          if (createdNew && integrationId) await adminDb.from("client_integrations").delete().eq("id", integrationId);
          return Response.redirect(returnUrl(config.redirectUri, "error"), 303);
        }
      },
    },
  },
});
