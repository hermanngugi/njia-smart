import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { notifyUser } from "@/lib/notify";
import { openStoredFile } from "@/lib/client-files";
import { useLiveRefresh } from "@/hooks/use-live-refresh";
import { isLeadOf, isSupervisorOf, peopleToNotify, safeFileName } from "./types";

const OUTPUT_BUCKET = "task-outputs";

// All loading, live updates and writes for one task's workspace.
export function useTaskWorkspace(taskId: string) {
  const { user, isAdmin } = useAuth();
  const [task, setTask] = useState<any>(null);
  const [subtasks, setSubtasks] = useState<any[]>([]);
  const [updates, setUpdates] = useState<any[]>([]);
  const [outputs, setOutputs] = useState<any[]>([]);
  const [staff, setStaff] = useState<{ id: string; full_name: string | null }[]>([]);
  const [loading, setLoading] = useState(true);
  const [missingSetup, setMissingSetup] = useState(false);
  const [busy, setBusy] = useState(false);

  async function load() {
    const [t, st, up, out, prof] = await Promise.all([
      supabase.from("tasks").select("*, clients(company_name)").eq("id", taskId).maybeSingle(),
      supabase.from("task_subtasks").select("*").eq("task_id", taskId).order("created_at"),
      supabase.from("task_comments").select("*").eq("task_id", taskId).order("created_at"),
      supabase.from("task_outputs").select("*").eq("task_id", taskId).order("created_at", { ascending: false }),
      supabase.from("profiles").select("id, full_name").order("full_name"),
    ]);
    // 42P01 / PGRST205 = the new tables don't exist yet (database update not run).
    const missing = [st, out].some((r: any) => r.error && (r.error.code === "42P01" || r.error.code === "PGRST205"));
    setMissingSetup(missing);
    if (t.error) toast.error(t.error.message);
    setTask(t.data ?? null);
    setSubtasks(missing ? [] : st.data ?? []);
    setUpdates((up.data ?? []) as any[]);
    setOutputs(missing ? [] : out.data ?? []);
    setStaff((prof.data ?? []) as any[]);
  }

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [taskId]);
  useLiveRefresh(["tasks", "task_comments", "task_subtasks", "task_outputs"], load);

  const nameOf = (id?: string | null) => (id ? staff.find(p => p.id === id)?.full_name ?? "Unknown" : "—");
  const isLead = isLeadOf(task, user?.id, isAdmin);
  const isSupervisor = isSupervisorOf(task, user?.id, isAdmin);
  const subtasksDone = subtasks.filter(s => s.done).length;

  // Who to tell when something happens on this task.
  const notifyTeam = (type: string, title: string, extraIds: string[] = []) => {
    if (!task) return;
    const ids = [...new Set([...peopleToNotify(task, user?.id), ...extraIds.filter(id => id !== user?.id)])];
    ids.forEach(id => notifyUser({ user_id: id, type, title, body: task.title, link: `/tasks?task=${taskId}` }));
  };

  async function setStatus(status: string, waiting?: { reason: string; followUpOn: string }) {
    const patch: any = { status };
    if (status === "waiting_on_client" && waiting) {
      patch.waiting_reason = waiting.reason;
      patch.follow_up_on = waiting.followUpOn || null;
    }
    const { error } = await supabase.from("tasks").update(patch).eq("id", taskId);
    if (error) return toast.error(error.message);
    if (status === "done") notifyTeam("task_completed", "Task completed");
    if (status === "waiting_on_client") notifyTeam("task_waiting", "Task waiting on client");
    load();
  }

  async function addSubtask(title: string) {
    if (!title.trim() || !user) return false;
    const { error } = await supabase.from("task_subtasks").insert({ task_id: taskId, title: title.trim(), created_by: user.id });
    if (error) { toast.error(error.message); return false; }
    load();
    return true;
  }

  async function toggleSubtask(s: any) {
    const { error } = await supabase.from("task_subtasks").update({ done: !s.done }).eq("id", s.id);
    if (error) toast.error(error.message); else load();
  }

  async function removeSubtask(s: any) {
    if (!confirm(`Remove "${s.title}"?`)) return;
    const { error } = await supabase.from("task_subtasks").delete().eq("id", s.id);
    if (error) toast.error(error.message); else load();
  }

  // A comment, or a request for help to whoever gave the task. When the giver (or
  // Director/Admin) replies to a request, the "Needs help" flag clears.
  async function postComment(body: string, needHelp = false) {
    const text = body.trim() || (needHelp ? "I need help with this task." : "");
    if (!text || !user) return false;
    const kind = needHelp ? "report" : task?.needs_guidance && isSupervisor ? "guidance" : "note";
    const { error } = await supabase.from("task_comments").insert({
      task_id: taskId, author_id: user.id, body: text, kind, ask_guidance: needHelp,
    });
    if (error) { toast.error(error.message); return false; }
    notifyTeam(`task_${kind}`, needHelp ? "Help needed on a task" : "New comment on a task");
    load();
    return true;
  }

  async function removeUpdate(id: string) {
    if (!confirm("Delete this comment?")) return;
    const { error } = await supabase.from("task_comments").delete().eq("id", id);
    if (error) toast.error(error.message); else load();
  }

  async function uploadOutput(file: File) {
    if (!user) return false;
    setBusy(true);
    const path = `${taskId}/${Date.now()}-${safeFileName(file.name)}`;
    const { error: upErr } = await supabase.storage.from(OUTPUT_BUCKET).upload(path, file);
    if (upErr) { setBusy(false); toast.error(upErr.message); return false; }
    const { error } = await supabase.from("task_outputs").insert({
      task_id: taskId, file_path: path, file_name: file.name, uploaded_by: user.id,
    });
    setBusy(false);
    if (error) {
      await supabase.storage.from(OUTPUT_BUCKET).remove([path]);
      toast.error(error.message);
      return false;
    }
    notifyTeam("task_output", "File added to a task");
    load();
    return true;
  }

  async function removeOutput(o: any) {
    if (!confirm(`Delete "${o.file_name}"?`)) return;
    const { error } = await supabase.from("task_outputs").delete().eq("id", o.id);
    if (error) return toast.error(error.message);
    await supabase.storage.from(OUTPUT_BUCKET).remove([o.file_path]);
    load();
  }

  const openOutput = (o: any) => openStoredFile(OUTPUT_BUCKET, o.file_path, 300);

  return {
    user, isAdmin, task, subtasks, updates, outputs, loading, missingSetup, busy,
    isLead, isSupervisor, subtasksDone, nameOf,
    setStatus, addSubtask, toggleSubtask, removeSubtask,
    postComment, removeUpdate, uploadOutput, removeOutput, openOutput,
  };
}

export type TaskWorkspaceCtx = ReturnType<typeof useTaskWorkspace>;
