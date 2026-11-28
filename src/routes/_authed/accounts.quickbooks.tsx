import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, Link2, RefreshCw, Unplug } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import {
  disconnectQboCompany, getQboCompany, refreshQboCompany, startQboCompanyAuthorization,
} from "@/lib/integrations/qbo.functions";

const RESULTS: Record<string, string> = {
  connected: "QuickBooks connected. Press Refresh to load your invoices and payments.",
  denied: "You declined the connection in QuickBooks. Nothing was connected.",
  invalid_response: "QuickBooks returned an incomplete response. Please try again.",
  permission_changed: "Your permissions changed during sign-in. Nothing was connected.",
  other_company_connected: "A different QuickBooks company is already connected. Disconnect it first.",
  error: "The connection could not be completed. Please try again.",
};

type Filter = "all" | "differences" | "not_in_njia" | "outstanding";
const FILTER_LABEL: Record<Filter, string> = { all: "All", differences: "Differences", not_in_njia: "Not in Njia Smart", outstanding: "Outstanding" };

const STATE_LABEL: Record<string, { text: string; tone: string }> = {
  matched: { text: "Matches", tone: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200" },
  amount_differs: { text: "Amount differs", tone: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200" },
  paid_differs: { text: "Paid differs", tone: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200" },
  not_in_njia: { text: "Not in Njia Smart", tone: "bg-muted text-muted-foreground" },
};

const money = (n: number, currency?: string | null) =>
  `${currency ?? "KES"} ${Number(n || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const Route = createFileRoute("/_authed/accounts/quickbooks")({
  validateSearch: (s: Record<string, unknown>) => ({ qbo: typeof s.qbo === "string" ? s.qbo : undefined }),
  component: QuickBooksPage,
});

function QuickBooksPage() {
  const { isAdmin } = useAuth();
  const search = Route.useSearch();
  const load = useServerFn(getQboCompany);
  const start = useServerFn(startQboCompanyAuthorization);
  const refresh = useServerFn(refreshQboCompany);
  const disconnect = useServerFn(disconnectQboCompany);

  const [state, setState] = useState<any>(null);
  const [busy, setBusy] = useState<"" | "connect" | "refresh" | "disconnect">("");
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");

  async function reload() {
    try { setState(await load()); } catch (e) { toast.error(e instanceof Error ? e.message : "Could not load QuickBooks."); }
  }
  useEffect(() => { void reload(); }, []);
  useEffect(() => { if (search.qbo && RESULTS[search.qbo]) (search.qbo === "connected" ? toast.success : toast.error)(RESULTS[search.qbo]); }, [search.qbo]);

  async function run(kind: "connect" | "refresh" | "disconnect", fn: () => Promise<void>) {
    setBusy(kind);
    try { await fn(); } catch (e) { toast.error(e instanceof Error ? e.message : "Something went wrong."); }
    setBusy("");
  }

  const connection = state?.connection;
  const overview = state?.overview;
  const needle = q.trim().toLowerCase();
  const invoices = useMemo(() => (overview?.invoices ?? []).filter((i: any) =>
    (filter === "all" ||
      (filter === "differences" && (i.state === "amount_differs" || i.state === "paid_differs")) ||
      (filter === "not_in_njia" && i.state === "not_in_njia") ||
      (filter === "outstanding" && i.balance > 0 && !i.voided)) &&
    (!needle || `${i.doc_number ?? ""} ${i.customer ?? ""}`.toLowerCase().includes(needle))), [overview, filter, needle]);

  if (!state) return <div className="text-sm text-muted-foreground">Loading…</div>;
  if (state.allowed === false) return <div className="text-sm text-muted-foreground">You do not have access to QuickBooks data.</div>;

  return (
    <div className="space-y-4">
      <Link to="/accounts" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1"><ArrowLeft className="h-3 w-3" /> Back to Accounts</Link>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">QuickBooks</h1>
          <p className="text-sm text-muted-foreground">Read-only view of your QuickBooks invoices, payments and balances, compared with Njia Smart. Nothing is ever changed in QuickBooks.</p>
        </div>
        {connection?.status === "connected" && (
          <div className="flex gap-2">
            <button disabled={busy !== ""} onClick={() => void run("refresh", async () => { const r = await refresh(); toast.success(`Loaded ${r.invoices} invoices and ${r.payments} payments`); await reload(); })}
              className="h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm inline-flex items-center gap-2 disabled:opacity-50">
              <RefreshCw className={`h-4 w-4 ${busy === "refresh" ? "animate-spin" : ""}`} /> {busy === "refresh" ? "Refreshing…" : "Refresh from QuickBooks"}
            </button>
            {isAdmin && (
              <button disabled={busy !== ""} onClick={() => { if (confirm("Disconnect QuickBooks? The copied QuickBooks data will be removed from Njia Smart.")) void run("disconnect", async () => { await disconnect({ data: { integration_id: connection.id } }); await reload(); }); }}
                className="h-9 px-3 rounded-md border text-sm inline-flex items-center gap-2 disabled:opacity-50"><Unplug className="h-4 w-4" /> Disconnect</button>
            )}
          </div>
        )}
      </div>

      {state.configured === false && (
        <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-900/20 p-4 text-sm">QuickBooks is not set up on this site yet. {state.message}</div>
      )}

      {state.configured && !connection && (
        <div className="rounded-lg border border-dashed bg-card p-8 text-center space-y-3">
          <Link2 className="h-8 w-8 mx-auto text-primary" />
          <h2 className="font-semibold text-lg">Connect your company's QuickBooks</h2>
          <p className="text-sm text-muted-foreground max-w-xl mx-auto">
            You sign in to QuickBooks once and approve read access. Njia Smart then copies invoices, payments and balances so you can check them against the invoices raised here.
            {state.environment === "sandbox" && " This site is connected to the QuickBooks sandbox (test) environment."}
          </p>
          {isAdmin ? (
            <button disabled={busy !== ""} onClick={() => void run("connect", async () => { const r = await start(); window.location.assign(r.authorization_url); })}
              className="h-10 px-5 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50">{busy === "connect" ? "Opening QuickBooks…" : "Connect QuickBooks"}</button>
          ) : <p className="text-xs text-muted-foreground">Ask a director or admin to connect it.</p>}
        </div>
      )}

      {connection && connection.status !== "connected" && (
        <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-900/20 p-4 text-sm flex flex-wrap items-center justify-between gap-2">
          <span>The QuickBooks connection needs to be renewed ({connection.last_error_code ?? "sign-in expired"}).</span>
          {isAdmin && <button disabled={busy !== ""} onClick={() => void run("connect", async () => { const r = await start(); window.location.assign(r.authorization_url); })} className="h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm">Reconnect</button>}
        </div>
      )}

      {connection?.status === "connected" && (
        <>
          <div className="text-xs text-muted-foreground">
            {connection.external_account_name ?? "QuickBooks company"} · {state.environment === "sandbox" ? "sandbox (test)" : "live"} ·{" "}
            {connection.last_synced_at ? `last refreshed ${formatDate(connection.last_synced_at)}` : "not refreshed yet — press Refresh"}
          </div>

          {overview && (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                {[
                  ["Invoiced", money(overview.summary.invoiced), ""],
                  ["Paid", money(overview.summary.paid), "text-emerald-600"],
                  ["Outstanding", money(overview.summary.outstanding), ""],
                  ["Overdue", money(overview.summary.overdue), overview.summary.overdue > 0 ? "text-red-600" : ""],
                ].map(([label, value, tone]) => (
                  <div key={label} className="rounded-lg border bg-card px-3 py-2">
                    <div className={`text-lg font-semibold ${tone}`}>{value}</div>
                    <div className="text-xs text-muted-foreground">{label} (in QuickBooks)</div>
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap gap-2 text-sm">
                <span className={`px-3 py-1 rounded-full border ${overview.summary.differences ? "border-red-300 text-red-700" : ""}`}>{overview.summary.differences} invoice{overview.summary.differences === 1 ? "" : "s"} differ from Njia Smart</span>
                <span className="px-3 py-1 rounded-full border">{overview.summary.not_in_njia} only in QuickBooks</span>
                <span className="px-3 py-1 rounded-full border">{overview.summary.not_in_qbo} sent in Njia Smart but not in QuickBooks</span>
              </div>

              <div className="flex flex-wrap gap-2 items-center">
                {(Object.keys(FILTER_LABEL) as Filter[]).map((f) => (
                  <button key={f} onClick={() => setFilter(f)} className={`px-3 h-8 rounded-full border text-xs ${filter === f ? "bg-primary text-primary-foreground border-primary" : "hover:bg-muted"}`}>{FILTER_LABEL[f]}</button>
                ))}
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find invoice or customer…" className="h-8 w-56 px-3 rounded-md border bg-background text-sm ml-auto" />
              </div>

              <div className="bg-card border rounded-lg overflow-auto max-h-[60vh]">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-muted-foreground bg-muted sticky top-0">
                    <tr><th className="p-2">Invoice</th><th className="p-2">Customer</th><th className="p-2">Date</th><th className="p-2 text-right">Total</th><th className="p-2 text-right">Paid</th><th className="p-2 text-right">Balance</th><th className="p-2">Check</th></tr>
                  </thead>
                  <tbody>
                    {invoices.length === 0 && <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">{overview.invoices.length === 0 ? "No invoices in QuickBooks yet." : "Nothing matches."}</td></tr>}
                    {invoices.slice(0, 400).map((i: any) => (
                      <tr key={i.qbo_id} className="border-t">
                        <td className="p-2 font-medium">{i.local_id ? <Link to="/accounts/$id" params={{ id: i.local_id }} className="text-primary">{i.doc_number ?? i.qbo_id}</Link> : (i.doc_number ?? i.qbo_id)}{i.voided && <span className="ml-1 text-xs text-muted-foreground">(void)</span>}</td>
                        <td className="p-2">{i.customer}</td>
                        <td className="p-2 whitespace-nowrap">{formatDate(i.txn_date)}</td>
                        <td className="p-2 text-right whitespace-nowrap">{money(i.total, i.currency)}{i.state === "amount_differs" && <div className="text-xs text-red-600">Njia Smart: {money(i.local_total ?? 0, i.currency)}</div>}</td>
                        <td className="p-2 text-right whitespace-nowrap">{money(i.paid, i.currency)}{i.state === "paid_differs" && <div className="text-xs text-amber-700">Njia Smart: {money(i.local_paid ?? 0, i.currency)}</div>}</td>
                        <td className="p-2 text-right whitespace-nowrap">{money(i.balance, i.currency)}</td>
                        <td className="p-2"><span className={`text-xs px-2 py-0.5 rounded-full whitespace-nowrap ${STATE_LABEL[i.state].tone}`}>{STATE_LABEL[i.state].text}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {overview.missing.length > 0 && (
                <div className="bg-card border rounded-lg p-3">
                  <h2 className="text-sm font-semibold mb-2">Raised in Njia Smart but not found in QuickBooks ({overview.missing.length})</h2>
                  <p className="text-xs text-muted-foreground mb-2">Matched on invoice number. Enter these in QuickBooks (or correct the number) so the books agree.</p>
                  <div className="divide-y text-sm">
                    {overview.missing.slice(0, 100).map((m: any) => (
                      <div key={m.local_id} className="flex justify-between gap-2 py-1.5">
                        <Link to="/accounts/$id" params={{ id: m.local_id }} className="text-primary font-medium">{m.invoice_number}</Link>
                        <span className="text-muted-foreground flex-1">{m.client}</span>
                        <span>{money(m.total)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="bg-card border rounded-lg p-3">
                <h2 className="text-sm font-semibold mb-2">Recent payments in QuickBooks</h2>
                {overview.payments.length === 0 ? <p className="text-sm text-muted-foreground">No payments yet.</p> : (
                  <div className="divide-y text-sm max-h-72 overflow-auto">
                    {overview.payments.slice(0, 100).map((p: any) => (
                      <div key={p.qbo_id} className="flex flex-wrap justify-between gap-2 py-1.5">
                        <span className="w-24 text-muted-foreground">{formatDate(p.txn_date)}</span>
                        <span className="flex-1 min-w-[140px]">{p.customer}{p.reference ? ` · ${p.reference}` : ""}</span>
                        <span className="text-muted-foreground">{p.invoices.length ? `for ${p.invoices.join(", ")}` : "unapplied"}</span>
                        <span className="font-medium">{money(p.total, p.currency)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
