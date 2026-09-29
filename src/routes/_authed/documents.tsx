import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Upload, Download, Trash2, FileText, Eye, X } from "lucide-react";
import { formatDate, formatDateTime } from "@/lib/format";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/_authed/documents")({ component: DocsPage });

function DocsPage() {
  const { isAdmin } = useAuth();
  const [rows, setRows] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [clientId, setClientId] = useState("");
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState("");
  const [preview, setPreview] = useState<{ url: string; title: string } | null>(null);

  async function load() {
    const [d, c] = await Promise.all([
      supabase.from("documents").select("*, clients(company_name)").order("created_at", { ascending: false }),
      supabase.from("clients").select("id, company_name").order("company_name"),
    ]);
    setRows(d.data ?? []); setClients(c.data ?? []);
  }
  useEffect(()=>{ load(); }, []);

  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!clientId) { toast.error("Pick a client first"); return; }
    setBusy(true);
    const { data: { user } } = await supabase.auth.getUser();
    const path = `${clientId}/${Date.now()}-${file.name}`;
    const up = await supabase.storage.from("client-documents").upload(path, file);
    if (up.error) { toast.error(up.error.message); setBusy(false); return; }
    const { error } = await supabase.from("documents").insert({
      client_id: clientId, title: title || file.name, file_path: path, uploaded_by: user?.id,
    });
    setBusy(false); e.target.value="";
    if (error) toast.error(error.message);
    else { toast.success("Uploaded"); setTitle(""); load(); }
  }

  async function download(path: string) {
    const { data, error } = await supabase.storage.from("client-documents").createSignedUrl(path, 60);
    if (error) toast.error(error.message);
    else window.open(data.signedUrl, "_blank");
  }
  async function view(path: string, title: string) {
    const { data, error } = await supabase.storage.from("client-documents").createSignedUrl(path, 600);
    if (error) toast.error(error.message);
    else setPreview({ url: data.signedUrl, title });
  }

  async function remove(id: string, path: string) {
    if (!confirm("Delete this document?")) return;
    await supabase.storage.from("client-documents").remove([path]);
    const { error } = await supabase.from("documents").delete().eq("id", id);
    if (error) toast.error(error.message); else { toast.success("Deleted"); load(); }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Documents</h1>
        <p className="text-sm text-muted-foreground">Centralized, secure document storage per client.</p>
      </div>
      <div className="bg-card border rounded-lg p-4 grid sm:grid-cols-3 gap-2">
        <select value={clientId} onChange={e=>setClientId(e.target.value)} className="h-9 px-3 rounded-md border bg-background text-sm"><option value="">Select client…</option>{clients.map(c=><option key={c.id} value={c.id}>{c.company_name}</option>)}</select>
        <input placeholder="Title (optional)" value={title} onChange={e=>setTitle(e.target.value)} className="h-9 px-3 rounded-md border bg-background text-sm" />
        <label className={`h-9 inline-flex items-center justify-center gap-2 rounded-md bg-primary text-primary-foreground text-sm cursor-pointer ${busy?"opacity-60":""}`}>
          <Upload className="h-4 w-4" /> {busy ? "Uploading…" : "Upload"}
          <input type="file" hidden onChange={upload} disabled={busy || !clientId} />
        </label>
      </div>
      <div className="bg-card border rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs text-muted-foreground border-b">
              <tr><th className="py-2 px-3">Title</th><th>Client</th><th>Version</th><th>Uploaded</th><th></th></tr>
            </thead>
            <tbody>
              {rows.length===0 && <tr><td colSpan={5} className="py-10 text-center text-muted-foreground">No documents yet.</td></tr>}
              {rows.map(r=>(
                <tr key={r.id} className="border-b last:border-0 hover:bg-muted/30">
                  <td className="py-2 px-3 inline-flex items-center gap-2"><FileText className="h-4 w-4 text-muted-foreground" />{r.title}</td>
                  <td>{r.clients?.company_name}</td>
                  <td>v{r.version}</td>
                  <td className="text-xs text-muted-foreground">
                    {formatDate(r.created_at)}
                    {r.updated_at && new Date(r.updated_at).getTime() - new Date(r.created_at).getTime() > 60000 && (
                      <div className="text-[10px]">Edited {formatDateTime(r.updated_at)}</div>
                    )}
                  </td>
                  <td className="text-right pr-3 space-x-2 whitespace-nowrap">
                    <button onClick={()=>view(r.file_path, r.title)} className="text-primary text-xs inline-flex items-center gap-1"><Eye className="h-3 w-3" />View</button>
                    <button onClick={()=>download(r.file_path)} className="text-primary text-xs inline-flex items-center gap-1"><Download className="h-3 w-3" />Download</button>
                    {isAdmin && <button onClick={()=>remove(r.id, r.file_path)} className="text-destructive text-xs inline-flex items-center gap-1"><Trash2 className="h-3 w-3" /></button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {preview && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={()=>setPreview(null)}>
          <div onClick={e=>e.stopPropagation()} className="bg-card w-full max-w-5xl h-[90vh] rounded-lg flex flex-col overflow-hidden">
            <div className="flex justify-between items-center p-3 border-b">
              <div className="font-semibold text-sm truncate">{preview.title}</div>
              <div className="flex items-center gap-2">
                <a href={preview.url} target="_blank" rel="noreferrer" className="text-xs text-primary inline-flex items-center gap-1"><Download className="h-3 w-3" />Open in new tab</a>
                <button onClick={()=>setPreview(null)}><X className="h-4 w-4" /></button>
              </div>
            </div>
            <iframe src={preview.url} className="flex-1 w-full" title={preview.title} />
          </div>
        </div>
      )}
    </div>
  );
}
