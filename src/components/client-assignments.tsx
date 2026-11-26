import { useEffect, useState } from "react";
import { notifyUser } from "@/lib/notify";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { UserPlus, X, Users } from "lucide-react";
import { useAuth } from "@/lib/auth";

type Assn = { id: string; user_id: string; role_on_engagement: string | null; assigned_by?: string | null; profile?: { full_name: string | null } | null };
type Oblig = { id: string; client_id: string; tax_type: string; user_id: string };

export function ClientAssignments({ clientId, compact = false }: { clientId: string; compact?: boolean }) {
  const { user, isAdmin } = useAuth();
  const [rows, setRows] = useState<Assn[]>([]);
  const [profiles, setProfiles] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState("");
  // Obligations (tax types) this client is obligated for, and the standing
  // obligation assignments per staff member.
  const [clientTypes, setClientTypes] = useState<{ tax_type: string; label: string }[]>([]);
  const [oblig, setOblig] = useState<Oblig[]>([]);
  const [pickedTypes, setPickedTypes] = useState<string[]>([]);

  async function load() {
    const [aRes, pRes, oRes, polRes, oaRes] = await Promise.all([
      supabase.from("client_assignments").select("*").eq("client_id", clientId),
      supabase.from("profiles").select("id, full_name").order("full_name"),
      supabase.from("client_tax_obligations").select("tax_type, active").eq("client_id", clientId),
      supabase.from("tax_policies").select("tax_type, label").order("sort_order"),
      supabase.from("client_obligation_assignees" as any).select("*").eq("client_id", clientId),
    ]);
    const profs = pRes.data ?? [];
    setProfiles(profs);
    const byId = new Map(profs.map((p: any) => [p.id, p]));
    setRows((aRes.data ?? []).map((r: any) => ({ ...r, profile: byId.get(r.user_id) ?? null })));
    const labels = new Map((polRes.data ?? []).map((p: any) => [p.tax_type, p.label]));
    setClientTypes((oRes.data ?? []).filter((o: any) => o.active !== false).map((o: any) => ({ tax_type: o.tax_type, label: labels.get(o.tax_type) ?? o.tax_type })));
    setOblig(((oaRes.data as any[]) ?? []) as Oblig[]);
  }
  useEffect(() => { if (clientId) load(); }, [clientId]);

  const labelOf = (t: string) => clientTypes.find(c => c.tax_type === t)?.label ?? t;

  // Give `uid` the chosen obligations: standing rule (for future periods) +
  // the client's currently open filings of those types.
  async function giveObligations(uid: string, types: string[], clientName?: string) {
    if (types.length === 0) return;
    const { error } = await supabase.from("client_obligation_assignees" as any).upsert(
      types.map(t => ({ client_id: clientId, tax_type: t, user_id: uid, assigned_by: user?.id ?? null })) as any,
      { onConflict: "client_id,tax_type,user_id", ignoreDuplicates: true },
    );
    if (error) { toast.error(error.message); return; }

    const { data: open } = await supabase.from("tax_returns").select("id, return_type, assigned_to")
      .eq("client_id", clientId).in("return_type", types as any).neq("status", "filed");
    for (const r of (open ?? []) as any[]) {
      if (!r.assigned_to) {
        await supabase.from("tax_returns").update({ assigned_to: uid } as any).eq("id", r.id);
      } else if (r.assigned_to !== uid) {
        await supabase.from("tax_return_assignees" as any).upsert(
          { tax_return_id: r.id, user_id: uid, role: "Assigned obligation", assigned_by: user?.id ?? null } as any,
          { onConflict: "tax_return_id,user_id", ignoreDuplicates: true },
        );
      }
    }
    if (uid !== user?.id) {
      await notifyUser({
        user_id: uid, type: "tax",
        title: "Tax obligations assigned to you",
        body: `${clientName ? clientName + ": " : ""}${types.map(labelOf).join(", ")}`,
        link: `/clients/${clientId}`,
      } as any);
    }
  }

  async function add() {
    if (!userId) return;
    const { error } = await supabase.from("client_assignments").insert({ client_id: clientId, user_id: userId, role_on_engagement: role || null, assigned_by: user?.id ?? null });
    if (error) return toast.error(error.message);

    const { data: client } = await supabase.from("clients").select("company_name").eq("id", clientId).maybeSingle();
    const clientName = client?.company_name;

    if (userId !== user?.id) {
      await notifyUser({
        user_id: userId, type: "client_assigned",
        title: "Assigned to a client",
        body: clientName ? `You were assigned to ${clientName}${role ? ` as ${role}` : ""}` : "You were assigned to a client",
        link: `/clients/${clientId}`,
      });
    }
    await giveObligations(userId, pickedTypes, clientName ?? undefined);
    setUserId(""); setRole(""); setPickedTypes([]); setOpen(false); load();
  }

  // Add more obligations to someone who is already assigned.
  async function addObligation(uid: string, type: string) {
    await giveObligations(uid, [type]);
    load();
  }
  async function removeObligation(id: string) {
    const { error } = await supabase.from("client_obligation_assignees" as any).delete().eq("id", id);
    if (error) toast.error(error.message); else load();
  }

  async function remove(id: string) {
    const target = rows.find(r => r.id === id);
    const { error } = await supabase.from("client_assignments").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    // Stop future periods from picking this person up. Past/filed records keep
    // their assignee so the filing history stays accurate.
    if (target) await supabase.from("client_obligation_assignees" as any).delete().eq("client_id", clientId).eq("user_id", target.user_id);
    load();
  }
  function canRemove(r: Assn) {
    return isAdmin || r.assigned_by == null || r.assigned_by === user?.id;
  }

  const available = profiles.filter(p => !rows.some(r => r.user_id === p.id));

  if (compact) {
    if (rows.length === 0) return <span className="text-xs text-muted-foreground">—</span>;
    return (
      <div className="flex flex-wrap gap-1">
        {rows.slice(0, 3).map(r => (
          <span key={r.id} className="text-xs px-1.5 py-0.5 rounded bg-muted">{r.profile?.full_name ?? "?"}</span>
        ))}
        {rows.length > 3 && <span className="text-xs text-muted-foreground">+{rows.length - 3}</span>}
      </div>
    );
  }

  return (
    <div className="bg-card border rounded-lg p-4">
      <div className="flex justify-between items-center mb-3">
        <h3 className="font-semibold inline-flex items-center gap-2"><Users className="h-4 w-4" /> Assigned staff</h3>
        <button onClick={() => setOpen(o => !o)} className="text-xs text-primary inline-flex items-center gap-1"><UserPlus className="h-3 w-3" /> Assign</button>
      </div>
      {open && (
        <div className="space-y-2 mb-3 p-2 border rounded-md bg-muted/30">
          <div className="flex flex-wrap gap-2">
            <select value={userId} onChange={e => setUserId(e.target.value)} className="h-8 px-2 rounded border bg-background text-sm flex-1 min-w-[140px]">
              <option value="">Select staff…</option>
              {available.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
            </select>
            <input value={role} onChange={e => setRole(e.target.value)} placeholder="Role (e.g. Lead, Reviewer)" className="h-8 px-2 rounded border bg-background text-sm flex-1 min-w-[140px]" />
            <button onClick={add} className="h-8 px-3 rounded bg-primary text-primary-foreground text-xs">Add</button>
          </div>
          {clientTypes.length > 0 && (
            <div>
              <div className="text-xs text-muted-foreground mb-1">Give them these obligations under this client</div>
              <div className="flex flex-wrap gap-2">
                {clientTypes.map(t => {
                  const on = pickedTypes.includes(t.tax_type);
                  return (
                    <label key={t.tax_type} className={`flex items-center gap-1.5 px-2 py-1 rounded cursor-pointer text-xs border ${on ? "bg-primary/10 text-primary border-primary/40" : "bg-background hover:bg-muted"}`}>
                      <input type="checkbox" checked={on} onChange={e => setPickedTypes(cur => e.target.checked ? [...cur, t.tax_type] : cur.filter(x => x !== t.tax_type))} />
                      {t.label}
                    </label>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No one assigned yet.</p>
      ) : (
        <div className="space-y-2">
          {rows.map(r => {
            const mine = oblig.filter(o => o.user_id === r.user_id);
            const missing = clientTypes.filter(t => !mine.some(o => o.tax_type === t.tax_type));
            return (
              <div key={r.id} className="text-sm py-1">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-medium">{r.profile?.full_name ?? "Unknown"}</span>
                    {r.role_on_engagement && <span className="text-xs text-muted-foreground ml-2">{r.role_on_engagement}</span>}
                  </div>
                  {canRemove(r) && <button onClick={() => remove(r.id)} className="text-muted-foreground hover:text-destructive"><X className="h-3.5 w-3.5" /></button>}
                </div>
                {(mine.length > 0 || missing.length > 0) && (
                  <div className="flex flex-wrap items-center gap-1 mt-1">
                    {mine.map(o => (
                      <span key={o.id} className="text-[11px] px-1.5 py-0.5 rounded bg-primary/10 text-primary inline-flex items-center gap-1">
                        {labelOf(o.tax_type)}
                        <button onClick={() => removeObligation(o.id)} aria-label="Remove obligation" className="hover:text-destructive"><X className="h-2.5 w-2.5" /></button>
                      </span>
                    ))}
                    {missing.length > 0 && (
                      <select value="" onChange={e => e.target.value && addObligation(r.user_id, e.target.value)} className="h-6 px-1 rounded border bg-background text-[11px] text-muted-foreground">
                        <option value="">+ obligation</option>
                        {missing.map(t => <option key={t.tax_type} value={t.tax_type}>{t.label}</option>)}
                      </select>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
