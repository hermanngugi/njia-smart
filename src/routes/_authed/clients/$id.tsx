import { createFileRoute, Link, useParams, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ArrowLeft, Pencil, Trash2, Plus, Eye, EyeOff, Check, X, Pause, Play } from "lucide-react";
import { formatDate } from "@/lib/format";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { ClientAssignments } from "@/components/client-assignments";
import { ObligationContacts } from "@/components/obligation-contacts";
import { LastUpdated } from "@/components/last-updated";

export const Route = createFileRoute("/_authed/clients/$id")({ component: ClientDetail });

const TABS = ["Overview","Tax","Audit","Advisory","Documents","Tasks"] as const;
const TASK_PRIORITIES = ["low","normal","high","urgent"];

function ClientDetail() {
  const { id } = useParams({ from: "/_authed/clients/$id" });
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const [client, setClient] = useState<any>(null);
  const [tab, setTab] = useState<typeof TABS[number]>("Overview");
  const [related, setRelated] = useState<any>({ tax: [], engagements: [], advisory: [], docs: [], tasks: [], contacts: [] });
  const [taxPolicies, setTaxPolicies] = useState<any[]>([]);
  const [obligations, setObligations] = useState<any[]>([]);
  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState<any>({});
  const [addOpen, setAddOpen] = useState<null | "tax" | "audit" | "advisory" | "document" | "task">(null);
  const [addForm, setAddForm] = useState<any>({});
  const [addBusy, setAddBusy] = useState(false);
  const [addFile, setAddFile] = useState<File | null>(null);
  const [showPwd, setShowPwd] = useState(false);
  const [editPwd, setEditPwd] = useState(false);
  const [pwdValue, setPwdValue] = useState("");
  const [pwdBusy, setPwdBusy] = useState(false);
  const [updaterName, setUpdaterName] = useState<string | null>(null);
  const [recordUpdaterName, setRecordUpdaterName] = useState<string | null>(null);

  async function load() {
    const { data } = await supabase.from("clients").select("*").eq("id", id).maybeSingle();
    setClient(data);
    const updaterId = (data as any)?.portal_password_updated_by;
    const recordUpdaterId = (data as any)?.updated_by;
    const [prof, recordProf] = await Promise.all([
      updaterId ? supabase.from("profiles").select("full_name").eq("id", updaterId).maybeSingle() : Promise.resolve({ data: null }),
      recordUpdaterId ? supabase.from("profiles").select("full_name").eq("id", recordUpdaterId).maybeSingle() : Promise.resolve({ data: null }),
    ]);
    setUpdaterName((prof.data as any)?.full_name ?? null);
    setRecordUpdaterName((recordProf.data as any)?.full_name ?? null);
    const [tax, eng, adv, docs, tasks, contacts, pols, obl] = await Promise.all([
      supabase.from("tax_returns").select("*").eq("client_id", id).order("due_date"),
      supabase.from("engagements").select("*").eq("client_id", id).order("created_at", { ascending: false }),
      supabase.from("advisory_projects").select("*").eq("client_id", id),
      supabase.from("documents").select("*").eq("client_id", id).order("created_at", { ascending: false }),
      supabase.from("tasks").select("*").eq("client_id", id).order("created_at", { ascending: false }),
      supabase.from("client_contacts").select("*").eq("client_id", id),
      supabase.from("tax_policies").select("*").eq("active", true).order("sort_order"),
      supabase.from("client_tax_obligations").select("*").eq("client_id", id).eq("active", true),
    ]);
    setRelated({ tax: tax.data ?? [], engagements: eng.data ?? [], advisory: adv.data ?? [], docs: docs.data ?? [], tasks: tasks.data ?? [], contacts: contacts.data ?? [] });
    setTaxPolicies((pols.data as any[]) ?? []);
    setObligations(obl.data ?? []);
  }
  useEffect(() => { load(); }, [id]);

  async function setPaused(paused: boolean) {
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from("clients").update(
      paused ? { is_paused: true, paused_at: new Date().toISOString(), paused_by: user?.id ?? null } as any
             : { is_paused: false, paused_at: null, paused_by: null } as any
    ).eq("id", id);
    if (error) toast.error(error.message); else { toast.success(paused ? "Client marked inactive" : "Client marked active"); load(); }
  }

  function openEdit() {
    setForm({
      client_type: (client as any).client_type ?? "company",
      company_name: client.company_name ?? "",
      first_name: (client as any).first_name ?? "",
      last_name: (client as any).last_name ?? "",
      id_number: (client as any).id_number ?? "",
      kra_pin: client.kra_pin ?? "",
      reg_number: client.reg_number ?? "",
      industry: client.industry ?? "",
      engagement_type: client.engagement_type ?? "",
      email: client.email ?? "",
      phone: client.phone ?? "",
      notes: client.notes ?? "",
    });
    setEditOpen(true);
  }

  async function saveEdit() {
    if (!form.company_name?.trim()) { toast.error("Name required"); return; }
    const { error } = await supabase.from("clients").update(form).eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Client updated");
    setEditOpen(false);
    load();
  }

  async function deleteClient() {
    const { error } = await supabase.from("clients").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Client deleted");
    navigate({ to: "/clients" });
  }

  function openAdd(kind: NonNullable<typeof addOpen>) {
    const defaults: any = {
      tax: { return_types: [] as string[] },
      audit: { title: "", due_date: "", notes: "" },
      advisory: { title: "", description: "", due_date: "" },
      document: { title: "" },
      task: { title: "", priority: "normal", due_date: "", description: "" },
    };
    setAddForm(defaults[kind]);
    setAddFile(null);
    setAddOpen(kind);
  }

  async function submitAdd() {
    if (!addOpen) return;
    setAddBusy(true);
    const { data: { user } } = await supabase.auth.getUser();
    try {
      if (addOpen === "tax") {
        const types: string[] = (addForm.return_types ?? []).filter(Boolean);
        if (types.length === 0) throw new Error("Select at least one tax obligation");
        // Due dates aren't picked here — each type's own policy (cadence + due
        // day, set by admins under Settings) decides when the first filing is due.
        for (const rt of types) {
          const { error } = await supabase.rpc("set_client_tax_obligation", {
            _client_id: id, _tax_type: rt, _active: true,
          });
          if (error) throw error;
        }
      } else if (addOpen === "audit" || addOpen === "advisory") {
        if (!addForm.title?.trim()) throw new Error("Title required");
        if (addOpen === "audit") {
          const { error } = await supabase.from("engagements").insert({
            client_id: id, type: "audit", title: addForm.title,
            due_date: addForm.due_date || null, notes: addForm.notes || null,
          } as any);
          if (error) throw error;
        } else {
          const { error } = await supabase.from("advisory_projects").insert({
            client_id: id, title: addForm.title,
            description: addForm.description || null,
            due_date: addForm.due_date || null,
          } as any);
          if (error) throw error;
        }
      } else if (addOpen === "document") {
        if (!addFile) throw new Error("Choose a file");
        const path = `${id}/${Date.now()}-${addFile.name}`;
        const up = await supabase.storage.from("client-documents").upload(path, addFile);
        if (up.error) throw up.error;
        const { error } = await supabase.from("documents").insert({
          client_id: id,
          title: addForm.title || addFile.name,
          file_path: path,
          uploaded_by: user?.id ?? null,
        } as any);
        if (error) throw error;
      } else if (addOpen === "task") {
        if (!addForm.title?.trim()) throw new Error("Title required");
        const { error } = await supabase.from("tasks").insert({
          client_id: id, title: addForm.title,
          priority: addForm.priority, due_date: addForm.due_date || null,
          description: addForm.description || null, created_by: user?.id ?? null,
        } as any);
        if (error) throw error;
      }
      toast.success("Added");
      setAddOpen(null);
      load();
    } catch (e: any) {
      toast.error(e.message ?? String(e));
    } finally {
      setAddBusy(false);
    }
  }

  async function savePassword() {
    setPwdBusy(true);
    try {
      const { error } = await (supabase as any).rpc("set_client_portal_password", {
        _client_id: id,
        _password: pwdValue || null,
      });
      if (error) throw error;
      toast.success("Password updated");
      setEditPwd(false);
      setPwdValue("");
      load();
    } catch (e: any) {
      toast.error(e.message ?? String(e));
    } finally {
      setPwdBusy(false);
    }
  }

  if (!client) return <div className="text-sm text-muted-foreground">Loading…</div>;

  const isIndividual = (client as any).client_type === "individual";
  const displayName = isIndividual
    ? [(client as any).first_name, (client as any).last_name].filter(Boolean).join(" ") || client.company_name
    : client.company_name;

  return (
    <div className="space-y-4">
      <Link to="/clients" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1"><ArrowLeft className="h-3 w-3" /> Back to clients</Link>
      <div className="bg-card border rounded-lg p-5">
        <div className="flex flex-wrap justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold">{displayName}</h1>
              <span className="text-xs px-2 py-0.5 rounded-full bg-muted capitalize">{isIndividual ? "individual" : "company"}</span>
            </div>
            <div className="mt-1 text-sm text-muted-foreground space-x-3">
              {client.kra_pin && <span>KRA: <span className="font-mono">{client.kra_pin}</span></span>}
              {(client as any).id_number && <span>· ID: <span className="font-mono">{(client as any).id_number}</span></span>}
              {client.industry && <span>· {client.industry}</span>}
              {client.engagement_type && <span>· {client.engagement_type}</span>}
            </div>
            <LastUpdated at={(client as any).updated_at} byName={recordUpdaterName} className="block mt-1" />
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPaused(!(client as any).is_paused)}
              className={`h-9 px-3 rounded-md border text-sm font-medium inline-flex items-center gap-1.5 ${
                (client as any).is_paused
                  ? "bg-muted text-muted-foreground border-muted-foreground/30 hover:bg-muted/70"
                  : "bg-emerald-100 text-emerald-800 border-emerald-300 hover:bg-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-200 dark:border-emerald-800"
              }`}
              title={(client as any).is_paused ? "Click to mark active" : "Click to mark inactive"}
            >
              {(client as any).is_paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
              {(client as any).is_paused ? "Inactive" : "Active"}
            </button>
            <Button variant="outline" size="sm" onClick={openEdit}><Pencil className="h-3.5 w-3.5 mr-1" />Edit</Button>
            {isAdmin && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" size="sm"><Trash2 className="h-3.5 w-3.5 mr-1" />Delete</Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete this client?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This permanently removes <strong>{displayName}</strong>. Related records may also be affected. Cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={deleteClient}>Delete</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
        </div>
        <div className="mt-4 grid sm:grid-cols-3 gap-3 text-sm">
          <Info label="Email" value={client.email} />
          <Info label="Phone" value={client.phone} />
          <div>
            <div className="text-xs text-muted-foreground flex items-center justify-between">
              <span>Portal password</span>
              {!editPwd && (
                <button type="button" onClick={()=>{ setPwdValue(""); setEditPwd(true); setShowPwd(true); }} className="text-muted-foreground hover:text-foreground" aria-label="Set password">
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            {editPwd ? (
              <div className="mt-1 flex items-center gap-1">
                <Input type={showPwd ? "text" : "password"} value={pwdValue} onChange={e=>setPwdValue(e.target.value)} placeholder="New password (blank to clear)" className="h-8 font-mono" autoFocus />
                <button type="button" onClick={()=>setShowPwd(s=>!s)} className="text-muted-foreground hover:text-foreground p-1" aria-label={showPwd ? "Hide" : "Show"}>
                  {showPwd ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
                <button type="button" onClick={savePassword} disabled={pwdBusy} className="text-emerald-600 hover:text-emerald-700 p-1" aria-label="Save"><Check className="h-4 w-4" /></button>
                <button type="button" onClick={()=>{ setEditPwd(false); setPwdValue(""); }} className="text-muted-foreground hover:text-foreground p-1" aria-label="Cancel"><X className="h-4 w-4" /></button>
              </div>
            ) : (
              <div className="font-medium font-mono text-xs text-muted-foreground">
                {(client as any).portal_password_updated_at ? "Set (hashed — not viewable)" : <span className="font-sans">—</span>}
              </div>
            )}
            {(client as any).portal_password_updated_at && (
              <div className="text-[11px] text-muted-foreground mt-1">
                Updated {formatDate((client as any).portal_password_updated_at)}{updaterName ? ` by ${updaterName}` : ""}
              </div>
            )}
          </div>
        </div>
        {client.notes && <div className="mt-3 text-sm text-muted-foreground whitespace-pre-wrap">{client.notes}</div>}
      </div>

      <div className="flex flex-wrap gap-1 border-b">
        {TABS.map(t => (
          <button key={t} onClick={()=>setTab(t)} className={`px-3 py-2 text-sm border-b-2 transition-colors ${tab===t ? "border-primary text-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground"}`}>{t}</button>
        ))}
      </div>

      {tab === "Overview" && (
        <div className="grid md:grid-cols-2 gap-4">
          <ClientAssignments clientId={id} />
          <Card title="Contacts">
            {related.contacts.length === 0 ? <Empty msg="No contacts" /> :
              related.contacts.map((c:any) => (
                <div key={c.id} className="py-2 border-b last:border-0 text-sm">
                  <div className="font-medium">{c.name} <span className="text-xs text-muted-foreground">{c.role}</span></div>
                  <div className="text-xs text-muted-foreground">{c.email} · {c.phone}</div>
                </div>
              ))
            }
          </Card>
          <Card title="Upcoming filings">
            {related.tax.slice(0,5).map((t:any) => (
              <div key={t.id} className="flex justify-between text-sm py-1">
                <span className="uppercase">{t.return_type}</span>
                <span className="text-muted-foreground">{formatDate(t.due_date)}</span>
              </div>
            ))}
            {related.tax.length === 0 && <Empty msg="No tax returns yet" />}
          </Card>
        </div>
      )}
      {tab === "Tax" && (
        <div className="space-y-3">
          <TabSection label="tax obligation" onAdd={() => openAdd("tax")}><TaxList rows={related.tax} onDelete={async (taxId: string) => {
            const { error } = await supabase.from("tax_returns").delete().eq("id", taxId);
            if (error) { toast.error(error.message); return; }
            toast.success("Tax obligation removed");
            load();
          }} empty="No tax returns" /></TabSection>
          {obligations.length > 0 && (
            <div className="space-y-2">
              {obligations.map(o => {
                const pol = taxPolicies.find(p => p.tax_type === o.tax_type);
                return <ObligationContacts key={o.tax_type} clientId={id} taxType={o.tax_type} label={pol?.label ?? o.tax_type} />;
              })}
            </div>
          )}
        </div>
      )}
      {tab === "Audit" && <TabSection label="audit engagement" onAdd={() => openAdd("audit")}><RelatedList rows={related.engagements.filter((e:any)=>e.type==="audit")} cols={["title","status","due_date"]} empty="No audit engagements" /></TabSection>}
      {tab === "Advisory" && <TabSection label="advisory project" onAdd={() => openAdd("advisory")}><RelatedList rows={related.advisory} cols={["title","status","due_date"]} empty="No advisory projects" /></TabSection>}
      {tab === "Documents" && <TabSection label="document" onAdd={() => openAdd("document")}><RelatedList rows={related.docs} cols={["title","version","created_at"]} empty="No documents" /></TabSection>}
      {tab === "Tasks" && <TabSection label="task" onAdd={() => openAdd("task")}><RelatedList rows={related.tasks} cols={["title","priority","status","due_date"]} empty="No tasks" /></TabSection>}

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Edit client</DialogTitle></DialogHeader>
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Type">
              <select value={form.client_type ?? "company"} onChange={e=>setForm({...form, client_type: e.target.value})} className="h-9 w-full px-3 rounded-md border bg-background text-sm">
                <option value="company">Company</option>
                <option value="individual">Individual</option>
              </select>
            </Field>
            <Field label={form.client_type === "individual" ? "Display name *" : "Company name *"}>
              <Input value={form.company_name ?? ""} onChange={e=>setForm({...form, company_name: e.target.value})} />
            </Field>
            {form.client_type === "individual" && <>
              <Field label="First name"><Input value={form.first_name ?? ""} onChange={e=>setForm({...form, first_name: e.target.value})} /></Field>
              <Field label="Last name"><Input value={form.last_name ?? ""} onChange={e=>setForm({...form, last_name: e.target.value})} /></Field>
              <Field label="ID / Passport #"><Input value={form.id_number ?? ""} onChange={e=>setForm({...form, id_number: e.target.value})} /></Field>
            </>}
            <Field label="KRA PIN"><Input value={form.kra_pin ?? ""} onChange={e=>setForm({...form, kra_pin: e.target.value})} /></Field>
            
            <Field label="Industry"><Input value={form.industry ?? ""} onChange={e=>setForm({...form, industry: e.target.value})} /></Field>
            <Field label="Engagement type"><Input value={form.engagement_type ?? ""} onChange={e=>setForm({...form, engagement_type: e.target.value})} /></Field>
            <Field label="Email"><Input type="email" value={form.email ?? ""} onChange={e=>setForm({...form, email: e.target.value})} /></Field>
            <Field label="Phone"><Input value={form.phone ?? ""} onChange={e=>setForm({...form, phone: e.target.value})} /></Field>
          </div>
          <Field label="Notes"><Textarea rows={3} value={form.notes ?? ""} onChange={e=>setForm({...form, notes: e.target.value})} /></Field>
          <DialogFooter>
            <Button variant="outline" onClick={()=>setEditOpen(false)}>Cancel</Button>
            <Button onClick={saveEdit}>Save changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!addOpen} onOpenChange={(o)=>!o && setAddOpen(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle className="capitalize">Add {addOpen}</DialogTitle></DialogHeader>
          {addOpen === "tax" && (
            <div className="space-y-3">
              <Field label="Tax obligations * (select one or more)">
                {taxPolicies.length === 0 ? (
                  <p className="text-xs text-muted-foreground p-2">No active tax policies configured yet — an admin can add types under Settings first.</p>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 p-2 border rounded-md bg-background">
                    {taxPolicies.map(p => {
                      const selected = (addForm.return_types ?? []).includes(p.tax_type);
                      return (
                        <label key={p.tax_type} title={`${p.cadence}, due day ${p.due_day}`} className={`flex items-center gap-2 px-2 py-1 rounded cursor-pointer text-xs ${selected ? "bg-primary/10 text-primary" : "hover:bg-muted"}`}>
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={e => {
                              const cur: string[] = addForm.return_types ?? [];
                              setAddForm({ ...addForm, return_types: e.target.checked ? [...cur, p.tax_type] : cur.filter((x: string) => x !== p.tax_type) });
                            }}
                          />
                          {p.label}
                        </label>
                      );
                    })}
                  </div>
                )}
              </Field>
              <p className="text-xs text-muted-foreground">
                Due dates aren't set here — each type follows its own tax policy (cadence and due day, managed by admins under Settings), so the first filing is scheduled automatically.
              </p>
            </div>
          )}
          {(addOpen === "audit" || addOpen === "advisory") && (
            <div className="space-y-3">
              <Field label="Title *"><Input value={addForm.title ?? ""} onChange={e=>setAddForm({...addForm, title: e.target.value})} /></Field>
              <Field label="Due date"><Input type="date" value={addForm.due_date ?? ""} onChange={e=>setAddForm({...addForm, due_date: e.target.value})} /></Field>
              {addOpen === "advisory"
                ? <Field label="Description"><Textarea rows={3} value={addForm.description ?? ""} onChange={e=>setAddForm({...addForm, description: e.target.value})} /></Field>
                : <Field label="Notes"><Textarea rows={3} value={addForm.notes ?? ""} onChange={e=>setAddForm({...addForm, notes: e.target.value})} /></Field>}
            </div>
          )}
          {addOpen === "document" && (
            <div className="space-y-3">
              <Field label="Title"><Input value={addForm.title ?? ""} onChange={e=>setAddForm({...addForm, title: e.target.value})} placeholder="Defaults to filename" /></Field>
              <Field label="File *"><Input type="file" onChange={e=>setAddFile(e.target.files?.[0] ?? null)} /></Field>
            </div>
          )}
          {addOpen === "task" && (
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2"><Field label="Title *"><Input value={addForm.title ?? ""} onChange={e=>setAddForm({...addForm, title: e.target.value})} /></Field></div>
              <Field label="Priority">
                <select value={addForm.priority} onChange={e=>setAddForm({...addForm, priority: e.target.value})} className="h-9 w-full px-3 rounded-md border bg-background text-sm capitalize">
                  {TASK_PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </Field>
              <Field label="Due date"><Input type="date" value={addForm.due_date ?? ""} onChange={e=>setAddForm({...addForm, due_date: e.target.value})} /></Field>
              <div className="sm:col-span-2"><Field label="Description"><Textarea rows={3} value={addForm.description ?? ""} onChange={e=>setAddForm({...addForm, description: e.target.value})} /></Field></div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={()=>setAddOpen(null)}>Cancel</Button>
            <Button onClick={submitAdd} disabled={addBusy}>{addBusy ? "Saving…" : "Add"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TabSection({ label, onAdd, children }: any) {
  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <Button size="sm" onClick={onAdd}><Plus className="h-3.5 w-3.5 mr-1" />Add {label}</Button>
      </div>
      {children}
    </div>
  );
}

function Info({ label, value }: any) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-medium">{value || "—"}</div>
    </div>
  );
}
function Card({ title, children }: any) {
  return (
    <div className="bg-card border rounded-lg p-4">
      <h3 className="font-semibold mb-2">{title}</h3>
      {children}
    </div>
  );
}
function Empty({ msg }: any) { return <p className="text-sm text-muted-foreground">{msg}</p>; }
function RelatedList({ rows, cols, empty }: any) {
  if (!rows.length) return <div className="bg-card border rounded-lg p-8 text-center text-muted-foreground text-sm">{empty}</div>;
  return (
    <div className="bg-card border rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-left text-xs text-muted-foreground border-b">
          <tr>{cols.map((c:string)=> <th key={c} className="py-2 px-3 capitalize">{c.replace(/_/g, " ")}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r:any) => (
            <tr key={r.id} className="border-b last:border-0">
              {cols.map((c:string) => (
                <td key={c} className="py-2 px-3">
                  {c.endsWith("_at") || c.endsWith("date") ? formatDate(r[c]) :
                    typeof r[c] === "string" ? <span className="capitalize">{r[c].replace(/_/g, " ")}</span> : r[c]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TaxList({ rows, onDelete, empty }: any) {
  if (!rows.length) return <div className="bg-card border rounded-lg p-8 text-center text-muted-foreground text-sm">{empty}</div>;
  return (
    <div className="bg-card border rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-left text-xs text-muted-foreground border-b">
          <tr>
            <th className="py-2 px-3">Return type</th>
            <th className="py-2 px-3">Period end</th>
            <th className="py-2 px-3">Due date</th>
            <th className="py-2 px-3">Status</th>
            <th className="py-2 px-3 w-10"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r: any) => (
            <tr key={r.id} className="border-b last:border-0">
              <td className="py-2 px-3 capitalize">{r.return_type?.replace(/_/g, " ")}</td>
              <td className="py-2 px-3">{formatDate(r.period_end)}</td>
              <td className="py-2 px-3">{formatDate(r.due_date)}</td>
              <td className="py-2 px-3 capitalize">{r.status?.replace(/_/g, " ")}</td>
              <td className="py-2 px-3">
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <button type="button" className="text-muted-foreground hover:text-destructive p-1" aria-label="Remove tax obligation">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Remove tax obligation?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will remove the <strong className="capitalize">{r.return_type?.replace(/_/g, " ")}</strong> obligation from this client only. This action cannot be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => onDelete(r.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Remove</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Field({ label, children }: any) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}
