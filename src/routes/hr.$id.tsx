import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth, ROLE_LABELS, type AppRole } from "@/lib/auth";
import { isHrManager } from "@/lib/permissions";
import { formatDate } from "@/lib/format";
import { ArrowLeft, Upload, Download, Trash2, FileText, Plus, X } from "lucide-react";

export const Route = createFileRoute("/_authed/hr/$id")({ component: EmployeeHrPage });

const EMPLOYMENT_TYPES = ["full_time", "part_time", "contract", "intern"];
const EMPLOYMENT_STATUSES = ["active", "on_leave", "suspended", "terminated"];
const DOC_TYPES = ["contract", "id", "tax_form", "certificate", "other"];
const GENDERS = ["male", "female"];

function money(n: number, currency = "KES") {
  return `${currency} ` + Number(n || 0).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function EmployeeHrPage() {
  const { id } = Route.useParams();
  const { user, isAdmin, roles: myRoles } = useAuth();
  const isSelf = user?.id === id;
  // Director, admin and accountant manage employee records (personal details,
  // documents, payslips). Everyone else only edits their own personal fields.
  const isHrMgr = isHrManager(myRoles);

  const [profile, setProfile] = useState<any>(null);
  const [roles, setRoles] = useState<string[]>([]);
  const [emp, setEmp] = useState<any>({});
  const [managers, setManagers] = useState<any[]>([]);
  const [docs, setDocs] = useState<any[]>([]);
  const [leave, setLeave] = useState<any[]>([]);
  const [payslips, setPayslips] = useState<any[]>([]);

  const [busy, setBusy] = useState(false);
  const [docTitle, setDocTitle] = useState("");
  const [docType, setDocType] = useState("other");
  const fileRef = useRef<HTMLInputElement>(null);

  const [payslipOpen, setPayslipOpen] = useState(false);
  const [payslipForm, setPayslipForm] = useState<any>({ period: "", gross_pay: "", net_pay: "" });
  const payslipFileRef = useRef<HTMLInputElement>(null);

  async function load() {
    const [p, ur, he, allProfiles, d, lr, ps] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", id).maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", id),
      supabase.from("hr_employment").select("*").eq("employee_id", id).maybeSingle(),
      supabase.from("profiles").select("id, full_name").order("full_name"),
      supabase.from("hr_documents").select("*").eq("employee_id", id).order("created_at", { ascending: false }),
      supabase.from("leave_requests").select("*, leave_types(name)").eq("employee_id", id).order("created_at", { ascending: false }),
      supabase.from("payslips").select("*").eq("employee_id", id).order("period", { ascending: false }),
    ]);
    setProfile(p.data);
    setRoles((ur.data ?? []).map((r: any) => r.role));
    setEmp(he.data || { employee_id: id });
    setManagers((allProfiles.data ?? []).filter((m: any) => m.id !== id));
    setDocs(d.data ?? []);
    setLeave(lr.data ?? []);
    setPayslips(ps.data ?? []);
  }
  useEffect(() => { load(); }, [id]);

  async function saveEmployment(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.from("hr_employment").upsert({
      employee_id: id,
      employee_no: emp.employee_no || null,
      employment_type: emp.employment_type || "full_time",
      employment_status: emp.employment_status || "active",
      manager_id: emp.manager_id || null,
      date_hired: emp.date_hired || null,
      date_of_birth: emp.date_of_birth || null,
      gender: emp.gender || null,
      national_id: emp.national_id || null,
      kra_pin: emp.kra_pin || null,
      gross_salary: emp.gross_salary === "" ? null : emp.gross_salary,
      salary_currency: emp.salary_currency || "KES",
      bank_name: emp.bank_name || null,
      bank_account: emp.bank_account || null,
      next_of_kin_name: emp.next_of_kin_name || null,
      next_of_kin_phone: emp.next_of_kin_phone || null,
    });
    setBusy(false);
    if (error) toast.error(error.message);
    else { toast.success("Employment record saved"); load(); }
  }

  async function saveMyInfo(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.rpc("update_my_employment_info", {
      _date_of_birth: emp.date_of_birth || null,
      _national_id: emp.national_id || null,
      _kra_pin: emp.kra_pin || null,
      _bank_name: emp.bank_name || null,
      _bank_account: emp.bank_account || null,
      _next_of_kin_name: emp.next_of_kin_name || null,
      _next_of_kin_phone: emp.next_of_kin_phone || null,
    });
    setBusy(false);
    if (error) toast.error(error.message);
    else { toast.success("Details saved"); load(); }
  }

  async function uploadDoc(file: File) {
    setBusy(true);
    const path = `${id}/${Date.now()}-${file.name}`;
    const up = await supabase.storage.from("hr-documents").upload(path, file);
    if (up.error) { setBusy(false); toast.error(up.error.message); return; }
    const { data: { user: caller } } = await supabase.auth.getUser();
    const { error } = await supabase.from("hr_documents").insert({
      employee_id: id, doc_type: docType, title: docTitle || file.name, file_path: path, uploaded_by: caller?.id,
    });
    setBusy(false);
    if (error) toast.error(error.message);
    else { toast.success("Document uploaded"); setDocTitle(""); setDocType("other"); load(); }
  }

  async function downloadDoc(path: string) {
    const { data, error } = await supabase.storage.from("hr-documents").createSignedUrl(path, 300);
    if (error) toast.error(error.message); else window.open(data.signedUrl, "_blank");
  }

  async function removeDoc(docId: string, path: string) {
    if (!confirm("Delete this document?")) return;
    await supabase.storage.from("hr-documents").remove([path]);
    const { error } = await supabase.from("hr_documents").delete().eq("id", docId);
    if (error) toast.error(error.message); else { toast.success("Deleted"); load(); }
  }

  async function publishPayslip(e: React.FormEvent) {
    e.preventDefault();
    if (!payslipForm.period) { toast.error("Pick the pay period"); return; }
    setBusy(true);
    let file_path: string | null = null;
    const file = payslipFileRef.current?.files?.[0];
    if (file) {
      const path = `${id}/${payslipForm.period}-${Date.now()}-${file.name}`;
      const up = await supabase.storage.from("payslips").upload(path, file);
      if (up.error) { setBusy(false); toast.error(up.error.message); return; }
      file_path = path;
    }
    const { data: { user: caller } } = await supabase.auth.getUser();
    const { error } = await supabase.from("payslips").upsert({
      employee_id: id,
      period: payslipForm.period + "-01",
      gross_pay: payslipForm.gross_pay || null,
      net_pay: payslipForm.net_pay || null,
      file_path,
      uploaded_by: caller?.id,
    }, { onConflict: "employee_id,period" });
    setBusy(false);
    if (error) toast.error(error.message);
    else {
      toast.success("Payslip published");
      setPayslipOpen(false);
      setPayslipForm({ period: "", gross_pay: "", net_pay: "" });
      load();
    }
  }

  async function downloadPayslip(path: string) {
    const { data, error } = await supabase.storage.from("payslips").createSignedUrl(path, 300);
    if (error) toast.error(error.message); else window.open(data.signedUrl, "_blank");
  }

  if (!profile) return <div className="text-sm text-muted-foreground">Loading…</div>;

  const canEditEmployment = isHrMgr;
  const canEditOwnInfo = isSelf && !isHrMgr;

  return (
    <div className="space-y-4 max-w-3xl">
      <Link to="/hr" className="text-sm text-muted-foreground inline-flex items-center gap-1 hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to HR & Employees
      </Link>

      <div className="bg-card border rounded-lg p-5">
        <h1 className="text-xl font-bold">{profile.full_name || "Unnamed"}</h1>
        <div className="text-sm text-muted-foreground">{profile.job_title || "—"} · {profile.department || "No department"}</div>
        <div className="mt-1 flex flex-wrap gap-1">
          {roles.map(r => <span key={r} className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary">{ROLE_LABELS[r as AppRole] || r}</span>)}
        </div>
      </div>

      {(canEditEmployment || isSelf) && (
        <form onSubmit={canEditEmployment ? saveEmployment : saveMyInfo} className="bg-card border rounded-lg p-5 space-y-3">
          <h2 className="font-semibold">Personal & employment details</h2>
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Employee no."><input disabled={!canEditEmployment} value={emp.employee_no || ""} onChange={e => setEmp({ ...emp, employee_no: e.target.value })} className={input(canEditEmployment)} /></Field>
            <Field label="Manager">
              <select disabled={!canEditEmployment} value={emp.manager_id || ""} onChange={e => setEmp({ ...emp, manager_id: e.target.value })} className={input(canEditEmployment)}>
                <option value="">None</option>
                {managers.map(m => <option key={m.id} value={m.id}>{m.full_name}</option>)}
              </select>
            </Field>
            <Field label="Employment type">
              <select disabled={!canEditEmployment} value={emp.employment_type || "full_time"} onChange={e => setEmp({ ...emp, employment_type: e.target.value })} className={input(canEditEmployment)}>
                {EMPLOYMENT_TYPES.map(t => <option key={t} value={t}>{t.replace("_", " ")}</option>)}
              </select>
            </Field>
            <Field label="Employment status">
              <select disabled={!canEditEmployment} value={emp.employment_status || "active"} onChange={e => setEmp({ ...emp, employment_status: e.target.value })} className={input(canEditEmployment)}>
                {EMPLOYMENT_STATUSES.map(s => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
              </select>
            </Field>
            <Field label="Date hired"><input disabled={!canEditEmployment} type="date" value={emp.date_hired || ""} onChange={e => setEmp({ ...emp, date_hired: e.target.value })} className={input(canEditEmployment)} /></Field>
            <Field label="Date of birth"><input disabled={!canEditEmployment && !canEditOwnInfo} type="date" value={emp.date_of_birth || ""} onChange={e => setEmp({ ...emp, date_of_birth: e.target.value })} className={input(canEditEmployment || canEditOwnInfo)} /></Field>
            <Field label="Gender">
              <select disabled={!canEditEmployment} value={emp.gender || ""} onChange={e => setEmp({ ...emp, gender: e.target.value })} className={input(canEditEmployment)}>
                <option value="">Not set</option>
                {GENDERS.map(g => <option key={g} value={g} className="capitalize">{g === "male" ? "Male" : "Female"}</option>)}
              </select>
              <p className="mt-1 text-xs text-muted-foreground">
                {emp.gender === "female" ? "Eligible for Maternity Leave."
                  : emp.gender === "male" ? "Eligible for Paternity Leave."
                  : "Set gender to determine maternity/paternity leave eligibility."}
              </p>
            </Field>
            <Field label="National ID"><input disabled={!canEditEmployment && !canEditOwnInfo} value={emp.national_id || ""} onChange={e => setEmp({ ...emp, national_id: e.target.value })} className={input(canEditEmployment || canEditOwnInfo)} /></Field>
            <Field label="KRA PIN"><input disabled={!canEditEmployment && !canEditOwnInfo} value={emp.kra_pin || ""} onChange={e => setEmp({ ...emp, kra_pin: e.target.value })} className={input(canEditEmployment || canEditOwnInfo)} /></Field>
            {canEditEmployment && (
              <>
                <Field label="Gross salary"><input type="number" step="0.01" value={emp.gross_salary ?? ""} onChange={e => setEmp({ ...emp, gross_salary: e.target.value })} className={input(true)} /></Field>
                <Field label="Currency"><input value={emp.salary_currency || "KES"} onChange={e => setEmp({ ...emp, salary_currency: e.target.value })} className={input(true)} /></Field>
              </>
            )}
            <Field label="Bank name"><input disabled={!canEditEmployment && !canEditOwnInfo} value={emp.bank_name || ""} onChange={e => setEmp({ ...emp, bank_name: e.target.value })} className={input(canEditEmployment || canEditOwnInfo)} /></Field>
            <Field label="Bank account"><input disabled={!canEditEmployment && !canEditOwnInfo} value={emp.bank_account || ""} onChange={e => setEmp({ ...emp, bank_account: e.target.value })} className={input(canEditEmployment || canEditOwnInfo)} /></Field>
            <Field label="Next of kin"><input disabled={!canEditEmployment && !canEditOwnInfo} value={emp.next_of_kin_name || ""} onChange={e => setEmp({ ...emp, next_of_kin_name: e.target.value })} className={input(canEditEmployment || canEditOwnInfo)} /></Field>
            <Field label="Next of kin phone"><input disabled={!canEditEmployment && !canEditOwnInfo} value={emp.next_of_kin_phone || ""} onChange={e => setEmp({ ...emp, next_of_kin_phone: e.target.value })} className={input(canEditEmployment || canEditOwnInfo)} /></Field>
          </div>
          {(canEditEmployment || canEditOwnInfo) && (
            <button disabled={busy} className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium">{busy ? "Saving…" : "Save"}</button>
          )}
          {!canEditEmployment && !canEditOwnInfo && <p className="text-xs text-muted-foreground">View only.</p>}
          {canEditOwnInfo && <p className="text-xs text-muted-foreground">You can update your own personal details. Salary and job details are managed by HR.</p>}
        </form>
      )}

      <div className="bg-card border rounded-lg p-5 space-y-3">
        <div className="flex justify-between items-center">
          <h2 className="font-semibold">Documents</h2>
        </div>
        {(isSelf || isHrMgr) && (
          <div className="grid sm:grid-cols-3 gap-2">
            <select value={docType} onChange={e => setDocType(e.target.value)} className="h-9 px-3 rounded-md border bg-background text-sm">
              {DOC_TYPES.map(t => <option key={t} value={t}>{t.replace("_", " ")}</option>)}
            </select>
            <input placeholder="Title (optional)" value={docTitle} onChange={e => setDocTitle(e.target.value)} className="h-9 px-3 rounded-md border bg-background text-sm" />
            <label className={`h-9 inline-flex items-center justify-center gap-2 rounded-md bg-primary text-primary-foreground text-sm cursor-pointer ${busy ? "opacity-60" : ""}`}>
              <Upload className="h-4 w-4" /> Upload
              <input ref={fileRef} type="file" hidden disabled={busy} onChange={e => { const f = e.target.files?.[0]; if (f) uploadDoc(f); e.currentTarget.value = ""; }} />
            </label>
          </div>
        )}
        <div className="divide-y">
          {docs.length === 0 && <div className="py-6 text-center text-muted-foreground text-sm">No documents yet.</div>}
          {docs.map(d => (
            <div key={d.id} className="py-2 flex items-center justify-between gap-2">
              <div className="min-w-0 flex items-center gap-2 text-sm"><FileText className="h-4 w-4 text-muted-foreground shrink-0" /><span className="truncate">{d.title}</span><span className="text-xs text-muted-foreground shrink-0">({d.doc_type.replace("_", " ")})</span></div>
              <div className="flex items-center gap-2 shrink-0">
                <button onClick={() => downloadDoc(d.file_path)} className="text-primary text-xs inline-flex items-center gap-1"><Download className="h-3 w-3" />Download</button>
                {(isAdmin || (isHrMgr && d.uploaded_by === user?.id)) && <button onClick={() => removeDoc(d.id, d.file_path)} className="text-destructive text-xs"><Trash2 className="h-3 w-3" /></button>}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-card border rounded-lg p-5 space-y-3">
        <h2 className="font-semibold">Leave history</h2>
        <div className="divide-y">
          {leave.length === 0 && <div className="py-6 text-center text-muted-foreground text-sm">No leave requests.</div>}
          {leave.map(r => (
            <div key={r.id} className="py-2 flex items-center justify-between gap-2 text-sm">
              <div>{r.leave_types?.name} · {formatDate(r.start_date)} – {formatDate(r.end_date)} ({r.days}d)</div>
              <span className="text-xs px-2 py-0.5 rounded-full bg-muted">{r.status}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-card border rounded-lg p-5 space-y-3">
        <div className="flex justify-between items-center">
          <h2 className="font-semibold">Payslips</h2>
          {isHrMgr && (
            <button onClick={() => setPayslipOpen(true)} className="h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs inline-flex items-center gap-1"><Plus className="h-3 w-3" />Publish payslip</button>
          )}
        </div>
        <div className="divide-y">
          {payslips.length === 0 && <div className="py-6 text-center text-muted-foreground text-sm">No payslips yet.</div>}
          {payslips.map(s => (
            <div key={s.id} className="py-2 flex items-center justify-between gap-2 text-sm">
              <div>{new Date(s.period).toLocaleDateString("en-KE", { month: "long", year: "numeric" })} · Gross {money(s.gross_pay, emp.salary_currency)} · Net {money(s.net_pay, emp.salary_currency)}</div>
              {s.file_path && <button onClick={() => downloadPayslip(s.file_path)} className="text-primary text-xs inline-flex items-center gap-1"><Download className="h-3 w-3" />Download</button>}
            </div>
          ))}
        </div>
      </div>

      {payslipOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setPayslipOpen(false)}>
          <form onClick={e => e.stopPropagation()} onSubmit={publishPayslip} className="bg-card w-full max-w-md rounded-lg p-6 space-y-3">
            <div className="flex justify-between"><h2 className="text-lg font-semibold">Publish payslip</h2><button type="button" onClick={() => setPayslipOpen(false)}><X className="h-4 w-4" /></button></div>
            <Field label="Pay period">
              <input required type="month" value={payslipForm.period} onChange={e => setPayslipForm({ ...payslipForm, period: e.target.value })} className={input(true)} />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Gross pay"><input type="number" step="0.01" value={payslipForm.gross_pay} onChange={e => setPayslipForm({ ...payslipForm, gross_pay: e.target.value })} className={input(true)} /></Field>
              <Field label="Net pay"><input type="number" step="0.01" value={payslipForm.net_pay} onChange={e => setPayslipForm({ ...payslipForm, net_pay: e.target.value })} className={input(true)} /></Field>
            </div>
            <Field label="Payslip file (optional PDF)"><input ref={payslipFileRef} type="file" accept="application/pdf" className="text-sm" /></Field>
            <button disabled={busy} className="w-full h-10 rounded-md bg-primary text-primary-foreground text-sm font-medium">{busy ? "Publishing…" : "Publish"}</button>
          </form>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs text-muted-foreground">{label}</label>
      <div className="mt-1">{children}</div>
    </div>
  );
}
function input(editable: boolean) {
  return `w-full h-9 px-3 rounded-md border text-sm ${editable ? "bg-background" : "bg-muted text-muted-foreground"}`;
}
