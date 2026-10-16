import { useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Plus, ShieldAlert, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { ASSERTIONS, COMMON_AREAS, RISK_STATUS_LABEL, riskRating } from "@/lib/audit/guidance";
import type { AuditData, RiskRow } from "./use-audit-data";

const inputClass = "mt-1 w-full min-w-0 rounded-md border bg-background px-3 py-2 text-sm";
const LEVELS: { value: "low" | "moderate" | "high"; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "moderate", label: "Medium" },
  { value: "high", label: "High" },
];

export function AuditRisks({ engagementId, data }: { engagementId: string; data: AuditData }) {
  const { risks, procedures, loading, error, reload } = data;
  const [open, setOpen] = useState(false);

  async function setStatus(risk: RiskRow, status: RiskRow["status"]) {
    const { error: err } = await (supabase as any).from("audit_risks").update({ status, updated_at: new Date().toISOString() }).eq("id", risk.id);
    if (err) toast.error(err.message); else await reload();
  }

  if (error) {
    return (
      <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 space-y-1">
        <h3 className="font-semibold text-sm">The audit database is not set up yet</h3>
        <p className="text-sm">Apply the three audit migrations in order, then refresh this page.</p>
        <p className="text-xs text-muted-foreground">Database message: {error}</p>
      </div>
    );
  }

  const open_ = risks.filter((r) => r.status !== "closed");
  const unaddressed = open_.filter((r) => r.procedureIds.length === 0);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-card p-4 flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <h2 className="font-semibold flex items-center gap-2"><ShieldAlert className="h-5 w-5 text-primary" /> Risks</h2>
          <p className="text-sm text-muted-foreground mt-1">
            A risk is something that could cause the client’s financial statements to be wrong. Record each one, rate it, and link the checklist steps that respond to it.
          </p>
        </div>
        <button onClick={() => setOpen(true)} className="h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-medium inline-flex items-center gap-2"><Plus className="h-4 w-4" /> Add a risk</button>
      </div>

      {unaddressed.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-900/20 p-3 text-sm flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{unaddressed.length} risk{unaddressed.length === 1 ? " has" : "s have"} no checklist step linked yet. Open the step that responds to it in the Checklist tab and tick the risk.</span>
        </div>
      )}

      {loading && <p className="text-sm text-muted-foreground">Loading risks…</p>}
      {!loading && risks.length === 0 && (
        <div className="rounded-lg border border-dashed bg-card p-8 text-center text-sm text-muted-foreground">
          No risks recorded yet. Click “Add a risk” — for example, “Revenue may be overstated”.
        </div>
      )}

      <div className="space-y-2">
        {risks.map((r) => {
          const rating = riskRating(r.likelihood, r.impact);
          const linked = r.procedureIds.map((id) => procedures.find((p) => p.id === id)?.title).filter(Boolean) as string[];
          return (
            <div key={r.id} className={`rounded-lg border bg-card p-3 space-y-2 ${r.status === "closed" ? "opacity-60" : ""}`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-sm">{r.title}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${rating.tone}`}>{rating.label}</span>
                    {r.significant_risk && <span className="text-xs px-2 py-0.5 rounded-full bg-red-600 text-white">Significant</span>}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">{r.financial_statement_area || "No area given"}</div>
                </div>
                <select aria-label={`Status for ${r.title}`} value={r.status} onChange={(e) => void setStatus(r, e.target.value as RiskRow["status"])} className="rounded-md border bg-background px-2 py-1 text-xs">
                  {Object.entries(RISK_STATUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              {r.description && <p className="text-sm whitespace-pre-wrap">{r.description}</p>}
              {r.planned_response && <p className="text-sm"><span className="font-medium">Our response:</span> {r.planned_response}</p>}
              {r.assertions.length > 0 && (
                <p className="text-xs text-muted-foreground">Could affect: {r.assertions.map((a) => ASSERTIONS.find((x) => x.id === a)?.label ?? a).join(", ")}</p>
              )}
              <p className={`text-xs ${linked.length === 0 && r.status !== "closed" ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground"}`}>
                {linked.length === 0 ? "No checklist step linked yet" : `Addressed by: ${linked.join("; ")}`}
              </p>
            </div>
          );
        })}
      </div>

      {open && <AddRiskDialog engagementId={engagementId} data={data} onClose={() => setOpen(false)} />}
    </div>
  );
}

function AddRiskDialog({ engagementId, data, onClose }: { engagementId: string; data: AuditData; onClose: () => void }) {
  const { user } = useAuth();
  const [title, setTitle] = useState("");
  const [area, setArea] = useState("");
  const [description, setDescription] = useState("");
  const [likelihood, setLikelihood] = useState<"low" | "moderate" | "high">("moderate");
  const [impact, setImpact] = useState<"low" | "moderate" | "high">("moderate");
  const [significant, setSignificant] = useState(false);
  const [assertions, setAssertions] = useState<string[]>([]);
  const [response, setResponse] = useState("");
  const [procIds, setProcIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const rating = riskRating(likelihood, impact);

  async function save() {
    if (!title.trim()) return toast.error("Give the risk a short title.");
    setSaving(true);
    const db = supabase as any;
    const { data: row, error } = await db.from("audit_risks").insert({
      engagement_id: engagementId, title: title.trim(), description: description.trim(),
      financial_statement_area: area.trim() || null, assertions, likelihood, impact,
      significant_risk: significant, planned_response: response.trim() || null,
      status: procIds.length ? "responded" : "assessed", created_by: user?.id ?? null,
    }).select("id").single();
    if (error || !row) { toast.error(error?.message ?? "Could not save the risk"); setSaving(false); return; }
    if (procIds.length) {
      const { error: linkError } = await db.from("audit_risk_procedure_links").upsert(
        procIds.map((engagement_procedure_id) => ({ risk_id: row.id, engagement_procedure_id, linked_by: user?.id ?? null })),
        { onConflict: "risk_id,engagement_procedure_id" },
      );
      if (linkError) toast.error(`Risk saved, but linking steps failed: ${linkError.message}`);
    }
    setSaving(false);
    toast.success("Risk recorded");
    await data.reload();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-card w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-lg shadow-xl">
        <div className="sticky top-0 bg-card border-b p-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Add a risk</h2>
          <button onClick={onClose} aria-label="Close"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-4 space-y-4">
          <label className="block text-sm font-medium">What could go wrong?
            <input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Revenue may be overstated" autoFocus />
          </label>
          <label className="block text-sm font-medium">Which part of the accounts?
            <input className={inputClass} list="audit-risk-areas" value={area} onChange={(e) => setArea(e.target.value)} placeholder="Pick or type, e.g. Revenue" />
            <datalist id="audit-risk-areas">{COMMON_AREAS.map((a) => <option key={a} value={a} />)}</datalist>
          </label>
          <label className="block text-sm font-medium">More detail <span className="font-normal text-muted-foreground">(optional)</span>
            <textarea className={inputClass} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>

          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block text-sm font-medium">How likely?
              <select className={inputClass} value={likelihood} onChange={(e) => setLikelihood(e.target.value as typeof likelihood)}>{LEVELS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}</select>
            </label>
            <label className="block text-sm font-medium">How big if it happens?
              <select className={inputClass} value={impact} onChange={(e) => setImpact(e.target.value as typeof impact)}>{LEVELS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}</select>
            </label>
            <div className="text-sm font-medium">Rating
              <div className={`mt-1 rounded-md px-3 py-2 text-sm text-center ${rating.tone}`}>{rating.label}</div>
            </div>
          </div>

          <label className="flex items-start gap-2 text-sm rounded-md border p-2">
            <input type="checkbox" className="mt-1" checked={significant} onChange={(e) => setSignificant(e.target.checked)} />
            <span><span className="font-medium">Significant risk</span><span className="block text-xs text-muted-foreground">Needs special audit attention — for example a fraud risk or a complex estimate.</span></span>
          </label>

          <details className="rounded-md border p-2">
            <summary className="text-sm font-medium cursor-pointer">What parts of the statements could be affected? <span className="font-normal text-muted-foreground">(optional)</span></summary>
            <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
              {ASSERTIONS.map((a) => (
                <label key={a.id} className="flex items-start gap-2 text-sm">
                  <input type="checkbox" className="mt-1" checked={assertions.includes(a.id)} onChange={(e) => setAssertions(e.target.checked ? [...assertions, a.id] : assertions.filter((x) => x !== a.id))} />
                  <span>{a.label}<span className="block text-xs text-muted-foreground">{a.help}</span></span>
                </label>
              ))}
            </div>
          </details>

          <label className="block text-sm font-medium">How will you respond? <span className="font-normal text-muted-foreground">(optional)</span>
            <input className={inputClass} value={response} onChange={(e) => setResponse(e.target.value)} placeholder="e.g. Test sales cut-off and confirm large balances" />
          </label>

          {data.procedures.length > 0 && (
            <div>
              <div className="text-sm font-medium">Which checklist steps address it? <span className="font-normal text-muted-foreground">(optional)</span></div>
              <div className="mt-1 max-h-36 overflow-y-auto rounded-md border p-2 space-y-1">
                {data.procedures.map((p) => (
                  <label key={p.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={procIds.includes(p.id)} onChange={(e) => setProcIds(e.target.checked ? [...procIds, p.id] : procIds.filter((x) => x !== p.id))} />
                    <span className="truncate">{p.title}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="sticky bottom-0 bg-card border-t p-4 flex justify-end gap-2">
          <button onClick={onClose} className="h-9 px-3 rounded-md border text-sm hover:bg-muted">Cancel</button>
          <button onClick={() => void save()} disabled={saving} className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50">{saving ? "Saving…" : "Save risk"}</button>
        </div>
      </div>
    </div>
  );
}
