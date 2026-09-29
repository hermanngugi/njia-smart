import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ArrowLeft, Upload, Download, Eye, Trash2, FileText, Send, X } from "lucide-react";
import { formatDate, formatDateTime, STATUS_COLORS, statusLabel } from "@/lib/format";
import { useAuth } from "@/lib/auth";
import { ClientAssignments } from "@/components/client-assignments";

export const Route = createFileRoute("/_authed/audit/$id")({ component: AuditDetail });

const STATUSES = ["not_started","in_progress","under_review","completed"];
const CATEGORIES: { v: string; label: string }[] = [
  { v: "planning", label: "Audit planning" },
  { v: "programs", label: "Audit programs" },
  { v: "risk", label: "Risk assessment" },
  { v: "working_papers", label: "Working papers" },
  { v: "sampling", label: "Sampling" },
  { v: "review_notes", label: "Review notes" },
  { v: "financial_statements", label: "Financial statements" },
  { v: "completion", label: "Completion tracking" },
  { v: "final_report", label: "Final audit report" },
];

function AuditDetail() {
  const { id } = useParams({ from: "/_authed/audit/$id" });
  const { user, isAdmin } = useAuth();
  const [e, setE] = useState<any>(null);
  const [wp, setWp] = useState<any[]>([]);
  const [notes, setNotes] = useState<any[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [staff, setStaff] = useState<any[]>([]);
  const [noteText, setNoteText] = useState("");
  const [wpTitle, setWpTitle] = useState("");
  const [wpCategory, setWpCategory] = useState<string>("planning");
  const [activeCat, setActiveCat] = useState<string>("planning");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{url:string;title:string}|null>(null);
  const [newTask, setNewTask] = useState({ title: "", assigned_to: "", due_date: "" });

  async function load() {
    const [eRes, wpRes, nRes, pRes, tRes] = await Promise.all([
      supabase.from("engagements").select("*, clients(company_name)").eq("id", id).maybeSingle(),
      supabase.from("audit_workpapers").select("*").eq("engagement_id", id).order("created_at", { ascending: false }),
      supabase.from("audit_review_notes").select("*").eq("engagement_id", id).order("created_at"),
      supabase.from("profiles").select("id, full_name"),
      supabase.from("tasks").select("*").eq("engagement_id", id).order("created_at"),
    ]);
    const byId = new Map((pRes.data ?? []).map((p: any) => [p.id, p]));
    setE(eRes.data);
    setStaff(pRes.data ?? []);
    setWp((wpRes.data ?? []).map((r: any) => ({ ...r, profiles: r.uploaded_by ? byId.get(r.uploaded_by) ?? null : null })));
    setNotes((nRes.data ?? []).map((r: any) => ({ ...r, profiles: r.author_id ? byId.get(r.author_id) ?? null : null })));
    setTasks((tRes.data ?? []).map((r: any) => ({ ...r, assignee: r.assigned_to ? byId.get(r.assigned_to) ?? null : null })));
  }
  useEffect(()=>{ load(); }, [id]);

  // Live updates scoped to this engagement only
  useEffect(() => {
    const ch = supabase
      .channel(`audit-${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "engagements", filter: `id=eq.${id}` }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "audit_workpapers", filter: `engagement_id=eq.${id}` }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "audit_review_notes", filter: `engagement_id=eq.${id}` }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks", filter: `engagement_id=eq.${id}` }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [id]);

  async function saveField(field: string, value: any) {
    const { error } = await supabase.from("engagements").update({ [field]: value } as any).eq("id", id);
    if (error) toast.error(error.message); else { toast.success("Saved"); load(); }
  }

  async function uploadWp(ev: React.ChangeEvent<HTMLInputElement>) {
    const file = ev.target.files?.[0]; if (!file) return;
    setBusy(true);
    const path = `${id}/${wpCategory}/${Date.now()}-${file.name}`;
    const up = await supabase.storage.from("audit-workpapers").upload(path, file);
    if (up.error) { toast.error(up.error.message); setBusy(false); return; }
    const { error } = await supabase.from("audit_workpapers").insert({
      engagement_id: id, title: wpTitle || file.name, file_path: path, uploaded_by: user?.id, category: wpCategory,
    } as any);
    setBusy(false); ev.target.value="";
    if (error) toast.error(error.message); else { toast.success("Uploaded"); setWpTitle(""); load(); }
  }
  async function viewWp(path: string, title: string) {
    const { data, error } = await supabase.storage.from("audit-workpapers").createSignedUrl(path, 600);
    if (error) toast.error(error.message); else setPreview({ url: data.signedUrl, title });
  }
  async function downloadWp(path: string) {
    const { data, error } = await supabase.storage.from("audit-workpapers").createSignedUrl(path, 60);
    if (error) toast.error(error.message); else window.open(data.signedUrl, "_blank");
  }
  async function removeWp(wpId: string, path: string) {
    if (!confirm("Delete workpaper?")) return;
    await supabase.storage.from("audit-workpapers").remove([path]);
    await supabase.from("audit_workpapers").delete().eq("id", wpId);
    load();
  }

  async function addNote() {
    if (!noteText.trim()) return;
    const { error } = await supabase.from("audit_review_notes").insert({ engagement_id: id, body: noteText.trim(), author_id: user?.id, stage: activeCat } as any);
    if (error) toast.error(error.message); else { setNoteText(""); load(); }
  }
  async function toggleNote(nid: string, resolved: boolean) {
    await supabase.from("audit_review_notes").update({ resolved }).eq("id", nid);
    load();
  }

  async function addTask() {
    if (!newTask.title.trim()) return;
    const payload: any = {
      title: newTask.title.trim(),
      engagement_id: id,
      client_id: e?.client_id,
      assigned_to: newTask.assigned_to || null,
      due_date: newTask.due_date || null,
      created_by: user?.id,
      stage: activeCat,
    };
    const { error } = await supabase.from("tasks").insert(payload);
    if (error) toast.error(error.message);
    else {
      if (payload.assigned_to) {
        await supabase.from("notifications").insert({
          user_id: payload.assigned_to, type: "task",
          title: `Assigned: ${payload.title}`, body: `Audit: ${e?.title} — ${CATEGORIES.find(c=>c.v===activeCat)?.label}`, link: `/audit/${id}`,
        });
      }
      setNewTask({ title: "", assigned_to: "", due_date: "" });
      load();
    }
  }
  async function setTaskStatus(tid: string, status: string) {
    await supabase.from("tasks").update({ status: status as any }).eq("id", tid);
    load();
  }
  async function removeTask(tid: string) {
    if (!confirm("Delete task?")) return;
    await supabase.from("tasks").delete().eq("id", tid);
    load();
  }

  if (!e) return <div className="text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="space-y-4">
      <Link to="/audit" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1"><ArrowLeft className="h-3 w-3" /> Back to audits</Link>
      <div className="bg-card border rounded-lg p-5">
        <div className="flex flex-wrap justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">{e.title}</h1>
            <div className="text-sm text-muted-foreground">{e.clients?.company_name}</div>
            {e.updated_at && <div className="text-xs text-muted-foreground mt-1">Last updated {formatDateTime(e.updated_at)}</div>}
          </div>
          <span className={`h-fit text-xs px-2 py-1 rounded-full capitalize ${STATUS_COLORS[e.status]}`}>{statusLabel(e.status)}</span>
        </div>
        <div className="mt-4 grid sm:grid-cols-4 gap-3">
          <div>
            <label className="text-xs font-medium">Start date</label>
            <input type="date" defaultValue={e.start_date || ""} onBlur={ev=>saveField("start_date", ev.target.value || null)} className="mt-1 w-full h-9 px-3 rounded-md border bg-background text-sm" />
          </div>
          <div>
            <label className="text-xs font-medium">Status</label>
            <select value={e.status} onChange={ev=>saveField("status", ev.target.value)} className="mt-1 w-full h-9 px-3 rounded-md border bg-background text-sm capitalize">
              {STATUSES.map(s=><option key={s} value={s}>{s.replace(/_/g," ")}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium">Completion ({e.completion_pct}%)</label>
            <input type="range" min={0} max={100} step={5} value={e.completion_pct} onChange={ev=>setE({...e, completion_pct: Number(ev.target.value)})} onMouseUp={ev=>saveField("completion_pct", Number((ev.target as HTMLInputElement).value))} onTouchEnd={ev=>saveField("completion_pct", Number((ev.target as HTMLInputElement).value))} className="mt-2 w-full" />
          </div>
          <div>
            <label className="text-xs font-medium">Due date</label>
            <input type="date" defaultValue={e.due_date || ""} onBlur={ev=>saveField("due_date", ev.target.value || null)} className="mt-1 w-full h-9 px-3 rounded-md border bg-background text-sm" />
          </div>
        </div>
        <div className="mt-3">
          <label className="text-xs font-medium">Notes</label>
          <textarea defaultValue={e.notes || ""} onBlur={ev=>saveField("notes", ev.target.value)} rows={2} className="mt-1 w-full px-3 py-2 rounded-md border bg-background text-sm" />
        </div>
      </div>

      {e.client_id && <ClientAssignments clientId={e.client_id} />}

      <div className="bg-card border rounded-lg p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h2 className="font-semibold">Audit workflow</h2>
          <div className="text-xs text-muted-foreground">Click a stage to manage its documents, tasks and review notes</div>
        </div>
        <div className="flex flex-wrap gap-1 mb-4 border-b">
          {CATEGORIES.map(c => {
            const docCount = wp.filter(w => (w.category ?? "working_papers") === c.v).length;
            const taskCount = tasks.filter(t => (t.stage ?? null) === c.v).length;
            const noteCount = notes.filter(n => (n.stage ?? null) === c.v).length;
            const total = docCount + taskCount + noteCount;
            return (
              <button key={c.v} onClick={()=>{ setActiveCat(c.v); setWpCategory(c.v); }} className={`px-3 py-1.5 text-xs border-b-2 transition-colors ${activeCat===c.v ? "border-primary text-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
                {c.label} {total>0 && <span className="ml-1 text-[10px] px-1 rounded bg-muted">{total}</span>}
              </button>
            );
          })}
        </div>

        <div className="space-y-6">
          {/* Documents */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold">Documents</h3>
              <span className="text-xs text-muted-foreground">{wp.filter(w => (w.category ?? "working_papers") === activeCat).length} file(s)</span>
            </div>
            <div className="flex gap-2 mb-2">
              <input placeholder="Document title (optional)" value={wpTitle} onChange={ev=>setWpTitle(ev.target.value)} className="flex-1 h-9 px-3 rounded-md border bg-background text-sm" />
              <label className={`h-9 px-3 inline-flex items-center gap-2 rounded-md bg-primary text-primary-foreground text-sm cursor-pointer ${busy?"opacity-60":""}`}>
                <Upload className="h-4 w-4" /> {busy ? "Uploading…" : "Upload"}
                <input type="file" hidden onChange={uploadWp} disabled={busy} />
              </label>
            </div>
            <div className="divide-y border rounded-md">
              {wp.filter(w => (w.category ?? "working_papers") === activeCat).length === 0 && (
                <div className="text-sm text-muted-foreground py-4 text-center">No documents in this stage yet.</div>
              )}
              {wp.filter(w => (w.category ?? "working_papers") === activeCat).map(w => (
                <div key={w.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  <div className="flex-1"><div>{w.title}</div><div className="text-xs text-muted-foreground">{w.profiles?.full_name} · {formatDate(w.created_at)}</div></div>
                  <button onClick={()=>viewWp(w.file_path, w.title)} className="text-primary text-xs inline-flex items-center gap-1"><Eye className="h-3 w-3" />View</button>
                  <button onClick={()=>downloadWp(w.file_path)} className="text-primary text-xs inline-flex items-center gap-1"><Download className="h-3 w-3" />Download</button>
                  {isAdmin && <button onClick={()=>removeWp(w.id, w.file_path)} className="text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>}
                </div>
              ))}
            </div>
          </section>

          {/* Tasks */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold">Tasks</h3>
              <span className="text-xs text-muted-foreground">{tasks.filter(t => (t.stage ?? null) === activeCat).length} task(s)</span>
            </div>
            <div className="space-y-1 mb-2 border rounded-md p-2">
              {tasks.filter(t => (t.stage ?? null) === activeCat).length === 0 && <div className="text-sm text-muted-foreground py-2 text-center">No tasks in this stage yet.</div>}
              {tasks.filter(t => (t.stage ?? null) === activeCat).map(t => (
                <div key={t.id} className="flex items-center gap-2 py-1.5 border-b last:border-0 text-sm">
                  <input type="checkbox" checked={t.status === "done"} onChange={ev => setTaskStatus(t.id, ev.target.checked ? "done" : "todo")} />
                  <div className="flex-1">
                    <div className={t.status === "done" ? "line-through text-muted-foreground" : ""}>{t.title}</div>
                    {t.status === "done" && t.completed_at && <div className="text-[10px] text-muted-foreground">Done {formatDateTime(t.completed_at)}</div>}
                  </div>
                  <span className="text-xs text-muted-foreground">{t.assignee?.full_name ?? "—"}</span>
                  <span className="text-xs text-muted-foreground">{formatDate(t.due_date)}</span>
                  <select value={t.status} onChange={ev => setTaskStatus(t.id, ev.target.value)} className="h-7 px-2 rounded text-xs border bg-background capitalize">
                    {["todo","in_progress","done"].map(s => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
                  </select>
                  <button onClick={() => removeTask(t.id)} className="text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto_auto] gap-2">
              <input value={newTask.title} onChange={ev => setNewTask({ ...newTask, title: ev.target.value })} placeholder={`New ${CATEGORIES.find(c=>c.v===activeCat)?.label.toLowerCase()} task…`} className="h-9 px-3 rounded-md border bg-background text-sm" />
              <select value={newTask.assigned_to} onChange={ev => setNewTask({ ...newTask, assigned_to: ev.target.value })} className="h-9 px-2 rounded-md border bg-background text-sm">
                <option value="">Assign…</option>
                {staff.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
              </select>
              <input type="date" value={newTask.due_date} onChange={ev => setNewTask({ ...newTask, due_date: ev.target.value })} className="h-9 px-2 rounded-md border bg-background text-sm" />
              <button onClick={addTask} className="h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm inline-flex items-center gap-1"><Send className="h-3.5 w-3.5" /> Add</button>
            </div>
          </section>

          {/* Review notes */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold">Review notes</h3>
              <span className="text-xs text-muted-foreground">{notes.filter(n => (n.stage ?? null) === activeCat).length} note(s)</span>
            </div>
            <div className="space-y-2 mb-2">
              {notes.filter(n => (n.stage ?? null) === activeCat).length === 0 && <div className="text-sm text-muted-foreground">No review notes in this stage yet.</div>}
              {notes.filter(n => (n.stage ?? null) === activeCat).map(n => (
                <div key={n.id} className={`p-2 rounded-md text-sm ${n.resolved ? "bg-muted/40 line-through text-muted-foreground" : "bg-muted/20"}`}>
                  <div className="flex justify-between gap-2">
                    <div className="flex-1 whitespace-pre-wrap">{n.body}</div>
                    <button onClick={()=>toggleNote(n.id, !n.resolved)} className="text-xs text-primary">{n.resolved ? "Reopen" : "Resolve"}</button>
                  </div>
                  <div className="text-xs text-muted-foreground">{n.profiles?.full_name} · {formatDate(n.created_at)}</div>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <input value={noteText} onChange={ev=>setNoteText(ev.target.value)} onKeyDown={ev=>{ if(ev.key==="Enter") addNote(); }} placeholder={`Add note for ${CATEGORIES.find(c=>c.v===activeCat)?.label}…`} className="flex-1 h-9 px-3 rounded-md border bg-background text-sm" />
              <button onClick={addNote} className="h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm inline-flex items-center gap-1"><Send className="h-3.5 w-3.5" /> Add</button>
            </div>
          </section>
        </div>
      </div>


      {preview && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={()=>setPreview(null)}>
          <div onClick={ev=>ev.stopPropagation()} className="bg-card w-full max-w-5xl h-[90vh] rounded-lg flex flex-col overflow-hidden">
            <div className="flex justify-between items-center p-3 border-b">
              <div className="font-semibold text-sm truncate">{preview.title}</div>
              <button onClick={()=>setPreview(null)}><X className="h-4 w-4" /></button>
            </div>
            <iframe src={preview.url} className="flex-1 w-full" title={preview.title} />
          </div>
        </div>
      )}
    </div>
  );
}
