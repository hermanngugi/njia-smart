import { getFreshQboAccessToken } from "@/lib/integrations/qbo.server";

const COMPANY_API_BASE_URL = "https://sandbox-quickbooks.api.intuit.com/v3/company";
const OPENID_USERINFO_URL = "https://sandbox-accounts.platform.intuit.com/v1/openid_connect/userinfo";
const PAYMENTS_API_BASE_URL = "https://sandbox.api.intuit.com/quickbooks/v4/payments";

type JsonObject = Record<string, unknown>;

type IntuitErrorPayload = {
  Fault?: {
    Error?: Array<{ code?: string | number }>;
  };
};

export class QboApiError extends Error {
  readonly statusCode: number;
  readonly intuitCode?: string;

  constructor(statusCode: number, intuitCode?: string) {
    super(
      `Intuit API request failed (HTTP ${statusCode}${intuitCode ? `, code ${intuitCode}` : ""}).`,
    );
    this.name = "QboApiError";
    this.statusCode = statusCode;
    this.intuitCode = intuitCode;
  }
}

function getIntuitErrorCode(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const fault = (payload as IntuitErrorPayload).Fault;
  const firstError = Array.isArray(fault?.Error) ? fault.Error[0] : undefined;
  if (firstError?.code === undefined || firstError.code === null) return undefined;
  return String(firstError.code).slice(0, 40);
}

async function qboJsonRequest<T extends JsonObject>(
  integrationId: string,
  url: string,
  init: RequestInit,
): Promise<T> {
  const send = async (accessToken: string) => {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${accessToken}`);
    headers.set("Accept", "application/json");
    return fetch(url, {
      ...init,
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
  };

  let response = await send(await getFreshQboAccessToken(integrationId));

  // Intuit's official Node.js sample refreshes and retries after a 401.
  // The retry is limited to once; a payment request reuses its Request-Id.
  if (response.status === 401) {
    response = await send(await getFreshQboAccessToken(integrationId, true));
  }

  const responseText = await response.text();
  let payload: unknown = null;
  if (responseText) {
    try {
      payload = JSON.parse(responseText);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    throw new QboApiError(response.status, getIntuitErrorCode(payload));
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new QboApiError(response.status, "invalid_json_response");
  }

  return payload as T;
}

export async function getQboCompanyInfo(
  integrationId: string,
  realmId: string,
): Promise<JsonObject> {
  if (!/^\d{1,30}$/.test(realmId)) {
    throw new Error("The connected QuickBooks company ID is invalid.");
  }

  const companyId = encodeURIComponent(realmId);
  return qboJsonRequest<JsonObject>(
    integrationId,
    `${COMPANY_API_BASE_URL}/${companyId}/companyinfo/${companyId}`,
    { method: "GET" },
  );
}

export async function getQboOpenIdUserInfo(integrationId: string): Promise<JsonObject> {
  return qboJsonRequest<JsonObject>(
    integrationId,
    OPENID_USERINFO_URL,
    { method: "GET" },
  );
}

export type QboSandboxChargeResult = {
  request_id: string;
  id: string;
  status: string;
  amount: string;
  currency: string;
  capture: boolean;
  auth_code?: string;
};

function safeChargeResult(
  payload: JsonObject,
  requestId: string,
): QboSandboxChargeResult {
  const id = typeof payload.id === "string" ? payload.id : "";
  const status = typeof payload.status === "string" ? payload.status : "";
  const amount = typeof payload.amount === "string" ? payload.amount : "";
  const currency = typeof payload.currency === "string" ? payload.currency : "USD";

  if (!id || !status || !amount) {
    throw new QboApiError(502, "invalid_charge_response");
  }

  return {
    request_id: requestId,
    id,
    status,
    amount,
    currency,
    capture: payload.capture === true,
    ...(typeof payload.authCode === "string" ? { auth_code: payload.authCode } : {}),
  };
}

export async function createQboSandboxCharge(args: {
  integrationId: string;
  amount: string;
  cardToken: string;
  capture: boolean;
}): Promise<QboSandboxChargeResult> {
  const requestId = crypto.randomUUID();
  const payload = await qboJsonRequest<JsonObject>(
    args.integrationId,
    `${PAYMENTS_API_BASE_URL}/charges`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Request-Id": requestId,
      },
      body: JSON.stringify({
        amount: args.amount,
        currency: "USD",
        capture: args.capture ? "true" : "false",
        token: args.cardToken,
      }),
    },
  );

  return safeChargeResult(payload, requestId);
}

export async function captureQboSandboxCharge(args: {
  integrationId: string;
  chargeId: string;
  amount: string;
}): Promise<QboSandboxChargeResult> {
  const requestId = crypto.randomUUID();
  const chargeId = encodeURIComponent(args.chargeId);
  const payload = await qboJsonRequest<JsonObject>(
    args.integrationId,
    `${PAYMENTS_API_BASE_URL}/charges/${chargeId}/capture`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Request-Id": requestId,
      },
      body: JSON.stringify({ amount: args.amount }),
    },
  );

  return safeChargeResult(payload, requestId);
}
