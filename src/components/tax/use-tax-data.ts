import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { todayNairobi } from "@/lib/tax-period";
import { chunk, fetchPages } from "./tax-model";

const db = supabase as any;

/**
 * Everything the Overview needs: tax policies, clients with an active
 * obligation, each client's current (not yet filed) filing per tax type, who
 * owns it, and which filings already have a receipt.
 */
export function useTaxData() {
  const [loading, setLoading] = useState(true);
  const [policies, setPolicies] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [obligations, setObligations] = useState<Set<string>>(new Set());
  const [openReturns, setOpenReturns] = useState<any[]>([]);
  const [receiptIds, setReceiptIds] = useState<Set<string>>(new Set());
  const [staff, setStaff] = useState<any[]>([]);
  const [filedThisYear, setFiledThisYear] = useState(0);

  const load = useCallback(async () => {
    try {
      const year = todayNairobi().slice(0, 4);
      const [pol, cl, ob, ret, st, filed] = await Promise.all([
        db.from("tax_policies").select("*").eq("active", true).order("sort_order"),
        fetchPages((a, b) => db.from("clients").select("id, company_name, is_paused").order("company_name").order("id").range(a, b)),
        fetchPages((a, b) => db.from("client_tax_obligations").select("client_id, tax_type").eq("active", true).order("id").range(a, b)),
        fetchPages((a, b) => db.from("tax_returns")
          .select("id, client_id, return_type, period_start, period_end, due_date, status, assigned_to, docs_received_at, prepared_at, invoice_id")
          .neq("status", "filed").order("due_date").order("id").range(a, b)),
        db.from("profiles").select("id, full_name").order("full_name"),
        db.from("tax_returns").select("id", { count: "exact", head: true }).eq("status", "filed").gte("due_date", `${year}-01-01`),
      ]);
      if (pol.error) throw new Error(pol.error.message);

      const ids = ret.map((r: any) => r.id);
      const docRows = (await Promise.all(
        chunk(ids, 100).map(group => db.from("documents").select("tax_return_id").in("tax_return_id", group)),
      )).flatMap((res: any) => res.data ?? []);

      setPolicies(pol.data ?? []);
      setClients(cl);
      setObligations(new Set(ob.map((o: any) => `${o.client_id}:${o.tax_type}`)));
      setOpenReturns(ret);
      setReceiptIds(new Set(docRows.map((d: any) => d.tax_return_id)));
      setStaff(st.data ?? []);
      setFiledThisYear(filed.count ?? 0);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not load the tax overview");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const staffMap = useMemo(() => new Map<string, string>(staff.map((s: any) => [s.id, s.full_name || "Unnamed"])), [staff]);
  const clientMap = useMemo(() => new Map<string, any>(clients.map((c: any) => [c.id, c])), [clients]);

  // Earliest open filing per client + tax type = the one being worked on now.
  const current = useMemo(() => {
    const m = new Map<string, any>();
    for (const r of openReturns) {
      const key = `${r.client_id}:${r.return_type}`;
      if (!m.has(key)) m.set(key, r);
    }
    return m;
  }, [openReturns]);

  return { loading, reload: load, policies, clients, clientMap, obligations, current, receiptIds, staff, staffMap, filedThisYear };
}

export type TaxData = ReturnType<typeof useTaxData>;
