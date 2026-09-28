import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Plus, X, Pencil, Trash2, MessageSquare, Send } from "lucide-react";
import { formatDate, formatDateTime, daysUntil, STATUS_COLORS } from "@/lib/format";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/_authed/tasks")({ component: TasksPage });

const EMPTY = { id: "", title:"", description:"", client_id:"", assigned_to:"", priority:"normal", due_date:"", status:"todo" };

function TasksPage() {
  const { user, isAdmin, canCreate, canDelete } = useAuth();
  const [rows, setRows] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [staff, setStaff] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"mine"|"all">("all");
  const [form, setForm] = useState<any>(EMPTY);
  const [detailId, setDetailId] = useState<string|null>(null);

  async function load() {
    const [t, c, s] = await Promise.all([
      supabase.from("tasks").select("*, clients(company_name)").order("due_date", { ascending: true, nullsFirst: false }),
      supabase.from("clients").select("id, company_name").order("company_name"),
      supabase.from("profiles").select("id, full_name").order("full_name"),
    ]);
    if (t.error) toast.error(t.error.message);
    const staffList = s.data ?? [];
    const byId = new Map(staffList.map((p: any) => [p.id, p]));
    const tasksWithAssignee = (t.data ?? []).map((row: any) => ({
      ...row,
      profiles: row.assigned_to ? byId.get(row.assigned_to) ?? null : null,
    }));
    setRows(tasksWithAssignee); setClients(c.data ?? []); setStaff(staffList);
  }
  useEffect(()=>{ load(); }, []);

  function openNew() { setForm(EMPTY); setOpen(true); }
  function openEdit(r: any) {
    setForm({ id: r.id, title:r.title, description:r.description||"", client_id:r.client_id||"", assigned_to:r.assigned_to||"", priority:r.priority, due_date:r.due_date||"", status:r.status });
    setOpen(true);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const payload: any = {
      title: form.title, description: form.description,
      client_id: form.client_id || null, assigned_to: form.assigned_to || null,
      priority: form.priority, due_date: form.due_date || null, status: form.status,
    };
    if (form.id) {
      const { error } = await supabase.from("tasks").update(payload).eq("id", form.id);
      if (error) return toast.error(error.message);
      toast.success("Task updated");
    } else {
      payload.created_by = user?.id;
      const { error } = await supabase.from("tasks").insert(payload);
      if (error) return toast.error(error.message);
      toast.success("Task created");
    }
    if (form.assigned_to && form.assigned_to !== user?.id) {
      await supabase.from("notifications").insert({ user_id: form.assigned_to, type:"task_assigned", title: form.id ? "Task updated" : "New task assigned", body: form.title });
    }
    setOpen(false); setForm(EMPTY); load();
  }

  async function remove(id: string) {
    if (!confirm("Delete this task?")) return;
    const { error } = await supabase.from("tasks").delete().eq("id", id);
    if (error) toast.error(error.message); else { toast.success("Deleted"); load(); }
  }

  async function setStatus(id: string, status: string) {
    const { error } = await supabase.from("tasks").update({ status: status as any }).eq("id", id);
    if (error) toast.error(error.message); else load();
  }

  const visible = tab === "mine" ? rows.filter(r => r.assigned_to === user?.id) : rows;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap justify-between items-center gap-3">
        <div><h1 className="text-2xl font-bold">Tasks</h1><p className="text-sm text-muted-foreground">Assign, transfer and collaborate on work.</p></div>
        {canCreate("tasks") && (
          <button onClick={openNew} className="h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm inline-flex items-center gap-2"><Plus className="h-4 w-4" /> New task</button>
        )}
      </div>
      <div className="inline-flex border rounded-md p-0.5 bg-muted">
        {(["all","mine"] as const).map(t => (
          <button key={t} onClick={()=>setTab(t)} className={`px-3 py-1 text-xs rounded ${tab===t ? "bg-card shadow font-medium" : "text-muted-foreground"}`}>{t === "mine" ? "My tasks" : "All tasks"}</button>
        ))}
      </div>
      <div className="bg-card border rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs text-muted-foreground border-b">
              <tr><th className="py-2 px-3">Task</th><th>Client</th><th>Assignee</th><th>Priority</th><th>Due</th><th>Status</th><th></th></tr>
            </thead>
            <tbody>
              {visible.length===0 && <tr><td colSpan={7} className="py-10 text-center text-muted-foreground">No tasks.</td></tr>}
              {visible.map(t=>{
                const d = daysUntil(t.due_date);
                const isUrgent = d !== null && d >= 0 && d <= 2 && t.status !== "done";
                return (
                  <tr key={t.id} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="py-2 px-3 font-medium">
                      <button onClick={()=>setDetailId(t.id)} className="hover:text-primary text-left">{t.title}</button>
                    </td>
                    <td className="text-xs text-muted-foreground">{t.clients?.company_name || "—"}</td>
                    <td className="text-xs">
                      <select value={t.assigned_to || ""} onChange={async e => {
                        const newAssignee = e.target.value || null;
                        const { error } = await supabase.from("tasks").update({ assigned_to: newAssignee }).eq("id", t.id);
                        if (error) toast.error(error.message);
                        else {
                          if (newAssignee && newAssignee !== user?.id) {
                            await supabase.from("notifications").insert({ user_id: newAssignee, type:"task_transferred", title:"Task transferred to you", body: t.title });
                          }
                          toast.success("Reassigned"); load();
                        }
                      }} className="h-7 px-2 rounded text-xs border bg-background">
                        <option value="">Unassigned</option>
                        {staff.map(s=><option key={s.id} value={s.id}>{s.full_name}</option>)}
                      </select>
                    </td>
                    <td><span className={`text-xs px-2 py-0.5 rounded capitalize ${isUrgent ? STATUS_COLORS.urgent : STATUS_COLORS[t.priority]}`}>{isUrgent ? "urgent" : t.priority}</span></td>
                    <td className="text-xs">{formatDate(t.due_date)}{t.is_overdue && <div className="text-destructive">overdue</div>}</td>
                    <td>
                      <select value={t.status} onChange={e=>setStatus(t.id, e.target.value)} className={`h-7 px-2 rounded text-xs border bg-background capitalize ${STATUS_COLORS[t.status]}`}>
                        {["todo","in_progress","blocked","done"].map(s=><option key={s} value={s}>{s.replace(/_/g," ")}</option>)}
                      </select>
                      {t.status === "done" && t.completed_at && (
                        <div className="text-[10px] text-muted-foreground mt-0.5 whitespace-nowrap">Done {formatDateTime(t.completed_at)}</div>
                      )}
                    </td>
                    <td className="pr-2 text-right space-x-1 whitespace-nowrap">
                      <button onClick={()=>setDetailId(t.id)} title="Comments" className="p-1 hover:text-primary"><MessageSquare className="h-3.5 w-3.5" /></button>
                      <button onClick={()=>openEdit(t)} title="Edit" className="p-1 hover:text-primary"><Pencil className="h-3.5 w-3.5" /></button>
                      {canDelete("tasks", { createdBy: t.created_by }) && <button onClick={()=>remove(t.id)} title="Delete" className="p-1 hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={()=>setOpen(false)}>
          <form onClick={e=>e.stopPropagation()} onSubmit={save} className="bg-card w-full max-w-md rounded-lg p-6 space-y-3">
            <div className="flex justify-between"><h2 className="text-lg font-semibold">{form.id ? "Edit task" : "New task"}</h2><button type="button" onClick={()=>setOpen(false)}><X className="h-4 w-4" /></button></div>
            <input required placeholder="Title" value={form.title} onChange={e=>setForm({...form, title:e.target.value})} className="w-full h-9 px-3 rounded-md border bg-background text-sm" />
            <textarea placeholder="Description" value={form.description} onChange={e=>setForm({...form, description:e.target.value})} rows={3} className="w-full px-3 py-2 rounded-md border bg-background text-sm" />
            <div className="grid grid-cols-2 gap-2">
              <select value={form.client_id} onChange={e=>setForm({...form, client_id:e.target.value})} className="h-9 px-3 rounded-md border bg-background text-sm"><option value="">No client</option>{clients.map(c=><option key={c.id} value={c.id}>{c.company_name}</option>)}</select>
              <select value={form.assigned_to} onChange={e=>setForm({...form, assigned_to:e.target.value})} className="h-9 px-3 rounded-md border bg-background text-sm"><option value="">Unassigned</option>{staff.map(s=><option key={s.id} value={s.id}>{s.full_name}</option>)}</select>
              <select value={form.priority} onChange={e=>setForm({...form, priority:e.target.value})} className="h-9 px-3 rounded-md border bg-background text-sm">{["low","normal","high","urgent"].map(p=><option key={p}>{p}</option>)}</select>
              <select value={form.status} onChange={e=>setForm({...form, status:e.target.value})} className="h-9 px-3 rounded-md border bg-background text-sm capitalize">{["todo","in_progress","blocked","done"].map(s=><option key={s} value={s}>{s.replace(/_/g," ")}</option>)}</select>
              <input type="date" value={form.due_date} onChange={e=>setForm({...form, due_date:e.target.value})} className="col-span-2 h-9 px-3 rounded-md border bg-background text-sm" />
            </div>
            <button className="w-full h-10 rounded-md bg-primary text-primary-foreground text-sm font-medium">{form.id ? "Save changes" : "Create task"}</button>
          </form>
        </div>
      )}

      {detailId && <TaskDetail id={detailId} onClose={()=>setDetailId(null)} />}
    </div>
  );
}

function TaskDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { user } = useAuth();
  const [task, setTask] = useState<any>(null);
  const [comments, setComments] = useState<any[]>([]);
  const [text, setText] = useState("");

  async function load() {
    const [t, c] = await Promise.all([
      supabase.from("tasks").select("*, clients(company_name)").eq("id", id).maybeSingle(),
      supabase.from("task_comments").select("*").eq("task_id", id).order("created_at"),
    ]);
    let taskData: any = t.data;
    if (taskData?.assigned_to) {
      const { data: p } = await supabase.from("profiles").select("full_name").eq("id", taskData.assigned_to).maybeSingle();
      taskData = { ...taskData, profiles: p };
    }
    const commentRows = c.data ?? [];
    const authorIds = [...new Set(commentRows.map((r: any) => r.author_id).filter(Boolean))];
    let profMap = new Map<string, any>();
    if (authorIds.length) {
      const { data: profs } = await supabase.from("profiles").select("id, full_name").in("id", authorIds);
      profMap = new Map((profs ?? []).map((p: any) => [p.id, p]));
    }
    setTask(taskData);
    setComments(commentRows.map((r: any) => ({ ...r, profiles: r.author_id ? profMap.get(r.author_id) : null })));
  }
  useEffect(()=>{ load(); }, [id]);

  async function send() {
    if (!text.trim()) return;
    const { error } = await supabase.from("task_comments").insert({ task_id: id, body: text.trim(), author_id: user?.id });
    if (error) toast.error(error.message);
    else { setText(""); load();
      if (task?.assigned_to && task.assigned_to !== user?.id) {
        await supabase.from("notifications").insert({ user_id: task.assigned_to, type:"task_comment", title:"New comment on task", body: task.title });
      }
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} className="bg-card w-full max-w-lg rounded-lg p-5 max-h-[90vh] flex flex-col">
        <div className="flex justify-between items-start mb-3"><div><h2 className="font-semibold">{task?.title || "Loading…"}</h2><div className="text-xs text-muted-foreground">{task?.clients?.company_name} · {task?.profiles?.full_name || "Unassigned"}</div></div><button onClick={onClose}><X className="h-4 w-4" /></button></div>
        {task?.description && <p className="text-sm text-muted-foreground mb-3 whitespace-pre-wrap">{task.description}</p>}
        <div className="text-xs font-medium mb-2 border-t pt-3">Comments & collaboration</div>
        <div className="flex-1 overflow-auto space-y-2 mb-2">
          {comments.length === 0 && <div className="text-xs text-muted-foreground">No comments yet.</div>}
          {comments.map(c => (
            <div key={c.id} className="text-sm bg-muted/40 rounded p-2">
              <div className="text-xs text-muted-foreground">{c.profiles?.full_name || "Staff"} · {formatDate(c.created_at)}</div>
              <div className="whitespace-pre-wrap">{c.body}</div>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <input value={text} onChange={e=>setText(e.target.value)} onKeyDown={e=>{ if(e.key==="Enter") send(); }} placeholder="Add a comment…" className="flex-1 h-9 px-3 rounded-md border bg-background text-sm" />
          <button onClick={send} className="h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm inline-flex items-center gap-1"><Send className="h-3.5 w-3.5" /> Send</button>
        </div>
      </div>
    </div>
  );
}
