import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Plus, Search, X, Pause, Play, Trash2 } from "lucide-react";
import { STATUS_COLORS, statusLabel, formatDate } from "@/lib/format";
import { CsvImport } from "@/components/csv-import";
import { clientMatches } from "@/lib/client-search";
import { useAuth } from "@/lib/auth";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/_authed/clients/")({ component: ClientsList });

const STATUSES = ["not_started","in_progress","waiting_for_documents","under_review","filed","completed","overdue","urgent"];

function ClientsList() {
  const navigate = useNavigate();
  const { isAdmin, canCreate, canDelete } = useAuth();
  const [rows, setRows] = useState<any[]>([]);
  const [assignByClient, setAssignByClient] = useState<Record<string, string[]>>({});
  const [q, setQ] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all"|"company"|"individual">("all");
  const [stateFilter, setStateFilter] = useState<"active"|"paused"|"all">("active");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>({ client_type:"company", company_name:"", first_name:"", last_name:"", id_number:"", kra_pin:"", reg_number:"", industry:"", email:"", phone:"", engagement_type:"", notes:"" });
  const [busy, setBusy] = useState(false);

  async function load() {
    const [cRes, aRes, pRes] = await Promise.all([
      supabase.from("clients").select("*").order("updated_at", { ascending: false }).order("created_at", { ascending: false }).order("company_name", { ascending: true }),
      supabase.from("client_assignments").select("client_id, user_id"),
      supabase.from("profiles").select("id, full_name"),
    ]);
    if (cRes.error) toast.error(cRes.error.message);
    setRows(cRes.data ?? []);
    const profById = new Map((pRes.data ?? []).map((p: any) => [p.id, p.full_name as string]));
    const map: Record<string, string[]> = {};
    (aRes.data ?? []).forEach((a: any) => {
      const name = profById.get(a.user_id) ?? "?";
      (map[a.client_id] ||= []).push(name);
    });
    setAssignByClient(map);
  }
  useEffect(() => { load(); }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { data: { user } } = await supabase.auth.getUser();
    const payload: any = { ...form, created_by: user?.id };
    if (form.client_type === "individual") {
      const full = [form.first_name, form.last_name].filter(Boolean).join(" ").trim();
      if (!form.company_name?.trim()) payload.company_name = full || "Individual";
      payload.reg_number = null;
    }
    const { error } = await supabase.from("clients").insert(payload);
    setBusy(false);
    if (error) toast.error(error.message);
    else { toast.success("Client added"); setOpen(false); setForm({ client_type:"company", company_name:"", first_name:"", last_name:"", id_number:"", kra_pin:"", reg_number:"", industry:"", email:"", phone:"", engagement_type:"", notes:"" }); load(); }
  }

  const filtered = useMemo(() => rows
    .filter(r =>
      // Paused clients remain visible only to Admin/Director.
      (isAdmin || !r.is_paused) &&
      (typeFilter === "all" || (r.client_type ?? "company") === typeFilter) &&
      (isAdmin ? (stateFilter === "all" || (stateFilter === "paused" ? r.is_paused : !r.is_paused)) : !r.is_paused) &&
      clientMatches(r, q.trim())
    )
    .sort((a, b) => {
      const nameA = String(a.company_name ?? [a.first_name, a.last_name].filter(Boolean).join(" ") ?? "").trim();
      const nameB = String(b.company_name ?? [b.first_name, b.last_name].filter(Boolean).join(" ") ?? "").trim();
      return nameA.localeCompare(nameB, undefined, { sensitivity: "base", numeric: true });
    }), [rows, typeFilter, stateFilter, q, isAdmin]);

  const pausedCount = rows.filter(r => r.is_paused).length;

  function toggleSelected(id: string) {
    setSelected(s => { const next = new Set(s); next.has(id) ? next.delete(id) : next.add(id); return next; });
  }
  function toggleSelectAll() {
    setSelected(s => s.size === filtered.length ? new Set() : new Set(filtered.map(r => r.id)));
  }

  async function setPaused(ids: string[], paused: boolean) {
    if (!isAdmin) { toast.error("Only an Admin or Director can activate or deactivate clients"); return; }
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from("clients").update(
      paused ? { is_paused: true, paused_at: new Date().toISOString(), paused_by: user?.id ?? null }
             : { is_paused: false, paused_at: null, paused_by: null }
    ).in("id", ids);
    if (error) toast.error(error.message);
    else { toast.success(paused ? `${ids.length > 1 ? "Clients" : "Client"} paused` : `${ids.length > 1 ? "Clients" : "Client"} resumed`); load(); }
  }

  async function bulkPause(paused: boolean) {
    setBulkBusy(true);
    await setPaused([...selected], paused);
    setBulkBusy(false);
    setSelected(new Set());
  }
  async function bulkDelete() {
    setBulkBusy(true);
    const { error } = await supabase.from("clients").delete().in("id", [...selected]);
    setBulkBusy(false);
    if (error) toast.error(error.message);
    else { toast.success(`${selected.size} client${selected.size > 1 ? "s" : ""} deleted`); setSelected(new Set()); load(); }
  }

  return (
    <div className="flex flex-col gap-4 h-[calc(100vh-6.5rem)]">
      <div className="shrink-0 flex flex-wrap items-center gap-3 justify-between">
        <div>
          <h1 className="text-2xl font-bold">Clients</h1>
          <p className="text-sm text-muted-foreground">{rows.length} total</p>
        </div>
        <div className="flex gap-2">
          {canCreate("clients") && (
            <>
              <CsvImport
                table="clients"
                fields={[
                  { key:"company_name", label:"Company name", required:true },
                  { key:"kra_pin", label:"KRA PIN" },
                  { key:"reg_number", label:"Registration #" },
                  { key:"industry", label:"Industry" },
                  { key:"email", label:"Email" },
                  { key:"phone", label:"Phone" },
                  { key:"engagement_type", label:"Engagement type" },
                  { key:"notes", label:"Notes" },
                ]}
                enrich={(r)=>({ created_by: r._uid })}
                onDone={load}
              />
              <button onClick={() => setOpen(true)} className="h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-medium inline-flex items-center gap-2">
                <Plus className="h-4 w-4" /> New client
              </button>
            </>
          )}
        </div>
      </div>

      <div className="shrink-0 flex flex-wrap gap-2 items-center">
        <div className="relative max-w-sm flex-1 min-w-[200px]">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search company, individual or KRA PIN…" className="w-full h-9 pl-9 pr-3 rounded-md border bg-background text-sm" />
        </div>
        <div className="inline-flex rounded-md border bg-background overflow-hidden text-sm">
          {([["all","All Clients"],["company","Companies"],["individual","Individuals"]] as const).map(([v,l]) => (
            <button key={v} onClick={()=>setTypeFilter(v)} className={`h-9 px-3 ${typeFilter===v ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>{l}</button>
          ))}
        </div>
        {isAdmin && <div className="inline-flex rounded-md border bg-background overflow-hidden text-sm">
          {([["active","Active"],["paused",`Paused${pausedCount ? ` (${pausedCount})` : ""}`],["all","All"]] as const).map(([v,l]) => (
            <button key={v} onClick={()=>setStateFilter(v)} className={`h-9 px-3 ${stateFilter===v ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>{l}</button>
          ))}
        </div>}
      </div>

      {selected.size > 0 && (
        <div className="shrink-0 bg-card border rounded-lg p-3 flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium">{selected.size} selected</span>
          {isAdmin && <>
            <button disabled={bulkBusy} onClick={()=>bulkPause(true)} className="h-8 px-3 rounded-md border text-xs inline-flex items-center gap-1.5 hover:bg-muted disabled:opacity-50"><Pause className="h-3.5 w-3.5" />Pause</button>
            <button disabled={bulkBusy} onClick={()=>bulkPause(false)} className="h-8 px-3 rounded-md border text-xs inline-flex items-center gap-1.5 hover:bg-muted disabled:opacity-50"><Play className="h-3.5 w-3.5" />Resume</button>
          </>}
          {isAdmin && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <button disabled={bulkBusy} className="h-8 px-3 rounded-md border border-destructive/40 text-destructive text-xs inline-flex items-center gap-1.5 hover:bg-destructive/10 disabled:opacity-50"><Trash2 className="h-3.5 w-3.5" />Delete</button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete {selected.size} client{selected.size > 1 ? "s" : ""}?</AlertDialogTitle>
                  <AlertDialogDescription>This permanently removes the selected clients and their related records. Cannot be undone. Consider pausing instead if you just need them out of the way.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={bulkDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
          <button onClick={()=>setSelected(new Set())} className="text-xs text-muted-foreground hover:text-foreground ml-auto">Clear selection</button>
        </div>
      )}

      <div className="bg-card border rounded-lg overflow-hidden flex-1 min-h-0 flex flex-col">
        <div className="overflow-auto flex-1 min-h-0">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground border-b bg-muted sticky top-0 z-10">
              <tr>
                <th className="py-2 px-3 w-8"><input type="checkbox" checked={filtered.length > 0 && selected.size === filtered.length} onChange={toggleSelectAll} /></th>
                <th className="py-2 px-3">Client</th><th>Type</th><th>KRA PIN</th><th>Industry</th><th>Engagement</th><th>Assigned</th><th>Status</th><th>Added</th><th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && <tr><td colSpan={10} className="py-10 text-center text-muted-foreground">No clients{q ? " match your search" : " yet — add the first one"}.</td></tr>}
              {filtered.map(r => {
                const names = assignByClient[r.id] ?? [];
                const ctype = (r.client_type ?? "company") as "company"|"individual";
                return (
                  <tr
                    key={r.id}
                    tabIndex={0}
                    role="link"
                    aria-label={`Open client ${r.company_name}`}
                    onClick={(event) => {
                      const target = event.target as HTMLElement;
                      if (target.closest("a, button, input, [role='button'], [data-radix-collection-item]")) return;
                      if (r.is_paused && !isAdmin) return;
                      navigate({ to: "/clients/$id", params: { id: r.id } });
                    }}
                    onKeyDown={(event) => {
                      if (event.target !== event.currentTarget) return;
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        if (r.is_paused && !isAdmin) return;
                        navigate({ to: "/clients/$id", params: { id: r.id } });
                      }
                    }}
                    className={`group border-b last:border-0 cursor-pointer outline-none transition-colors duration-150 hover:bg-primary/[0.045] focus-visible:bg-primary/[0.07] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/60 ${r.is_paused ? "opacity-60" : ""}`}
                  >
                    <td className="py-2 px-3"><input type="checkbox" checked={selected.has(r.id)} onChange={()=>toggleSelected(r.id)} /></td>
                    <td className="py-2 px-3 font-medium">
                      <Link to="/clients/$id" params={{ id: r.id }} className="hover:text-primary group-hover:text-primary transition-colors">{r.company_name}</Link>
                      {r.is_paused && <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground align-middle">Paused</span>}
                    </td>
                    <td>
                      <span className={`text-xs px-2 py-0.5 rounded-md border ${ctype === "individual" ? "border-blue-200 text-blue-700 dark:border-blue-900 dark:text-blue-300" : "border-emerald-200 text-emerald-700 dark:border-emerald-900 dark:text-emerald-300"}`}>
                        {ctype === "individual" ? "Individual" : "Company"}
                      </span>
                    </td>
                    <td className="font-mono text-xs">{r.kra_pin || "—"}</td>
                    <td>{r.industry || "—"}</td>
                    <td>{r.engagement_type || "—"}</td>
                    <td>
                      {names.length === 0 ? <span className="text-xs text-muted-foreground">—</span> : (
                        <div className="flex flex-wrap gap-1">
                          {names.slice(0,2).map((n, i) => <span key={i} className="text-xs px-1.5 py-0.5 rounded bg-muted">{n}</span>)}
                          {names.length > 2 && <span className="text-xs text-muted-foreground">+{names.length-2}</span>}
                        </div>
                      )}
                    </td>
                    <td><span className={`text-xs px-2 py-1 rounded-full capitalize ${STATUS_COLORS[r.status]}`}>{statusLabel(r.status)}</span></td>
                    <td className="text-muted-foreground">{formatDate(r.created_at)}</td>
                    <td className="py-2 px-3 text-right whitespace-nowrap">
                      {isAdmin && <button onClick={()=>setPaused([r.id], !r.is_paused)} title={r.is_paused ? "Resume" : "Pause"} className="text-muted-foreground hover:text-foreground p-1">
                        {r.is_paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
                      </button>}
                      {canDelete("clients", { createdBy: r.created_by }) && (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <button className="text-muted-foreground hover:text-destructive p-1" aria-label="Delete client"><Trash2 className="h-3.5 w-3.5" /></button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete {r.company_name}?</AlertDialogTitle>
                              <AlertDialogDescription>This permanently removes this client and related records. Cannot be undone. Consider pausing instead if you just need them out of the way.</AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={async () => {
                                const { error } = await supabase.from("clients").delete().eq("id", r.id);
                                if (error) toast.error(error.message); else { toast.success("Client deleted"); load(); }
                              }} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={()=>setOpen(false)}>
          <form onClick={e=>e.stopPropagation()} onSubmit={save} className="bg-card w-full max-w-lg rounded-lg p-6 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">New client</h2>
              <button type="button" onClick={()=>setOpen(false)}><X className="h-4 w-4" /></button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="text-xs font-medium">Client type</label>
                <select value={form.client_type} onChange={e=>setForm({...form, client_type: e.target.value})} className="mt-1 w-full h-9 px-3 rounded-md border bg-background text-sm">
                  <option value="company">Company</option>
                  <option value="individual">Individual</option>
                </select>
              </div>
              {form.client_type === "individual" ? <>
                <Field label="First name *" value={form.first_name} onChange={v=>setForm({...form, first_name:v, company_name:`${v} ${form.last_name}`.trim()})} required />
                <Field label="Last name" value={form.last_name} onChange={v=>setForm({...form, last_name:v, company_name:`${form.first_name} ${v}`.trim()})} />
                <Field label="ID / Passport #" value={form.id_number} onChange={v=>setForm({...form, id_number:v})} />
              </> : <>
                <Field label="Company name *" value={form.company_name} onChange={v=>setForm({...form, company_name:v})} required />
                <Field label="Registration #" value={form.reg_number} onChange={v=>setForm({...form, reg_number:v})} />
              </>}
              <Field label="KRA PIN" value={form.kra_pin} onChange={v=>setForm({...form, kra_pin:v})} />
              <Field label="Industry" value={form.industry} onChange={v=>setForm({...form, industry:v})} />
              <Field label="Email" type="email" value={form.email} onChange={v=>setForm({...form, email:v})} />
              <Field label="Phone" value={form.phone} onChange={v=>setForm({...form, phone:v})} />
              <Field label="Engagement type" value={form.engagement_type} onChange={v=>setForm({...form, engagement_type:v})} placeholder="Audit, Tax, Advisory…" />
            </div>
            <div>
              <label className="text-xs font-medium">Notes</label>
              <textarea value={form.notes} onChange={e=>setForm({...form, notes:e.target.value})} rows={2} className="mt-1 w-full px-3 py-2 rounded-md border bg-background text-sm" />
            </div>
            <button disabled={busy} className="w-full h-10 rounded-md bg-primary text-primary-foreground text-sm font-medium">{busy?"Saving…":"Create client"}</button>
          </form>
        </div>
      )}
    </div>
  );
}

function Field({ label, value, onChange, required, type="text", placeholder }: { label:string; value:string; onChange:(v:string)=>void; required?:boolean; type?:string; placeholder?:string }) {
  return (
    <div>
      <label className="text-xs font-medium">{label}</label>
      <input required={required} type={type} placeholder={placeholder} value={value} onChange={e=>onChange(e.target.value)} className="mt-1 w-full h-9 px-3 rounded-md border bg-background text-sm" />
    </div>
  );
}
