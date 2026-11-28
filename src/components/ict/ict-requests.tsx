import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useLiveRefresh } from "@/hooks/use-live-refresh";
import { formatDate } from "@/lib/format";
import { ModalForm } from "@/components/modal-form";

const PRIORITIES = ["Low", "Medium", "High", "Critical"];
// "New" is what the database calls an open request.
const STATUS: Record<string, string> = { New: "Open", "In Progress": "In progress", Resolved: "Resolved" };
const FIELD = "w-full h-9 px-3 rounded-md border bg-background text-sm";
const isResolved = (t: any) => t.status === "Resolved" || t.status === "Closed";
const EMPTY = { title: "", description: "", priority: "Medium" };

export function IctRequests() {
  const { user, access } = useAuth();
  const [rows, setRows] = useState<any[]>([]);
  const [people, setPeople] = useState<{ id: string; full_name: string | null }[]>([]);
  const [team, setTeam] = useState<string[]>([]);
  const [showResolved, setShowResolved] = useState(false);
  const [form, setForm] = useState<typeof EMPTY | null>(null);
  const [fixing, setFixing] = useState<{ id: string; title: string; note: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const canManage = access("ict_service_desk") === "full" || (!!user && team.includes(user.id));

  // The database decides who sees which requests (own ones, or all for the ICT team).
  async function load() {
    const [t, p, m] = await Promise.all([
      supabase.from("ict_tickets").select("*").order("created_at", { ascending: false }),
      supabase.from("profiles").select("id, full_name").order("full_name"),
      supabase.from("ict_service_desk_team").select("user_id"),
    ]);
    if (t.error) toast.error(t.error.message);
    setRows(t.data ?? []);
    setPeople(p.data ?? []);
    setTeam((m.data ?? []).map((x: any) => x.user_id));
  }
  useEffect(() => { void load(); }, []);
  useLiveRefresh(["ict_tickets"], load);

  const nameOf = (id?: string | null) => people.find((p) => p.id === id)?.full_name ?? "—";
  const handlers = team.length ? people.filter((p) => team.includes(p.id)) : people;

  async function raise(e: React.FormEvent) {
    e.preventDefault();
    if (!form || !user || saving) return;
    setSaving(true);
    const { error } = await supabase.from("ict_tickets").insert({
      title: form.title.trim(), description: form.description.trim() || null, priority: form.priority, reported_by: user.id,
    } as any);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Sent to ICT");
    setForm(null);
    void load();
  }

  async function update(id: string, patch: Record<string, unknown>) {
    const { error } = await supabase.from("ict_tickets").update(patch as any).eq("id", id);
    if (error) toast.error(error.message);
    void load();
    return !error;
  }

  const visible = rows.filter((t) => showResolved || !isResolved(t));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="text-sm inline-flex items-center gap-2"><input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} /> Show resolved</label>
        <button onClick={() => setForm(EMPTY)} className="h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm inline-flex items-center gap-2"><Plus className="h-4 w-4" /> Report a problem</button>
      </div>

      <div className="bg-card border rounded-lg divide-y">
        {visible.length === 0 && <div className="py-10 text-center text-sm text-muted-foreground">No {showResolved ? "" : "open "}requests.</div>}
        {visible.map((t) => (
          <div key={t.id} className="p-3 flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="flex-1 min-w-[14rem]">
              <div className="font-medium text-sm">{t.title}</div>
              <div className="text-xs text-muted-foreground">{[t.ticket_number, nameOf(t.reported_by), formatDate(t.created_at)].filter(Boolean).join(" · ")}</div>
              {t.description && <div className="text-xs mt-1 whitespace-pre-wrap">{t.description}</div>}
              {isResolved(t) && t.resolution_note && <div className="text-xs mt-1 text-emerald-700 dark:text-emerald-300">Fix: {t.resolution_note}</div>}
            </div>
            <span className={`text-xs px-2 py-0.5 rounded-full ${t.priority === "Critical" || t.priority === "High" ? "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200" : "bg-muted text-muted-foreground"}`}>{t.priority}</span>
            {canManage ? (
              <>
                <select value={t.assigned_to ?? ""} onChange={(e) => void update(t.id, { assigned_to: e.target.value || null })} className="h-8 px-2 rounded-md border bg-background text-xs" aria-label="Handled by">
                  <option value="">Nobody yet</option>
                  {handlers.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                </select>
                <select value={t.status} onChange={(e) => e.target.value === "Resolved" ? setFixing({ id: t.id, title: t.title, note: "" }) : void update(t.id, { status: e.target.value })} className="h-8 px-2 rounded-md border bg-background text-xs" aria-label="Status">
                  {!STATUS[t.status] && <option value={t.status}>{t.status}</option>}
                  {Object.entries(STATUS).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
                </select>
              </>
            ) : (
              <span className="text-xs text-muted-foreground">{STATUS[t.status] ?? t.status}{t.assigned_to ? ` · ${nameOf(t.assigned_to)}` : ""}</span>
            )}
          </div>
        ))}
      </div>

      {form && (
        <ModalForm title="Report a problem" onClose={() => setForm(null)} onSubmit={raise}>
          <input required autoFocus placeholder="What is wrong?" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className={FIELD} />
          <textarea rows={3} placeholder="Details (optional)" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="w-full px-3 py-2 rounded-md border bg-background text-sm" />
          <label className="block text-xs text-muted-foreground">Priority
            <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} className={`mt-1 ${FIELD}`}>{PRIORITIES.map((p) => <option key={p}>{p}</option>)}</select>
          </label>
          <button disabled={saving} className="w-full h-10 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50">{saving ? "Sending…" : "Send to ICT"}</button>
        </ModalForm>
      )}

      {fixing && (
        <ModalForm title={`Resolve: ${fixing.title}`} onClose={() => setFixing(null)} onSubmit={async (e) => {
          e.preventDefault();
          if (!fixing.note.trim()) return;
          if (await update(fixing.id, { status: "Resolved", resolution_note: fixing.note.trim() })) setFixing(null);
        }}>
          <textarea required autoFocus rows={3} placeholder="What fixed it?" value={fixing.note} onChange={(e) => setFixing({ ...fixing, note: e.target.value })} className="w-full px-3 py-2 rounded-md border bg-background text-sm" />
          <button className="w-full h-10 rounded-md bg-primary text-primary-foreground text-sm font-medium">Mark resolved</button>
        </ModalForm>
      )}
    </div>
  );
}
