import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Upload, Download, Trash2, FileText, X, Search } from "lucide-react";
import { formatDate } from "@/lib/format";
import { useLiveRefresh } from "@/hooks/use-live-refresh";
import { isOnline } from "@/lib/offline/status";

export const Route = createFileRoute("/_authed/documents")({ component: DocsPage });

type LibraryDocument = {
  id: string;
  title: string;
  clientId: string | null;
  clientName: string;
  category: string;
  bucket: string;
  filePath: string;
  createdAt: string;
  confidentiality: string;
  canDelete: boolean;
};

const DOCUMENT_TYPES = [
  ["general_supporting", "General document"],
  ["internal_circular", "Internal circular / memo"],
  ["identity", "ID / Passport"],
  ["company_search", "CR12 / Company search"],
  ["kra_pin", "KRA PIN certificate"],
  ["incorporation", "Registration / Incorporation"],
  ["ownership", "Directors / Ownership"],
  ["banking", "Banking document"],
] as const;

const TYPE_LABELS: Record<string, string> = Object.fromEntries(DOCUMENT_TYPES);

const inputClass = "h-9 w-full min-w-0 rounded-md border bg-background px-3 text-sm";

function DocsPage() {
  const [rows, setRows] = useState<LibraryDocument[]>([]);
  const [clients, setClients] = useState<{ id: string; company_name: string }[]>([]);
  const [clientId, setClientId] = useState("");
  const [category, setCategory] = useState("");
  const [confidentiality, setConfidentiality] = useState("confidential");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [adding, setAdding] = useState(false);
  const [preview, setPreview] = useState<{ url: string; title: string } | null>(null);
  const [search, setSearch] = useState("");
  const [filterClient, setFilterClient] = useState("");

  async function load() {
    const [docsRes, clientsRes] = await Promise.all([
      supabase
        .from("documents")
        .select("id, client_id, title, file_path, storage_bucket, created_at, category, confidentiality, document_group, service_line, engagement_id, tax_return_id, service_project_id, advisory_project_id")
        .eq("document_group", "client_master")
        .is("service_line", null)
        .is("engagement_id", null)
        .is("tax_return_id", null)
        .is("service_project_id", null)
        .is("advisory_project_id", null)
        .order("created_at", { ascending: false }),
      supabase.from("clients").select("id, company_name").order("company_name"),
    ]);

    if (docsRes.error) {
      toast.error("Could not load documents: " + docsRes.error.message);
      return;
    }

    const clientRows = clientsRes.data ?? [];
    const clientMap = new Map<string, string>(
      clientRows.map((client) => [client.id, client.company_name || "Unnamed client"]),
    );

    setClients(clientRows);
    setRows((docsRes.data ?? []).map((doc) => ({
      id: doc.id,
      title: doc.title || "Untitled document",
      clientId: doc.client_id,
      clientName: doc.client_id ? (clientMap.get(doc.client_id) ?? "Client not available") : "Internal – GK",
      category: doc.category || "general_supporting",
      bucket: doc.storage_bucket || "client-documents",
      filePath: doc.file_path,
      createdAt: doc.created_at,
      confidentiality: doc.confidentiality || "confidential",
      canDelete: true,
    })));
  }

  useEffect(() => { void load(); }, []);
  useLiveRefresh(["documents", "clients"], load);

  function requireOnline(action: string) {
    if (typeof navigator !== "undefined" && (!navigator.onLine || !isOnline())) {
      toast.error(action + " requires an active internet connection. Reconnect and try again.");
      return false;
    }
    return true;
  }

  function closeUpload() {
    setAdding(false); setFile(null); setTitle(""); setCategory(""); setClientId(""); setConfidentiality("confidential");
  }

  async function upload(event: React.FormEvent) {
    event.preventDefault();
    if (!file || busy) return;
    if (!requireOnline("Document uploads")) return;

    setBusy(true);
    let path: string | null = null;
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) {
        toast.error(authError?.message || "Sign in again before uploading documents.");
        return;
      }

      const safeName = file.name.replace(/[\\/]/g, "_");
      const uniqueName = typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : Date.now() + "-" + Math.random().toString(36).slice(2);

      // Client files remain under the client UUID; internal files use a separate
      // prefix recognised by the scoped Supabase storage-access helper.
      path = clientId
        ? clientId + "/" + uniqueName + "-" + safeName
        : "internal/" + user.id + "/" + uniqueName + "-" + safeName;

      const uploadResult = await supabase.storage.from("client-documents").upload(path, file, { upsert: false });
      if (uploadResult.error) {
        toast.error(uploadResult.error.message);
        return;
      }

      if (!requireOnline("Saving document details")) {
        toast.error("The file was uploaded, but its record was not saved. Reconnect before continuing; the file has been retained to avoid deleting a possibly linked document.");
        return;
      }

      const payload = {
        client_id: clientId || null,
        title: title.trim() || file.name,
        file_path: path,
        uploaded_by: user.id,
        document_group: "client_master",
        service_line: null,
        category: category || "general_supporting",
        storage_bucket: "client-documents",
        period_label: null,
        expires_on: null,
        confidentiality,
        engagement_id: null,
        tax_return_id: null,
        advisory_project_id: null,
        service_project_id: null,
      };

      const { error } = await supabase.from("documents").insert(payload as any);
      if (error) {
        // Confirm whether the insert committed before cleaning up the uploaded file.
        const check = await supabase.from("documents").select("id").eq("file_path", path).maybeSingle();
        if (check.data?.id) {
          toast.success("Document uploaded successfully.");
        } else if (!check.error) {
          const cleanup = await supabase.storage.from("client-documents").remove([path]);
          toast.error(cleanup.error
            ? "Document details were not saved (" + error.message + "); the uploaded file could not be cleaned up (" + cleanup.error.message + ")."
            : error.message);
          return;
        } else {
          toast.error("The save result could not be confirmed. The file was retained to avoid breaking a record that may have been saved; refresh the library before retrying.");
          return;
        }
      } else {
        toast.success(clientId ? "Document uploaded and linked to the client." : "Internal document uploaded successfully.");
      }

      closeUpload();
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Document upload failed. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function signedUrl(row: LibraryDocument, seconds: number) {
    if (!requireOnline("Viewing or downloading documents")) return null;
    try {
      const { data, error } = await supabase.storage.from(row.bucket).createSignedUrl(row.filePath, seconds);
      if (error) {
        toast.error(error.message);
        return null;
      }
      return data.signedUrl;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not open the document. Check your connection.");
      return null;
    }
  }

  async function download(row: LibraryDocument) {
    const url = await signedUrl(row, 60);
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  }

  async function view(row: LibraryDocument) {
    const url = await signedUrl(row, 600);
    if (url) setPreview({ url, title: row.title });
  }

  async function remove(row: LibraryDocument) {
    if (!row.canDelete || !window.confirm("Delete “" + row.title + "” and its stored file? This cannot be undone.")) return;
    if (!requireOnline("Document deletion")) return;

    try {
      const { error: storageError } = await supabase.storage.from(row.bucket).remove([row.filePath]);
      if (storageError) {
        toast.error("File was not deleted: " + storageError.message);
        return;
      }
      const { error } = await supabase.from("documents").delete().eq("id", row.id);
      if (error) {
        toast.error("The file was removed, but its document record could not be deleted: " + error.message);
      } else {
        toast.success("Document deleted.");
      }
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Document deletion failed. Check your connection.");
    }
  }

  const filteredRows = rows.filter((row) => {
    if (filterClient === "__internal__" && row.clientId !== null) return false;
    if (filterClient && filterClient !== "__internal__" && row.clientId !== filterClient) return false;
    const haystack = (row.title + " " + row.clientName + " " + (TYPE_LABELS[row.category] || row.category)).toLowerCase();
    return !search.trim() || haystack.includes(search.trim().toLowerCase());
  });

  const typeLabel = (row: LibraryDocument) => TYPE_LABELS[row.category] || row.category.replaceAll("_", " ");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Documents</h1>
        <button type="button" onClick={() => setAdding(true)} className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm text-primary-foreground">
          <Upload className="h-4 w-4" /> Upload
        </button>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative min-w-0 flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by name, client or type…" className={inputClass + " pl-9"} />
        </div>
        <select value={filterClient} onChange={(event) => setFilterClient(event.target.value)} className={inputClass + " sm:max-w-xs"} aria-label="Show documents for">
          <option value="">All documents</option>
          <option value="__internal__">Internal (GK)</option>
          {clients.map((client) => <option key={client.id} value={client.id}>{client.company_name}</option>)}
        </select>
      </div>

      <ul className="divide-y rounded-lg border bg-card">
        {filteredRows.length === 0 && (
          <li className="px-3 py-12 text-center text-sm text-muted-foreground">
            {rows.length === 0 ? "No documents yet. Use Upload to add the first one." : "No documents match."}
          </li>
        )}
        {filteredRows.map((row) => (
          <li key={row.id} className="flex items-center gap-3 px-3 py-2.5 hover:bg-muted/30">
            <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
            <button type="button" onClick={() => void view(row)} className="min-w-0 flex-1 text-left" title="View">
              <span className="block break-words text-sm font-medium hover:text-primary">{row.title}</span>
              <span className="block text-xs text-muted-foreground">
                {row.clientName} · {typeLabel(row)} · {formatDate(row.createdAt)}
                {row.confidentiality === "restricted" && <span className="ml-2 rounded bg-amber-500/15 px-1.5 py-0.5 text-amber-700 dark:text-amber-300">Restricted</span>}
              </span>
            </button>
            <button type="button" onClick={() => void download(row)} aria-label={"Download " + row.title} title="Download" className="shrink-0 rounded-md p-2 hover:bg-muted"><Download className="h-4 w-4" /></button>
            <button type="button" onClick={() => void remove(row)} aria-label={"Delete " + row.title} title="Delete" className="shrink-0 rounded-md p-2 text-destructive hover:bg-muted"><Trash2 className="h-4 w-4" /></button>
          </li>
        ))}
      </ul>

      {adding && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => !busy && closeUpload()}>
          <form onSubmit={upload} onClick={(event) => event.stopPropagation()} className="w-full max-w-md space-y-3 rounded-lg bg-card p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Upload document</h2>
              <button type="button" onClick={closeUpload} disabled={busy} aria-label="Close"><X className="h-4 w-4" /></button>
            </div>
            <input type="file" required onChange={(event) => setFile(event.target.files?.[0] ?? null)} className="block w-full text-sm" aria-label="File" />
            <label className="block text-xs text-muted-foreground">For
              <select value={clientId} onChange={(event) => setClientId(event.target.value)} className={inputClass + " mt-1 text-foreground"}>
                <option value="">Internal (GK)</option>
                {clients.map((client) => <option key={client.id} value={client.id}>{client.company_name}</option>)}
              </select>
            </label>
            <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Name (defaults to the file name)" className={inputClass} />
            <select value={category} onChange={(event) => setCategory(event.target.value)} className={inputClass} aria-label="Type">
              <option value="">General document</option>
              {DOCUMENT_TYPES.slice(1).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={confidentiality === "restricted"} onChange={(event) => setConfidentiality(event.target.checked ? "restricted" : "confidential")} />
              Only Director/Admin can see this
            </label>
            <button disabled={!file || busy} className="h-10 w-full rounded-md bg-primary text-sm font-medium text-primary-foreground disabled:opacity-50">{busy ? "Uploading…" : "Upload"}</button>
          </form>
        </div>
      )}

      {preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setPreview(null)}>
          <div onClick={(event) => event.stopPropagation()} className="flex h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg bg-card">
            <div className="flex items-center justify-between gap-3 border-b p-3">
              <div className="truncate text-sm font-semibold">{preview.title}</div>
              <div className="flex items-center gap-3">
                <a href={preview.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary">
                  <Download className="h-3 w-3" />Open in new tab
                </a>
                <button onClick={() => setPreview(null)} aria-label="Close preview"><X className="h-4 w-4" /></button>
              </div>
            </div>
            <iframe src={preview.url} className="w-full flex-1" title={preview.title} />
          </div>
        </div>
      )}
    </div>
  );
}
