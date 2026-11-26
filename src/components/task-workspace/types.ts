// Shared constants and helpers for tasks.

export const TASK_STATUSES = ["todo", "in_progress", "waiting_on_client", "done"] as const;

// "blocked" is no longer offered, but any older record still reads properly.
export const STATUS_LABEL: Record<string, string> = {
  todo: "To do",
  in_progress: "In progress",
  waiting_on_client: "Waiting on client",
  blocked: "Blocked",
  done: "Done",
};

/** Waiting on the client (not on us): not counted as overdue against the assignee. */
export const isWaitingOnClient = (task: any) => task?.status === "waiting_on_client";

/** Whole days the task has been waiting on the client. */
export function waitingDays(task: any): number | null {
  if (!isWaitingOnClient(task) || !task.waiting_since) return null;
  return Math.max(0, Math.floor((Date.now() - new Date(task.waiting_since).getTime()) / 86400000));
}

/** The date to chase the client has arrived (or passed). */
export function chaseDue(task: any): boolean {
  if (!isWaitingOnClient(task) || !task.follow_up_on) return false;
  return String(task.follow_up_on).slice(0, 10) <= new Date().toISOString().slice(0, 10);
}

/** Runs the task: Director/Admin, the assignee, the giver or the supervisor. */
export function isLeadOf(task: any, userId?: string | null, isAdmin?: boolean): boolean {
  if (!task || !userId) return false;
  return !!isAdmin || task.assigned_to === userId || task.created_by === userId || task.supervisor_id === userId;
}

/** Supervisor side: may give guidance. */
export function isSupervisorOf(task: any, userId?: string | null, isAdmin?: boolean): boolean {
  if (!task || !userId) return false;
  return !!isAdmin || task.created_by === userId || task.supervisor_id === userId;
}

/** People to tell about something that happened on the task (never yourself). */
export function peopleToNotify(task: any, exceptUserId?: string | null): string[] {
  const ids = [task?.assigned_to, task?.supervisor_id, task?.created_by].filter(Boolean) as string[];
  return [...new Set(ids)].filter(id => id !== exceptUserId);
}

export function safeFileName(name: string): string {
  return name.replace(/[^\w.\-]+/g, "_").slice(-120) || "file";
}
