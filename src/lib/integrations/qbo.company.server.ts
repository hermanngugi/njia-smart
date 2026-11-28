// Company-wide, read-only QuickBooks mirror for the Accounts module.
// Nothing here ever writes to QuickBooks.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getFreshQboAccessToken, getQboConfig, qboApiBase } from "@/lib/integrations/qbo.server";
import { getModuleAccess } from "@/lib/permissions";
import type { AppRole } from "@/lib/auth";

const db = supabaseAdmin as any;
type Json = Record<string, any>;

export class QboCompanyError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = "QboCompanyError"; }
}

/** "manage" = connect/disconnect (directors and admins). "view" = see data and refresh it. */
export async function assertCompanyAccess(userId: string, level: "view" | "manage") {
  const { data, error } = await db.from("user_roles").select("role").eq("user_id", userId);
  if (error) throw new Error("Could not check your permissions.");
  const roles = (data ?? []).map((r: any) => r.role) as AppRole[];
  const isAdmin = roles.includes("director" as AppRole) || roles.includes("admin" as AppRole);
  if (isAdmin) return;
  if (level === "view" && getModuleAccess(roles, "accounts") === "full") return;
  throw new Error(level === "manage" ? "Only directors and admins can connect or disconnect QuickBooks." : "You are not authorised to view QuickBooks data.");
}

export async function getCompanyConnection() {
  const config = getQboConfig();
  const { data, error } = await db.from("client_integrations")
    .select("id,status,environment,external_account_id,external_account_name,country_code,last_connected_at,last_synced_at,refresh_token_expires_at,last_error_code")
    .is("client_id", null).eq("provider", "quickbooks_online").eq("environment", config.environment)
    .neq("status", "disconnected").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error("Could not load the QuickBooks connection.");
  return { environment: config.environment, connection: data ?? null };
}

async function request(connection: { id: string; external_account_id: string }, path: string): Promise<Json> {
  const config = getQboConfig();
  if (!/^\d{1,30}$/.test(connection.external_account_id)) throw new QboCompanyError("invalid_realm", "Invalid QuickBooks company ID.");
  const send = (token: string) => fetch(`${qboApiBase(config.environment)}/${encodeURIComponent(connection.external_account_id)}/${path}`, {
    headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
    cache: "no-store",
    signal: AbortSignal.timeout(25000),
  });
  let response = await send(await getFreshQboAccessToken(connection.id));
  if (response.status === 401) response = await send(await getFreshQboAccessToken(connection.id, true));
  if (!response.ok) throw new QboCompanyError(`http_${response.status}`, `QuickBooks request failed (HTTP ${response.status}).`);
  const body = await response.json().catch(() => null);
  if (!body || typeof body !== "object") throw new QboCompanyError("invalid_response", "QuickBooks returned an invalid response.");
  return body as Json;
}

async function queryAll(connection: { id: string; external_account_id: string }, entity: "Invoice" | "Payment"): Promise<Json[]> {
  const out: Json[] = [];
  const pageSize = 500;
  for (let page = 0; page < 40; page++) {
    const sql = `select * from ${entity} order by Id STARTPOSITION ${page * pageSize + 1} MAXRESULTS ${pageSize}`;
    const body = await request(connection, `query?query=${encodeURIComponent(sql)}&minorversion=75`);
    const rows = (body.QueryResponse?.[entity] ?? []) as Json[];
    out.push(...rows);
    if (rows.length < pageSize) return out;
  }
  throw new QboCompanyError("too_many_records", `More than ${40 * pageSize} ${entity} records; narrow the sync before continuing.`);
}

const text = (v: unknown, max = 250) => (typeof v === "string" && v ? v.slice(0, max) : null);
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const date = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
const stamp = (v: unknown) => { const t = typeof v === "string" ? Date.parse(v) : NaN; return Number.isFinite(t) ? new Date(t).toISOString() : null; };
const chunk = <T,>(items: T[], size: number) => { const o: T[][] = []; for (let i = 0; i < items.length; i += size) o.push(items.slice(i, i + size)); return o; };

export async function syncCompany(integrationId: string) {
  const { data: connection, error } = await db.from("client_integrations")
    .select("id,external_account_id,status").eq("id", integrationId).is("client_id", null).maybeSingle();
  if (error || !connection) throw new Error("QuickBooks connection was not found.");
  if (connection.status !== "connected") throw new Error("QuickBooks needs to be reconnected before it can be refreshed.");

  const startedAt = new Date().toISOString();
  const [invoices, payments, info] = await Promise.all([
    queryAll(connection, "Invoice"),
    queryAll(connection, "Payment"),
    request(connection, `companyinfo/${encodeURIComponent(connection.external_account_id)}?minorversion=75`).catch(() => null),
  ]);

  const invoiceRows = invoices.map((i) => ({
    integration_id: integrationId,
    qbo_id: String(i.Id),
    doc_number: text(i.DocNumber, 100),
    customer_id: text(i.CustomerRef?.value, 100),
    customer_name: text(i.CustomerRef?.name),
    txn_date: date(i.TxnDate),
    due_date: date(i.DueDate),
    total: num(i.TotalAmt),
    balance: num(i.Balance),
    currency: text(i.CurrencyRef?.value, 10),
    voided: num(i.TotalAmt) === 0 && /void/i.test(String(i.PrivateNote ?? "")),
    provider_modified_at: stamp(i.MetaData?.LastUpdatedTime),
    synced_at: startedAt,
  }));
  const paymentRows = payments.map((p) => ({
    integration_id: integrationId,
    qbo_id: String(p.Id),
    customer_id: text(p.CustomerRef?.value, 100),
    customer_name: text(p.CustomerRef?.name),
    txn_date: date(p.TxnDate),
    total: num(p.TotalAmt),
    unapplied: num(p.UnappliedAmt),
    currency: text(p.CurrencyRef?.value, 10),
    reference: text(p.PaymentRefNum, 100),
    linked_invoice_ids: Array.from(new Set(
      ((p.Line ?? []) as Json[]).flatMap((l) => ((l.LinkedTxn ?? []) as Json[]).filter((t) => t.TxnType === "Invoice").map((t) => String(t.TxnId))),
    )),
    provider_modified_at: stamp(p.MetaData?.LastUpdatedTime),
    synced_at: startedAt,
  }));

  for (const part of chunk(invoiceRows, 500)) {
    const { error: e } = await db.from("qbo_invoices").upsert(part, { onConflict: "integration_id,qbo_id" });
    if (e) throw new Error("Could not save the QuickBooks invoices.");
  }
  for (const part of chunk(paymentRows, 500)) {
    const { error: e } = await db.from("qbo_payments").upsert(part, { onConflict: "integration_id,qbo_id" });
    if (e) throw new Error("Could not save the QuickBooks payments.");
  }
  // Anything not seen this time was deleted in QuickBooks.
  await db.from("qbo_invoices").delete().eq("integration_id", integrationId).lt("synced_at", startedAt);
  await db.from("qbo_payments").delete().eq("integration_id", integrationId).lt("synced_at", startedAt);

  const company = info?.CompanyInfo as Json | undefined;
  await db.from("client_integrations").update({
    last_synced_at: new Date().toISOString(),
    ...(company?.CompanyName ? { external_account_name: text(company.CompanyName, 200) } : {}),
    ...(typeof company?.Country === "string" && /^[A-Z]{2}$/.test(company.Country) ? { country_code: company.Country } : {}),
  }).eq("id", integrationId);

  return { invoices: invoiceRows.length, payments: paymentRows.length };
}

async function fetchAll(build: (from: number, to: number) => PromiseLike<{ data: any[] | null; error: any }>) {
  const out: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw new Error("Could not load the data.");
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

const norm = (v?: string | null) => (v ?? "").trim().toLowerCase();
const same = (a: number, b: number) => Math.abs(a - b) < 0.01;

export type CompareState = "matched" | "amount_differs" | "paid_differs" | "not_in_njia";

/** Compares the QuickBooks mirror with Njia Smart's own invoices. Read-only. */
export async function companyOverview(integrationId: string) {
  const [qbo, pays, local] = await Promise.all([
    fetchAll((a, b) => db.from("qbo_invoices").select("*").eq("integration_id", integrationId).order("txn_date", { ascending: false }).range(a, b)),
    fetchAll((a, b) => db.from("qbo_payments").select("*").eq("integration_id", integrationId).order("txn_date", { ascending: false }).range(a, b)),
    fetchAll((a, b) => db.from("invoices").select("id,invoice_number,total,amount_paid,status,currency,client_id,clients(company_name)").order("created_at", { ascending: false }).range(a, b)),
  ]);

  const localByNumber = new Map<string, any>();
  for (const l of local) localByNumber.set(norm(l.invoice_number), l);
  const docById = new Map<string, string>(qbo.map((q) => [q.qbo_id, q.doc_number ?? q.qbo_id]));

  const seenLocal = new Set<string>();
  const invoices = qbo.map((q) => {
    const l = q.doc_number ? localByNumber.get(norm(q.doc_number)) : undefined;
    if (l) seenLocal.add(l.id);
    const qboPaid = Number(q.total) - Number(q.balance);
    let state: CompareState = "not_in_njia";
    if (l) state = !same(Number(l.total), Number(q.total)) ? "amount_differs" : !same(Number(l.amount_paid), qboPaid) ? "paid_differs" : "matched";
    return {
      qbo_id: q.qbo_id, doc_number: q.doc_number, customer: q.customer_name, txn_date: q.txn_date, due_date: q.due_date,
      total: Number(q.total), paid: qboPaid, balance: Number(q.balance), currency: q.currency, voided: q.voided,
      state, local_id: l?.id ?? null, local_total: l ? Number(l.total) : null, local_paid: l ? Number(l.amount_paid) : null, local_status: l?.status ?? null,
    };
  });

  const missing = local
    .filter((l) => l.status !== "draft" && !seenLocal.has(l.id))
    .map((l) => ({ local_id: l.id, invoice_number: l.invoice_number, client: l.clients?.company_name ?? null, total: Number(l.total), paid: Number(l.amount_paid), status: l.status }));

  const live = invoices.filter((i) => !i.voided);
  const summary = {
    invoiced: live.reduce((s, i) => s + i.total, 0),
    paid: live.reduce((s, i) => s + i.paid, 0),
    outstanding: live.reduce((s, i) => s + i.balance, 0),
    overdue: live.filter((i) => i.balance > 0 && i.due_date && i.due_date < new Date().toISOString().slice(0, 10)).reduce((s, i) => s + i.balance, 0),
    differences: invoices.filter((i) => i.state === "amount_differs" || i.state === "paid_differs").length,
    not_in_njia: invoices.filter((i) => i.state === "not_in_njia" && !i.voided).length,
    not_in_qbo: missing.length,
  };

  const payments = pays.slice(0, 300).map((p) => ({
    qbo_id: p.qbo_id, customer: p.customer_name, txn_date: p.txn_date, total: Number(p.total), unapplied: Number(p.unapplied),
    currency: p.currency, reference: p.reference, invoices: (p.linked_invoice_ids ?? []).map((id: string) => docById.get(id) ?? id),
  }));

  return { summary, invoices, missing, payments };
}
