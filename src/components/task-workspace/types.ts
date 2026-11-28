// Shared constants and helpers for tasks.

export const TASK_STATUSES = ["todo", "in_progress", "waiting_on_client", "done", "cancelled"] as const;

// "blocked" is no longer offered, but any older record still reads properly.
export const STATUS_LABEL: Record<string, string> = {
  todo: "To do",
  in_progress: "In progress",
  waiting_on_client: "Waiting on client",
  blocked: "Blocked",
  done: "Done",
  cancelled: "Cancelled",
};

export const isClosed = (task: any) => task?.status === "done" || task?.status === "cancelled";

/** Monday-to-Friday days gone by since a timestamp. */
export function workingDaysSince(iso?: string | null): number {
  if (!iso) return 0;
  const day = new Date(iso);
  day.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let n = 0;
  while (day < today) {
    day.setDate(day.getDate() + 1);
    if (day.getDay() !== 0 && day.getDay() !== 6) n++;
  }
  return n;
}

/** In progress with no progress update or step change for 3 working days. */
export const isStale = (task: any) => task?.status === "in_progress" && workingDaysSince(task.last_update_at ?? task.created_at) >= 3;

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
