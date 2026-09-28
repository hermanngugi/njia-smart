import { createFileRoute, Link, Outlet, useChildMatches } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth, ROLE_LABELS, type AppRole } from "@/lib/auth";
import { isHrManager } from "@/lib/permissions";
import { formatDate } from "@/lib/format";
import { Plus, X, Download, FileText, CheckCircle2, XCircle, Users } from "lucide-react";

export const Route = createFileRoute("/_authed/hr")({
  head: () => ({
    meta: [
      { title: "HR & Employees | G.K Nahashon & Company" },
      { name: "description", content: "Employee records, documents, leave management and payslips." },
    ],
  }),
  component: HrRoute,
});

// /hr/$id (an employee record) is a child route of /hr. Without an <Outlet />
// the parent keeps rendering the directory and the record never opens, so show
// the child whenever one is matched and the directory otherwise.
function HrRoute() {
  const childMatches = useChildMatches();
  if (childMatches.length > 0) return <Outlet />;
  return <HrPage />;
}

const TABS = ["Directory", "My Leave", "Approvals", "Payslips"] as const;

type GenderFilter = "all" | "female" | "male" | "unset";

function money(n: number, currency = "KES") {
  return `${currency} ` + Number(n || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function HrPage() {
  const { user, isAdmin, roles: myRoles } = useAuth();
  const isHrMgr = isHrManager(myRoles);
  const [tab, setTab] = useState<(typeof TABS)[number]>("Directory");
  const [genderFilter, setGenderFilter] = useState<GenderFilter>("all");

  const [profiles, setProfiles] = useState<any[]>([]);
  const [rolesByUser, setRolesByUser] = useState<Record<string, string[]>>({});
  const [employment, setEmployment] = useState<Record<string, any>>({});

  const [leaveTypes, setLeaveTypes] = useState<any[]>([]);
  const [myRequests, setMyRequests] = useState<any[]>([]);
  const [myBalances, setMyBalances] = useState<any[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<any[]>([]);
  const [myPayslips, setMyPayslips] = useState<any[]>([]);

  const [loading, setLoading] = useState(true);
  const [reqForm, setReqForm] = useState<any>({ leave_type_id: "", start_date: "", end_date: "", reason: "" });
  const [reqOpen, setReqOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [decideNotes, setDecideNotes] = useState<Record<string, string>>({});

  async function load() {
    setLoading(true);
    const [p, ur, he, lt, lr, bal, ps] = await Promise.all([
      supabase.from("profiles").select("*").order("full_name"),
      supabase.from("user_roles").select("*"),
      supabase.from("hr_employment").select("*"),
      supabase.from("leave_types").select("*").eq("active", true).order("sort_order"),
      supabase.from("leave_requests").select("*, profiles!leave_requests_employee_id_fkey(full_name)").order("created_at", { ascending: false }),
      supabase.from("leave_balances").select("*"),
      supabase.from("payslips").select("*").order("period", { ascending: false }),
    ]);
    const byUser: Record<string, string[]> = {};
    (ur.data ?? []).forEach((r: any) => { (byUser[r.user_id] ??= []).push(r.role); });
    setRolesByUser(byUser);
    setProfiles(p.data ?? []);
    setEmployment(Object.fromEntries((he.data ?? []).map((e: any) => [e.employee_id, e])));
    setLeaveTypes(lt.data ?? []);
    setMyBalances((bal.data ?? []).filter((b: any) => b.employee_id === user?.id));
    setMyRequests((lr.data ?? []).filter((r: any) => r.employee_id === user?.id));
    setPendingApprovals((lr.data ?? []).filter((r: any) => r.status === "pending" && r.employee_id !== user?.id));
    setMyPayslips((ps.data ?? []).filter((s: any) => s.employee_id === user?.id));
    setLoading(false);
  }
  useEffect(() => { if (user) load(); }, [user?.id]);

  const canApproveAny = useMemo(() => {
    if (isAdmin) return true;
    return Object.values(employment).some((e: any) => e.manager_id === user?.id);
  }, [employment, isAdmin, user?.id]);

  // Gender-restricted leave types (maternity/paternity) are only offered to
  // employees whose recorded gender matches. No gender on file = not offered.
  const myGender: string | undefined = user ? employment[user.id]?.gender : undefined;
  const eligibleLeaveTypes = useMemo(
    () => leaveTypes.filter(t => !t.eligible_gender || t.eligible_gender === myGender),
    [leaveTypes, myGender]
  );
  const hiddenRestrictedTypes = leaveTypes.length - eligibleLeaveTypes.length;

  const genderOf = (id: string): "female" | "male" | "unset" => (employment[id]?.gender as any) || "unset";
  const genderCounts = useMemo(() => {
    const c = { female: 0, male: 0, unset: 0 };
    profiles.forEach(p => { c[genderOf(p.id)]++; });
    return c;
  }, [profiles, employment]);
  const visibleProfiles = useMemo(
    () => (isHrMgr && genderFilter !== "all" ? profiles.filter(p => genderOf(p.id) === genderFilter) : profiles),
    [profiles, employment, genderFilter, isHrMgr]
  );

  async function submitLeaveRequest(e: React.FormEvent) {
    e.preventDefault();
    if (!reqForm.leave_type_id || !reqForm.start_date || !reqForm.end_date) {
      toast.error("Pick a leave type and both dates");
      return;
    }
    setBusy(true);
    const { error } = await supabase.rpc("request_leave", {
      _leave_type_id: reqForm.leave_type_id,
      _start_date: reqForm.start_date,
      _end_date: reqForm.end_date,
      _reason: reqForm.reason || null,
    });
    setBusy(false);
    if (error) toast.error(error.message);
    else {
      toast.success("Leave request submitted");
      setReqOpen(false);
      setReqForm({ leave_type_id: "", start_date: "", end_date: "", reason: "" });
      load();
    }
  }

  async function cancelRequest(id: string) {
    if (!confirm("Cancel this leave request?")) return;
    const { error } = await supabase.from("leave_requests").update({ status: "cancelled" }).eq("id", id);
    if (error) toast.error(error.message); else { toast.success("Request cancelled"); load(); }
  }

  async function decide(id: string, approve: boolean) {
    setBusy(true);
    const { error } = await supabase.rpc("decide_leave_request", {
      _id: id, _approve: approve, _notes: decideNotes[id] || null,
    });
    setBusy(false);
    if (error) toast.error(error.message);
    else { toast.success(approve ? "Request approved" : "Request rejected"); load(); }
  }

  async function downloadPayslip(path: string) {
    const { data, error } = await supabase.storage.from("payslips").createSignedUrl(path, 60);
    if (error) toast.error(error.message);
    else window.open(data.signedUrl, "_blank");
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">HR & Employees</h1>
        <p className="text-sm text-muted-foreground">Employee records, documents, leave and payslips — all in one place.</p>
      </div>

      <div className="flex flex-wrap gap-1 border-b">
        {TABS.filter(t => t !== "Approvals" || canApproveAny).map(t => (
          <button key={t} onClick={() => setTab(t)} className={`px-3 py-2 text-sm border-b-2 transition-colors ${tab === t ? "border-primary text-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            {t}{t === "Approvals" && pendingApprovals.length > 0 ? ` (${pendingApprovals.length})` : ""}
          </button>
        ))}
      </div>

      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}

      {!loading && tab === "Directory" && (
        <div className="grid gap-3">
          {isHrMgr && (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-muted-foreground">Filter by gender:</span>
              {([
                ["all", `All (${profiles.length})`],
                ["female", `Female · maternity eligible (${genderCounts.female})`],
                ["male", `Male · paternity eligible (${genderCounts.male})`],
                ["unset", `Not set (${genderCounts.unset})`],
              ] as [GenderFilter, string][]).map(([v, label]) => (
                <button key={v} onClick={() => setGenderFilter(v)} className={`px-2.5 py-1 rounded-full border ${genderFilter === v ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:border-primary/50"}`}>{label}</button>
              ))}
            </div>
          )}
          {visibleProfiles.length === 0 && <div className="py-8 text-center text-sm text-muted-foreground">No employees match this filter.</div>}
          {visibleProfiles.map(p => {
            const emp = employment[p.id];
            const manager = emp?.manager_id ? profiles.find(m => m.id === emp.manager_id) : null;
            return (
              <Link key={p.id} to="/hr/$id" params={{ id: p.id }} className="group bg-card border rounded-lg p-4 hover:border-primary/50 transition-colors block">
                <div className="flex flex-wrap justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold group-hover:text-primary">{p.full_name || "Unnamed"}</div>
                    <div className="text-xs text-muted-foreground">
                      {p.job_title || "—"} · {p.department || "No department"}
                      {manager && <> · Reports to {manager.full_name}</>}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1 items-center">
                    {(rolesByUser[p.id] || []).map(r => (
                      <span key={r} className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary">{ROLE_LABELS[r as AppRole] || r}</span>
                    ))}
                    {isHrMgr && emp?.gender && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-muted capitalize">{emp.gender}</span>
                    )}
                    {emp?.employment_status && emp.employment_status !== "active" && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-100">{emp.employment_status.replace("_", " ")}</span>
                    )}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {!loading && tab === "My Leave" && (
        <div className="space-y-4">
          <div className="grid sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {myBalances.map(b => (
              <div key={b.leave_type_id} className="bg-card border rounded-lg p-3">
                <div className="text-xs text-muted-foreground">{b.leave_type_name}</div>
                <div className="text-lg font-bold">{b.remaining_days}</div>
                <div className="text-xs text-muted-foreground">of {b.entitled_days} days left</div>
              </div>
            ))}
          </div>

          <div className="flex justify-end">
            <button onClick={() => setReqOpen(true)} className="h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm inline-flex items-center gap-2">
              <Plus className="h-4 w-4" /> Request leave
            </button>
          </div>

          <div className="bg-card border rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-left text-xs text-muted-foreground border-b">
                  <tr><th className="py-2 px-3">Type</th><th>Dates</th><th>Days</th><th>Status</th><th>Notes</th><th></th></tr>
                </thead>
                <tbody>
                  {myRequests.length === 0 && <tr><td colSpan={6} className="py-10 text-center text-muted-foreground">No leave requests yet.</td></tr>}
                  {myRequests.map(r => (
                    <tr key={r.id} className="border-b last:border-0">
                      <td className="py-2 px-3">{leaveTypes.find(t => t.id === r.leave_type_id)?.name || "—"}</td>
                      <td className="text-xs">{formatDate(r.start_date)} – {formatDate(r.end_date)}</td>
                      <td>{r.days}</td>
                      <td><StatusBadge status={r.status} /></td>
                      <td className="text-xs text-muted-foreground max-w-[16rem] truncate">{r.decision_notes || r.reason || "—"}</td>
                      <td className="text-right pr-3">
                        {r.status === "pending" && (
                          <button onClick={() => cancelRequest(r.id)} className="text-destructive text-xs">Cancel</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {!loading && tab === "Approvals" && (
        <div className="bg-card border rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-xs text-muted-foreground border-b">
                <tr><th className="py-2 px-3">Employee</th><th>Type</th><th>Dates</th><th>Days</th><th>Reason</th><th className="w-64"></th></tr>
              </thead>
              <tbody>
                {pendingApprovals.length === 0 && <tr><td colSpan={6} className="py-10 text-center text-muted-foreground">No pending requests.</td></tr>}
                {pendingApprovals.map(r => (
                  <tr key={r.id} className="border-b last:border-0 align-top">
                    <td className="py-2 px-3">{r.profiles?.full_name || "—"}</td>
                    <td>{leaveTypes.find(t => t.id === r.leave_type_id)?.name || "—"}</td>
                    <td className="text-xs">{formatDate(r.start_date)} – {formatDate(r.end_date)}</td>
                    <td>{r.days}</td>
                    <td className="text-xs text-muted-foreground max-w-[12rem] truncate">{r.reason || "—"}</td>
                    <td className="py-2 pr-3">
                      <div className="flex flex-col gap-1">
                        <input
                          placeholder="Note (optional)"
                          value={decideNotes[r.id] || ""}
                          onChange={e => setDecideNotes({ ...decideNotes, [r.id]: e.target.value })}
                          className="h-8 px-2 rounded-md border bg-background text-xs"
                        />
                        <div className="flex gap-2">
                          <button disabled={busy} onClick={() => decide(r.id, true)} className="h-7 px-2 rounded-md bg-emerald-600 text-white text-xs inline-flex items-center gap-1"><CheckCircle2 className="h-3 w-3" />Approve</button>
                          <button disabled={busy} onClick={() => decide(r.id, false)} className="h-7 px-2 rounded-md bg-destructive text-destructive-foreground text-xs inline-flex items-center gap-1"><XCircle className="h-3 w-3" />Reject</button>
                        </div>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!loading && tab === "Payslips" && (
        <div className="bg-card border rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-xs text-muted-foreground border-b">
                <tr><th className="py-2 px-3">Period</th><th>Gross</th><th>Net</th><th></th></tr>
              </thead>
              <tbody>
                {myPayslips.length === 0 && <tr><td colSpan={4} className="py-10 text-center text-muted-foreground">No payslips published yet.</td></tr>}
                {myPayslips.map(s => (
                  <tr key={s.id} className="border-b last:border-0">
                    <td className="py-2 px-3 inline-flex items-center gap-2"><FileText className="h-4 w-4 text-muted-foreground" />{new Date(s.period).toLocaleDateString("en-KE", { month: "long", year: "numeric" })}</td>
                    <td>{money(s.gross_pay)}</td>
                    <td>{money(s.net_pay)}</td>
                    <td className="text-right pr-3">
                      {s.file_path && (
                        <button onClick={() => downloadPayslip(s.file_path)} className="text-primary text-xs inline-flex items-center gap-1"><Download className="h-3 w-3" />Download</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {isHrMgr && (
            <div className="p-3 border-t text-xs text-muted-foreground inline-flex items-center gap-2">
              <Users className="h-3.5 w-3.5" /> To publish a payslip for someone, open their record from the Directory tab.
            </div>
          )}
        </div>
      )}

      {reqOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setReqOpen(false)}>
          <form onClick={e => e.stopPropagation()} onSubmit={submitLeaveRequest} className="bg-card w-full max-w-md rounded-lg p-6 space-y-3">
            <div className="flex justify-between"><h2 className="text-lg font-semibold">Request leave</h2><button type="button" onClick={() => setReqOpen(false)}><X className="h-4 w-4" /></button></div>
            <select required value={reqForm.leave_type_id} onChange={e => setReqForm({ ...reqForm, leave_type_id: e.target.value })} className="w-full h-9 px-3 rounded-md border bg-background text-sm">
              <option value="">Select leave type…</option>
              {eligibleLeaveTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            {hiddenRestrictedTypes > 0 && (
              <p className="text-xs text-muted-foreground">Maternity/Paternity leave is offered once HR has recorded your gender details.</p>
            )}
            <div className="grid grid-cols-2 gap-2">
              <input required type="date" value={reqForm.start_date} onChange={e => setReqForm({ ...reqForm, start_date: e.target.value })} className="h-9 px-3 rounded-md border bg-background text-sm" />
              <input required type="date" value={reqForm.end_date} onChange={e => setReqForm({ ...reqForm, end_date: e.target.value })} className="h-9 px-3 rounded-md border bg-background text-sm" />
            </div>
            <textarea placeholder="Reason (optional)" value={reqForm.reason} onChange={e => setReqForm({ ...reqForm, reason: e.target.value })} className="w-full px-3 py-2 rounded-md border bg-background text-sm" rows={3} />
            <button disabled={busy} className="w-full h-10 rounded-md bg-primary text-primary-foreground text-sm font-medium">{busy ? "Submitting…" : "Submit request"}</button>
          </form>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    pending: "bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-100",
    approved: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
    rejected: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
    cancelled: "bg-muted text-muted-foreground",
  };
  return <span className={`text-xs px-2 py-0.5 rounded-full ${map[status] || "bg-muted"}`}>{status}</span>;
}
