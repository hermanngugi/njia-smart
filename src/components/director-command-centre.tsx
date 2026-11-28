import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { useLiveRefresh } from "@/hooks/use-live-refresh";
import { formatDate } from "@/lib/format";
import {
  Users, ClipboardCheck, Briefcase, UserCheck, FileText, Wallet, TrendingUp, AlertCircle,
  CheckCircle2, XCircle,
} from "lucide-react";

/**
 * Director dashboard — navigation-first command centre.
 *
 * Every figure here is a shortcut into the module that owns it; nothing is
 * re-implemented. Totals use the same maths as /accounts, staff opens the HR
 * directory, engagements open their own module, and leave requests are
 * decided through the same `decide_leave_request` RPC the HR Approvals tab uses.
 */

function money(n: number) {
  return "KES " + Number(n || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const tileCls = "block bg-card rounded-lg border p-4 h-full hover:border-primary/60 hover:shadow-sm transition";
const labelCls = "text-xs text-muted-foreground font-medium uppercase tracking-wider";

// Active engagements live in several modules; each chip opens its own module.
const ENGAGEMENT_LINES = [
  { label: "Audit", to: "/audit", module: "audit" },
  { label: "Advisory", to: "/advisory", module: "advisory" },
  { label: "Outsourced Accounting", to: "/outsourced-accounting", module: "outsourced_accounting" },
  { label: "Payroll", to: "/payroll-management", module: "payroll_management" },
  { label: "Financial Business Mgmt", to: "/financial-business-management", module: "financial_business_management" },
  { label: "ICT", to: "/ict", module: "ict_service_desk" },
] as const;

// These modules share the service-module page, which understands ?tab=projects&filter=active.
const SERVICE_MODULES: string[] = ["outsourced_accounting", "payroll_management", "financial_business_management", "ict"];

export function DirectorCommandCentre() {
  const { user, access } = useAuth();
  const [fin, setFin] = useState<{ billed: number; collected: number; outstanding: number; overdue: number } | null>(null);
  const [clients, setClients] = useState<number | null>(null);
  const [staff, setStaff] = useState<number | null>(null);
  const [engagements, setEngagements] = useState<Record<string, number>>({});
  const [pending, setPending] = useState<any[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    const count = (q: any) => q.then((r: any) => r.count ?? 0);
    const open = (t: string) => supabase.from(t as any).select("id", { count: "exact", head: true }).neq("status", "completed");

    // Invoices, paged so a large book isn't cut off at the 1000-row default.
    const invoices: any[] = [];
    for (let from = 0; ; from += 1000) {
      const { data } = await supabase.from("invoices").select("total, amount_paid, status").order("id").range(from, from + 999);
      invoices.push(...((data as any[]) ?? []));
      if (!data || data.length < 1000) break;
    }
    const billed = invoices.reduce((s, r) => s + Number(r.total || 0), 0);
    const collected = invoices.reduce((s, r) => s + Number(r.amount_paid || 0), 0);
    const overdue = invoices.filter((r) => r.status === "overdue").reduce((s, r) => s + (Number(r.total || 0) - Number(r.amount_paid || 0)), 0);
    setFin({ billed, collected, outstanding: billed - collected, overdue });

    const [c, s, audit, advisory, osa, payroll, fbm, ict, lr] = await Promise.all([
      count(supabase.from("clients").select("id", { count: "exact", head: true })),
      count(supabase.from("profiles").select("id", { count: "exact", head: true })),
      count(supabase.from("engagements").select("id", { count: "exact", head: true }).eq("type", "audit").neq("status", "completed")),
      count(open("advisory_projects")),
      ...["outsourced_accounting", "payroll_management", "financial_business_management", "ict"].map((m) =>
        count(supabase.from("service_projects" as any).select("id", { count: "exact", head: true }).eq("module", m).neq("status", "completed"))),
      supabase.from("leave_requests").select("id, employee_id, start_date, end_date, days, profiles!leave_requests_employee_id_fkey(full_name)").eq("status", "pending").order("start_date"),
    ]);
    setClients(c);
    setStaff(s);
    setEngagements({ audit, advisory, outsourced_accounting: osa, payroll_management: payroll, financial_business_management: fbm, ict });
    // Same rule as the HR Approvals tab: pending requests, excluding your own.
    setPending(((lr.data as any[]) ?? []).filter((r) => r.employee_id !== user?.id));
  }
  useLiveRefresh(
    ["invoices", "payments", "clients", "profiles", "engagements", "advisory_projects", "service_projects", "leave_requests"],
    load,
    { enabled: !!user },
  );
  useEffect(() => { if (user) void load(); }, [user?.id]);

  async function decide(id: string, approve: boolean) {
    setBusyId(id);
    const { error } = await supabase.rpc("decide_leave_request", { _id: id, _approve: approve, _notes: null });
    setBusyId(null);
    if (error) toast.error(error.message);
    else { toast.success(approve ? "Request approved" : "Request rejected"); load(); }
  }

  const v = (n: number | null | undefined, fmt: (x: number) => string = String) => (n == null ? "—" : fmt(n));
  const lines = ENGAGEMENT_LINES.filter((l) => access(l.module as any) !== "none" && (engagements[l.module] ?? 0) > 0);
  const totalEngagements = Object.values(engagements).reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-6">
      {/* Financial Summary — every figure opens Accounts */}
      <section>
        <h2 className="text-sm font-semibold mb-2">Financial Summary</h2>
        <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
          <Link to="/accounts" className={tileCls}>
            <div className="flex items-center justify-between"><span className={labelCls}>Total Invoiced</span><FileText className="h-4 w-4 text-primary" /></div>
            <div className="mt-2 text-xl font-bold">{v(fin?.billed, money)}</div>
          </Link>
          <Link to="/accounts" className={tileCls}>
            <div className="flex items-center justify-between"><span className={labelCls}>Total Collected</span><Wallet className="h-4 w-4 text-emerald-600" /></div>
            <div className="mt-2 text-xl font-bold">{v(fin?.collected, money)}</div>
          </Link>
          <Link to="/accounts" search={{ filter: "outstanding" }} className={tileCls}>
            <div className="flex items-center justify-between"><span className={labelCls}>Outstanding Balance</span><TrendingUp className="h-4 w-4 text-amber-600" /></div>
            <div className="mt-2 text-xl font-bold">{v(fin?.outstanding, money)}</div>
          </Link>
          <Link to="/accounts" search={{ filter: "overdue" }} className={tileCls}>
            <div className="flex items-center justify-between"><span className={labelCls}>Overdue Amount</span><AlertCircle className="h-4 w-4 text-destructive" /></div>
            <div className={`mt-2 text-xl font-bold ${fin && fin.overdue > 0 ? "text-destructive" : ""}`}>{v(fin?.overdue, money)}</div>
          </Link>
        </div>
      </section>

      {/* Command centre — each tile goes straight to where the work is */}
      <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 items-start">
        <Link to="/clients" className={tileCls}>
          <div className="flex items-center justify-between"><span className={labelCls}>Total Clients</span><Users className="h-4 w-4 text-muted-foreground" /></div>
          <div className="mt-2 text-2xl font-bold">{v(clients)}</div>
        </Link>

        {access("hr") !== "none" ? (
          <Link to="/hr" className={tileCls}>
            <div className="flex items-center justify-between"><span className={labelCls}>Total Staff</span><ClipboardCheck className="h-4 w-4 text-muted-foreground" /></div>
            <div className="mt-2 text-2xl font-bold">{v(staff)}</div>
          </Link>
        ) : (
          <div className={tileCls}>
            <div className="flex items-center justify-between"><span className={labelCls}>Total Staff</span><ClipboardCheck className="h-4 w-4 text-muted-foreground" /></div>
            <div className="mt-2 text-2xl font-bold">{v(staff)}</div>
          </div>
        )}

        <div className="bg-card rounded-lg border p-4 h-full">
          <div className="flex items-center justify-between"><span className={labelCls}>Active Engagements</span><Briefcase className="h-4 w-4 text-muted-foreground" /></div>
          <div className="mt-2 text-2xl font-bold">{v(Object.keys(engagements).length ? totalEngagements : null)}</div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {lines.map((l) => (
              <Link key={l.module} to={l.to} {...(SERVICE_MODULES.includes(l.module) ? { search: { tab: "projects", filter: "active" } as never } : {})} className="text-xs px-2 py-1 rounded-full border bg-muted/40 hover:border-primary/60 hover:text-primary transition">
                {l.label} <span className="font-semibold">{engagements[l.module]}</span>
              </Link>
            ))}
            {Object.keys(engagements).length > 0 && lines.length === 0 && <span className="text-xs text-muted-foreground">None active</span>}
          </div>
        </div>

        <div className="bg-card rounded-lg border p-4 h-full">
          <div className="flex items-center justify-between"><span className={labelCls}>Leave Awaiting Approval</span><UserCheck className="h-4 w-4 text-muted-foreground" /></div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className={`text-2xl font-bold ${pending.length > 0 ? "text-amber-600" : ""}`}>{pending.length}</span>
            {pending.length > 0 && <Link to="/hr" className="text-xs text-primary hover:underline">Open in HR →</Link>}
          </div>
          {pending.slice(0, 3).map((r) => (
            <div key={r.id} className="mt-2 border-t pt-2 text-sm">
              <div className="font-medium truncate">{r.profiles?.full_name ?? "—"}</div>
              <div className="text-xs text-muted-foreground">{formatDate(r.start_date)} – {formatDate(r.end_date)} ({r.days}d)</div>
              <div className="mt-1.5 flex gap-2">
                <button disabled={busyId === r.id} onClick={() => decide(r.id, true)} className="h-7 px-2 rounded-md bg-emerald-600 text-white text-xs inline-flex items-center gap-1 disabled:opacity-60"><CheckCircle2 className="h-3 w-3" />Approve</button>
                <button disabled={busyId === r.id} onClick={() => decide(r.id, false)} className="h-7 px-2 rounded-md bg-destructive text-destructive-foreground text-xs inline-flex items-center gap-1 disabled:opacity-60"><XCircle className="h-3 w-3" />Reject</button>
              </div>
            </div>
          ))}
          {pending.length > 3 && <Link to="/hr" className="mt-2 block text-xs text-primary hover:underline">+{pending.length - 3} more in HR →</Link>}
        </div>
      </section>
    </div>
  );
}
