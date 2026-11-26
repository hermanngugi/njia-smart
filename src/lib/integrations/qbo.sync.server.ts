import { getFreshQboAccessToken } from "@/lib/integrations/qbo.server";

const COMPANY_API_BASE_URL = "https://sandbox-quickbooks.api.intuit.com/v3/company";

type JsonObject = Record<string, unknown>;
type QboRecordType = "Customer" | "Invoice" | "Payment";

export class QboSyncError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "QboSyncError";
  }
}

async function qboRequest<T>(integrationId: string, realmId: string, path: string, init: RequestInit = {}): Promise<T> {
  if (!/^\d{1,30}$/.test(realmId)) throw new QboSyncError("invalid_realm", "Invalid QuickBooks company ID.");
  const send = async (token: string) => fetch(`${COMPANY_API_BASE_URL}/${encodeURIComponent(realmId)}/${path}`, {
    ...init,
    headers: { Accept: "application/json", ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers, Authorization: `Bearer ${token}` },
    cache: "no-store",
    signal: AbortSignal.timeout(25_000),
  });
  let response = await send(await getFreshQboAccessToken(integrationId));
  if (response.status === 401) response = await send(await getFreshQboAccessToken(integrationId, true));
  const text = await response.text();
  let body: unknown;
  try { body = text ? JSON.parse(text) : null; } catch { body = null; }
  if (!response.ok) throw new QboSyncError(`http_${response.status}`, `QuickBooks request failed (HTTP ${response.status}).`);
  if (!body || typeof body !== "object") throw new QboSyncError("invalid_response", "QuickBooks returned an invalid response.");
  return body as T;
}

function safeString(value: unknown, max = 500): string | null {
  return typeof value === "string" ? value.slice(0, max) : null;
}
function nestedString(value: unknown, key: string): string | null {
  return value && typeof value === "object" ? safeString((value as JsonObject)[key]) : null;
}
function amount(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
function dateTime(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
function dateOnly(value: unknown): string | null {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}
function allowList(type: QboRecordType, raw: JsonObject) {
  const meta = raw.MetaData as JsonObject | undefined;
  const customer = raw.CustomerRef as JsonObject | undefined;
  const currency = raw.CurrencyRef as JsonObject | undefined;
  const base = {
    provider_modified_at: dateTime(meta?.LastUpdatedTime),
    currency_code: safeString(currency?.value, 3),
    customer_ref: safeString(customer?.value, 100),
    customer_name: safeString(customer?.name, 200),
  };
  if (type === "Customer") return {
    ...base,
    company_name: safeString(raw.CompanyName, 200),
    display_name: safeString(raw.DisplayName, 200),
    given_name: safeString(raw.GivenName, 100),
    family_name: safeString(raw.FamilyName, 100),
    email: nestedString(raw.PrimaryEmailAddr, "Address"),
    phone: nestedString(raw.PrimaryPhone, "FreeFormNumber"),
    active: typeof raw.Active === "boolean" ? raw.Active : null,
    balance: amount(raw.Balance),
  };
  if (type === "Invoice") return {
    ...base,
    doc_number: safeString(raw.DocNumber, 100),
    txn_date: dateOnly(raw.TxnDate),
    due_date: dateOnly(raw.DueDate),
    total_amount: amount(raw.TotalAmt),
    balance_amount: amount(raw.Balance),
    private_note: safeString(raw.PrivateNote, 500),
    customer_ref: safeString(customer?.value, 100),
    customer_name: safeString(customer?.name, 200),
  };
  return {
    ...base,
    txn_date: dateOnly(raw.TxnDate),
    payment_ref_num: safeString(raw.PaymentRefNum, 100),
    total_amount: amount(raw.TotalAmt),
    unapplied_amount: amount(raw.UnappliedAmt),
    customer_ref: safeString(customer?.value, 100),
    customer_name: safeString(customer?.name, 200),
  };
}

function queryFor(type: QboRecordType, since: string | null, start: number) {
  const overlap = since ? new Date(new Date(since).getTime() - 5000).toISOString() : null;
  const updatedFilter = overlap ? ` WHERE MetaData.LastUpdatedTime > '${overlap}'` : "";
  return `select * from ${type}${updatedFilter} ORDERBY MetaData.LastUpdatedTime STARTPOSITION ${start} MAXRESULTS 1000`;
}

export type QboSyncSummary = {
  records_seen: number;
  records_created: number;
  records_updated: number;
  records_failed: number;
  next_cursor: string;
};

export async function syncQboRecordType(args: {
  integrationId: string;
  clientId: string;
  realmId: string;
  type: QboRecordType;
  since: string | null;
  upsert: (rows: Array<Record<string, unknown>>) => Promise<{ created: number; updated: number }>;
}): Promise<QboSyncSummary> {
  let start = 1;
  let recordsSeen = 0;
  let recordsCreated = 0;
  let recordsUpdated = 0;
  let newest = args.since ?? "1970-01-01T00:00:00.000Z";
  while (true) {
    const query = queryFor(args.type, args.since, start);
    const payload = await qboRequest<JsonObject>(args.integrationId, args.realmId, `query?query=${encodeURIComponent(query)}`);
    const queryResponse = payload.QueryResponse as JsonObject | undefined;
    const records = Array.isArray(queryResponse?.[args.type]) ? queryResponse[args.type] as JsonObject[] : [];
    if (records.length === 0) break;
    const rows = records.flatMap((record) => {
      const id = safeString(record.Id, 200);
      if (!id) return [];
      const fields = allowList(args.type, record) as JsonObject;
      const modifiedAt = safeString(fields.provider_modified_at);
      if (modifiedAt && modifiedAt > newest) newest = modifiedAt;
      const displayName = args.type === "Customer"
        ? safeString(fields.display_name) ?? safeString(fields.company_name)
        : safeString(fields.doc_number) ?? safeString(fields.customer_name);
      return [{
        integration_id: args.integrationId,
        client_id: args.clientId,
        provider: "quickbooks_online",
        external_record_type: args.type,
        external_record_id: id,
        display_name: displayName,
        document_number: safeString(fields.doc_number) ?? safeString(fields.payment_ref_num),
        transaction_date: dateOnly(fields.txn_date),
        due_date: dateOnly(fields.due_date),
        total_amount: amount(fields.total_amount),
        balance_amount: amount(fields.balance_amount),
        currency_code: safeString(fields.currency_code, 3),
        provider_modified_at: modifiedAt,
        record_data: fields,
        synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }];
    });
    recordsSeen += records.length;
    if (rows.length) {
      const counts = await args.upsert(rows);
      recordsCreated += counts.created;
      recordsUpdated += counts.updated;
    }
    if (records.length < 1000) break;
    start += records.length;
    if (start > 100_000) throw new QboSyncError("page_limit", "QuickBooks sync exceeded the safety page limit.");
  }
  return { records_seen: recordsSeen, records_created: recordsCreated, records_updated: recordsUpdated, records_failed: 0, next_cursor: newest };
}
