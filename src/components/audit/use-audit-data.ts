import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { getAuditProcedurePack, getAuditWorkspaceSections } from "@/lib/audit/registry";
import { PACK_ID, PACK_VERSION, isDone } from "@/lib/audit/guidance";

export type ProcedureResult = {
  id: string;
  work_performed: string;
  conclusion: string | null;
  exceptions: unknown[];
  prepared_by: string | null;
  prepared_at: string;
};

export type Signoff = {
  id: string;
  engagement_procedure_id: string;
  reviewer_id: string;
  decision: "approved" | "changes_requested" | "rejected";
  comments: string | null;
  signed_at: string;
};

export type ProcedureRow = {
  id: string;
  procedure_id: string;
  pack_id: string;
  pack_version: number;
  status: string;
  assigned_to: string | null;
  assigned_reviewer_id: string | null;
  title: string;
  sectionId: string;
  required: boolean;
  standardRefs: string[];
  objective: string;
  expectedEvidence: string[];
  dependencies: string[];
  latest: ProcedureResult | null;
  latestSignoff: Signoff | null;
  evidenceWorkpaperIds: string[];
  riskIds: string[];
};

export type RiskRow = {
  id: string;
  title: string;
  description: string;
  financial_statement_area: string | null;
  assertions: string[];
  likelihood: "low" | "moderate" | "high" | null;
  impact: "low" | "moderate" | "high" | null;
  significant_risk: boolean;
  planned_response: string | null;
  status: "identified" | "assessed" | "responded" | "closed";
  created_at: string;
  procedureIds: string[];
};

export type SectionGroup = {
  id: string;
  label: string;
  description: string;
  procedures: ProcedureRow[];
  done: number;
};

function push<V>(map: Map<string, V[]>, key: string, value: V) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/**
 * One shared load for everything the audit workspace needs (checklist, risks,
 * results, sign-offs, links). Screens read from this instead of each querying
 * the database on its own, so the overview, checklist and review queue always
 * agree with each other.
 */
export function useAuditData(engagementId: string) {
  const { user } = useAuth();
  const [procedures, setProcedures] = useState<ProcedureRow[]>([]);
  const [risks, setRisks] = useState<RiskRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [initializing, setInitializing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const db = supabase as any;
    const [procRes, riskRes, defRes] = await Promise.all([
      db.from("audit_engagement_procedures").select("*").eq("engagement_id", engagementId).order("created_at"),
      db.from("audit_risks").select("*").eq("engagement_id", engagementId).order("created_at", { ascending: false }),
      db.from("audit_procedure_definitions").select("*").eq("pack_id", PACK_ID).eq("pack_version", PACK_VERSION),
    ]);
    const firstError = procRes.error || riskRes.error || defRes.error;
    if (firstError) {
      setError(firstError.message || "The audit tables could not be loaded.");
      setLoading(false);
      return;
    }

    const procRows: any[] = procRes.data ?? [];
    const ids: string[] = procRows.map((p) => p.id);
    const [resultRes, signoffRes, evidenceRes, linkRes] = ids.length
      ? await Promise.all([
          db.from("audit_procedure_results").select("*").in("engagement_procedure_id", ids).order("prepared_at", { ascending: false }),
          db.from("audit_signoffs").select("*").in("engagement_procedure_id", ids).order("signed_at", { ascending: false }),
          db.from("audit_evidence_links").select("engagement_procedure_id, workpaper_id").in("engagement_procedure_id", ids),
          db.from("audit_risk_procedure_links").select("risk_id, engagement_procedure_id").in("engagement_procedure_id", ids),
        ])
      : [{ data: [] }, { data: [] }, { data: [] }, { data: [] }];
    if (resultRes.error || signoffRes.error) {
      setError((resultRes.error || signoffRes.error).message);
      setLoading(false);
      return;
    }

    const defs = new Map<string, any>((defRes.data ?? []).map((d: any) => [d.procedure_id, d]));
    const latestResult = new Map<string, ProcedureResult>();
    for (const r of resultRes.data ?? []) if (!latestResult.has(r.engagement_procedure_id)) latestResult.set(r.engagement_procedure_id, r);
    const latestSignoff = new Map<string, Signoff>();
    for (const s of signoffRes.data ?? []) if (!latestSignoff.has(s.engagement_procedure_id)) latestSignoff.set(s.engagement_procedure_id, s);
    const evidenceBy = new Map<string, string[]>();
    for (const e of evidenceRes.data ?? []) push(evidenceBy, e.engagement_procedure_id, e.workpaper_id);
    const risksByProc = new Map<string, string[]>();
    const procsByRisk = new Map<string, string[]>();
    for (const l of linkRes.data ?? []) {
      push(risksByProc, l.engagement_procedure_id, l.risk_id);
      push(procsByRisk, l.risk_id, l.engagement_procedure_id);
    }

    const packOrder = new Map((getAuditProcedurePack(PACK_ID, PACK_VERSION)?.procedures ?? []).map((p, i) => [p.id, i]));
    const rows: ProcedureRow[] = procRows.map((p) => {
      const d = defs.get(p.procedure_id);
      const def = d?.definition ?? {};
      return {
        id: p.id,
        procedure_id: p.procedure_id,
        pack_id: p.pack_id,
        pack_version: p.pack_version,
        status: p.status,
        assigned_to: p.assigned_to ?? null,
        assigned_reviewer_id: p.assigned_reviewer_id ?? null,
        title: d?.title ?? p.procedure_id,
        sectionId: d?.section_id ?? "planning",
        required: d?.required ?? true,
        standardRefs: d?.standard_references ?? [],
        objective: def.objective ?? "",
        expectedEvidence: def.expectedEvidence ?? [],
        dependencies: def.dependencies ?? [],
        latest: latestResult.get(p.id) ?? null,
        latestSignoff: latestSignoff.get(p.id) ?? null,
        evidenceWorkpaperIds: evidenceBy.get(p.id) ?? [],
        riskIds: risksByProc.get(p.id) ?? [],
      };
    }).sort((a, b) => (packOrder.get(a.procedure_id) ?? 999) - (packOrder.get(b.procedure_id) ?? 999));

    setProcedures(rows);
    setRisks((riskRes.data ?? []).map((r: any) => ({ ...r, assertions: Array.isArray(r.assertions) ? r.assertions : [], procedureIds: procsByRisk.get(r.id) ?? [] })));
    setError(null);
    setLoading(false);
  }, [engagementId]);

  useEffect(() => { void load(); }, [load]);

  /** Creates the checklist for this engagement from the active pack (safe to run twice). */
  async function initialize() {
    setInitializing(true);
    const db = supabase as any;
    const { data: defs, error: defError } = await db.from("audit_procedure_definitions")
      .select("procedure_id").eq("pack_id", PACK_ID).eq("pack_version", PACK_VERSION).eq("enabled", true);
    if (defError) { toast.error(defError.message); setInitializing(false); return; }
    if (!defs?.length) { toast.error("No audit procedures were found. Apply the audit database migrations first."); setInitializing(false); return; }
    const rows = defs.map((d: { procedure_id: string }) => ({
      engagement_id: engagementId, pack_id: PACK_ID, pack_version: PACK_VERSION,
      procedure_id: d.procedure_id, created_by: user?.id ?? null,
    }));
    const { error: upsertError } = await db.from("audit_engagement_procedures").upsert(rows, {
      onConflict: "engagement_id,pack_id,pack_version,procedure_id", ignoreDuplicates: true,
    });
    setInitializing(false);
    if (upsertError) toast.error(upsertError.message);
    else { toast.success("Audit checklist is ready"); await load(); }
  }

  const sections: SectionGroup[] = useMemo(() => {
    const known = getAuditWorkspaceSections();
    const groups = known.map((s) => {
      const list = procedures.filter((p) => p.sectionId === s.id);
      return { id: s.id, label: s.label, description: s.description, procedures: list, done: list.filter((p) => isDone(p.status)).length };
    });
    return groups.filter((g) => g.procedures.length > 0);
  }, [procedures]);

  const total = procedures.length;
  const done = procedures.filter((p) => isDone(p.status)).length;

  return { loading, error, procedures, risks, sections, total, done, reload: load, initialize, initializing };
}

export type AuditData = ReturnType<typeof useAuditData>;
export type StaffMember = { id: string; full_name: string | null };
