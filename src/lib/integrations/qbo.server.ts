import { supabaseAdmin } from "@/integrations/supabase/client.server";

const AUTHORIZATION_ENDPOINT = "https://appcenter.intuit.com/connect/oauth2";
const TOKEN_ENDPOINT = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const REVOCATION_ENDPOINT = "https://developer.api.intuit.com/v2/oauth2/tokens/revoke";
export const QBO_ACCOUNTING_SCOPE = "com.intuit.quickbooks.accounting";

export type QboConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  environment: "sandbox";
};

export type QboTokenResponse = {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  x_refresh_token_expires_in?: number;
  x_refresh_token_hard_expires_in?: number;
  scope?: string;
};

export type QboCredentialBundle = {
  access_token: string;
  refresh_token: string;
  token_type: string;
  scope?: string;
  hard_expiry_at?: string;
};

export class QboOAuthError extends Error {
  code: string;
  constructor(code: string, message = "QuickBooks authorisation failed") {
    super(message);
    this.name = "QboOAuthError";
    this.code = code;
  }
}

export function getQboConfig(): QboConfig {
  const clientId = process.env.QBO_CLIENT_ID?.trim();
  const clientSecret = process.env.QBO_CLIENT_SECRET?.trim();
  const redirectUri = process.env.QBO_REDIRECT_URI?.trim();
  const environment = (process.env.QBO_ENVIRONMENT?.trim() || "sandbox").toLowerCase();

  const missing = [
    ...(!clientId ? ["QBO_CLIENT_ID"] : []),
    ...(!clientSecret ? ["QBO_CLIENT_SECRET"] : []),
    ...(!redirectUri ? ["QBO_REDIRECT_URI"] : []),
  ];
  if (missing.length) {
    throw new Error(\`QuickBooks development configuration is incomplete: \${missing.join(", ")}\`);
  }

  if (environment !== "sandbox") {
    throw new Error("This development branch only supports the QuickBooks sandbox environment.");
  }

  let parsedRedirect: URL;
  try {
    parsedRedirect = new URL(redirectUri!);
  } catch {
    throw new Error("QBO_REDIRECT_URI must be a valid HTTPS URL.");
  }

  if (
    parsedRedirect.protocol !== "https:" ||
    parsedRedirect.pathname !== "/api/integrations/qbo/callback" ||
    parsedRedirect.search ||
    parsedRedirect.hash
  ) {
    throw new Error(
      "QBO_REDIRECT_URI must be HTTPS, have no query string, and end with /api/integrations/qbo/callback.",
    );
  }

  return {
    clientId: clientId!,
    clientSecret: clientSecret!,
    redirectUri: redirectUri!,
    environment: "sandbox",
  };
}

export function createOAuthState(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function hashOAuthState(state: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(state));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function buildQboAuthorizationUrl(config: QboConfig, state: string): string {
  const url = new URL(AUTHORIZATION_ENDPOINT);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", QBO_ACCOUNTING_SCOPE);
  url.searchParams.set("state", state);
  return url.toString();
}

function basicAuthorization(config: QboConfig): string {
  return \`Basic \${btoa(\`\${config.clientId}:\${config.clientSecret}\`)}\`;
}

async function tokenRequest(
  config: QboConfig,
  body: URLSearchParams,
): Promise<QboTokenResponse> {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: basicAuthorization(config),
      "Content-Type": "application/x-www-form-urlencoded",
      "x-include-refresh-token-hard-expires-in": "true",
    },
    body,
    signal: AbortSignal.timeout(20_000),
  });

  const payload = await response.json().catch(() => null) as
    | (Partial<QboTokenResponse> & { error?: string })
    | null;

  if (!response.ok || !payload || !payload.access_token || !payload.refresh_token || !payload.token_type) {
    const errorCode = typeof payload?.error === "string" ? payload.error.slice(0, 80) : \`http_\${response.status}\`;
    throw new QboOAuthError(errorCode, "Intuit did not return a valid token response.");
  }

  const expiresIn = Number(payload.expires_in);
  if (!Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw new QboOAuthError("invalid_token_lifetime", "Intuit returned an invalid token lifetime.");
  }

  return {
    access_token: payload.access_token,
    refresh_token: payload.refresh_token,
    token_type: payload.token_type,
    expires_in: expiresIn,
    x_refresh_token_expires_in: Number(payload.x_refresh_token_expires_in) || undefined,
    x_refresh_token_hard_expires_in: Number(payload.x_refresh_token_hard_expires_in) || undefined,
    scope: typeof payload.scope === "string" ? payload.scope : undefined,
  };
}

export async function exchangeQboAuthorizationCode(
  config: QboConfig,
  code: string,
): Promise<QboTokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: config.redirectUri,
  });
  return tokenRequest(config, body);
}

async function refreshQboToken(
  config: QboConfig,
  refreshToken: string,
): Promise<QboTokenResponse> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  return tokenRequest(config, body);
}

export function tokenExpiryDates(tokens: QboTokenResponse, now = Date.now()) {
  const refreshSeconds = tokens.x_refresh_token_expires_in ?? 8_640_000;
  const hardSeconds = tokens.x_refresh_token_hard_expires_in;
  return {
    accessTokenExpiresAt: new Date(now + tokens.expires_in * 1000).toISOString(),
    refreshTokenExpiresAt: new Date(now + refreshSeconds * 1000).toISOString(),
    hardExpiryAt: hardSeconds
      ? new Date(now + hardSeconds * 1000).toISOString()
      : undefined,
  };
}

export function credentialBundle(tokens: QboTokenResponse, hardExpiryAt?: string): QboCredentialBundle {
  return {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    token_type: tokens.token_type,
    ...(tokens.scope ? { scope: tokens.scope } : {}),
    ...(hardExpiryAt ? { hard_expiry_at: hardExpiryAt } : {}),
  };
}

const adminDb = supabaseAdmin as any;

export async function storeQboCredentials(args: {
  integrationId: string;
  credentials: QboCredentialBundle;
  accessTokenExpiresAt: string;
  refreshTokenExpiresAt: string;
  connectedBy: string | null;
}) {
  const { error } = await adminDb.rpc("qbo_store_credentials", {
    _integration_id: args.integrationId,
    _credentials: args.credentials,
    _access_token_expires_at: args.accessTokenExpiresAt,
    _refresh_token_expires_at: args.refreshTokenExpiresAt,
    _connected_by: args.connectedBy,
  });
  if (error) throw new Error("Could not securely store the QuickBooks credentials.");
}

export async function readQboCredentials(integrationId: string): Promise<QboCredentialBundle> {
  const { data, error } = await adminDb.rpc("qbo_read_credentials", {
    _integration_id: integrationId,
  });
  if (error || !data || typeof data !== "object") {
    throw new Error("The QuickBooks credentials are unavailable. Reconnect the company.");
  }
  return data as QboCredentialBundle;
}

export async function revokeQboTokens(config: QboConfig, credentials: QboCredentialBundle) {
  const response = await fetch(REVOCATION_ENDPOINT, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: basicAuthorization(config),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ token: credentials.refresh_token }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new QboOAuthError(
      \`revoke_http_\${response.status}\`,
      "Intuit could not confirm token revocation. The connection has been kept so it can be retried.",
    );
  }
}

export async function clearQboCredentials(integrationId: string) {
  const { data, error } = await adminDb.rpc("qbo_clear_credentials", {
    _integration_id: integrationId,
  });
  if (error || data !== true) throw new Error("Could not clear the stored QuickBooks credentials.");
}

async function markQboReconnectRequired(integrationId: string, code: string) {
  await adminDb.rpc("qbo_mark_reconnect_required", {
    _integration_id: integrationId,
    _error_code: code,
  });
}

/**
 * Server-only access-token helper for subsequent read-only QBO API calls.
 * Intuit rotates refresh tokens. A database lock ensures only one invocation
 * can exchange a refresh token at a time.
 */
export async function getFreshQboAccessToken(integrationId: string): Promise<string> {
  const config = getQboConfig();
  const connectionResult = await adminDb
    .from("client_integrations")
    .select("status, access_token_expires_at, refresh_token_expires_at")
    .eq("id", integrationId)
    .eq("provider", "quickbooks_online")
    .eq("environment", "sandbox")
    .maybeSingle();

  if (connectionResult.error || !connectionResult.data) {
    throw new Error("QuickBooks connection was not found.");
  }
  if (connectionResult.data.status !== "connected") {
    throw new Error("QuickBooks needs to be reconnected before synchronisation.");
  }

  let credentials = await readQboCredentials(integrationId);
  const accessExpiry = new Date(connectionResult.data.access_token_expires_at ?? 0).getTime();
  if (Number.isFinite(accessExpiry) && accessExpiry > Date.now() + 120_000) {
    return credentials.access_token;
  }

  const lockId = crypto.randomUUID();
  const lockResult = await adminDb.rpc("qbo_try_acquire_refresh_lock", {
    _integration_id: integrationId,
    _lock_id: lockId,
  });

  if (lockResult.error) throw new Error("Could not coordinate the QuickBooks token refresh.");
  if (lockResult.data !== true) {
    await new Promise((resolve) => setTimeout(resolve, 350));
    const latest = await adminDb
      .from("client_integrations")
      .select("access_token_expires_at,status")
      .eq("id", integrationId)
      .maybeSingle();
    if (
      latest.data?.status === "connected" &&
      new Date(latest.data.access_token_expires_at ?? 0).getTime() > Date.now() + 60_000
    ) {
      credentials = await readQboCredentials(integrationId);
      return credentials.access_token;
    }
    throw new Error("A QuickBooks token refresh is already in progress. Retry shortly.");
  }

  try {
    const refreshedAt = Date.now();
    const latestConnection = await adminDb
      .from("client_integrations")
      .select("refresh_token_expires_at,status")
      .eq("id", integrationId)
      .maybeSingle();

    if (latestConnection.data?.status !== "connected") {
      throw new Error("QuickBooks connection is no longer active.");
    }

    const refreshExpiry = new Date(latestConnection.data.refresh_token_expires_at ?? 0).getTime();
    if (!Number.isFinite(refreshExpiry) || refreshExpiry <= refreshedAt) {
      await markQboReconnectRequired(integrationId, "refresh_token_expired");
      throw new QboOAuthError("refresh_token_expired", "Reconnect the QuickBooks company.");
    }

    credentials = await readQboCredentials(integrationId);
    const tokens = await refreshQboToken(config, credentials.refresh_token);
    const expiries = tokenExpiryDates(tokens, refreshedAt);
    const merged: QboCredentialBundle = {
      ...credentialBundle(tokens, expiries.hardExpiryAt ?? credentials.hard_expiry_at),
      ...(tokens.scope ? { scope: tokens.scope } : credentials.scope ? { scope: credentials.scope } : {}),
    };

    await storeQboCredentials({
      integrationId,
      credentials: merged,
      accessTokenExpiresAt: expiries.accessTokenExpiresAt,
      refreshTokenExpiresAt: expiries.refreshTokenExpiresAt,
      connectedBy: null,
    });

    return merged.access_token;
  } catch (error) {
    if (error instanceof QboOAuthError && error.code === "invalid_grant") {
      await markQboReconnectRequired(integrationId, "invalid_grant");
    }
    throw error;
  } finally {
    await adminDb.rpc("qbo_release_refresh_lock", {
      _integration_id: integrationId,
      _lock_id: lockId,
    });
  }
}

export async function getQboAdminClient() {
  return supabaseAdmin;
}
