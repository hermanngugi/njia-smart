import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getFreshQboAccessToken } from "@/lib/integrations/qbo.server";

const db = supabaseAdmin as any;
const API = "https://sandbox-quickbooks.api.intuit.com/v3/company";

type Json = Record<string, any>;
type Connection = { id: string; client_id: string; external_account_id: string; metadata: Json; country_code: string | null };

export class QboInvoiceError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = "QboInvoiceError"; }
}

async function request<T>(connection: Connection, path: string, init: RequestInit = {}): Promise<T> {
  if (!/^\d{1,30}$/.test(connection.external_account_id)) throw new QboInvoiceError("invalid_realm", "Invalid QuickBooks company ID.");
  const send = (token: string) => fetch(`${API}/${encodeURIComponent(connection.external_account_id)}/${path}`, {
    ...init,
    headers: { Accept: "application/json", ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers, Authorization: `Bearer ${token}` },
    cache: "no-store",
    signal: AbortSignal.timeout(25000),
  });
  let response = await send(await getFreshQboAccessToken(connection.id));
  if (response.status === 401) response = await send(await getFreshQboAccessToken(connection.id, true));
  const raw = await response.text();
  let body: any = null;
  try { body = raw ? JSON.parse(raw) : null; } catch { /* handled below */ }
  if (!response.ok) throw new QboInvoiceError(`http_${response.status}`, `QuickBooks request failed (HTTP ${response.status}).`);
  if (!body || typeof body !== "object") throw new QboInvoiceError("invalid_response", "QuickBooks returned an invalid response.");
  return body as T;
}

function queryPath(sql: string) { return `query?query=${encodeURIComponent(sql)}`; }
function safeId(value: unknown) {
  const id = String(value ?? "");
  if (!/^\d{1,30}$/.test(id)) throw new QboInvoiceError("invalid_external_id", "Invalid QuickBooks record ID.");
  return id;
}
function asText(value: unknown, max = 250) { return typeof value === "string" ? value.slice(0, max) : null; }
function asNumber(value: unknown) { const n = Number(value); return Number.isFinite(n) ? n : 0; }

export async function listQboInvoiceSetup(connection: Connection, clientId: string, invoiceId?: string) {
  const [customers, items, mapping, invoiceMapping] = await Promise.all([
    request<Json>(connection, queryPath("select Id, DisplayName, CompanyName, PrimaryEmailAddr from Customer where Active = true MAXRESULTS 1000")),
    request<Json>(connection, queryPath("select Id, Name, Description, Type, Active from Item where Type = 'Service' and Active = true MAXRESULTS 1000")),
    db.from("integration_record_mappings").select("external_record_id,metadata")
      .eq("integration_id", connection.id).eq("client_id", clientId)
      .eq("local_record_type", "client").eq("local_record_id", clientId).maybeSingle(),
    invoiceId ? db.from("integration_record_mappings").select("external_record_id,metadata,last_synced_at")
      .eq("integration_id", connection.id).eq("client_id", clientId)
      .eq("local_record_type", "invoice").eq("local_record_id", invoiceId).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const customerRows = Array.isArray(customers.QueryResponse?.Customer) ? customers.QueryResponse.Customer : [];
  const itemRows = Array.isArray(items.QueryResponse?.Item) ? items.QueryResponse.Item : [];
  return {
    customers: customerRows.map((r: Json) => ({ id: String(r.Id), name: asText(r.DisplayName) ?? asText(r.CompanyName) ?? String(r.Id), email: asText(r.PrimaryEmailAddr?.Address) })),
    serviceItems: itemRows.map((r: Json) => ({ id: String(r.Id), name: asText(r.Name) ?? String(r.Id), description: asText(r.Description) })),
    customerId: mapping.data?.external_record_id ?? null,
    serviceItemId: asText(connection.metadata?.qbo_services_item_id, 100),
    invoiceLink: invoiceMapping.data ? { externalId: invoiceMapping.data.external_record_id, ...(invoiceMapping.data.metadata ?? {}), syncedAt: invoiceMapping.data.last_synced_at } : null,
  };
}

export async function saveQboInvoiceSetup(connection: Connection, clientId: string, customerId: string, serviceItemId: string) {
  const customer = safeId(customerId);
  const item = safeId(serviceItemId);
  const [customerResult, itemResult] = await Promise.all([
    request<Json>(connection, queryPath(`select Id, DisplayName from Customer where Id = '${customer}'`)),
    request<Json>(connection, queryPath(`select Id, Name, Type from Item where Id = '${item}'`)),
  ]);
  const qboCustomer = customerResult.QueryResponse?.Customer?.[0];
  const qboItem = itemResult.QueryResponse?.Item?.[0];
  if (!qboCustomer) throw new QboInvoiceError("customer_not_found", "The selected QuickBooks customer was not found.");
  if (!qboItem || qboItem.Type !== "Service") throw new QboInvoiceError("service_item_invalid", "Select an active QuickBooks Service item.");

  const { error: mapError } = await db.from("integration_record_mappings").upsert({
    integration_id: connection.id, client_id: clientId,
    local_record_type: "client", local_record_id: clientId,
    external_record_type: "Customer", external_record_id: customer,
    metadata: { display_name: asText(qboCustomer.DisplayName) },
    last_synced_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }, { onConflict: "integration_id,local_record_type,local_record_id" });
  if (mapError) throw new QboInvoiceError("customer_mapping_failed", "Could not save the QuickBooks customer match.");

  const metadata = { ...(connection.metadata ?? {}), qbo_services_item_id: item };
  const { error: configError } = await db.from("client_integrations")
    .update({ metadata, updated_at: new Date().toISOString() })
    .eq("id", connection.id).eq("client_id", clientId);
  if (configError) throw new QboInvoiceError("item_config_failed", "Could not save the shared Services item.");
  return { customerId: customer, customerName: asText(qboCustomer.DisplayName), serviceItemId: item, serviceItemName: asText(qboItem.Name) };
}

async function getInvoice(connection: Connection, clientId: string, invoiceId: string) {
  const { data, error } = await db.from("invoices")
    .select("id,invoice_number,client_id,issue_date,due_date,currency,subtotal,vat_rate,vat_amount,total,amount_paid,status,notes,memo,clients(id,company_name,kra_pin,email,phone),invoice_items(id,item_name,description,quantity,unit_price,amount,sort_order)")
    .eq("id", invoiceId).eq("client_id", clientId).maybeSingle();
  if (error || !data) throw new QboInvoiceError("invoice_not_found", "Njia Smart invoice was not found for this client.");
  if (data.status === "draft") throw new QboInvoiceError("invoice_not_final", "Finalise the invoice in Njia Smart before sending it to QuickBooks.");
  if (!Array.isArray(data.invoice_items) || data.invoice_items.length === 0) throw new QboInvoiceError("invoice_empty", "Add at least one invoice line before sending it to QuickBooks.");
  return data;
}

async function getExistingInvoiceMapping(connection: Connection, clientId: string, invoiceId: string) {
  const { data, error } = await db.from("integration_record_mappings")
    .select("id,external_record_id,metadata")
    .eq("integration_id", connection.id).eq("client_id", clientId)
    .eq("local_record_type", "invoice").eq("local_record_id", invoiceId).maybeSingle();
  if (error) throw new QboInvoiceError("mapping_read_failed", "Could not check the existing QuickBooks invoice link.");
  return data;
}

async function readQboInvoice(connection: Connection, externalId: string) {
  const id = safeId(externalId);
  const result = await request<Json>(connection, `invoice/${id}`);
  if (!result.Invoice) throw new QboInvoiceError("invoice_read_failed", "QuickBooks did not return the linked invoice.");
  return result.Invoice as Json;
}

function invoiceStatus(invoice: Json) {
  const total = asNumber(invoice.TotalAmt);
  const balance = Math.max(0, asNumber(invoice.Balance));
  const paid = Math.max(0, total - balance);
  if (invoice.TxnStatus === "Voided" || invoice.status === "Voided") return "voided";
  if (balance <= 0.005 && total > 0) return "paid";
  if (paid > 0.005) return "partial";
  const due = typeof invoice.DueDate === "string" ? invoice.DueDate : null;
  if (due && due < new Date().toISOString().slice(0, 10) && balance > 0) return "overdue";
  return "sent";
}

async function persistQboInvoiceSnapshot(connection: Connection, clientId: string, localInvoiceId: string, qboInvoice: Json) {
  const externalId = safeId(qboInvoice.Id);
  const syncedAt = new Date().toISOString();
  const status = invoiceStatus(qboInvoice);
  const total = asNumber(qboInvoice.TotalAmt);
  const balance = Math.max(0, asNumber(qboInvoice.Balance));
  const fields = {
    doc_number: asText(qboInvoice.DocNumber, 100),
    txn_date: asText(qboInvoice.TxnDate, 10),
    due_date: asText(qboInvoice.DueDate, 10),
    total_amount: total,
    balance_amount: balance,
    amount_paid: Math.max(0, total - balance),
    status,
    currency_code: asText(qboInvoice.CurrencyRef?.value, 3),
    customer_ref: asText(qboInvoice.CustomerRef?.value, 100),
    customer_name: asText(qboInvoice.CustomerRef?.name, 200),
    provider_modified_at: asText(qboInvoice.MetaData?.LastUpdatedTime, 80),
  };
  const { error: mapError } = await db.from("integration_record_mappings").upsert({
    integration_id: connection.id, client_id: clientId,
    local_record_type: "invoice", local_record_id: localInvoiceId,
    external_record_type: "Invoice", external_record_id: externalId,
    metadata: { document_number: fields.doc_number, status, total_amount: total, balance_amount: balance, amount_paid: fields.amount_paid, synced_at: syncedAt },
    last_synced_at: syncedAt, updated_at: syncedAt,
  }, { onConflict: "integration_id,local_record_type,local_record_id" });
  if (mapError) throw new QboInvoiceError("invoice_mapping_failed", "QuickBooks returned an invoice, but Njia Smart could not save its link. Retry safely; the same request ID is used.");
  const { error: mirrorError } = await db.from("integration_external_records").upsert({
    integration_id: connection.id, client_id: clientId, provider: "quickbooks_online",
    external_record_type: "Invoice", external_record_id: externalId,
    display_name: fields.doc_number, document_number: fields.doc_number,
    transaction_date: fields.txn_date, due_date: fields.due_date,
    total_amount: total, balance_amount: balance, currency_code: fields.currency_code,
    provider_modified_at: fields.provider_modified_at, record_data: fields,
    synced_at: syncedAt, updated_at: syncedAt,
  }, { onConflict: "integration_id,external_record_type,external_record_id" });
  if (mirrorError) throw new QboInvoiceError("invoice_mirror_failed", "The QuickBooks invoice was linked, but its latest status could not be mirrored.");
  await db.from("client_integrations").update({ last_synced_at: syncedAt, updated_at: syncedAt }).eq("id", connection.id);
  return { externalId, documentNumber: fields.doc_number, status, total, amountPaid: fields.amount_paid, balance, syncedAt };
}

export async function sendNjiaInvoiceToQbo(connection: Connection, clientId: string, invoiceId: string) {
  const invoice = await getInvoice(connection, clientId, invoiceId);
  const customerMapping = await db.from("integration_record_mappings").select("external_record_id")
    .eq("integration_id", connection.id).eq("client_id", clientId)
    .eq("local_record_type", "client").eq("local_record_id", clientId).maybeSingle();
  if (customerMapping.error || !customerMapping.data?.external_record_id) {
    throw new QboInvoiceError("customer_not_mapped", "Match this Njia Smart client to a QuickBooks Customer before sending invoices.");
  }
  const serviceItemId = safeId(connection.metadata?.qbo_services_item_id);
  const existing = await getExistingInvoiceMapping(connection, clientId, invoiceId);
  if (existing?.external_record_id) {
    const qboInvoice = await readQboInvoice(connection, existing.external_record_id);
    return persistQboInvoiceSnapshot(connection, clientId, invoiceId, qboInvoice);
  }

  const customerId = safeId(customerMapping.data.external_record_id);
  const customerResponse = await request<Json>(connection, `customer/${customerId}`);
  const customer = customerResponse.Customer;
  if (!customer) throw new QboInvoiceError("customer_not_found", "The mapped QuickBooks Customer no longer exists.");
  const preferencesResponse = await request<Json>(connection, "preferences");
  const preferences = preferencesResponse.Preferences ?? {};
  const homeCurrency = asText(preferences.CurrencyPrefs?.HomeCurrency?.value, 3);
  const multiCurrency = preferences.CurrencyPrefs?.MultiCurrencyEnabled === true;
  const customerCurrency = asText(customer.CurrencyRef?.value, 3) ?? homeCurrency;
  if (invoice.currency && customerCurrency && invoice.currency !== customerCurrency) {
    throw new QboInvoiceError("currency_mismatch", `This QuickBooks Customer uses ${customerCurrency}; the Njia Smart invoice is ${invoice.currency}. Match a customer configured for the same currency.`);
  }

  const lines = [...invoice.invoice_items].sort((a: Json, b: Json) => Number(a.sort_order) - Number(b.sort_order)).map((line: Json) => {
    const quantity = asNumber(line.quantity);
    const unitPrice = asNumber(line.unit_price);
    if (quantity <= 0 || unitPrice < 0) throw new QboInvoiceError("invalid_line", "An invoice line has an invalid quantity or rate.");
    return {
      Amount: Number((quantity * unitPrice).toFixed(2)),
      DetailType: "SalesItemLineDetail",
      Description: [asText(line.item_name, 150), asText(line.description, 500)].filter(Boolean).join(" — ").slice(0, 4000),
      SalesItemLineDetail: { ItemRef: { value: serviceItemId }, Qty: quantity, UnitPrice: unitPrice },
    };
  });
  const payload: Json = {
    CustomerRef: { value: customerId },
    TxnDate: invoice.issue_date,
    DueDate: invoice.due_date,
    Line: lines,
    PrivateNote: `Njia Smart invoice ${invoice.invoice_number} [${invoice.id}]`.slice(0, 4000),
    CustomerMemo: { value: `Njia Smart invoice ${invoice.invoice_number}` },
  };
  if (multiCurrency && invoice.currency) payload.CurrencyRef = { value: invoice.currency };
  const companyInfo = await request<Json>(connection, `companyinfo/${encodeURIComponent(connection.external_account_id)}`);
  const companyCountry = asText(companyInfo.CompanyInfo?.Country, 80)?.toUpperCase();
  if (companyCountry && companyCountry !== "US") payload.GlobalTaxCalculation = "TaxExcluded";
  const requestId = invoice.id.replace(/-/g, "").slice(0, 36);
  const result = await request<Json>(connection, `invoice?requestid=${requestId}`, {
    method: "POST", body: JSON.stringify(payload),
  });
  if (!result.Invoice?.Id) throw new QboInvoiceError("invoice_create_failed", "QuickBooks did not confirm invoice creation.");
  return persistQboInvoiceSnapshot(connection, clientId, invoiceId, result.Invoice);
}

export async function refreshNjiaInvoiceFromQbo(connection: Connection, clientId: string, invoiceId: string) {
  const existing = await getExistingInvoiceMapping(connection, clientId, invoiceId);
  if (!existing?.external_record_id) throw new QboInvoiceError("invoice_not_linked", "This Njia Smart invoice has not been sent to QuickBooks yet.");
  const qboInvoice = await readQboInvoice(connection, existing.external_record_id);
  return persistQboInvoiceSnapshot(connection, clientId, invoiceId, qboInvoice);
}
