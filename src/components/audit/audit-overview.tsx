import type { ReactNode } from "react";
import { AlertCircle, ArrowRight, CheckCircle2, ClipboardList, FileText, ListChecks, ShieldAlert, UserCheck } from "lucide-react";
import { computeNextStep, isDone, type AuditTabKey } from "@/lib/audit/guidance";
import type { AuditData } from "./use-audit-data";

type Props = {
  data: AuditData;
  userId: string | null;
  completionPct: number;
  workpaperCount: number;
  openTasks: number;
  openNotes: number;
  onGo: (tab: AuditTabKey, procedureId?: string) => void;
  onApplyProgress: (pct: number) => void;
  team?: ReactNode;
};

const STEPS = [
  { n: 1, title: "Plan", text: "Set up the checklist and record the risks you have identified." },
  { n: 2, title: "Do the work", text: "Work through each step, write what you did and your conclusion, and attach evidence." },
  { n: 3, title: "Get it reviewed", text: "Mark the step ready for review. A different person approves it or sends it back." },
  { n: 4, title: "Finish", text: "When every step is approved, mark the audit completed and raise the invoice." },
];

export function AuditOverview({ data, userId, completionPct, workpaperCount, openTasks, openNotes, onGo, onApplyProgress, team }: Props) {
  const { procedures, risks, sections, total, done, loading, error } = data;
  const next = computeNextStep({
    procedures: procedures.map((p) => ({ id: p.id, title: p.title, status: p.status, required: p.required, dependencies: p.dependencies, procedureId: p.procedure_id, assigned_reviewer_id: p.assigned_reviewer_id })),
    userId,
    openRisks: risks.filter((r) => r.status !== "closed").length,
  });
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  const waitingReview = procedures.filter((p) => p.status === "prepared" || p.status === "under_review").length;
  const changesRequested = procedures.filter((p) => p.status === "review_notes").length;
  const significant = risks.filter((r) => r.significant_risk && r.status !== "closed").length;
  const unaddressed = risks.filter((r) => r.status !== "closed" && r.procedureIds.length === 0).length;

  return (
    <div className="space-y-4">
      {error && (
        <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 space-y-1">
          <h3 className="font-semibold text-sm flex items-center gap-2"><AlertCircle className="h-4 w-4" /> The audit database is not set up yet</h3>
          <p className="text-sm">Apply the three audit migrations in order (foundation, risk/procedure links, review/sign-off), then refresh this page.</p>
          <p className="text-xs text-muted-foreground">Database message: {error}</p>
        </div>
      )}

      {!error && (
        <div className="rounded-lg border-2 border-primary/30 bg-primary/5 p-4 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-wide text-primary">What to do next</div>
            <div className="mt-1 font-semibold">{loading ? "Loading…" : next.title}</div>
            {!loading && <p className="text-sm text-muted-foreground mt-0.5">{next.detail}</p>}
          </div>
          {!loading && (
            <button onClick={() => onGo(next.tab, next.procedureId)} className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium inline-flex items-center gap-2">
              {next.actionLabel} <ArrowRight className="h-4 w-4" />
            </button>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile icon={<ListChecks className="h-4 w-4" />} label="Steps completed" value={`${done} of ${total}`} hint={total === 0 ? "Checklist not set up" : `${pct}% done`} onClick={() => onGo("procedures")} />
        <Tile icon={<UserCheck className="h-4 w-4" />} label="Waiting for review" value={String(waitingReview)} hint={changesRequested > 0 ? `${changesRequested} sent back for changes` : "Nothing sent back"} tone={changesRequested > 0 ? "warn" : undefined} onClick={() => onGo("review")} />
        <Tile icon={<ShieldAlert className="h-4 w-4" />} label="Risks recorded" value={String(risks.length)} hint={risks.length === 0 ? "None yet" : `${significant} significant · ${unaddressed} without a response`} tone={unaddressed > 0 ? "warn" : undefined} onClick={() => onGo("risks")} />
        <Tile icon={<FileText className="h-4 w-4" />} label="Documents · open tasks" value={`${workpaperCount} · ${openTasks}`} hint={openNotes > 0 ? `${openNotes} review note${openNotes === 1 ? "" : "s"} to resolve` : "No open review notes"} tone={openNotes > 0 ? "warn" : undefined} onClick={() => onGo(openNotes > 0 ? "review" : "documents")} />
      </div>

      {total > 0 && Math.abs(pct - completionPct) >= 5 && (
        <div className="rounded-lg border bg-card p-3 text-sm flex flex-wrap items-center justify-between gap-2">
          <span>Checklist progress is <strong>{pct}%</strong>, but the engagement progress is set to <strong>{completionPct}%</strong>.</span>
          <button onClick={() => onApplyProgress(pct)} className="h-8 px-3 rounded-md border text-xs hover:bg-muted">Use {pct}% as engagement progress</button>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="lg:col-span-2 rounded-lg border bg-card p-4">
          <div className="flex items-center gap-2 mb-3"><ClipboardList className="h-4 w-4 text-primary" /><h2 className="font-semibold">Progress by phase</h2></div>
          {sections.length === 0 ? (
            <p className="text-sm text-muted-foreground">Set up the checklist to see progress for each phase of the audit.</p>
          ) : (
            <div className="space-y-3">
              {sections.map((s) => {
                const p = Math.round((s.done / s.procedures.length) * 100);
                const complete = s.procedures.every((x) => isDone(x.status));
                return (
                  <button key={s.id} onClick={() => onGo("procedures")} className="w-full text-left group">
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <span className="font-medium flex items-center gap-1.5">
                        {complete && <CheckCircle2 className="h-4 w-4 text-emerald-600" />}{s.label}
                      </span>
                      <span className="text-xs text-muted-foreground">{s.done} of {s.procedures.length} done</span>
                    </div>
                    <div className="mt-1 h-2 rounded-full bg-muted overflow-hidden"><div className="h-full bg-primary transition-all" style={{ width: `${p}%` }} /></div>
                    <div className="mt-1 text-xs text-muted-foreground group-hover:text-foreground">{s.description}</div>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <section className="rounded-lg border bg-card p-4">
          <h2 className="font-semibold mb-3">How an audit works here</h2>
          <ol className="space-y-3">
            {STEPS.map((s) => (
              <li key={s.n} className="flex gap-3">
                <span className="h-6 w-6 shrink-0 rounded-full bg-primary/10 text-primary text-xs font-semibold flex items-center justify-center">{s.n}</span>
                <div><div className="text-sm font-medium">{s.title}</div><div className="text-xs text-muted-foreground">{s.text}</div></div>
              </li>
            ))}
          </ol>
        </section>
      </div>

      {team}
    </div>
  );
}

function Tile({ icon, label, value, hint, onClick, tone }: { icon: ReactNode; label: string; value: string; hint: string; onClick: () => void; tone?: "warn" }) {
  return (
    <button onClick={onClick} className={`rounded-lg border bg-card p-3 text-left hover:border-primary/50 transition-colors ${tone === "warn" ? "border-amber-300" : ""}`}>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">{icon}{label}</div>
      <div className="mt-1 text-xl font-bold">{value}</div>
      <div className={`text-xs mt-0.5 ${tone === "warn" ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground"}`}>{hint}</div>
    </button>
  );
}
