import { useState } from "react";
import { formatDate, daysUntil } from "@/lib/format";
import { isClosed, isStale } from "./types";

/** Who is doing what, and what got finished: for follow-up and meetings. */
export function TeamView({ tasks, staff, onPerson, onTask }: {
  tasks: any[];
  staff: { id: string; full_name: string | null }[];
  onPerson: (id: string) => void;
  onTask: (id: string) => void;
}) {
  const [period, setPeriod] = useState<"week" | "month">("week");
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  if (period === "week") from.setDate(from.getDate() - ((from.getDay() + 6) % 7));
  else from.setDate(1);
  const completed = tasks.filter((t) => t.status === "done" && t.completed_at && new Date(t.completed_at) >= from);
  const nameOf = (id?: string | null) => staff.find((p) => p.id === id)?.full_name ?? "Unassigned";

  const people = staff.map((p) => {
    const open = tasks.filter((t) => t.assigned_to === p.id && !isClosed(t));
    return {
      ...p,
      open: open.length,
      overdue: open.filter((t) => t.status !== "waiting_on_client" && (daysUntil(t.due_date) ?? 0) < 0).length,
      waiting: open.filter((t) => t.status === "waiting_on_client").length,
      stale: open.filter(isStale).length,
      done: completed.filter((t) => t.assigned_to === p.id).length,
    };
  });

  return (
    <div className="space-y-4">
      <label className="text-xs text-muted-foreground">Completed during{" "}
        <select value={period} onChange={(e) => setPeriod(e.target.value as "week" | "month")} className="h-7 px-2 rounded border bg-background text-xs">
          <option value="week">this week</option>
          <option value="month">this month</option>
        </select>
      </label>
      <div className="bg-card border rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-xs text-muted-foreground border-b">
            <tr><th className="py-2 px-3">Person</th><th className="px-2">Open</th><th className="px-2">Overdue</th><th className="px-2">Waiting on client</th><th className="px-2">Update needed</th><th className="px-2">Completed</th></tr>
          </thead>
          <tbody>
            {people.map((p) => (
              <tr key={p.id} className="border-b last:border-0">
                <td className="py-2 px-3"><button onClick={() => onPerson(p.id)} className="font-medium hover:text-primary text-left">{p.full_name}</button></td>
                <td className="px-2">{p.open}</td>
                <td className={`px-2 ${p.overdue ? "text-destructive font-semibold" : ""}`}>{p.overdue}</td>
                <td className="px-2">{p.waiting}</td>
                <td className={`px-2 ${p.stale ? "text-destructive font-semibold" : ""}`}>{p.stale}</td>
                <td className="px-2">{p.done}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="bg-card border rounded-lg p-4">
        <h2 className="font-semibold text-sm mb-2">Completed ({completed.length})</h2>
        {completed.length === 0 && <p className="text-sm text-muted-foreground">Nothing completed in this period yet.</p>}
        <ul className="divide-y">
          {completed.map((t) => (
            <li key={t.id} className="py-2 text-sm">
              <button onClick={() => onTask(t.id)} className="font-medium hover:text-primary text-left">{t.title}</button>
              <div className="text-xs text-muted-foreground">{[nameOf(t.assigned_to), t.clients?.company_name, formatDate(t.completed_at)].filter(Boolean).join(" · ")}</div>
              {t.outcome && <div className="text-xs">{t.outcome}</div>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
