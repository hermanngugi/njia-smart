import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";
import { formatDateTime, STATUS_COLORS, statusLabel } from "@/lib/format";
import { ClientAssignments } from "@/components/client-assignments";
import { CompletionInvoiceDialog, LinkedInvoice } from "@/components/completion-invoice-dialog";
import { ModuleTabBar } from "@/components/module-extra-tabs";
import { daysFromToday, shortDate } from "@/components/tax/tax-model";
import { getAuditWorkspaceSections } from "@/lib/audit/registry";
import { PACK_ID, PACK_VERSION, isDone, isInReview, type AuditTabKey } from "@/lib/audit/guidance";
import { useAuditData } from "@/components/audit/use-audit-data";
import { AuditProcedures } from "@/components/audit/audit-procedures";
import { AuditReviewQueue } from "@/components/audit/audit-review-queue";
import { AuditDocuments } from "@/components/audit/audit-documents";
import { AuditNotes } from "@/components/audit/audit-notes";

export const Route = createFileRoute("/_authed/audit/$id")({ component: AuditDetail });

const STATUSES = ["not_started", "in_progress", "completed"];
const STATUS_TEXT: Record<string, string> = {
  not_started: "Not started", in_progress: "In progress", under_review: "Under review", completed: "Completed",
};
const PHASES = getAuditWorkspaceSections(PACK_ID, PACK_VERSION).map(({ id, label }) => ({ v: id, label }));
const fieldClass = "mt-1 w-full h-9 px-3 rounded-md border bg-background text-sm";

function AuditDetail() {
  const { id } = useParams({ from: "/_authed/audit/$id" });
  const audit = useAuditData(id);
  const [tab, setTab] = useState<AuditTabKey>("checklist");
  const [e, setE] = useState<any>(null);
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [wp, setWp] = useState<any[]>([]);
  const [notes, setNotes] = useState<any[]>([]);
  const [staff, setStaff] = useState<any[]>([]);

  async function load() {
    const [eRes, wpRes, nRes, pRes] = await Promise.all([
      supabase.from("engagements").select("*, clients(company_name)").eq("id", id).maybeSingle(),
      supabase.from("audit_workpapers").select("*").eq("engagement_id", id).order("created_at", { ascending: false }),
      supabase.from("audit_review_notes").select("*").eq("engagement_id", id).order("created_at"),
      supabase.from("profiles").select("id, full_name"),
    ]);
    const byId = new Map((pRes.data ?? []).map((p: any) => [p.id, p]));
    setE(eRes.data);
    setStaff(pRes.data ?? []);
    setWp((wpRes.data ?? []).map((r: any) => ({ ...r, profiles: r.uploaded_by ? byId.get(r.uploaded_by) ?? null : null })));
    setNotes((nRes.data ?? []).map((r: any) => ({ ...r, profiles: r.author_id ? byId.get(r.author_id) ?? null : null })));
  }
  useEffect(() => { void load(); }, [id]);

  // Live updates scoped to this engagement only
  useEffect(() => {
    const ch = supabase
      .channel(`audit-${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "engagements", filter: `id=eq.${id}` }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "audit_workpapers", filter: `engagement_id=eq.${id}` }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "audit_review_notes", filter: `engagement_id=eq.${id}` }, () => void load())
      .on("postgres_changes", { event: "*", schema: "public", table: "audit_engagement_procedures", filter: `engagement_id=eq.${id}` }, () => { void audit.reload(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "audit_risks", filter: `engagement_id=eq.${id}` }, () => { void audit.reload(); })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function saveField(field: string, value: any, skipInvoice = false) {
    // Completing an audit requires an invoice under the client.
    if (!skipInvoice && field === "status" && value === "completed" && e?.status !== "completed" && !e?.invoice_id) {
      setInvoiceOpen(true);
      return;
    }
    const { error } = await supabase.from("engagements").update({ [field]: value } as any).eq("id", id);
    if (error) toast.error(error.message); else { toast.success("Saved"); void load(); }
  }

  const phaseProgress = useMemo(() => audit.sections.map((s) => ({
    id: s.id, label: s.label, done: s.done, total: s.procedures.length,
  })), [audit.sections]);

  if (!e) return <div className="text-sm text-muted-foreground">Loading…</div>;

  const waitingReview = audit.procedures.filter((p) => isInReview(p.status)).length;
  const openNotes = notes.filter((n) => !n.resolved).length;
  const openSteps = audit.procedures.filter((p) => !isDone(p.status)).length;
  const overdueSteps = audit.procedures.filter((p) => !isDone(p.status) && p.due_date && (daysFromToday(p.due_date) ?? 0) < 0).length;
  const dueIn = daysFromToday(e.due_date);
  const pct = audit.total ? Math.round((audit.done / audit.total) * 100) : Number(e.completion_pct ?? 0);
  const ownerName = staff.find((s) => s.id === e.assigned_to)?.full_name;

  return (
    <div className="space-y-4">
      <Link to="/audit" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1"><ArrowLeft className="h-3 w-3" /> Back to audits</Link>

      {/* Header strip: where the engagement stands, who is on it, and the key dates */}
      <div className="bg-card border rounded-lg p-5 space-y-4">
        <div className="flex flex-wrap justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">{e.title}</h1>
            <div className="text-sm text-muted-foreground">{e.clients?.company_name}</div>
          </div>
          <div className="flex flex-col items-end gap-1">
            <span className={`h-fit text-xs px-2 py-1 rounded-full ${STATUS_COLORS[e.status]}`}>{STATUS_TEXT[e.status] ?? statusLabel(e.status)}</span>
            {e.invoice_id && <LinkedInvoice invoiceId={e.invoice_id} />}
          </div>
          <CompletionInvoiceDialog
            open={invoiceOpen}
            onOpenChange={setInvoiceOpen}
            source="engagements"
            sourceId={e.id}
            clientName={e.clients?.company_name}
            defaultDescription={`Audit — ${e.title}`}
            onInvoiced={() => saveField("status", "completed", true)}
          />
        </div>

        <div>
          <div className="flex justify-between text-xs text-muted-foreground mb-1">
            <span>{audit.total ? `${audit.done} of ${audit.total} steps signed off` : "Checklist not started"}</span><span>{pct}%</span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden"><div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} /></div>
          {phaseProgress.length > 0 && (
            <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2">
              {phaseProgress.map((s) => (
                <div key={s.id}>
                  <div className="flex justify-between text-[11px] text-muted-foreground"><span>{s.label}</span><span>{s.done}/{s.total}</span></div>
                  <div className="h-1 rounded-full bg-muted overflow-hidden"><div className="h-full bg-emerald-500" style={{ width: `${s.total ? (s.done / s.total) * 100 : 0}%` }} /></div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <div><span className="text-muted-foreground">Owner </span>{ownerName ?? <span className="text-red-600">None</span>}</div>
          <div><span className="text-muted-foreground">Start </span>{shortDate(e.start_date)}</div>
          <div>
            <span className="text-muted-foreground">Due </span>{shortDate(e.due_date)}
            {e.status !== "completed" && dueIn !== null && dueIn < 0 && <span className="ml-1 text-xs text-red-600">{-dueIn}d overdue</span>}
          </div>
          <Link to="/tasks" search={{ engagement: id } as any} className="text-primary hover:underline">Tasks for this audit</Link>
          {overdueSteps > 0 && <div className="text-red-600">{overdueSteps} step{overdueSteps === 1 ? "" : "s"} overdue</div>}
          {e.client_id && <div className="flex items-center gap-2"><span className="text-muted-foreground">Team</span><ClientAssignments clientId={e.client_id} compact /></div>}
          {e.updated_at && <div className="text-xs text-muted-foreground ml-auto">Updated {formatDateTime(e.updated_at)}</div>}
        </div>

        <details>
          <summary className="cursor-pointer text-sm text-primary">Edit details (owner, status, dates, notes)</summary>
          <div className="mt-3 grid sm:grid-cols-4 gap-3">
            <div>
              <label className="text-xs font-medium">Owner</label>
              <select value={e.assigned_to ?? ""} onChange={(ev) => void saveField("assigned_to", ev.target.value || null)} className={fieldClass}>
                <option value="">No owner</option>
                {staff.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium">Status</label>
              <select value={e.status} onChange={(ev) => void saveField("status", ev.target.value)} className={fieldClass}>
                {(STATUSES.includes(e.status) ? STATUSES : [e.status, ...STATUSES]).map((s) => <option key={s} value={s}>{STATUS_TEXT[s] ?? statusLabel(s)}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium">Start date</label>
              <input type="date" defaultValue={e.start_date || ""} onBlur={(ev) => void saveField("start_date", ev.target.value || null)} className={fieldClass} />
            </div>
            <div>
              <label className="text-xs font-medium">Due date</label>
              <input type="date" defaultValue={e.due_date || ""} onBlur={(ev) => void saveField("due_date", ev.target.value || null)} className={fieldClass} />
            </div>
          </div>
          <div className="mt-3">
            <label className="text-xs font-medium">Notes</label>
            <textarea defaultValue={e.notes || ""} onBlur={(ev) => void saveField("notes", ev.target.value)} rows={2} className="mt-1 w-full px-3 py-2 rounded-md border bg-background text-sm" />
          </div>
        </details>
      </div>

      <ModuleTabBar
        active={tab}
        onChange={setTab}
        tabs={[
          { key: "checklist", label: "Checklist", count: audit.total > 0 ? openSteps : undefined },
          { key: "documents", label: "Documents", count: wp.length },
          { key: "review", label: "Review", count: waitingReview + openNotes },
        ]}
      />

      {tab === "checklist" && (
        <AuditProcedures
          engagementId={id}
          data={audit}
          staff={staff}
          workpapers={wp.map((w) => ({ id: w.id, title: w.title }))}
        />
      )}

      {tab === "documents" && <AuditDocuments engagementId={id} docs={wp} phases={PHASES} reload={() => void load()} />}

      {tab === "review" && (
        <div className="space-y-6">
          <AuditReviewQueue data={audit} staff={staff} />
          <AuditNotes engagementId={id} notes={notes} phases={PHASES} reload={() => void load()} />
        </div>
      )}
    </div>
  );
}
