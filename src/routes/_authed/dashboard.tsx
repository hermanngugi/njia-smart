import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Users, ClipboardCheck, Receipt, AlertTriangle, CheckCircle2, ListTodo, CalendarClock, UserCheck, Headset } from "lucide-react";
import { formatDate, daysUntil } from "@/lib/format";
import { useAuth } from "@/lib/auth";
import {
  ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid, Cell,
} from "recharts";

export const Route = createFileRoute("/_authed/dashboard")({ component: Dashboard });

const COLORS = ["#363D97", "#F14B24", "#10b981", "#f59e0b", "#8b5cf6", "#ef4444", "#06b6d4", "#64748b"];

function Kpi({ icon: Icon, label, value, sub, tone, to }: any) {
  const content = (
    <div className="bg-card rounded-lg border p-4 h-full hover:border-primary/60 hover:shadow-sm transition">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider">{label}</span>
        <Icon className={`h-4 w-4 ${tone ?? "text-muted-foreground"}`} />
      </div>
      <div className="mt-2 text-2xl font-bold">{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
    </div>
  );
  return to ? <Link to={to}>{content}</Link> : content;
}

// ICT Service Desk alert card — shown only to the ICT service-desk team
// (Amos, Herman, ...) and Director/Admin, so new tickets are seen straight
// away. Updates live as tickets are raised.
function IctDeskCard() {
  const { user, access } = useAuth();
  const [isTeam, setIsTeam] = useState(false);
  const [open, setOpen] = useState<any[]>([]);
  const fullAccess = access("ict_service_desk") === "full";

  async function load() {
    if (!user) return;
    const [team, tickets] = await Promise.all([
      supabase.from("ict_service_desk_team").select("user_id").eq("user_id", user.id).maybeSingle(),
      supabase.from("ict_tickets").select("id, ticket_number, title, priority, status, assigned_to, created_at")
        .not("status", "in", "(Resolved,Closed)").order("created_at", { ascending: false }),
    ]);
    setIsTeam(!!team.data);
    setOpen((tickets.data as any[]) ?? []);
  }
  useEffect(() => { load(); }, [user?.id]);
  useEffect(() => {
    const ch = supabase.channel("dash-ict-tickets")
      .on("postgres_changes", { event: "*", schema: "public", table: "ict_tickets" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user?.id]);

  if (!isTeam && !fullAccess) return null;

  const critical = open.filter((t) => t.priority === "Critical").length;
  const mine = open.filter((t) => t.assigned_to === user?.id).length;
  const unassigned = open.filter((t) => !t.assigned_to).length;
  const newest = open.slice(0, 5);

  return (
    <div className={`bg-card border rounded-lg p-4 ${critical > 0 ? "border-destructive/60" : ""}`}>
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold inline-flex items-center gap-1.5"><Headset className="h-4 w-4" /> ICT Service Desk</h2>
        <Link to="/ict-service-desk" className="text-xs text-primary hover:underline">Open service desk →</Link>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3 text-center">
        <div><div className="text-2xl font-bold">{open.length}</div><div className="text-xs text-muted-foreground">Open tickets</div></div>
        <div><div className={`text-2xl font-bold ${critical > 0 ? "text-destructive" : ""}`}>{critical}</div><div className="text-xs text-muted-foreground">Critical</div></div>
        <div><div className="text-2xl font-bold">{unassigned}</div><div className="text-xs text-muted-foreground">Unassigned</div></div>
        <div><div className="text-2xl font-bold">{mine}</div><div className="text-xs text-muted-foreground">Assigned to me</div></div>
      </div>
      {newest.length === 0 ? (
        <div className="text-sm text-muted-foreground">No open tickets.</div>
      ) : (
        <ul className="divide-y text-sm">
          {newest.map((t) => (
            <li key={t.id} className="py-1.5 flex items-center justify-between gap-2">
              <Link to="/ict-service-desk" className="truncate hover:underline">
                <span className="text-xs text-muted-foreground mr-1.5">{t.ticket_number}</span>{t.title}
              </Link>
              <span className={`text-xs shrink-0 ${t.priority === "Critical" ? "text-destructive font-medium" : "text-muted-foreground"}`}>{t.priority ?? "—"}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Dashboard() {
  const { user, isAdmin } = useAuth();
  const [stats, setStats] = useState({ clients: 0, pending: 0, overdue: 0, completed: 0, staff: 0 });
  const [overdueByType, setOverdueByType] = useState<{ name: string; value: number }[]>([]);
  const [tasksByStatus, setTasksByStatus] = useState<{ name: string; value: number }[]>([]);
  const [workload, setWorkload] = useState<{ name: string; tasks: number; filings: number; overdue: number }[]>([]);

  const [myTasks, setMyTasks] = useState<any[]>([]);
  const [myFilings, setMyFilings] = useState<any[]>([]);
  const [myApprovals, setMyApprovals] = useState<any[]>([]);
  const [myLeave, setMyLeave] = useState<any[]>([]);

  useEffect(() => {
    (async () => {
      const [c, pendingTax, overdueTasks, completedTasks, staff, taxOpen, allTasks] = await Promise.all([
        supabase.from("clients").select("id", { count: "exact", head: true }),
        supabase.from("tax_returns").select("id", { count: "exact", head: true }).in("status", ["pending", "in_progress"]),
        supabase.from("tasks").select("id", { count: "exact", head: true }).eq("is_overdue", true),
        supabase.from("tasks").select("id", { count: "exact", head: true }).eq("status", "done"),
        supabase.from("profiles").select("id, full_name"),
        supabase.from("tax_returns").select("return_type, due_date, status, assigned_to").neq("status", "filed"),
        supabase.from("tasks").select("status, assigned_to, is_overdue"),
      ]);
      setStats({
        clients: c.count ?? 0,
        pending: pendingTax.count ?? 0,
        overdue: overdueTasks.count ?? 0,
        completed: completedTasks.count ?? 0,
        staff: (staff.data ?? []).length,
      });

      // Overdue filings by tax type — what's actually late, broken down so
      // it's obvious where to focus first.
      const today = new Date();
      const overdueCounts: Record<string, number> = {};
      (taxOpen.data ?? []).forEach((r: any) => {
        if (r.due_date && new Date(r.due_date) < today) {
          overdueCounts[r.return_type] = (overdueCounts[r.return_type] ?? 0) + 1;
        }
      });
      setOverdueByType(Object.entries(overdueCounts).map(([name, value]) => ({ name: name.replace(/_/g, " "), value })));

      // Open tasks by status.
      const statusCounts: Record<string, number> = {};
      (allTasks.data ?? []).forEach((t: any) => { statusCounts[t.status] = (statusCounts[t.status] ?? 0) + 1; });
      setTasksByStatus(Object.entries(statusCounts).map(([name, value]) => ({ name: name.replace(/_/g, " "), value })));

      // Per-staff workload — who's carrying what, at a glance (admin only).
      const staffMap = new Map((staff.data ?? []).map((s: any) => [s.id, s.full_name]));
      const wl: Record<string, { tasks: number; filings: number; overdue: number }> = {};
      (allTasks.data ?? []).forEach((t: any) => {
        if (!t.assigned_to || t.status === "done") return;
        wl[t.assigned_to] ??= { tasks: 0, filings: 0, overdue: 0 };
        wl[t.assigned_to].tasks++;
        if (t.is_overdue) wl[t.assigned_to].overdue++;
      });
      (taxOpen.data ?? []).forEach((r: any) => {
        if (!r.assigned_to) return;
        wl[r.assigned_to] ??= { tasks: 0, filings: 0, overdue: 0 };
        wl[r.assigned_to].filings++;
        if (r.due_date && new Date(r.due_date) < today) wl[r.assigned_to].overdue++;
      });
      setWorkload(
        Object.entries(wl)
          .map(([uid, v]) => ({ name: staffMap.get(uid) ?? "Unknown", ...v }))
          .sort((a, b) => (b.tasks + b.filings) - (a.tasks + a.filings))
          .slice(0, 8)
      );

      if (user?.id) {
        const [mt, mf, la] = await Promise.all([
          supabase.from("tasks").select("id, title, due_date, priority, status").eq("assigned_to", user.id).neq("status", "done").order("due_date").limit(6),
          supabase.from("tax_returns").select("id, return_type, due_date, status, clients(company_name)").eq("assigned_to", user.id).neq("status", "filed").order("due_date").limit(6),
          supabase.from("leave_balances").select("*").eq("employee_id", user.id),
        ]);
        setMyTasks(mt.data ?? []);
        setMyFilings(mf.data ?? []);
        setMyLeave(la.data ?? []);

        // Pending leave approvals I own — silently skipped if the HR module
        // isn't set up yet (query just comes back empty/errors).
        const emp = await supabase.from("hr_employment").select("employee_id").eq("manager_id", user.id);
        const reportIds = (emp.data ?? []).map((e: any) => e.employee_id);
        if (isAdmin || reportIds.length > 0) {
          let q = supabase.from("leave_requests").select("id, employee_id, start_date, end_date, days, profiles!leave_requests_employee_id_fkey(full_name)").eq("status", "pending");
          if (!isAdmin) q = q.in("employee_id", reportIds);
          const pend = await q.limit(6);
          setMyApprovals(pend.data ?? []);
        }
      }
    })();
  }, [user?.id, isAdmin]);

  const summary = stats.overdue > 0
    ? `Heads up — ${stats.overdue} task${stats.overdue > 1 ? "s are" : " is"} overdue. ${stats.pending} tax return${stats.pending !== 1 ? "s" : ""} pending across ${stats.clients} client${stats.clients !== 1 ? "s" : ""}.`
    : `All clear on overdue items. ${stats.pending} pending tax return${stats.pending !== 1 ? "s" : ""}, ${stats.completed} task${stats.completed !== 1 ? "s" : ""} completed.`;

  const myOpenCount = myTasks.length + myFilings.length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">{summary}</p>
      </div>

      <div className="grid gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
        <Kpi icon={Users} label="Clients" value={stats.clients} to="/clients" />
        <Kpi icon={Receipt} label="Pending Tax" value={stats.pending} tone="text-primary" to="/tax" />
        <Kpi icon={AlertTriangle} label="Overdue" value={stats.overdue} tone="text-destructive" to="/tasks" />
        <Kpi icon={CheckCircle2} label="Done Tasks" value={stats.completed} tone="text-emerald-600" to="/tasks" />
        <Kpi icon={ClipboardCheck} label="Staff" value={stats.staff} to="/team" />
        <Kpi icon={ListTodo} label="My Open Items" value={myOpenCount} tone="text-accent" />
      </div>

      <IctDeskCard />

      {/* My day — what this person specifically needs to look at */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="bg-card border rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold inline-flex items-center gap-1.5"><ListTodo className="h-4 w-4" /> My tasks</h2>
            <Link to="/tasks" className="text-xs text-primary hover:underline">View all →</Link>
          </div>
          {myTasks.length === 0 && <p className="text-sm text-muted-foreground">Nothing assigned to you right now.</p>}
          <div className="space-y-1">
            {myTasks.map((t: any) => {
              const d = daysUntil(t.due_date);
              return (
                <div key={t.id} className="flex items-center justify-between p-2 rounded hover:bg-muted text-sm">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{t.title}</div>
                    <div className="text-xs text-muted-foreground capitalize">{t.priority} priority · {t.status.replace(/_/g, " ")}</div>
                  </div>
                  {t.due_date && (
                    <span className={`text-xs shrink-0 ${d !== null && d < 0 ? "text-destructive" : d !== null && d <= 2 ? "text-amber-600" : "text-muted-foreground"}`}>
                      {d! < 0 ? `${Math.abs(d!)}d overdue` : d === 0 ? "Today" : `in ${d}d`}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="bg-card border rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold inline-flex items-center gap-1.5"><Receipt className="h-4 w-4" /> My tax filings</h2>
            <Link to="/tax" className="text-xs text-primary hover:underline">View all →</Link>
          </div>
          {myFilings.length === 0 && <p className="text-sm text-muted-foreground">No filings assigned to you.</p>}
          <div className="space-y-1">
            {myFilings.map((r: any) => {
              const d = daysUntil(r.due_date);
              return (
                <Link key={r.id} to="/tax/$type" params={{ type: r.return_type }} className="flex items-center justify-between p-2 rounded hover:bg-muted text-sm">
                  <div className="min-w-0">
                    <div className="font-medium uppercase truncate">{r.return_type}</div>
                    <div className="text-xs text-muted-foreground truncate">{r.clients?.company_name ?? "—"}</div>
                  </div>
                  <span className={`text-xs shrink-0 ${d !== null && d < 0 ? "text-destructive" : d !== null && d <= 3 ? "text-amber-600" : "text-muted-foreground"}`}>
                    {d === null ? formatDate(r.due_date) : d < 0 ? `${Math.abs(d)}d overdue` : d === 0 ? "Today" : `in ${d}d`}
                  </span>
                </Link>
              );
            })}
          </div>
        </div>

        {(myApprovals.length > 0 || myLeave.length > 0) && (
          <div className="bg-card border rounded-lg p-4">
            <h2 className="font-semibold mb-3 inline-flex items-center gap-1.5"><UserCheck className="h-4 w-4" /> Leave approvals waiting on you</h2>
            {myApprovals.length === 0 ? <p className="text-sm text-muted-foreground">Nothing pending.</p> : (
              <div className="space-y-1">
                {myApprovals.map((r: any) => (
                  <Link key={r.id} to="/hr" className="flex items-center justify-between p-2 rounded hover:bg-muted text-sm">
                    <span>{r.profiles?.full_name ?? "—"}</span>
                    <span className="text-xs text-muted-foreground">{formatDate(r.start_date)} – {formatDate(r.end_date)} ({r.days}d)</span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}

        {myLeave.length > 0 && (
          <div className="bg-card border rounded-lg p-4">
            <h2 className="font-semibold mb-3 inline-flex items-center gap-1.5"><CalendarClock className="h-4 w-4" /> My leave balance</h2>
            <div className="grid grid-cols-3 gap-2">
              {myLeave.map((b: any) => (
                <div key={b.leave_type_id} className="text-center bg-muted/30 rounded p-2">
                  <div className="text-lg font-bold">{b.remaining_days}</div>
                  <div className="text-[11px] text-muted-foreground">{b.leave_type_name}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Firm-wide reports */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="bg-card border rounded-lg p-4">
          <h2 className="font-semibold mb-3">Overdue filings by type</h2>
          {overdueByType.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing overdue — nice work.</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={overdueByType} layout="vertical" margin={{ left: 16 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" allowDecimals={false} fontSize={11} />
                <YAxis type="category" dataKey="name" width={90} fontSize={11} className="capitalize" />
                <Tooltip />
                <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                  {overdueByType.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="bg-card border rounded-lg p-4">
          <h2 className="font-semibold mb-3">Open tasks by status</h2>
          {tasksByStatus.length === 0 ? (
            <p className="text-sm text-muted-foreground">No tasks yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={tasksByStatus}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" fontSize={11} className="capitalize" />
                <YAxis allowDecimals={false} fontSize={11} />
                <Tooltip />
                <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                  {tasksByStatus.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {isAdmin && workload.length > 0 && (
        <div className="bg-card border rounded-lg p-4">
          <h2 className="font-semibold mb-3">Team workload</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground border-b">
                <tr><th className="py-2">Staff</th><th>Open tasks</th><th>Open filings</th><th>Overdue</th></tr>
              </thead>
              <tbody>
                {workload.map(w => (
                  <tr key={w.name} className="border-b last:border-0">
                    <td className="py-2 font-medium">{w.name}</td>
                    <td>{w.tasks}</td>
                    <td>{w.filings}</td>
                    <td className={w.overdue > 0 ? "text-destructive font-medium" : ""}>{w.overdue}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
