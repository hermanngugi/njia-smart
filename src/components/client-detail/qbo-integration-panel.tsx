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
  last_connected_at: string | null;
  last_synced_at: string | null;
};

export function QboIntegrationPanel({ clientId }: { clientId: string }) {
  const { isAdmin, roles } = useAuth();
  const canAdminister = isAdmin || roles.includes("director");
  const canConnect = canAdminister || roles.includes("accountant");
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
      toast.error(error instanceof Error ? error.message : "Could not load QuickBooks connection.");
    } finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, [clientId]);

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
    if (!window.confirm("Disconnect this client's QuickBooks company? Stored OAuth credentials will be revoked and cleared.")) return;
    setBusy("disconnect");
    try {
      await disconnectQboConnection({ data: { client_id: clientId, integration_id: connection.id } });
      toast.success("QuickBooks disconnected.");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not disconnect QuickBooks.");
    } finally { setBusy(null); }
  }

  if (loading) return <div className="flex items-center gap-2 rounded-lg border bg-card p-5 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading QuickBooks connection…</div>;
  if (!allowed) return <div className="rounded-lg border bg-card p-5 text-sm text-muted-foreground"><AlertCircle className="mr-2 inline h-4 w-4" /> You do not have integration access to this client.</div>;

  const connected = connection?.status === "connected";
  const reconnectRequired = connection?.status === "reconnect_required";
  return (
    <section className="rounded-lg border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">QuickBooks Online</h3>
          <p className="mt-1 text-sm text-muted-foreground">Invoice transfer and read-only payment-status updates. Payments and bank reconciliation are managed in QuickBooks.</p>
        </div>
        <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${connected ? "bg-emerald-100 text-emerald-800" : reconnectRequired ? "bg-amber-100 text-amber-800" : "bg-muted text-muted-foreground"}`}>
          {connected ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}
          {connected ? "Connected" : reconnectRequired ? "Reconnect required" : connection?.status ?? "Not connected"}
        </span>
      </div>
      {connected && connection && <div className="mt-4 grid gap-3 rounded-md bg-muted/30 p-3 text-sm sm:grid-cols-2">
        <div><div className="text-xs text-muted-foreground">Connected company</div><div className="mt-0.5 font-medium">{connection.external_account_name || connection.external_account_id}</div></div>
        <div><div className="text-xs text-muted-foreground">QuickBooks Realm ID</div><div className="mt-0.5 break-all font-mono text-xs">{connection.external_account_id}</div></div>
        <div><div className="text-xs text-muted-foreground">Connected on</div><div className="mt-0.5">{connection.last_connected_at ? new Date(connection.last_connected_at).toLocaleString() : "—"}</div></div>
        <div><div className="text-xs text-muted-foreground">Last invoice/status sync</div><div className="mt-0.5">{connection.last_synced_at ? new Date(connection.last_synced_at).toLocaleString() : "Not synced yet"}</div></div>
      </div>}
      {reconnectRequired && <p className="mt-3 rounded-md bg-amber-50 p-3 text-sm text-amber-900">QuickBooks authorisation has expired. Reconnect the company to continue.</p>}
      <div className="mt-4 flex flex-wrap gap-2">
        {canConnect && !connected && <Button onClick={connect} disabled={busy !== null}>{busy === "connect" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ExternalLink className="mr-2 h-4 w-4" />}{reconnectRequired ? "Reconnect QuickBooks" : "Connect QuickBooks"}</Button>}
        {canAdminister && connected && <Button variant="outline" onClick={disconnect} disabled={busy !== null}>{busy === "disconnect" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Unplug className="mr-2 h-4 w-4" />}Disconnect</Button>}
        <Button type="button" variant="ghost" onClick={() => void load()} disabled={busy !== null}><RefreshCw className="mr-2 h-4 w-4" />Refresh status</Button>
      </div>
      {!canConnect && !connected && <p className="mt-3 text-xs text-muted-foreground">An Accountant, Director or Admin must connect this company's QuickBooks account.</p>}
    </section>
  );
}
