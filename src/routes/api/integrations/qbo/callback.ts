import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  credentialBundle,
  exchangeQboAuthorizationCode,
  getQboConfig,
  hashOAuthState,
  storeQboCredentials,
  tokenExpiryDates,
} from "@/lib/integrations/qbo.server";

const adminDb = supabaseAdmin as any;

function callbackError(message: string, status = 400) {
  return new Response(message, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

function clientReturnUrl(redirectUri: string, clientId: string, result: string) {
  const url = new URL(\`/clients/\${encodeURIComponent(clientId)}\`, new URL(redirectUri).origin);
  url.searchParams.set("tab", "Integrations");
  url.searchParams.set("qbo", result);
  return url;
}

async function consumeAuthorizationState(state: string) {
  if (!/^[a-f0-9]{64}$/i.test(state)) return null;

  const stateHash = await hashOAuthState(state);
  const now = new Date().toISOString();

  // The UPDATE is atomic. A second callback cannot consume the same state.
  const { data, error } = await adminDb
    .from("integration_auth_states")
    .update({ consumed_at: now })
    .eq("state_hash", stateHash)
    .eq("provider", "quickbooks_online")
    .eq("environment", "sandbox")
    .is("consumed_at", null)
    .gt("expires_at", now)
    .select("id,client_id,provider,environment,initiated_by")
    .maybeSingle();

  if (error || !data) return null;
  return data as {
    id: string;
    client_id: string;
    provider: string;
    environment: string;
    initiated_by: string | null;
  };
}

export const Route = createFileRoute("/api/integrations/qbo/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const state = url.searchParams.get("state") ?? "";
        if (!state) return callbackError("QuickBooks authorisation state is missing.");

        const authorizationState = await consumeAuthorizationState(state);
        if (!authorizationState || !authorizationState.initiated_by) {
          return callbackError("This QuickBooks authorisation request is invalid, expired or already used.");
        }

        let config: ReturnType<typeof getQboConfig>;
        try {
          config = getQboConfig();
        } catch {
          return callbackError("QuickBooks development configuration is incomplete.", 503);
        }

        const clientId = authorizationState.client_id;
        const oauthError = url.searchParams.get("error");
        if (oauthError) {
          return Response.redirect(clientReturnUrl(config.redirectUri, clientId, "denied"), 303);
        }

        const code = url.searchParams.get("code") ?? "";
        const realmId = url.searchParams.get("realmId") ?? "";

        if (!code || code.length > 4096 || !/^\d{1,30}$/.test(realmId)) {
          return Response.redirect(clientReturnUrl(config.redirectUri, clientId, "invalid_response"), 303);
        }

        const { data: accessAllowed, error: accessError } = await adminDb.rpc(
          "integration_client_access_check",
          {
            _user_id: authorizationState.initiated_by,
            _client_id: clientId,
            _action: "connect",
          },
        );

        if (accessError || accessAllowed !== true) {
          return Response.redirect(clientReturnUrl(config.redirectUri, clientId, "permission_changed"), 303);
        }

        let integrationId: string | null = null;
        let createdNewIntegration = false;

        try {
          const existingResult = await adminDb
            .from("client_integrations")
            .select("id,client_id")
            .eq("provider", "quickbooks_online")
            .eq("environment", "sandbox")
            .eq("external_account_id", realmId)
            .neq("status", "disconnected")
            .maybeSingle();

          if (existingResult.error) throw new Error("Could not check the existing company connection.");

          if (existingResult.data && existingResult.data.client_id !== clientId) {
            return Response.redirect(
              clientReturnUrl(config.redirectUri, clientId, "company_already_linked"),
              303,
            );
          }

          if (existingResult.data) {
            integrationId = existingResult.data.id;
          } else {
            const insertResult = await adminDb
              .from("client_integrations")
              .insert({
                client_id: clientId,
                provider: "quickbooks_online",
                environment: "sandbox",
                external_account_id: realmId,
                status: "pending",
                scopes: ["com.intuit.quickbooks.accounting"],
                connected_by: authorizationState.initiated_by,
                created_by: authorizationState.initiated_by,
              })
              .select("id")
              .single();

            if (insertResult.error || !insertResult.data?.id) {
              // A concurrent callback may have connected this company first.
              if (insertResult.error?.code === "23505") {
                return Response.redirect(
                  clientReturnUrl(config.redirectUri, clientId, "company_already_linked"),
                  303,
                );
              }
              throw new Error("Could not create the QuickBooks connection record.");
            }

            integrationId = insertResult.data.id;
            createdNewIntegration = true;
          }

          // Intuit authorization codes are one-time use. Exchange them once only.
          const tokens = await exchangeQboAuthorizationCode(config, code);
          const expiries = tokenExpiryDates(tokens);
          const credentials = credentialBundle(tokens, expiries.hardExpiryAt);

          await storeQboCredentials({
            integrationId,
            credentials,
            accessTokenExpiresAt: expiries.accessTokenExpiresAt,
            refreshTokenExpiresAt: expiries.refreshTokenExpiresAt,
            connectedBy: authorizationState.initiated_by,
          });

          return Response.redirect(clientReturnUrl(config.redirectUri, clientId, "connected"), 303);
        } catch (error) {
          // Never log authorization codes, tokens, client secrets or raw provider payloads.
          console.error("[QBO OAuth] Callback failed:", error instanceof Error ? error.name : "UnknownError");

          if (createdNewIntegration && integrationId) {
            await adminDb
              .from("client_integrations")
              .delete()
              .eq("id", integrationId)
              .eq("client_id", clientId);
          }

          return Response.redirect(clientReturnUrl(config.redirectUri, clientId, "error"), 303);
        }
      },
    },
  },
});
