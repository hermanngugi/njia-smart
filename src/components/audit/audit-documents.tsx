import { useState } from "react";
import { toast } from "sonner";
import { Download, Eye, FileText, Trash2, Upload, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { openStoredFile, signedFileUrl } from "@/lib/client-files";
import { formatDate } from "@/lib/format";
import { useAuth } from "@/lib/auth";

export type Phase = { v: string; label: string };
const selectClass = "h-9 px-2 rounded-md border bg-background text-sm";

/** Working papers and evidence for one engagement. Files are attached to steps from the Checklist. */
export function AuditDocuments({ engagementId, docs, phases, reload }: { engagementId: string; docs: any[]; phases: Phase[]; reload: () => void }) {
  const { user, isAdmin } = useAuth();
  const [phase, setPhase] = useState("all");
  const [category, setCategory] = useState(phases[0]?.v ?? "working_papers");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ url: string; title: string } | null>(null);
  const label = (v?: string | null) => phases.find((s) => s.v === v)?.label ?? "General";
  const shown = docs.filter((w) => phase === "all" || (w.category ?? "working_papers") === phase);

  async function upload(ev: React.ChangeEvent<HTMLInputElement>) {
    const file = ev.target.files?.[0]; if (!file) return;
    setBusy(true);
    const path = `${engagementId}/${category}/${Date.now()}-${file.name}`;
    const up = await supabase.storage.from("audit-workpapers").upload(path, file);
    if (up.error) { toast.error(up.error.message); setBusy(false); return; }
    const { error } = await supabase.from("audit_workpapers").insert({
      engagement_id: engagementId, title: title || file.name, file_path: path, uploaded_by: user?.id, category,
    } as any);
    setBusy(false); ev.target.value = "";
    if (error) toast.error(error.message); else { toast.success("Uploaded"); setTitle(""); reload(); }
  }
  async function view(path: string, t: string) {
    const res = await signedFileUrl("audit-workpapers", path, 600);
    if ("error" in res) toast.error(res.error); else setPreview({ url: res.url, title: t });
  }
  async function remove(id: string, path: string) {
    if (!confirm("Delete document?")) return;
    await supabase.storage.from("audit-workpapers").remove([path]);
    await supabase.from("audit_workpapers").delete().eq("id", id);
    reload();
  }

  return (
    <div className="bg-card border rounded-lg p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold">Documents</h2>
          <p className="text-sm text-muted-foreground">Upload working papers and evidence, then attach them to checklist steps.</p>
        </div>
        <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">Show
          <select value={phase} onChange={(e) => setPhase(e.target.value)} className={selectClass}>
            <option value="all">All phases</option>
            {phases.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}
          </select>
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <select value={category} onChange={(e) => setCategory(e.target.value)} className={selectClass} aria-label="Phase for the new document">
          {phases.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}
        </select>
        <input placeholder="Document title (optional)" value={title} onChange={(e) => setTitle(e.target.value)} className="flex-1 min-w-[180px] h-9 px-3 rounded-md border bg-background text-sm" />
        <label className={`h-9 px-3 inline-flex items-center gap-2 rounded-md bg-primary text-primary-foreground text-sm cursor-pointer ${busy ? "opacity-60" : ""}`}>
          <Upload className="h-4 w-4" /> {busy ? "Uploading…" : "Upload file"}
          <input type="file" hidden onChange={upload} disabled={busy} />
        </label>
      </div>
      <div className="divide-y border rounded-md">
        {shown.length === 0 && <div className="text-sm text-muted-foreground py-6 text-center">{docs.length === 0 ? "No documents yet. Upload your first file above." : "No documents in this phase."}</div>}
        {shown.map((w) => (
          <div key={w.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
            <FileText className="h-4 w-4 text-muted-foreground" />
            <div className="flex-1 min-w-[160px]">
              <div>{w.title}</div>
              <div className="text-xs text-muted-foreground">{label(w.category ?? "working_papers")} · {w.profiles?.full_name} · {formatDate(w.created_at)}</div>
            </div>
            <button onClick={() => view(w.file_path, w.title)} className="text-primary text-xs inline-flex items-center gap-1"><Eye className="h-3 w-3" />View</button>
            <button onClick={() => void openStoredFile("audit-workpapers", w.file_path, 60)} className="text-primary text-xs inline-flex items-center gap-1"><Download className="h-3 w-3" />Download</button>
            {isAdmin && <button onClick={() => remove(w.id, w.file_path)} className="text-destructive" aria-label="Delete document"><Trash2 className="h-3.5 w-3.5" /></button>}
          </div>
        ))}
      </div>
      {preview && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={() => setPreview(null)}>
          <div onClick={(e) => e.stopPropagation()} className="bg-card w-full max-w-5xl h-[90vh] rounded-lg flex flex-col overflow-hidden">
            <div className="flex justify-between items-center p-3 border-b">
              <div className="font-semibold text-sm truncate">{preview.title}</div>
              <button onClick={() => setPreview(null)} aria-label="Close"><X className="h-4 w-4" /></button>
            </div>
            <iframe src={preview.url} className="flex-1 w-full" title={preview.title} />
          </div>
        </div>
      )}
    </div>
  );
}
