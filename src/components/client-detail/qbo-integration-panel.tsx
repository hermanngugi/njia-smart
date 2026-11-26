import { useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, ExternalLink, Loader2, RefreshCw, Unplug } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import {
  disconnectQboConnection,
  getQboConnectionStatus,
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
  const [connection, setConnection] = useState<QboConnection | null>(null);
  const [allowed, setAllowed] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"connect" | "disconnect" | null>(null);

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

        {!canConnect && !connected && (
          <p className="mt-3 text-xs text-muted-foreground">
            An Accountant, Director or Admin must connect this company's QuickBooks account.
          </p>
        )}
      </div>
    </div>
  );
}
