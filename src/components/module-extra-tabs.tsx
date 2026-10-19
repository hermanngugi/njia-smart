import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Eye, Download, FileText, X } from "lucide-react";
import { formatDate, STATUS_COLORS } from "@/lib/format";
import { ClientAssignments } from "@/components/client-assignments";

/** Rollup row used by ClientsRollupTab — each domain computes its own counts. */
export type ClientRollupRow = { id: string; company_name: string; count: number; open: number };

export function ClientsRollupTab({ rows, noun = "engagements" }: { rows: ClientRollupRow[]; noun?: string }) {
  return (
    <div className="bg-card border rounded-lg overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground border-b bg-muted/40">
            <tr><th className="py-2 px-3">Client</th><th>Total {noun}</th><th>Open</th><th>Team</th></tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={4} className="py-10 text-center text-muted-foreground">No clients yet.</td></tr>}
            {rows.map(c => (
              <tr key={c.id} className="border-b last:border-0 hover:bg-muted/30">
                <td className="py-2 px-3 font-medium">{c.company_name}</td>
                <td>{c.count}</td>
                <td>{c.open}</td>
                <td className="py-2 px-3"><ClientAssignments clientId={c.id} compact /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Invoices tagged with a given Service Line (set on the invoice in Accounts). */
export function BillingTab({ serviceLine }: { serviceLine: string }) {
  const [invoices, setInvoices] = useState<any[]>([]);
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.from("invoices").select("*, clients(company_name)").eq("service_line", serviceLine).order("updated_at", { ascending: false }).order("issue_date", { ascending: false });
      if (error) toast.error(error.message); else setInvoices(data ?? []);
    })();
  }, [serviceLine]);

  return (
    <div className="bg-card border rounded-lg overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground border-b bg-muted/40">
            <tr><th className="py-2 px-3">Client</th><th>Invoice</th><th>Issued</th><th>Due</th><th>Total</th><th>Paid</th><th>Status</th></tr>
          </thead>
          <tbody>
            {invoices.length === 0 && <tr><td colSpan={7} className="py-10 text-center text-muted-foreground">No invoices tagged “{serviceLine}” yet. Set the Service Line to “{serviceLine}” when creating an invoice in Accounts.</td></tr>}
            {invoices.map(inv => (
              <tr key={inv.id} className="border-b last:border-0 hover:bg-muted/30">
                <td className="py-2 px-3 font-medium">{inv.clients?.company_name}</td>
                <td>{inv.invoice_number}</td>
                <td>{formatDate(inv.issue_date)}</td>
                <td>{formatDate(inv.due_date)}</td>
                <td>{Number(inv.total ?? 0).toLocaleString()}</td>
                <td>{Number(inv.amount_paid ?? 0).toLocaleString()}</td>
                <td><span className={`text-xs px-2 py-1 rounded-full capitalize ${STATUS_COLORS[inv.status] || "bg-muted"}`}>{inv.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Client-level documents (from the Documents module) for a given set of client ids. */
export function DocumentsTab({ clientIds }: { clientIds: string[] }) {
  const [docs, setDocs] = useState<any[]>([]);
  const [preview, setPreview] = useState<{ url: string; title: string } | null>(null);

  useEffect(() => {
    (async () => {
      if (clientIds.length === 0) { setDocs([]); return; }
      const { data, error } = await supabase.from("documents").select("*, clients(company_name)").in("client_id", clientIds).order("created_at", { ascending: false });
      if (error) toast.error(error.message); else setDocs(data ?? []);
    })();
  }, [clientIds.join(",")]);

  async function view(path: string, title: string) {
    const { data, error } = await supabase.storage.from("client-documents").createSignedUrl(path, 600);
    if (error) toast.error(error.message); else setPreview({ url: data.signedUrl, title });
  }
  async function download(path: string) {
    const { data, error } = await supabase.storage.from("client-documents").createSignedUrl(path, 60);
    if (error) toast.error(error.message); else window.open(data.signedUrl, "_blank");
  }

  return (
    <>
      <div className="bg-card border rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground border-b bg-muted/40">
              <tr><th className="py-2 px-3">Title</th><th>Client</th><th>Uploaded</th><th></th></tr>
            </thead>
            <tbody>
              {docs.length === 0 && <tr><td colSpan={4} className="py-10 text-center text-muted-foreground">No client documents yet.</td></tr>}
              {docs.map(d => (
                <tr key={d.id} className="border-b last:border-0 hover:bg-muted/30">
                  <td className="py-2 px-3 inline-flex items-center gap-2"><FileText className="h-4 w-4 text-muted-foreground" />{d.title}</td>
                  <td>{d.clients?.company_name}</td>
                  <td className="text-xs text-muted-foreground">{formatDate(d.created_at)}</td>
                  <td className="text-right pr-3 space-x-2 whitespace-nowrap">
                    <button onClick={() => view(d.file_path, d.title)} className="text-primary text-xs inline-flex items-center gap-1"><Eye className="h-3 w-3" />View</button>
                    <button onClick={() => download(d.file_path)} className="text-primary text-xs inline-flex items-center gap-1"><Download className="h-3 w-3" />Download</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {preview && (
        <div className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center p-4" onClick={() => setPreview(null)}>
          <div onClick={e => e.stopPropagation()} className="bg-card w-full max-w-5xl h-[90vh] rounded-lg flex flex-col overflow-hidden">
            <div className="flex justify-between items-center p-3 border-b">
              <div className="font-semibold text-sm truncate">{preview.title}</div>
              <button onClick={() => setPreview(null)}><X className="h-4 w-4" /></button>
            </div>
            <iframe src={preview.url} className="flex-1 w-full" title={preview.title} />
          </div>
        </div>
      )}
    </>
  );
}

/** Simple top tab bar shared by Audit/Advisory pages. */
export function ModuleTabBar<T extends string>({
  tabs, active, onChange,
}: { tabs: { key: T; label: string; count?: number }[]; active: T; onChange: (t: T) => void }) {
  return (
    <div className="flex gap-1 border-b overflow-x-auto">
      {tabs.map(t => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm border-b-2 -mb-px whitespace-nowrap ${active === t.key ? "border-primary text-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground"}`}
        >
          {t.label}{t.count !== undefined && <span className="ml-1 text-xs">({t.count})</span>}
        </button>
      ))}
    </div>
  );
}
