import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { Ticket, HardDrive, Wrench, AlertTriangle, Plus, X, Pencil, Trash2 } from "lucide-react";

export const Route = createFileRoute("/_authed/ict-service-desk")({
  head: () => ({
    meta: [
      { title: "ICT Service Desk | G.K Nahashon & Company" },
      { name: "description", content: "Internal IT support, assets and maintenance." },
    ],
  }),
  component: IctServiceDesk,
});

const CATEGORIES = ["Hardware", "Software", "Network", "Access/Account", "Other"];
const PRIORITIES = ["Low", "Medium", "High", "Critical"];
const STATUSES = ["New", "In Progress", "On Hold", "Resolved", "Closed"];
const EMPTY_FORM = { title: "", description: "", category: CATEGORIES[0], priority: "Medium", assigned_to: "" };
const EMPTY_ASSET_FORM = { id: "", name: "", description: "", quantity: "1", unit_cost: "", purchase_date: "", assigned_to: "" };

const PRIORITY_COLORS: Record<string, string> = {
  Low: "bg-muted text-muted-foreground",
  Medium: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200",
  High: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  Critical: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
};

const STATUS_COLORS: Record<string, string> = {
  New: "bg-muted text-muted-foreground",
  "In Progress": "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200",
  "On Hold": "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  Resolved: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  Closed: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
};

type Ticket = {
  id: string;
  ticket_number: string | null;
  title: string;
  description: string | null;
  category: string | null;
  priority: string | null;
  status: string;
  reported_by: string;
  assigned_to: string | null;
  created_at: string;
};

type Asset = {
  id: string;
  name: string;
  description: string | null;
  quantity: number;
  unit_cost: number | null;
  purchase_date: string | null;
  assigned_to: string | null;
  created_at: string;
};

function StatCard({ icon: Icon, label, value }: { icon: any; label: string; value: number }) {
  return (
    <div className="bg-card rounded-lg border p-4 h-full">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider">{label}</span>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="mt-2 text-2xl font-bold">{value}</div>
    </div>
  );
}

function IctServiceDesk() {
  const { user, access, canCreate } = useAuth();
  const fullAccess = access("ict_service_desk") === "full";
  // ICT team members (Amos, Herman, ...) work the desk: they see and update
  // every ticket. Assets + deleting tickets stay Director/Admin only.
  const [isIctTeam, setIsIctTeam] = useState(false);
  const canManageTickets = fullAccess || isIctTeam;
  const canRaiseTicket = canCreate("ict_service_desk");

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [staff, setStaff] = useState<{ id: string; full_name: string | null }[]>([]);
  const [allStaff, setAllStaff] = useState<{ id: string; full_name: string | null }[]>([]);
  const [openCount, setOpenCount] = useState(0);
  const [criticalCount, setCriticalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const [assets, setAssets] = useState<Asset[]>([]);
  const [assetTotalQty, setAssetTotalQty] = useState(0);
  const [assetFormOpen, setAssetFormOpen] = useState(false);
  const [assetForm, setAssetForm] = useState(EMPTY_ASSET_FORM);
  const [assetSaving, setAssetSaving] = useState(false);

  // RLS already scopes this correctly: regular staff only see tickets they
  // reported, full-access roles (Director/Admin) see every ticket — so a
  // plain select gives each viewer exactly the counts/rows they should see.
  async function load() {
    setLoading(true);
    const [ticketsRes, openRes, criticalRes, staffRes, assetsRes, teamRes] = await Promise.all([
      supabase.from("ict_tickets").select("*").order("created_at", { ascending: false }),
      supabase.from("ict_tickets").select("id", { count: "exact", head: true }).not("status", "in", "(Resolved,Closed)"),
      supabase.from("ict_tickets").select("id", { count: "exact", head: true }).eq("priority", "Critical"),
      supabase.from("profiles").select("id, full_name").order("full_name"),
      // ict_assets is RLS-restricted to Director/Admin; this simply returns
      // nothing for everyone else instead of erroring.
      fullAccess ? supabase.from("ict_assets").select("*").order("name") : Promise.resolve({ data: [], error: null }),
      supabase.from("ict_service_desk_team").select("user_id"),
    ]);
    if (ticketsRes.error) toast.error(ticketsRes.error.message);
    if (assetsRes.error) toast.error(assetsRes.error.message);
    setTickets((ticketsRes.data as Ticket[]) ?? []);
    setOpenCount(openRes.count ?? 0);
    setCriticalCount(criticalRes.count ?? 0);
    const directory = (staffRes.data as any[]) ?? [];
    setAllStaff(directory);
    // Ticket assignees are the ICT service-desk team (ict_service_desk_team
    // table). Falls back to matching Amos/Herman by name if it's still empty.
    const teamIds = new Set(((teamRes.data as any[]) ?? []).map((t) => t.user_id));
    setIsIctTeam(!!user && teamIds.has(user.id));
    setStaff(
      teamIds.size > 0
        ? directory.filter((p) => teamIds.has(p.id))
        : directory.filter((p) => ["amos", "herman"].some((n) => (p.full_name ?? "").toLowerCase().includes(n))),
    );
    const assetRows = (assetsRes.data as Asset[]) ?? [];
    setAssets(assetRows);
    setAssetTotalQty(assetRows.reduce((sum, a) => sum + (a.quantity ?? 0), 0));
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  // Live refresh: a newly raised or updated ticket shows up without a reload.
  useEffect(() => {
    const ch = supabase
      .channel("ict-desk-tickets")
      .on("postgres_changes", { event: "*", schema: "public", table: "ict_tickets" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  // Only full-access roles (Director/Admin) hit this — the RLS "update"
  // policy on ict_tickets enforces the same rule server-side regardless.
  async function updateTicket(id: string, patch: Partial<Pick<Ticket, "status" | "assigned_to">>) {
    setTickets((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t))); // optimistic
    const { error } = await supabase.from("ict_tickets").update(patch).eq("id", id);
    if (error) { toast.error(error.message); load(); return; }
    toast.success("Ticket updated");
  }

  function openNewAsset() { setAssetForm(EMPTY_ASSET_FORM); setAssetFormOpen(true); }
  function openEditAsset(a: Asset) {
    setAssetForm({
      id: a.id,
      name: a.name,
      description: a.description ?? "",
      quantity: String(a.quantity ?? 1),
      unit_cost: a.unit_cost != null ? String(a.unit_cost) : "",
      purchase_date: a.purchase_date ?? "",
      assigned_to: a.assigned_to ?? "",
    });
    setAssetFormOpen(true);
  }

  // ict_assets RLS restricts insert/update/delete to Director/Admin ("full"
  // rank on ict_service_desk) regardless of what the UI shows.
  async function saveAsset(e: React.FormEvent) {
    e.preventDefault();
    if (!assetForm.name.trim() || !user) return;
    setAssetSaving(true);
    const payload = {
      name: assetForm.name.trim(),
      description: assetForm.description.trim() || null,
      quantity: Number(assetForm.quantity) || 1,
      unit_cost: assetForm.unit_cost ? Number(assetForm.unit_cost) : null,
      purchase_date: assetForm.purchase_date || null,
      assigned_to: assetForm.assigned_to || null,
    };
    const { error } = assetForm.id
      ? await supabase.from("ict_assets").update(payload).eq("id", assetForm.id)
      : await supabase.from("ict_assets").insert({ ...payload, created_by: user.id });
    setAssetSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(assetForm.id ? "Asset updated" : "Asset added");
    setAssetFormOpen(false);
    load();
  }

  async function deleteAsset(id: string) {
    if (!confirm("Delete this asset?")) return;
    const { error } = await supabase.from("ict_assets").delete().eq("id", id);
    if (error) toast.error(error.message); else { toast.success("Asset deleted"); load(); }
  }

  async function deleteTicket(id: string) {
    if (!confirm("Delete this ticket?")) return;
    const { error } = await supabase.from("ict_tickets").delete().eq("id", id);
    if (error) toast.error(error.message); else { toast.success("Ticket deleted"); load(); }
  }

  async function submitTicket(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim() || !user) return;
    setSaving(true);
    const { data, error } = await supabase
      .from("ict_tickets")
      .insert({
        title: form.title.trim(),
        description: form.description.trim() || null,
        category: form.category,
        priority: form.priority,
        assigned_to: form.assigned_to || null,
        reported_by: user.id,
      })
      .select("ticket_number")
      .single();
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`Ticket ${data?.ticket_number ?? ""} raised`.trim());
    setForm(EMPTY_FORM);
    setFormOpen(false);
    load();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap justify-between items-center gap-3">
        <div>
          <h1 className="text-2xl font-bold">ICT Service Desk</h1>
          <p className="text-sm text-muted-foreground">Internal IT support, assets and maintenance.</p>
        </div>
        {canRaiseTicket && (
          <button
            onClick={() => setFormOpen(true)}
            className="h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm inline-flex items-center gap-2"
          >
            <Plus className="h-4 w-4" /> Raise a ticket
          </button>
        )}
      </div>

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <StatCard icon={Ticket} label="Open Tickets" value={openCount} />
        {fullAccess && <StatCard icon={HardDrive} label="Assets" value={assetTotalQty} />}
        <StatCard icon={Wrench} label="Active Maintenance" value={0} />
        <StatCard icon={AlertTriangle} label="Critical Issues" value={criticalCount} />
      </div>

      <div className="bg-card border rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b text-sm font-medium">
          {canManageTickets ? "All tickets" : "Your tickets"}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs text-muted-foreground border-b">
              <tr>
                <th className="py-2 px-3">Ticket</th>
                <th>Category</th>
                <th>Priority</th>
                <th>Status</th>
                <th>Assignee</th>
                <th>Raised</th>
                {fullAccess && <th></th>}
              </tr>
            </thead>
            <tbody>
              {!loading && tickets.length === 0 && (
                <tr><td colSpan={fullAccess ? 7 : 6} className="py-10 text-center text-muted-foreground">No tickets yet.</td></tr>
              )}
              {tickets.map((t) => (
                <tr key={t.id} className="border-b last:border-0 hover:bg-muted/30">
                  <td className="py-2 px-3">
                    <div className="font-medium">{t.title}</div>
                    <div className="text-xs text-muted-foreground">{t.ticket_number}</div>
                  </td>
                  <td className="text-xs text-muted-foreground">{t.category ?? "—"}</td>
                  <td><span className={`text-xs px-2 py-0.5 rounded ${PRIORITY_COLORS[t.priority ?? ""] ?? "bg-muted text-muted-foreground"}`}>{t.priority ?? "—"}</span></td>
                  <td>
                    {canManageTickets ? (
                      <select
                        value={t.status}
                        onChange={(e) => updateTicket(t.id, { status: e.target.value })}
                        className={`h-7 px-2 rounded text-xs border bg-background ${STATUS_COLORS[t.status] ?? ""}`}
                      >
                        {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    ) : (
                      <span className={`text-xs px-2 py-0.5 rounded ${STATUS_COLORS[t.status] ?? "bg-muted text-muted-foreground"}`}>{t.status}</span>
                    )}
                  </td>
                  <td>
                    {canManageTickets ? (
                      <select
                        value={t.assigned_to ?? ""}
                        onChange={(e) => updateTicket(t.id, { assigned_to: e.target.value || null })}
                        className="h-7 px-2 rounded text-xs border bg-background"
                      >
                        <option value="">Unassigned</option>
                        {staff.map((s) => <option key={s.id} value={s.id}>{s.full_name ?? "Unnamed"}</option>)}
                      </select>
                    ) : (
                      <span className="text-xs">{allStaff.find((p) => p.id === t.assigned_to)?.full_name ?? "Unassigned"}</span>
                    )}
                  </td>
                  <td className="text-xs text-muted-foreground">{new Date(t.created_at).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" })}</td>
                  {fullAccess && (
                    <td className="pr-2 text-right">
                      <button onClick={() => deleteTicket(t.id)} title="Delete" className="p-1 hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {fullAccess && (
        <div className="bg-card border rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b flex items-center justify-between">
            <span className="text-sm font-medium">IT Assets</span>
            <button
              onClick={openNewAsset}
              className="h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs inline-flex items-center gap-1.5"
            >
              <Plus className="h-3.5 w-3.5" /> Add asset
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-xs text-muted-foreground border-b">
                <tr>
                  <th className="py-2 px-3">Item</th>
                  <th>Qty</th>
                  <th>Unit cost</th>
                  <th>Total</th>
                  <th>Date bought</th>
                  <th>Assigned to</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {assets.length === 0 && (
                  <tr><td colSpan={7} className="py-10 text-center text-muted-foreground">No assets recorded yet.</td></tr>
                )}
                {assets.map((a) => {
                  const assignee = allStaff.find((s) => s.id === a.assigned_to);
                  const total = a.unit_cost != null ? a.unit_cost * a.quantity : null;
                  return (
                    <tr key={a.id} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="py-2 px-3">
                        <div className="font-medium">{a.name}</div>
                        {a.description && <div className="text-xs text-muted-foreground">{a.description}</div>}
                      </td>
                      <td className="text-xs">{a.quantity}</td>
                      <td className="text-xs">{a.unit_cost != null ? a.unit_cost.toLocaleString("en-KE", { style: "currency", currency: "KES" }) : "—"}</td>
                      <td className="text-xs">{total != null ? total.toLocaleString("en-KE", { style: "currency", currency: "KES" }) : "—"}</td>
                      <td className="text-xs text-muted-foreground">{a.purchase_date ? new Date(a.purchase_date).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" }) : "—"}</td>
                      <td className="text-xs">{assignee?.full_name ?? "Office (shared)"}</td>
                      <td className="pr-2 text-right space-x-1 whitespace-nowrap">
                        <button onClick={() => openEditAsset(a)} title="Edit" className="p-1 hover:text-primary"><Pencil className="h-3.5 w-3.5" /></button>
                        <button onClick={() => deleteAsset(a.id)} title="Delete" className="p-1 hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {formOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setFormOpen(false)}>
          <form onClick={(e) => e.stopPropagation()} onSubmit={submitTicket} className="bg-card w-full max-w-md rounded-lg p-6 space-y-3">
            <div className="flex justify-between">
              <h2 className="text-lg font-semibold">Raise a ticket</h2>
              <button type="button" onClick={() => setFormOpen(false)}><X className="h-4 w-4" /></button>
            </div>
            <input
              required
              placeholder="Title"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              className="w-full h-9 px-3 rounded-md border bg-background text-sm"
            />
            <textarea
              placeholder="Describe the issue"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={3}
              className="w-full px-3 py-2 rounded-md border bg-background text-sm"
            />
            <div className="grid grid-cols-2 gap-2">
              <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="h-9 px-3 rounded-md border bg-background text-sm">
                {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
              </select>
              <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} className="h-9 px-3 rounded-md border bg-background text-sm">
                {PRIORITIES.map((p) => <option key={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Assign to (ICT)</label>
              <select
                value={form.assigned_to}
                onChange={(e) => setForm({ ...form, assigned_to: e.target.value })}
                className="w-full h-9 px-3 rounded-md border bg-background text-sm mt-1"
              >
                <option value="">Any ICT team member</option>
                {staff.map((s) => <option key={s.id} value={s.id}>{s.full_name ?? "Unnamed"}</option>)}
              </select>
            </div>
            <button disabled={saving} className="w-full h-10 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50">
              {saving ? "Submitting…" : "Submit ticket"}
            </button>
          </form>
        </div>
      )}

      {assetFormOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setAssetFormOpen(false)}>
          <form onClick={(e) => e.stopPropagation()} onSubmit={saveAsset} className="bg-card w-full max-w-md rounded-lg p-6 space-y-3">
            <div className="flex justify-between">
              <h2 className="text-lg font-semibold">{assetForm.id ? "Edit asset" : "Add asset"}</h2>
              <button type="button" onClick={() => setAssetFormOpen(false)}><X className="h-4 w-4" /></button>
            </div>
            <input
              required
              placeholder="Item name (e.g. Dell Latitude laptop, HP LaserJet printer)"
              value={assetForm.name}
              onChange={(e) => setAssetForm({ ...assetForm, name: e.target.value })}
              className="w-full h-9 px-3 rounded-md border bg-background text-sm"
            />
            <textarea
              placeholder="Description"
              value={assetForm.description}
              onChange={(e) => setAssetForm({ ...assetForm, description: e.target.value })}
              rows={2}
              className="w-full px-3 py-2 rounded-md border bg-background text-sm"
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                type="number" min={1} required
                placeholder="Quantity"
                value={assetForm.quantity}
                onChange={(e) => setAssetForm({ ...assetForm, quantity: e.target.value })}
                className="h-9 px-3 rounded-md border bg-background text-sm"
              />
              <input
                type="number" min={0} step="0.01"
                placeholder="Unit cost (KES)"
                value={assetForm.unit_cost}
                onChange={(e) => setAssetForm({ ...assetForm, unit_cost: e.target.value })}
                className="h-9 px-3 rounded-md border bg-background text-sm"
              />
              <input
                type="date"
                value={assetForm.purchase_date}
                onChange={(e) => setAssetForm({ ...assetForm, purchase_date: e.target.value })}
                className="h-9 px-3 rounded-md border bg-background text-sm"
              />
              <select
                value={assetForm.assigned_to}
                onChange={(e) => setAssetForm({ ...assetForm, assigned_to: e.target.value })}
                className="h-9 px-3 rounded-md border bg-background text-sm"
              >
                <option value="">Office (shared)</option>
                {allStaff.map((s) => <option key={s.id} value={s.id}>{s.full_name ?? "Unnamed"}</option>)}
              </select>
            </div>
            <button disabled={assetSaving} className="w-full h-10 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50">
              {assetSaving ? "Saving…" : assetForm.id ? "Save changes" : "Add asset"}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

