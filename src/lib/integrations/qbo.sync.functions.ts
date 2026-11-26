import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { syncQboRecordType } from "@/lib/integrations/qbo.sync.server";

const db = supabaseAdmin as any;
async function assertAccess(userId: string, clientId: string, action: "view" | "sync" | "approve") {
  const { data, error } = await db.rpc("integration_client_access_check", {
    _user_id: userId, _client_id: clientId, _action: action,
  });
  if (error || data !== true) throw new Error("You are not authorised to perform this integration action for this client.");
}
async function getConnection(clientId: string, integrationId: string) {
  const { data, error } = await db.from("client_integrations")
    .select("id,client_id,external_account_id,status,provider,environment")
    .eq("id", integrationId).eq("client_id", clientId)
    .eq("provider", "quickbooks_online").eq("environment", "sandbox").maybeSingle();
  if (error || !data || data.status !== "connected" || !/^\d{1,30}$/.test(data.external_account_id ?? "")) {
    throw new Error("A connected QuickBooks sandbox company is required.");
  }
  return data;
}

export const runQboReadOnlySync = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({
    client_id: z.string().uuid(), integration_id: z.string().uuid(),
    mode: z.enum(["initial", "incremental", "full"]).default("incremental"),
  }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAccess(context.userId, data.client_id, "sync");
    const connection = await getConnection(data.client_id, data.integration_id);
    const { data: previous } = await db.from("integration_sync_runs")
      .select("provider_cursor")
      .eq("integration_id", connection.id).eq("client_id", data.client_id)
      .eq("status", "succeeded").order("finished_at", { ascending: false }).limit(1).maybeSingle();

    const cursors = data.mode === "incremental" && previous?.provider_cursor && typeof previous.provider_cursor === "object"
      ? previous.provider_cursor as Record<string, string> : {};
    const runType = data.mode === "initial" ? "initial" : data.mode;
    const { data: run, error: runError } = await db.from("integration_sync_runs").insert({
      integration_id: connection.id, client_id: data.client_id,
      run_type: runType, status: "running", requested_by: context.userId, started_at: new Date().toISOString(),
    }).select("id").single();
    if (runError || !run?.id) throw new Error("Could not create the QuickBooks sync audit record.");

    const cursorsNext: Record<string, string> = { ...cursors };
    const totals = { records_seen: 0, records_created: 0, records_updated: 0, records_skipped: 0, records_failed: 0 };
    try {
      for (const type of ["Customer", "Invoice", "Payment"] as const) {
        const result = await syncQboRecordType({
          integrationId: connection.id, clientId: data.client_id,
          realmId: connection.external_account_id, type,
          since: data.mode === "incremental" ? cursors[type] ?? null : null,
          upsert: async (rows) => {
            const ids = rows.map((row) => String(row.external_record_id));
            const existingIds = new Set<string>();
            for (let i = 0; i < ids.length; i += 500) {
              const { data: existing, error } = await db.from("integration_external_records")
                .select("external_record_id")
                .eq("integration_id", connection.id).eq("external_record_type", type)
                .in("external_record_id", ids.slice(i, i + 500));
              if (error) throw new Error("Could not inspect existing QuickBooks mirror records.");
              for (const row of existing ?? []) existingIds.add(row.external_record_id);
            }
            const { error } = await db.from("integration_external_records")
              .upsert(rows, { onConflict: "integration_id,external_record_type,external_record_id" });
            if (error) throw new Error("Could not save QuickBooks mirror records.");
            return { created: ids.filter((id) => !existingIds.has(id)).length, updated: ids.filter((id) => existingIds.has(id)).length };
          },
        });
        totals.records_seen += result.records_seen;
        totals.records_created += result.records_created;
        totals.records_updated += result.records_updated;
        cursorsNext[type] = result.next_cursor;
      }
      const finishedAt = new Date().toISOString();
      await db.from("integration_sync_runs").update({
        status: "succeeded", finished_at: finishedAt,
        records_seen: totals.records_seen, records_created: totals.records_created,
        records_updated: totals.records_updated, records_skipped: totals.records_skipped,
        records_failed: totals.records_failed, provider_cursor: cursorsNext,
        summary: { entities: ["Customer", "Invoice", "Payment"], mode: data.mode },
      }).eq("id", run.id);
      await db.from("client_integrations").update({ last_synced_at: finishedAt })
        .eq("id", connection.id).eq("client_id", data.client_id);
      return { run_id: run.id, status: "succeeded" as const, ...totals };
    } catch (error) {
      await db.from("integration_sync_runs").update({
        status: "failed", finished_at: new Date().toISOString(),
        error_code: error instanceof Error && "code" in error ? String((error as Error & {code:string}).code).slice(0,80) : "sync_failed",
        error_summary: "QuickBooks synchronisation failed. Review the connection and retry; sensitive provider details are not retained.",
        provider_cursor: cursorsNext,
      }).eq("id", run.id);
      throw new Error("QuickBooks synchronisation failed. The attempt has been recorded; check the connection and retry.");
    }
  });

export const getQboMirrorRecords = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({
    client_id: z.string().uuid(), integration_id: z.string().uuid(),
    record_type: z.enum(["Customer", "Invoice", "Payment"]),
    limit: z.number().int().min(1).max(100).default(50),
  }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAccess(context.userId, data.client_id, "view");
    const connection = await getConnection(data.client_id, data.integration_id);
    const { data: records, error } = await db.from("integration_external_records")
      .select("id,external_record_type,external_record_id,display_name,document_number,transaction_date,due_date,total_amount,balance_amount,currency_code,record_data,synced_at")
      .eq("integration_id", connection.id).eq("client_id", data.client_id)
      .eq("external_record_type", data.record_type)
      .order("transaction_date", { ascending: false, nullsFirst: false })
      .order("synced_at", { ascending: false }).limit(data.limit);
    if (error) throw new Error("Could not load the QuickBooks read-only mirror.");
    return records ?? [];
  });
