import { useRef, useState } from "react";
import { CheckCircle2, Circle, Download, FileText, LifeBuoy, Trash2, X } from "lucide-react";
import { STATUS_COLORS, formatDate, formatDateTime } from "@/lib/format";
import { useTaskWorkspace } from "./use-task-workspace";
import { TASK_STATUSES, STATUS_LABEL, chaseDue, waitingDays, isWaitingOnClient, isClosed, isStale } from "./types";
import { ReasonDialog, type ReasonKind } from "./reason-dialog";
import { WaitingOnClientDialog } from "./waiting-on-client-dialog";

const INPUT = "flex-1 min-w-0 h-9 px-3 rounded-md border bg-background text-sm";
const BUTTON = "h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm disabled:opacity-50";

// One task on one page: instructions, checklist, comments and files.
export function TaskWorkspace({ id, onClose }: { id: string; onClose: () => void }) {
  const {
    user, isAdmin, task, subtasks, updates, outputs, loading, missingSetup, busy, isLead, subtasksDone, nameOf,
    setStatus, postUpdate, takeOver, staff, addSubtask, toggleSubtask, removeSubtask, postComment, removeUpdate, uploadOutput, removeOutput, openOutput,
  } = useTaskWorkspace(id);
  const [item, setItem] = useState("");
  const [comment, setComment] = useState("");
  const [sending, setSending] = useState(false);
  const [askWaiting, setAskWaiting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [stepDue, setStepDue] = useState("");
  const [stepOwner, setStepOwner] = useState("");
  const [progressText, setProgressText] = useState("");
  const [nextText, setNextText] = useState("");
  const [reasonFor, setReasonFor] = useState<ReasonKind | null>(null);

  const open = !!task && !isClosed(task);
  const canTakeOver = open && task.assigned_to !== user?.id;
  const lastUpdate = [...updates].reverse().find(u => u.kind === "update");
  const today = new Date().toLocaleDateString("en-CA");

  async function saveUpdate(e: React.FormEvent) {
    e.preventDefault();
    if (sending || !progressText.trim()) return;
    setSending(true);
    if (await postUpdate(progressText, nextText)) { setProgressText(""); setNextText(""); }
    setSending(false);
  }
  const giver = task?.supervisor_id || task?.created_by;
  const canAskHelp = !!task && task.assigned_to === user?.id && !!giver && giver !== user?.id && !task.needs_guidance && task.status !== "done";

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (await addSubtask(item, stepDue, stepOwner)) { setItem(""); setStepDue(""); }
  }
  async function send(needHelp: boolean) {
    if (sending) return;
    setSending(true);
    if (await postComment(comment, needHelp)) setComment("");
    setSending(false);
  }
  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) await uploadOutput(file);
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex justify-end" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="bg-card w-full max-w-2xl h-full flex flex-col shadow-xl animate-fade-in">
        <div className="p-4 border-b grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold break-words">{task?.title || (loading ? "Loading…" : "Task not found")}</h2>
            {task && (
              <div className="text-xs text-muted-foreground mt-0.5">
                {task.clients?.company_name ? `${task.clients.company_name} · ` : ""}
                {nameOf(task.assigned_to)}
                {task.created_by && task.created_by !== task.assigned_to ? ` · from ${nameOf(task.created_by)}` : ""}
                {task.due_date ? ` · due ${formatDate(task.due_date)}` : ""}
                {task.priority !== "normal" ? ` · ${task.priority} priority` : ""}
              </div>
            )}
          </div>
          <button onClick={onClose} className="p-1 hover:text-primary" title="Close"><X className="h-5 w-5" /></button>
        </div>

        {!task && !loading && <p className="p-4 text-sm text-muted-foreground">This task was not found, or you do not have access to it.</p>}

        {task && (
          <div className="flex-1 overflow-y-auto p-4 space-y-6">
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={task.status}
                disabled={!isLead}
                onChange={e => {
                  const v = e.target.value;
                  if (v === "waiting_on_client") setAskWaiting(true);
                  else if (v === "done" || v === "cancelled") setReasonFor(v);
                  else setStatus(v);
                }}
                className={`h-8 px-2 rounded text-xs border bg-background ${STATUS_COLORS[task.status] ?? ""}`}
                aria-label="Status"
              >
                {!(TASK_STATUSES as readonly string[]).includes(task.status) && <option value={task.status}>{STATUS_LABEL[task.status] ?? task.status}</option>}
                {TASK_STATUSES.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
              </select>
              {canAskHelp && (
                <button onClick={() => send(true)} disabled={sending} title="Anything typed in the comment box is sent with the request" className="h-8 px-3 rounded-md border text-xs inline-flex items-center gap-1.5 hover:bg-muted">
                  <LifeBuoy className="h-3.5 w-3.5" /> Need help
                </button>
              )}
              {canTakeOver && <button onClick={() => setReasonFor("takeover")} className="h-8 px-3 rounded-md border text-xs hover:bg-muted">Take over</button>}
              {task.is_private && <span className="text-xs px-2 py-0.5 rounded-full border">Private</span>}
              {isStale(task) && <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200">No recent update</span>}
              {task.needs_guidance && <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">Needs help</span>}
            </div>

            {isWaitingOnClient(task) && (
              <div className="rounded-md bg-amber-50 text-amber-900 dark:bg-amber-900/20 dark:text-amber-100 px-3 py-2 text-xs">
                Waiting on client for {waitingDays(task) ?? 0} day(s){task.waiting_reason ? ` — ${task.waiting_reason}` : ""}
                {task.follow_up_on && <> · chase {formatDate(task.follow_up_on)}{chaseDue(task) && <span className="ml-1 font-semibold text-destructive">(chase now)</span>}</>}
              </div>
            )}

            <section className="rounded-lg border bg-muted/30 p-3 space-y-2">
              <h3 className="text-sm font-semibold">Handover</h3>
              <div className="text-sm"><span className="text-muted-foreground">Where it stands: </span><span className="whitespace-pre-wrap">{task.handover_note || "No update yet."}</span></div>
              <div className="text-sm"><span className="text-muted-foreground">Next action: </span>{task.next_action || "Not stated."}</div>
              {lastUpdate && <div className="text-xs text-muted-foreground">Updated by {nameOf(lastUpdate.author_id)} · {formatDateTime(lastUpdate.created_at)}</div>}
              {task.status === "done" && task.outcome && <div className="text-sm"><span className="text-muted-foreground">Outcome: </span>{task.outcome}</div>}
              {task.status === "cancelled" && task.cancel_reason && <div className="text-sm"><span className="text-muted-foreground">Cancelled because: </span>{task.cancel_reason}</div>}
              {isLead && open && (
                <form onSubmit={saveUpdate} className="space-y-2 pt-1">
                  <textarea required rows={2} value={progressText} onChange={e => setProgressText(e.target.value)} placeholder="What have you done, and where does it stand?" className="w-full px-3 py-2 rounded-md border bg-background text-sm" />
                  <div className="flex gap-2">
                    <input required value={nextText} onChange={e => setNextText(e.target.value)} placeholder="What happens next?" className={INPUT} />
                    <button disabled={sending} className={BUTTON}>Post update</button>
                  </div>
                </form>
              )}
            </section>

            <section>
              <h3 className="text-sm font-semibold mb-1">Instructions</h3>
              <p className="text-sm whitespace-pre-wrap text-muted-foreground">{task.description || "No instructions."}</p>
            </section>

            {missingSetup && <p className="text-sm text-amber-700">Checklist and files are unavailable until your admin runs the latest database update.</p>}

            <section className="space-y-2">
              <h3 className="text-sm font-semibold">Steps{subtasks.length > 0 && <span className="ml-2 font-normal text-muted-foreground">{subtasksDone} of {subtasks.length}</span>}</h3>
              <ul className="space-y-1">
                {subtasks.map(s => (
                  <li key={s.id} className="flex items-center gap-2 text-sm">
                    <button onClick={() => toggleSubtask(s)} disabled={!isLead && s.assigned_to !== user?.id} title={s.done ? "Mark as not done" : "Mark as done"} className="disabled:opacity-50">
                      {s.done ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> : <Circle className="h-5 w-5 text-muted-foreground" />}
                    </button>
                    <span className={`flex-1 min-w-0 break-words ${s.done ? "line-through text-muted-foreground" : ""}`}>{s.title}</span>
                    <span className={`text-xs text-right ${!s.done && s.due_date && s.due_date < today ? "text-destructive font-medium" : "text-muted-foreground"}`}>
                      {s.assigned_to && s.assigned_to !== task.assigned_to ? `${nameOf(s.assigned_to)} · ` : ""}{s.due_date ? formatDate(s.due_date) : ""}
                    </span>
                    {isLead && <button onClick={() => removeSubtask(s)} title="Remove" className="p-1 text-muted-foreground hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>}
                  </li>
                ))}
              </ul>
              {isLead && open && (
                <form onSubmit={add} className="flex flex-wrap gap-2">
                  <input required value={item} onChange={e => setItem(e.target.value)} placeholder="Break it down: add a step" className={`${INPUT} basis-full sm:basis-0`} />
                  <input type="date" value={stepDue} max={task.due_date ?? undefined} onChange={e => setStepDue(e.target.value)} className="h-9 px-2 rounded-md border bg-background text-sm" aria-label="Step due date" />
                  <select value={stepOwner || task.assigned_to || ""} onChange={e => setStepOwner(e.target.value)} className="h-9 px-2 rounded-md border bg-background text-sm max-w-[10rem]" aria-label="Step owner">
                    {staff.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                  </select>
                  <button className={BUTTON}>Add</button>
                </form>
              )}
            </section>

            <section className="space-y-2">
              <h3 className="text-sm font-semibold">Files</h3>
              <ul className="space-y-1">
                {outputs.map(o => (
                  <li key={o.id} className="flex items-center gap-2 text-sm">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    <span className="flex-1 min-w-0 break-all">{o.file_name}</span>
                    <button onClick={() => openOutput(o)} title="Open / download" className="p-1 hover:text-primary"><Download className="h-4 w-4" /></button>
                    {(isLead || o.uploaded_by === user?.id) && <button onClick={() => removeOutput(o)} title="Delete" className="p-1 hover:text-destructive"><Trash2 className="h-4 w-4" /></button>}
                  </li>
                ))}
              </ul>
              <input ref={fileRef} type="file" onChange={upload} disabled={busy} className="block w-full text-sm" aria-label="Add a file" />
              {busy && <p className="text-xs text-muted-foreground">Uploading…</p>}
            </section>

            <section className="space-y-2">
              <h3 className="text-sm font-semibold">Activity</h3>
              <form onSubmit={e => { e.preventDefault(); send(false); }} className="flex gap-2">
                <input required value={comment} onChange={e => setComment(e.target.value)} placeholder="Write a comment" className={INPUT} />
                <button disabled={sending} className={BUTTON}>Post</button>
              </form>
              <ul className="space-y-2">
                {[...updates].reverse().map(u => u.kind === "system" ? (
                  <li key={u.id} className="text-xs text-muted-foreground border-l-2 pl-3">
                    {u.body}{u.author_id ? ` · by ${nameOf(u.author_id)}` : ""} · {formatDateTime(u.created_at)}
                  </li>
                ) : (
                  <li key={u.id} className="rounded-lg border p-3">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{nameOf(u.author_id)} · {formatDateTime(u.created_at)}</span>
                      {u.kind === "update" && <span className="font-medium text-primary">progress update</span>}
                      {u.ask_guidance && <span className="text-amber-700 dark:text-amber-300">asked for help</span>}
                      {u.kind !== "update" && (u.author_id === user?.id || isAdmin) && <button onClick={() => removeUpdate(u.id)} title="Delete" className="ml-auto p-1 hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>}
                    </div>
                    <div className="mt-1 text-sm whitespace-pre-wrap">{u.body}</div>
                    {u.next_action && <div className="text-xs text-muted-foreground mt-1">Next: {u.next_action}</div>}
                  </li>
                ))}
              </ul>
            </section>
          </div>
        )}

        <ReasonDialog
          kind={reasonFor}
          taskTitle={task?.title ?? ""}
          onCancel={() => setReasonFor(null)}
          onConfirm={async text => {
            if (reasonFor === "takeover") await takeOver(text);
            else if (reasonFor) await setStatus(reasonFor, undefined, text);
            setReasonFor(null);
          }}
        />
        <WaitingOnClientDialog
          taskTitle={askWaiting ? (task?.title ?? "") : null}
          onCancel={() => setAskWaiting(false)}
          onConfirm={async d => { await setStatus("waiting_on_client", d); setAskWaiting(false); }}
        />
      </div>
    </div>
  );
}
