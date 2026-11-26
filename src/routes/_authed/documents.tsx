import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Upload, Download, Trash2, FileText, Eye, X, Search, ShieldCheck } from "lucide-react";
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

  async function upload(event: React.ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    if (busy) { input.value = ""; return; }
    if (!requireOnline("Document uploads")) { input.value = ""; return; }

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

      setTitle("");
      setCategory("");
      setClientId("");
      setConfidentiality("confidential");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Document upload failed. Check your connection and try again.");
    } finally {
      setBusy(false);
      input.value = "";
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

  const internalCount = rows.filter((row) => row.clientId === null).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Documents</h1>
          <p className="text-sm text-muted-foreground">A simple shared library for client files and internal GK documents.</p>
        </div>
        <div className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-xs text-muted-foreground">
          <ShieldCheck className="h-4 w-4 text-primary" />
          Private files · access controlled by your Documents permissions
        </div>
      </div>

      <section className="rounded-lg border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-semibold">Upload a document</h2>
          <span className="text-xs text-muted-foreground">Client is optional</span>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <select value={clientId} onChange={(event) => setClientId(event.target.value)} className={inputClass}>
            <option value="">Internal / no client</option>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>{client.company_name}</option>
            ))}
          </select>
          <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Document title (optional)" className={inputClass} />
          <select value={category} onChange={(event) => setCategory(event.target.value)} className={inputClass}>
            <option value="">Document type (optional)</option>
            {DOCUMENT_TYPES.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <select value={confidentiality} onChange={(event) => setConfidentiality(event.target.value)} className={inputClass}>
            <option value="confidential">Confidential</option>
            <option value="restricted">Restricted · Director/Admin only</option>
          </select>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">
            Leave the client blank for internal circulars, memos and shared office documents. Audit, Tax, Advisory and project workpapers remain in their own workspaces.
          </p>
          <label className={"inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm text-primary-foreground " + (busy ? "cursor-not-allowed opacity-60" : "cursor-pointer")}>
            <Upload className="h-4 w-4" />
            {busy ? "Uploading…" : "Choose file & upload"}
            <input type="file" hidden onChange={upload} disabled={busy} />
          </label>
        </div>
      </section>

      <section className="space-y-3 rounded-lg border bg-card p-3 sm:p-4">
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative min-w-0 flex-1">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search documents or clients…" className={inputClass + " pl-9"} />
          </div>
          <select value={filterClient} onChange={(event) => setFilterClient(event.target.value)} className={inputClass + " sm:max-w-xs"}>
            <option value="">All documents</option>
            <option value="__internal__">Internal GK documents</option>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>{client.company_name}</option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>Showing {filteredRows.length} of {rows.length} documents</span>
          <span>{internalCount} internal GK document{internalCount === 1 ? "" : "s"}</span>
        </div>

        <div className="overflow-x-auto rounded-md border">
          <table className="w-full min-w-[650px] text-sm">
            <thead className="bg-muted text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Document</th>
                <th className="px-3 py-2">Client / circulation</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Uploaded</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-12 text-center text-muted-foreground">
                    No documents found. Upload a file to start the library.
                  </td>
                </tr>
              )}
              {filteredRows.map((row) => (
                <tr key={row.id} className="border-t align-top hover:bg-muted/20">
                  <td className="max-w-[280px] px-3 py-2">
                    <div className="flex items-start gap-2">
                      <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0">
                        <div className="break-words font-medium">{row.title}</div>
                        {row.confidentiality === "restricted" && (
                          <span className="mt-1 inline-block rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-700">Restricted</span>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2">{row.clientName}</td>
                  <td className="px-3 py-2">{TYPE_LABELS[row.category] || row.category.replaceAll("_", " ")}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">{formatDate(row.createdAt)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    <div className="inline-flex items-center gap-3">
                      <button onClick={() => void view(row)} className="inline-flex items-center gap-1 text-xs text-primary">
                        <Eye className="h-3 w-3" />View
                      </button>
                      <button onClick={() => void download(row)} className="inline-flex items-center gap-1 text-xs text-primary">
                        <Download className="h-3 w-3" />Download
                      </button>
                      <button onClick={() => void remove(row)} aria-label={"Delete " + row.title} className="text-destructive">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

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
