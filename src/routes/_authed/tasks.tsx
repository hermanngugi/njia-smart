import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { notifyUser } from "@/lib/notify";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Plus, X, Pencil, Printer } from "lucide-react";
import { formatDate, daysUntil, STATUS_COLORS } from "@/lib/format";
import { useAuth } from "@/lib/auth";
import { useLiveRefresh } from "@/hooks/use-live-refresh";
import { TaskWorkspace } from "@/components/task-workspace/task-workspace";
import { TASK_STATUSES, STATUS_LABEL, waitingDays, chaseDue, isClosed, isStale } from "@/components/task-workspace/types";
import { ReasonDialog } from "@/components/task-workspace/reason-dialog";
import { TeamView } from "@/components/task-workspace/team-view";
import { WaitingOnClientDialog } from "@/components/task-workspace/waiting-on-client-dialog";

export const Route = createFileRoute("/_authed/tasks")({
  component: TasksPage,
  validateSearch: (s: Record<string, unknown>) => ({
    status: typeof s.status === "string" ? s.status : undefined,
    overdue: s.overdue === true || s.overdue === "true" ? true : undefined,
    task: typeof s.task === "string" ? s.task : undefined,
    engagement: typeof s.engagement === "string" ? s.engagement : undefined,
  }),
});

const EMPTY = { id: "", title: "", description: "", client_id: "", assigned_to: "", priority: "normal", due_date: "", is_private: false };
const FIELD = "w-full h-9 px-3 rounded-md border bg-background text-sm text-foreground";
const GROUPS = ["Overdue", "This week", "Later", "Closed"] as const;

/** Which heading a task sits under. Waiting on the client is never counted as overdue. */
function groupOf(t: any): (typeof GROUPS)[number] {
  if (isClosed(t)) return "Closed";
  const d = daysUntil(t.due_date);
  if (d === null) return "Later";
  if (d < 0 && t.status !== "waiting_on_client") return "Overdue";
  const toSunday = (7 - new Date().getDay()) % 7;
  return d <= toSunday ? "This week" : "Later";
}

function TasksPage() {
  const { user, isAdmin } = useAuth();
  const { status: statusFilter, overdue: overdueFilter, task: taskParam, engagement: engagementId } = Route.useSearch();
  const [engagement, setEngagement] = useState<{ title: string; client_id: string | null } | null>(null);
  useEffect(() => {
    setEngagement(null);
    if (engagementId) supabase.from("engagements").select("title, client_id").eq("id", engagementId).maybeSingle().then(({ data }) => setEngagement(data));
  }, [engagementId]);
  const navigate = useNavigate({ from: Route.fullPath });
  const [rows, setRows] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [staff, setStaff] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [more, setMore] = useState(false);
  const [form, setForm] = useState<any>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [view, setView] = useState<"mine" | "all" | "team">(engagementId || statusFilter || overdueFilter ? "all" : "mine");
  const [steps, setSteps] = useState<any[]>([]);
  const [person, setPerson] = useState<string | null>(null);
  const [closing, setClosing] = useState<{ task: any; status: "done" | "cancelled" } | null>(null);
  const [waitingFor, setWaitingFor] = useState<{ id: string; title: string } | null>(null);

  async function load() {
    // The database decides what each person may see: Director/Admin get every
    // task, everyone else gets the tasks they are involved in.
    const [t, c, s, st] = await Promise.all([
      supabase.from("tasks").select("*, clients(company_name)").order("due_date", { ascending: true, nullsFirst: false }),
      supabase.from("clients").select("id, company_name").order("company_name"),
      supabase.from("profiles").select("id, full_name").order("full_name"),
      supabase.from("task_subtasks").select("task_id, assigned_to, done"),
    ]);
    if (t.error) toast.error(t.error.message);
    setRows(t.data ?? []); setClients(c.data ?? []); setStaff(s.data ?? []); setSteps(st.data ?? []);
  }
  useEffect(() => { load(); }, [user?.id]);
  useLiveRefresh(["tasks", "task_subtasks"], load);

  // Deep link from a notification: /tasks?task=<id> opens that task.
  useEffect(() => { if (taskParam) setDetailId(taskParam); }, [taskParam]);
  function closeWorkspace() {
    setDetailId(null);
    load();
    if (taskParam) navigate({ search: { status: statusFilter, overdue: overdueFilter, task: undefined, engagement: engagementId } });
  }

  const nameOf = (id?: string | null) => (id ? staff.find((p: any) => p.id === id)?.full_name : null) || null;

  function openNew() { setForm({ ...EMPTY, client_id: engagement?.client_id ?? "" }); setMore(false); setOpen(true); }
  function openEdit(r: any) {
    setForm({ id: r.id, title: r.title, description: r.description || "", client_id: r.client_id || "", assigned_to: r.assigned_to || "", priority: r.priority, due_date: r.due_date || "", is_private: !!r.is_private });
    setMore(true);
    setOpen(true);
  }

  async function tellAssignee(assignee: string, taskId: string, title: string, isNew: boolean) {
    if (assignee === user?.id) return;
    const me = nameOf(user?.id);
    await notifyUser({
      user_id: assignee,
      type: isNew ? "task_assigned" : "task_updated",
      title: isNew ? "New task assigned" : "Task updated",
      body: `${me ? `From ${me}: ` : ""}${title}`,
      link: `/tasks?task=${taskId}`,
    });
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    if (!form.title.trim()) return toast.error("Give the task a title.");
    const payload: any = {
      title: form.title.trim(), description: form.description.trim() || null,
      client_id: form.client_id || null, priority: form.priority, due_date: form.due_date || null,
    };
    const before = rows.find(r => r.id === form.id);
    if (!form.id || isAdmin || before?.created_by === user?.id) payload.is_private = form.is_private;
    const previous = form.id ? rows.find(r => r.id === form.id)?.assigned_to ?? null : null;
    // Anyone may choose the assignee of a new task; only Director/Admin may change it later.
    if (!form.id || isAdmin) payload.assigned_to = form.assigned_to || null;
    setSaving(true);
    // The id is made here because the database will not hand a new row back
    // (insert ... returning) to anyone but Director/Admin.
    const taskId: string = form.id || crypto.randomUUID();
    const { error } = form.id
      ? await supabase.from("tasks").update(payload).eq("id", taskId)
      : await supabase.from("tasks").insert({ ...payload, id: taskId, created_by: user?.id, engagement_id: engagementId ?? null, ...(engagementId ? { client_id: engagement?.client_id ?? null } : {}) });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(form.id ? "Task updated" : "Task created");
    const assignee = payload.assigned_to ?? previous;
    if (assignee) await tellAssignee(assignee, taskId, payload.title, !form.id || previous !== assignee);
    setOpen(false); load();
  }

  // Director/Admin only (also enforced in the database).
  async function reassign(id: string, newAssignee: string | null, title: string) {
    const { error } = await supabase.from("tasks").update({ assigned_to: newAssignee }).eq("id", id);
    if (error) { toast.error(error.message); return; }
    if (newAssignee) await tellAssignee(newAssignee, id, title, true);
    toast.success("Reassigned"); load();
  }

  const tellOthers = (task: any, type: string, title: string, body: string) =>
    [...new Set([task?.supervisor_id, task?.created_by, task?.assigned_to].filter(Boolean) as string[])]
      .filter(id => id !== user?.id)
      .forEach(id => notifyUser({ user_id: id, type, title, body, link: `/tasks?task=${task.id}` }));

  async function setStatus(task: any, status: string) {
    // "Waiting on client" asks what we are waiting for and when to chase first.
    if (status === "waiting_on_client") return setWaitingFor({ id: task.id, title: task.title });
    // Finishing or cancelling asks for a short note that stays on record.
    if (status === "done" || status === "cancelled") return setClosing({ task, status });
    const { error } = await supabase.from("tasks").update({ status: status as any }).eq("id", task.id);
    if (error) return toast.error(error.message);
    load();
  }

  async function confirmClose(note: string) {
    if (!closing) return;
    const { task, status } = closing;
    const patch: any = status === "done" ? { status, outcome: note } : { status, cancel_reason: note };
    const { error } = await supabase.from("tasks").update(patch).eq("id", task.id);
    if (error) { toast.error(error.message); return; }
    tellOthers(task, status === "done" ? "task_completed" : "task_cancelled", status === "done" ? "Task completed" : "Task cancelled", `${task.title} — ${note}`);
    setClosing(null);
    load();
  }

  async function confirmWaiting(d: { reason: string; followUpOn: string }) {
    if (!waitingFor) return;
    const { error } = await supabase.from("tasks")
      .update({ status: "waiting_on_client", waiting_reason: d.reason, follow_up_on: d.followUpOn || null } as any)
      .eq("id", waitingFor.id);
    if (error) { toast.error(error.message); return; }
    tellOthers(rows.find(r => r.id === waitingFor.id), "task_waiting", "Task waiting on client", `${waitingFor.title} — ${d.reason}`);
    setWaitingFor(null);
    load();
  }

  const hasMyStep = (id: string) => steps.some(x => x.task_id === id && x.assigned_to === user?.id && !x.done);
  const visible = rows.filter(r =>
    (person ? r.assigned_to === person : view !== "mine" || r.assigned_to === user?.id || (!isClosed(r) && hasMyStep(r.id))) &&
    (!engagementId || r.engagement_id === engagementId) &&
    (!statusFilter || r.status === statusFilter) &&
    (!overdueFilter || (!isClosed(r) && r.status !== "waiting_on_client" && r.is_overdue === true))
  );

  const progressOf = (t: any) => {
    const mine = steps.filter(x => x.task_id === t.id);
    return mine.length ? { done: mine.filter(x => x.done).length, total: mine.length } : null;
  };

  const row = (t: any) => (
    <tr key={t.id} className="border-b last:border-0 hover:bg-muted/30">
      <td className="py-2 px-3">
        <button onClick={() => setDetailId(t.id)} className={`font-medium hover:text-primary text-left ${t.status === "cancelled" ? "line-through" : ""}`}>{t.title}</button>
        <div className="text-[11px] text-muted-foreground">
          {[t.clients?.company_name, t.created_by !== t.assigned_to && nameOf(t.created_by) ? `from ${nameOf(t.created_by)}` : null].filter(Boolean).join(" · ")}
        </div>
        {!isClosed(t) && t.next_action && <div className="text-[11px] max-w-md truncate">Next: {t.next_action}</div>}
        {t.is_private && <span className="mr-1 text-[10px] px-1.5 py-0.5 rounded border">Private</span>}
        {(t.priority === "high" || t.priority === "urgent") && <span className={`mr-1 text-[10px] px-1.5 py-0.5 rounded capitalize ${STATUS_COLORS[t.priority]}`}>{t.priority}</span>}
        {t.needs_guidance && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">Needs help</span>}
      </td>
      <td className="pr-3 text-xs">
        {isAdmin ? (
          <select value={t.assigned_to || ""} onChange={e => reassign(t.id, e.target.value || null, t.title)} className="h-7 px-2 rounded text-xs border bg-background" aria-label="Assignee">
            <option value="">Unassigned</option>
            {staff.map((s: any) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
          </select>
        ) : (nameOf(t.assigned_to) ?? "Unassigned")}
      </td>
      <td className="pr-3 text-xs whitespace-nowrap">{formatDate(t.due_date)}</td>
      <td className="pr-3 text-xs whitespace-nowrap">
        {(() => { const p = progressOf(t); return p ? (
          <div className="w-24">
            <div>{p.done} of {p.total} steps</div>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden"><div className="h-full bg-primary" style={{ width: `${(p.done / p.total) * 100}%` }} /></div>
          </div>
        ) : null; })()}
        <div className="text-[11px] text-muted-foreground">{t.last_update_at ? `Updated ${formatDate(t.last_update_at)}` : "No update yet"}</div>
        {isStale(t) && <div className="text-[11px] font-semibold text-destructive">Update needed</div>}
      </td>
      <td className="pr-3">
        <select value={t.status} onChange={e => setStatus(t, e.target.value)} className={`h-7 px-2 rounded text-xs border bg-background ${STATUS_COLORS[t.status]}`} aria-label="Status">
          {!(TASK_STATUSES as readonly string[]).includes(t.status) && <option value={t.status}>{STATUS_LABEL[t.status] ?? t.status}</option>}
          {TASK_STATUSES.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
        {t.status === "waiting_on_client" && (
          <div className="text-[10px] mt-0.5 max-w-[11rem] text-amber-800 dark:text-amber-200">
            Waiting {waitingDays(t) ?? 0}d{t.waiting_reason ? ` · ${t.waiting_reason}` : ""}
            {chaseDue(t) && <span className="ml-1 font-semibold text-destructive">· chase now</span>}
          </div>
        )}
      </td>
      <td className="pr-2 text-right">
        {(isAdmin || t.created_by === user?.id) && !isClosed(t) && <button onClick={() => openEdit(t)} title="Edit" className="p-1 hover:text-primary"><Pencil className="h-3.5 w-3.5" /></button>}
      </td>
    </tr>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap justify-between items-center gap-3">
        <div>
          <h1 className="text-2xl font-bold">Tasks</h1>
          {engagementId && (
            <p className="text-sm text-muted-foreground">
              For audit <Link to="/audit/$id" params={{ id: engagementId }} className="font-medium text-primary hover:underline">{engagement?.title ?? "…"}</Link>. New tasks are linked to it.{" "}
              <Link to="/tasks" search={{} as any} className="hover:underline">Show all tasks</Link>
            </p>
          )}
          {(statusFilter || overdueFilter) && (
            <p className="text-sm text-muted-foreground">
              Filtered to <span className="font-medium text-foreground">{overdueFilter ? "overdue" : STATUS_LABEL[statusFilter!] ?? statusFilter}</span>{" "}
              <button onClick={() => navigate({ search: { status: undefined, overdue: undefined, task: undefined, engagement: engagementId } })} className="text-primary hover:underline">clear</button>
            </p>
          )}
        </div>
        <button onClick={openNew} disabled={!!engagementId && !engagement} className="h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm inline-flex items-center gap-2"><Plus className="h-4 w-4" /> Give task</button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 print:hidden">
        {([["mine", "My tasks"], ["all", "All tasks"], ["team", "Team report"]] as const).map(([k, label]) => (
          <button key={k} onClick={() => { setView(k); setPerson(null); }} className={`text-xs px-2.5 py-1 rounded-full border ${view === k && !person ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-muted"}`}>{label}</button>
        ))}
        {person && <button onClick={() => setPerson(null)} className="text-xs px-2.5 py-1 rounded-full border bg-primary text-primary-foreground">{nameOf(person)} ✕</button>}
        {view === "team" && !person && <button onClick={() => window.print()} className="ml-auto text-xs px-2.5 py-1 rounded-md border inline-flex items-center gap-1.5 hover:bg-muted"><Printer className="h-3.5 w-3.5" /> Print</button>}
      </div>

      {view === "team" && !person ? (
        <TeamView tasks={rows.filter(r => !engagementId || r.engagement_id === engagementId)} staff={staff} onPerson={setPerson} onTask={setDetailId} />
      ) : (
      <div className="bg-card border rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs text-muted-foreground border-b">
              <tr><th className="py-2 px-3">Task</th><th>Assignee</th><th>Due</th><th>Progress</th><th>Status</th><th></th></tr>
            </thead>
            {visible.length === 0 && <tbody><tr><td colSpan={6} className="py-10 text-center text-muted-foreground">No tasks.</td></tr></tbody>}
            {GROUPS.map(g => {
              const items = visible.filter(t => groupOf(t) === g);
              if (!items.length) return null;
              return (
                <tbody key={g}>
                  <tr className="border-b bg-muted/20"><th colSpan={6} className={`py-1.5 px-3 text-left text-xs font-semibold ${g === "Overdue" ? "text-destructive" : ""}`}>{g} ({items.length})</th></tr>
                  {items.map(row)}
                </tbody>
              );
            })}
          </table>
        </div>
      </div>
      )}

      {open && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setOpen(false)}>
          <form onClick={e => e.stopPropagation()} onSubmit={save} className="bg-card w-full max-w-md max-h-full overflow-y-auto rounded-lg p-6 space-y-3">
            <div className="flex justify-between"><h2 className="text-lg font-semibold">{form.id ? "Edit task" : "Give task"}</h2><button type="button" onClick={() => setOpen(false)} aria-label="Close"><X className="h-4 w-4" /></button></div>
            <input required placeholder="What needs to be done?" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} className={FIELD} />
            <label className="block text-xs text-muted-foreground">Assignee
              <select required={!form.id} disabled={!!form.id && !isAdmin} value={form.assigned_to} onChange={e => setForm({ ...form, assigned_to: e.target.value })} className={`mt-1 ${FIELD}`}>
                <option value="">Choose a person</option>
                {staff.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
              </select>
            </label>
            <label className="block text-xs text-muted-foreground">Due date
              <input type="date" required={!form.id} value={form.due_date} onChange={e => setForm({ ...form, due_date: e.target.value })} className={`mt-1 ${FIELD}`} />
            </label>
            <button type="button" onClick={() => setMore(!more)} className="text-xs text-primary hover:underline">{more ? "Less" : "More (client, priority, instructions, private)"}</button>
            {more && (
              <div className="space-y-3">
                <select value={form.client_id} onChange={e => setForm({ ...form, client_id: e.target.value })} className={FIELD} aria-label="Client"><option value="">No client</option>{clients.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}</select>
                <select value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })} className={`${FIELD} capitalize`} aria-label="Priority">{["low", "normal", "high", "urgent"].map(p => <option key={p}>{p}</option>)}</select>
                <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={form.is_private} onChange={e => setForm({ ...form, is_private: e.target.checked })} className="mt-1" /><span>Private: only the people involved and Director/Admin can see it</span></label>
                <textarea placeholder="Instructions" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} rows={4} className="w-full px-3 py-2 rounded-md border bg-background text-sm" />
              </div>
            )}
            <button disabled={saving} className="w-full h-10 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50">{form.id ? "Save changes" : "Create task"}</button>
          </form>
        </div>
      )}

      {detailId && <TaskWorkspace id={detailId} onClose={closeWorkspace} />}
      <ReasonDialog kind={closing?.status ?? null} taskTitle={closing?.task.title ?? ""} onCancel={() => setClosing(null)} onConfirm={confirmClose} />
      <WaitingOnClientDialog taskTitle={waitingFor ? waitingFor.title : null} onCancel={() => setWaitingFor(null)} onConfirm={confirmWaiting} />
    </div>
  );
}
