import { useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, CreditCard, ExternalLink, Loader2, RefreshCw, Unplug } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import {
  captureQboSandboxCharge,
  createQboSandboxCharge,
  disconnectQboConnection,
  getQboCompanyInfo,
  getQboConnectionStatus,
  getQboOpenIdUserInfo,
  startQboAuthorization,
} from "@/lib/integrations/qbo.functions";

type QboConnection = {
  id: string;
  status: string;
  external_account_id: string | null;
  external_account_name: string | null;
  country_code: string | null;
  last_connected_at: string | null;
  last_synced_at: string | null;
  access_token_expires_at: string | null;
  refresh_token_expires_at: string | null;
  last_error_code: string | null;
};

export function QboIntegrationPanel({ clientId }: { clientId: string }) {
  const { isAdmin, roles } = useAuth();
  const canConnect = isAdmin || roles.includes("accountant");
  const canCreateSandboxCharge = isAdmin || roles.includes("director");
  const [connection, setConnection] = useState<QboConnection | null>(null);
  const [allowed, setAllowed] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"connect" | "disconnect" | null>(null);
  const [apiBusy, setApiBusy] = useState<"company" | "userinfo" | "charge" | "capture" | null>(null);
  const [apiOutput, setApiOutput] = useState<{ label: string; data: unknown } | null>(null);
  const [cardToken, setCardToken] = useState("");
  const [chargeAmount, setChargeAmount] = useState("1.00");
  const [captureImmediately, setCaptureImmediately] = useState(false);
  const [pendingCharge, setPendingCharge] = useState<{ id: string; amount: string } | null>(null);

  async function load() {
    setLoading(true);
    try {
      const result = await getQboConnectionStatus({ data: { client_id: clientId } });
      setAllowed(result.allowed);
      setConnection(result.connection as QboConnection | null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load integrations.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [clientId]);

  async function connect() {
    setBusy("connect");
    try {
      const result = await startQboAuthorization({ data: { client_id: clientId } });
      window.location.assign(result.authorization_url);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not start QuickBooks authorisation.");
      setBusy(null);
    }
  }

  async function disconnect() {
    if (!connection) return;
    if (!window.confirm("Disconnect this client's QuickBooks company? Njia Smart will revoke the OAuth tokens and remove its stored credentials.")) return;

    setBusy("disconnect");
    try {
      await disconnectQboConnection({
        data: { client_id: clientId, integration_id: connection.id },
      });
      toast.success("QuickBooks disconnected.");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not disconnect QuickBooks.");
    } finally {
      setBusy(null);
    }
  }

  async function testCompanyInfo() {
    if (!connection) return;
    setApiBusy("company");
    try {
      const result = await getQboCompanyInfo({
        data: { client_id: clientId, integration_id: connection.id },
      });
      setApiOutput({ label: "QuickBooks CompanyInfo response", data: result });
      toast.success("Company info request succeeded.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Company info request failed.");
    } finally {
      setApiBusy(null);
    }
  }

  async function testOpenIdUserInfo() {
    if (!connection) return;
    setApiBusy("userinfo");
    try {
      const result = await getQboOpenIdUserInfo({
        data: { client_id: clientId, integration_id: connection.id },
      });
      setApiOutput({ label: "OpenID userinfo response", data: result });
      toast.success("OpenID user info request succeeded.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "OpenID user info request failed.");
    } finally {
      setApiBusy(null);
    }
  }

  async function submitSandboxCharge() {
    if (!connection) return;
    const token = cardToken.trim();
    if (!token) {
      toast.error("Enter the one-time Intuit payment token first.");
      return;
    }
    const action = captureImmediately
      ? "Create and capture this sandbox payment charge?"
      : "Create this sandbox payment authorization? It will not be captured yet.";
    if (!window.confirm(action)) return;

    setApiBusy("charge");
    try {
      const result = await createQboSandboxCharge({
        data: {
          client_id: clientId,
          integration_id: connection.id,
          amount: chargeAmount,
          card_token: token,
          capture: captureImmediately,
        },
      });
      setApiOutput({ label: "QuickBooks Payments charge response", data: result });
      setPendingCharge(
        result.status.toUpperCase() === "AUTHORIZED"
          ? { id: result.id, amount: result.amount }
          : null,
      );
      setCardToken("");
      toast.success(
        result.status.toUpperCase() === "AUTHORIZED"
          ? "Sandbox payment authorised. Capture it below when ready."
          : `Sandbox payment returned status: ${result.status}`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Sandbox charge request failed.");
    } finally {
      setApiBusy(null);
    }
  }

  async function capturePendingSandboxCharge() {
    if (!connection || !pendingCharge) return;
    if (!window.confirm("Capture this previously authorised sandbox payment?")) return;

    setApiBusy("capture");
    try {
      const result = await captureQboSandboxCharge({
        data: {
          client_id: clientId,
          integration_id: connection.id,
          charge_id: pendingCharge.id,
          amount: pendingCharge.amount,
        },
      });
      setApiOutput({ label: "QuickBooks Payments capture response", data: result });
      setPendingCharge(null);
      toast.success(`Sandbox capture returned status: ${result.status}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Sandbox capture request failed.");
    } finally {
      setApiBusy(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-lg border bg-card p-5 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading accounting integrations…
      </div>
    );
  }

  if (!allowed) {
    return (
      <div className="rounded-lg border bg-card p-5">
        <div className="flex items-start gap-2 text-sm text-muted-foreground">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          You do not have integration access to this client. Access is limited by staff role and client assignment.
        </div>
      </div>
    );
  }

  const connected = connection?.status === "connected";
  const reconnectRequired = connection?.status === "reconnect_required";
  const label = connection?.external_account_name || connection?.external_account_id || "QuickBooks company";
  const statusClasses = [
    "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium",
    connected
      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200"
      : reconnectRequired
        ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200"
        : "bg-muted text-muted-foreground",
  ].join(" ");

  return (
    <div className="space-y-3">
      <div className="rounded-lg border bg-card p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
              <span className="text-sm font-bold">qb</span>
            </div>
            <div className="min-w-0">
              <h3 className="font-semibold">QuickBooks Online</h3>
              <p className="text-sm text-muted-foreground">Accounting connection · Development sandbox</p>
            </div>
          </div>
          <span className={statusClasses}>
            {connected ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}
            {connected ? "Connected" : reconnectRequired ? "Reconnect required" : connection?.status ?? "Not connected"}
          </span>
        </div>

        {connected && connection && (
          <div className="mt-4 grid gap-3 rounded-md bg-muted/30 p-3 text-sm sm:grid-cols-2">
            <div>
              <p className="text-xs text-muted-foreground">Connected company</p>
              <p className="mt-0.5 break-all font-medium">{label}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">QuickBooks Realm ID</p>
              <p className="mt-0.5 break-all font-mono text-xs">{connection.external_account_id}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Connected on</p>
              <p className="mt-0.5">{connection.last_connected_at ? new Date(connection.last_connected_at).toLocaleString() : "—"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Last data sync</p>
              <p className="mt-0.5">{connection.last_synced_at ? new Date(connection.last_synced_at).toLocaleString() : "Not synchronised yet"}</p>
            </div>
          </div>
        )}

        {reconnectRequired && (
          <p className="mt-3 rounded-md bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
            The stored authorisation is no longer valid. Reconnect this company to continue.
          </p>
        )}

        {connected && (
          <p className="mt-3 text-xs text-muted-foreground">
            OAuth is connected. Accounting data retrieval has not been enabled yet; the first synchronisation phase will be read-only.
          </p>
        )}

        {!connected && !reconnectRequired && !connection && (
          <p className="mt-3 text-sm text-muted-foreground">
            Connect the client's QuickBooks Online company to prepare for read-only accounting synchronisation.
          </p>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          {canConnect && !connected && (
            <Button onClick={connect} disabled={busy !== null}>
              {busy === "connect" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ExternalLink className="mr-2 h-4 w-4" />}
              {reconnectRequired ? "Reconnect QuickBooks" : "Connect QuickBooks"}
            </Button>
          )}
          {canConnect && connection && !connected && !reconnectRequired && connection.status !== "pending" && (
            <Button variant="outline" onClick={connect} disabled={busy !== null}>
              <RefreshCw className="mr-2 h-4 w-4" /> Try again
            </Button>
          )}
          {isAdmin && connected && (
            <Button variant="outline" onClick={disconnect} disabled={busy !== null}>
              {busy === "disconnect" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Unplug className="mr-2 h-4 w-4" />}
              Disconnect
            </Button>
          )}
          <Button type="button" variant="ghost" onClick={() => void load()} disabled={busy !== null}>
            <RefreshCw className="mr-2 h-4 w-4" /> Refresh status
          </Button>
        </div>

        {connected && connection && (
          <div className="rounded-lg border bg-card p-4 sm:p-5 space-y-4">
            <div>
              <h3 className="font-semibold">Sandbox API examples</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                These buttons run authenticated requests against the connected Intuit development company. Results are not stored in Njia Smart.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={testCompanyInfo} disabled={apiBusy !== null}>
                {apiBusy === "company" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Get company info
              </Button>
              <Button type="button" variant="outline" onClick={testOpenIdUserInfo} disabled={apiBusy !== null}>
                {apiBusy === "userinfo" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Get OpenID user info
              </Button>
            </div>

            <div className="border-t pt-4 space-y-3">
              <div>
                <h4 className="font-medium">Payments sandbox charge</h4>
                <p className="mt-1 text-xs text-muted-foreground">
                  Supply a one-time token from Intuit's client-side payment tokenisation flow. Do not enter or send raw card details to Njia Smart. Intuit tokens are single-use and short-lived.
                </p>
              </div>

              {canCreateSandboxCharge ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="space-y-1 text-sm sm:col-span-2">
                    <span className="font-medium">Intuit payment token</span>
                    <input
                      type="password"
                      autoComplete="off"
                      value={cardToken}
                      onChange={(event) => setCardToken(event.target.value)}
                      placeholder="Paste the one-time token returned by Intuit"
                      className="w-full rounded-md border bg-background px-3 py-2 font-mono text-xs"
                    />
                  </label>
                  <label className="space-y-1 text-sm">
                    <span className="font-medium">Amount (USD)</span>
                    <input
                      inputMode="decimal"
                      value={chargeAmount}
                      onChange={(event) => setChargeAmount(event.target.value)}
                      placeholder="1.00"
                      className="w-full rounded-md border bg-background px-3 py-2"
                    />
                  </label>
                  <label className="flex items-center gap-2 self-end pb-2 text-sm">
                    <input
                      type="checkbox"
                      checked={captureImmediately}
                      onChange={(event) => setCaptureImmediately(event.target.checked)}
                      className="h-4 w-4"
                    />
                    Capture immediately
                  </label>
                  <div className="sm:col-span-2 flex flex-wrap items-center gap-2">
                    <Button type="button" onClick={submitSandboxCharge} disabled={apiBusy !== null || !cardToken.trim()}>
                      {apiBusy === "charge" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CreditCard className="mr-2 h-4 w-4" />}
                      Create sandbox charge
                    </Button>
                    {pendingCharge && (
                      <Button type="button" variant="outline" onClick={capturePendingSandboxCharge} disabled={apiBusy !== null}>
                        {apiBusy === "capture" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                        Capture authorised charge
                      </Button>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground sm:col-span-2">
                    Without immediate capture, Intuit creates an authorisation first. Use the Capture button to complete the sandbox transaction.
                  </p>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Only a Director or Admin may submit or capture sandbox payment charges.
                </p>
              )}
            </div>

            {apiOutput && (
              <div className="border-t pt-4">
                <div className="mb-2 text-sm font-medium">{apiOutput.label}</div>
                <pre className="max-h-96 overflow-auto rounded-md bg-muted p-3 text-xs leading-relaxed">
                  {JSON.stringify(apiOutput.data, null, 2)}
                </pre>
              </div>
            )}
          </div>
        )}

        {!canConnect && !connected && (
          <p className="mt-3 text-xs text-muted-foreground">
            An Accountant, Director or Admin must connect this company's QuickBooks account.
          </p>
        )}
      </div>
    </div>
  );
}
