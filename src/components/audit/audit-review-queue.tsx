import { useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, CornerUpLeft, ShieldCheck, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { STATUS_LABEL, STATUS_TONE } from "@/lib/audit/guidance";
import { formatDateTime } from "@/lib/format";
import type { AuditData, ProcedureRow, StaffMember } from "./use-audit-data";

/**
 * Review queue: shows only what needs a decision, grouped by who has to act.
 * Reviewers see the preparer's work and conclusion right here, so they do not
 * have to jump back to the checklist to understand what they are approving.
 */
export function AuditReviewQueue({ data, staff }: { data: AuditData; staff: StaffMember[] }) {
  const { user } = useAuth();
  const { procedures, loading, error, reload } = data;
  const [comments, setComments] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const nameOf = (id: string | null) => staff.find((s) => s.id === id)?.full_name ?? "Someone";
  const inReview = procedures.filter((p) => p.status === "prepared" || p.status === "under_review");
  const mine = inReview.filter((p) => p.assigned_reviewer_id && p.assigned_reviewer_id === user?.id);
  const unassigned = inReview.filter((p) => !p.assigned_reviewer_id);
  const others = inReview.filter((p) => p.assigned_reviewer_id && p.assigned_reviewer_id !== user?.id);
  const sentBack = procedures.filter((p) => p.status === "review_notes");
  const approved = procedures.filter((p) => p.status === "completed");

  async function assign(p: ProcedureRow, reviewerId: string) {
    setBusyId(p.id);
    const { error: err } = await (supabase as any).from("audit_engagement_procedures")
      .update({ assigned_reviewer_id: reviewerId || null, updated_at: new Date().toISOString() }).eq("id", p.id);
    setBusyId(null);
    if (err) toast.error(err.message); else { toast.success("Reviewer assigned"); await reload(); }
  }

  async function decide(p: ProcedureRow, decision: "approved" | "changes_requested" | "rejected") {
    const text = (comments[p.id] ?? "").trim();
    if (decision !== "approved" && !text) return toast.error("Add a comment explaining what needs to change.");
    setBusyId(p.id);
    const { error: err } = await (supabase as any).rpc("audit_record_procedure_signoff", {
      p_engagement_procedure_id: p.id, p_decision: decision, p_comments: text || null,
    });
    setBusyId(null);
    if (err) return toast.error(err.message);
    toast.success(decision === "approved" ? "Approved" : decision === "changes_requested" ? "Sent back with your comments" : "Rejected");
    setComments((old) => ({ ...old, [p.id]: "" }));
    await reload();
  }

  if (error) {
    return (
      <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 space-y-1">
        <h3 className="font-semibold text-sm">Review cannot connect to the audit database</h3>
        <p className="text-sm">Apply the three audit migrations in order, then refresh this page.</p>
        <p className="text-xs text-muted-foreground">Database message: {error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="rounded-lg border bg-card p-4">
        <h2 className="font-semibold flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-primary" /> Review and sign-off</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Every step must be approved by someone other than the person who did the work. Steps appear here once they are marked “Ready for review”.
        </p>
      </div>

      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {!loading && procedures.length === 0 && (
        <div className="rounded-lg border border-dashed bg-card p-6 text-center text-sm text-muted-foreground">Set up the checklist first (Checklist tab). Nothing to review yet.</div>
      )}
      {!loading && procedures.length > 0 && inReview.length === 0 && sentBack.length === 0 && (
        <div className="rounded-lg border border-dashed bg-card p-6 text-center text-sm text-muted-foreground">Nothing is waiting for review right now.</div>
      )}

      {mine.length > 0 && (
        <Group title="Waiting for you" count={mine.length} tone="primary">
          {mine.map((p) => {
            const preparedByMe = p.latest?.prepared_by === user?.id;
            return (
              <Card key={p.id} p={p} preparer={nameOf(p.latest?.prepared_by ?? null)}>
                {preparedByMe ? (
                  <p className="text-sm text-amber-700 dark:text-amber-300">You prepared this work, so someone else must review it. Assign a different reviewer below.</p>
                ) : (
                  <div className="space-y-2 border-t pt-3">
                    <label className="block text-xs font-medium">Your comments <span className="font-normal text-muted-foreground">(required if you send it back)</span>
                      <textarea className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm" rows={2} value={comments[p.id] ?? ""} onChange={(e) => setComments((o) => ({ ...o, [p.id]: e.target.value }))} placeholder="What is missing or wrong?" />
                    </label>
                    <div className="flex flex-wrap gap-2">
                      <button disabled={busyId === p.id} onClick={() => void decide(p, "approved")} className="h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm inline-flex items-center gap-2 disabled:opacity-50"><CheckCircle2 className="h-4 w-4" /> Approve</button>
                      <button disabled={busyId === p.id} onClick={() => void decide(p, "changes_requested")} className="h-9 px-3 rounded-md border text-sm inline-flex items-center gap-2 hover:bg-muted disabled:opacity-50"><CornerUpLeft className="h-4 w-4" /> Send back for changes</button>
                      <button disabled={busyId === p.id} onClick={() => void decide(p, "rejected")} className="h-9 px-3 rounded-md border text-sm inline-flex items-center gap-2 hover:bg-muted text-destructive disabled:opacity-50"><XCircle className="h-4 w-4" /> Reject</button>
                    </div>
                  </div>
                )}
                <ReviewerPicker p={p} staff={staff} busy={busyId === p.id} onChange={(id) => void assign(p, id)} showWhen={preparedByMe} />
              </Card>
            );
          })}
        </Group>
      )}

      {unassigned.length > 0 && (
        <Group title="Needs a reviewer" count={unassigned.length} tone="warn">
          {unassigned.map((p) => (
            <Card key={p.id} p={p} preparer={nameOf(p.latest?.prepared_by ?? null)}>
              <ReviewerPicker p={p} staff={staff} busy={busyId === p.id} onChange={(id) => void assign(p, id)} showWhen />
            </Card>
          ))}
        </Group>
      )}

      {others.length > 0 && (
        <Group title="With another reviewer" count={others.length}>
          {others.map((p) => (
            <Card key={p.id} p={p} preparer={nameOf(p.latest?.prepared_by ?? null)} compact>
              <p className="text-xs text-muted-foreground">Reviewer: {nameOf(p.assigned_reviewer_id)}</p>
              <ReviewerPicker p={p} staff={staff} busy={busyId === p.id} onChange={(id) => void assign(p, id)} showWhen={false} />
            </Card>
          ))}
        </Group>
      )}

      {sentBack.length > 0 && (
        <Group title="Sent back for changes" count={sentBack.length} tone="warn">
          {sentBack.map((p) => (
            <Card key={p.id} p={p} preparer={nameOf(p.latest?.prepared_by ?? null)} compact>
              {p.latestSignoff?.comments && <p className="text-sm"><strong>{nameOf(p.latestSignoff.reviewer_id)} said:</strong> {p.latestSignoff.comments}</p>}
              <p className="text-xs text-muted-foreground">The preparer needs to update this step in the Checklist tab and send it for review again.</p>
            </Card>
          ))}
        </Group>
      )}

      {approved.length > 0 && (
        <details className="rounded-lg border bg-card p-3">
          <summary className="cursor-pointer text-sm font-medium">Approved ({approved.length})</summary>
          <ul className="mt-2 space-y-1 text-sm">
            {approved.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>{p.title}</span>
                <span className="text-xs text-muted-foreground">{nameOf(p.latestSignoff?.reviewer_id ?? p.assigned_reviewer_id)} · {formatDateTime(p.latestSignoff?.signed_at)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function Group({ title, count, tone, children }: { title: string; count: number; tone?: "primary" | "warn"; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className={`text-sm font-semibold flex items-center gap-2 ${tone === "primary" ? "text-primary" : ""}`}>
        {title} <span className={`text-xs px-1.5 rounded ${tone === "warn" ? "bg-amber-100 text-amber-800" : "bg-muted"}`}>{count}</span>
      </h3>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function Card({ p, preparer, compact, children }: { p: ProcedureRow; preparer: string; compact?: boolean; children?: React.ReactNode }) {
  const exceptions = Array.isArray(p.latest?.exceptions) ? (p.latest!.exceptions as unknown[]) : [];
  return (
    <div className="rounded-lg border bg-card p-3 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-medium text-sm">{p.title}</div>
        <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_TONE[p.status] ?? "bg-muted"}`}>{STATUS_LABEL[p.status] ?? p.status}</span>
      </div>
      {!compact && p.latest && (
        <div className="rounded-md bg-muted/40 p-3 text-sm space-y-2">
          <div className="text-xs text-muted-foreground">Prepared by {preparer} · {formatDateTime(p.latest.prepared_at)} · {p.evidenceWorkpaperIds.length} file{p.evidenceWorkpaperIds.length === 1 ? "" : "s"} attached</div>
          <div><div className="text-xs font-medium">Work performed</div><p className="whitespace-pre-wrap">{p.latest.work_performed || "—"}</p></div>
          <div><div className="text-xs font-medium">Conclusion</div><p className="whitespace-pre-wrap">{p.latest.conclusion || "—"}</p></div>
          {exceptions.length > 0 && (
            <div><div className="text-xs font-medium">Exceptions</div><ul className="list-disc pl-5">{exceptions.map((e, i) => <li key={i}>{typeof e === "string" ? e : JSON.stringify(e)}</li>)}</ul></div>
          )}
        </div>
      )}
      {children}
    </div>
  );
}

function ReviewerPicker({ p, staff, busy, onChange, showWhen }: { p: ProcedureRow; staff: StaffMember[]; busy: boolean; onChange: (id: string) => void; showWhen: boolean }) {
  const preparerId = p.latest?.prepared_by ?? null;
  const options = staff.filter((s) => s.id !== preparerId);
  if (!showWhen) {
    return (
      <details className="text-xs">
        <summary className="cursor-pointer text-muted-foreground">Change reviewer</summary>
        <select className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm" disabled={busy} value={p.assigned_reviewer_id ?? ""} onChange={(e) => onChange(e.target.value)}>
          <option value="">Choose a reviewer…</option>
          {options.map((s) => <option key={s.id} value={s.id}>{s.full_name ?? s.id}</option>)}
        </select>
      </details>
    );
  }
  return (
    <label className="block text-xs font-medium">Reviewer <span className="font-normal text-muted-foreground">(not the preparer)</span>
      <select className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm" disabled={busy} value={p.assigned_reviewer_id ?? ""} onChange={(e) => onChange(e.target.value)}>
        <option value="">Choose a reviewer…</option>
        {options.map((s) => <option key={s.id} value={s.id}>{s.full_name ?? s.id}</option>)}
      </select>
    </label>
  );
}
