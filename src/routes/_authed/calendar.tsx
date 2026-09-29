import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, X, Trash2, Plus } from "lucide-react";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/_authed/calendar")({ component: CalendarPage });

const EVENT_TYPES = [
  { v: "task", label: "Task", cls: "bg-primary/15 text-primary" },
  { v: "reminder", label: "Reminder", cls: "bg-muted text-foreground" },
  { v: "deadline", label: "Deadline", cls: "bg-destructive/15 text-destructive" },
  { v: "meeting", label: "Meeting", cls: "bg-blue-500/15 text-blue-700 dark:text-blue-300" },
  { v: "compliance", label: "Compliance", cls: "bg-amber-500/15 text-amber-700 dark:text-amber-300" },
  { v: "internal", label: "Internal", cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
];
const typeCls = (t: string) => EVENT_TYPES.find(e => e.v === t)?.cls ?? "bg-muted";

function CalendarPage() {
  const { user } = useAuth();
  const [cursor, setCursor] = useState(() => { const d = new Date(); d.setDate(1); return d; });
  const [events, setEvents] = useState<any[]>([]);
  const [taxRows, setTaxRows] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [staff, setStaff] = useState<any[]>([]);
  const [dialog, setDialog] = useState<{ mode: "new" | "edit"; data: any } | null>(null);

  async function load() {
    const [e, t, c, p] = await Promise.all([
      supabase.from("calendar_events").select("*").order("event_date"),
      supabase.from("tax_returns").select("id, return_type, due_date, clients(company_name)"),
      supabase.from("clients").select("id, company_name").order("company_name"),
      supabase.from("profiles").select("id, full_name"),
    ]);
    setEvents(e.data ?? []);
    setTaxRows(t.data ?? []);
    setClients(c.data ?? []);
    setStaff(p.data ?? []);
  }
  useEffect(() => { load(); }, []);

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const startWeekday = first.getDay();
  const days: Date[] = [];
  for (let i = 0; i < startWeekday; i++) days.push(new Date(year, month, -startWeekday + i + 1));
  for (let d = 1; d <= last.getDate(); d++) days.push(new Date(year, month, d));
  while (days.length % 7 !== 0) days.push(new Date(year, month + 1, days.length - last.getDate() - startWeekday + 1));

  function eventsOn(d: Date) {
    const dStr = d.toISOString().slice(0, 10);
    const customs = events.filter(e => {
      if (e.event_date === dStr) return true;
      if (e.recurrence === "monthly") {
        const ed = new Date(e.event_date);
        return ed.getDate() === d.getDate();
      }
      if (e.recurrence === "annual") {
        const ed = new Date(e.event_date);
        return ed.getDate() === d.getDate() && ed.getMonth() === d.getMonth();
      }
      return false;
    }).map(e => ({ kind: "custom" as const, id: e.id, title: e.title, type: e.type, raw: e, sharedWithYou: e.created_by && e.created_by !== user?.id, isTeam: e.visibility === "team" }));
    const tax = taxRows.filter(t => t.due_date === dStr).map(t => ({
      kind: "tax" as const, id: t.id, title: `${t.return_type.toUpperCase()} · ${t.clients?.company_name ?? ""}`, type: "deadline",
    }));
    return [...customs, ...tax];
  }

  function openNew(d: Date) {
    setDialog({ mode: "new", data: {
      title: "", type: "reminder", event_date: d.toISOString().slice(0, 10),
      event_time: "", recurrence: "once", client_id: "", assigned_to: "", notes: "", visibility: "private",
    }});
  }
  function openEdit(ev: any) {
    setDialog({ mode: "edit", data: { ...ev, event_time: ev.event_time ?? "", client_id: ev.client_id ?? "", assigned_to: ev.assigned_to ?? "", notes: ev.notes ?? "", visibility: ev.visibility ?? "private" } });
  }
  async function save() {
    if (!dialog) return;
    const d = dialog.data;
    const payload: any = {
      title: d.title, type: d.type, event_date: d.event_date,
      event_time: d.event_time || null, recurrence: d.recurrence,
      client_id: d.client_id || null, assigned_to: d.assigned_to || null,
      notes: d.notes || null, visibility: d.visibility === "team" ? "team" : "private",
    };
    if (!payload.title || !payload.event_date) { toast.error("Title and date required"); return; }
    let err;
    if (dialog.mode === "new") {
      payload.created_by = user?.id;
      ({ error: err } = await supabase.from("calendar_events").insert(payload));
      if (!err && payload.assigned_to) {
        await supabase.from("notifications").insert({
          user_id: payload.assigned_to, type: "calendar",
          title: `Assigned: ${payload.title}`, body: `Due ${payload.event_date}`, link: "/calendar",
        });
      }
    } else {
      ({ error: err } = await supabase.from("calendar_events").update(payload).eq("id", d.id));
    }
    if (err) toast.error(err.message);
    else { toast.success("Saved"); setDialog(null); load(); }
  }
  async function remove() {
    if (!dialog || dialog.mode !== "edit") return;
    if (!confirm("Delete this event?")) return;
    const { error } = await supabase.from("calendar_events").delete().eq("id", dialog.data.id);
    if (error) toast.error(error.message); else { setDialog(null); load(); }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Calendar</h1>
          <p className="text-sm text-muted-foreground">Your personal calendar — events you created or were assigned to. Click any day to add.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => openNew(new Date())} className="h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs inline-flex items-center gap-1"><Plus className="h-3 w-3" /> New event</button>
          <button onClick={() => setCursor(new Date(year, month - 1, 1))} className="h-8 w-8 rounded-md border bg-card hover:bg-muted"><ChevronLeft className="h-4 w-4 mx-auto" /></button>
          <div className="font-semibold w-36 text-center">{cursor.toLocaleString("en", { month: "long", year: "numeric" })}</div>
          <button onClick={() => setCursor(new Date(year, month + 1, 1))} className="h-8 w-8 rounded-md border bg-card hover:bg-muted"><ChevronRight className="h-4 w-4 mx-auto" /></button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 text-xs">
        {EVENT_TYPES.map(t => (
          <span key={t.v} className={`px-2 py-0.5 rounded ${t.cls}`}>{t.label}</span>
        ))}
      </div>

      <div className="bg-card border rounded-lg overflow-hidden">
        <div className="grid grid-cols-7 text-xs font-medium text-muted-foreground border-b">
          {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map(d => <div key={d} className="p-2 text-center">{d}</div>)}
        </div>
        <div className="grid grid-cols-7">
          {days.map((d, i) => {
            const isCurr = d.getMonth() === month;
            const today = d.toDateString() === new Date().toDateString();
            const evs = eventsOn(d);
            return (
              <div key={i} onClick={() => openNew(d)} className={`min-h-24 p-1.5 border-r border-b text-xs cursor-pointer hover:bg-muted/40 ${!isCurr ? "bg-muted/30 text-muted-foreground" : ""}`}>
                <div className={`text-right font-medium ${today ? "text-accent" : ""}`}>{d.getDate()}</div>
                <div className="space-y-0.5 mt-1">
                  {evs.slice(0, 3).map((e, idx) => (
                    <div
                      key={idx}
                      onClick={ev => { ev.stopPropagation(); if (e.kind === "custom") openEdit(e.raw); }}
                      className={`px-1.5 py-0.5 rounded text-[10px] truncate ${typeCls(e.type)}`}
                      title={e.kind === "custom" && e.sharedWithYou ? (e.isTeam ? `${e.title} · team event` : `${e.title} · assigned to you`) : e.title}
                    >
                      {e.kind === "custom" && e.sharedWithYou ? (e.isTeam ? "👥 " : "👤 ") : ""}{e.title}
                    </div>
                  ))}
                  {evs.length > 3 && <div className="text-[10px] text-muted-foreground">+{evs.length - 3} more</div>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {dialog && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setDialog(null)}>
          <div onClick={e => e.stopPropagation()} className="bg-card w-full max-w-md rounded-lg p-6 space-y-3">
            <div className="flex justify-between"><h2 className="text-lg font-semibold">{dialog.mode === "new" ? "New event" : "Edit event"}</h2><button onClick={() => setDialog(null)}><X className="h-4 w-4" /></button></div>
            <input placeholder="Title *" value={dialog.data.title} onChange={e => setDialog({ ...dialog, data: { ...dialog.data, title: e.target.value } })} className="w-full h-9 px-3 rounded-md border bg-background text-sm" />
            <div className="grid grid-cols-2 gap-2">
              <select value={dialog.data.type} onChange={e => setDialog({ ...dialog, data: { ...dialog.data, type: e.target.value } })} className="h-9 px-3 rounded-md border bg-background text-sm">
                {EVENT_TYPES.map(t => <option key={t.v} value={t.v}>{t.label}</option>)}
              </select>
              <select value={dialog.data.recurrence} onChange={e => setDialog({ ...dialog, data: { ...dialog.data, recurrence: e.target.value } })} className="h-9 px-3 rounded-md border bg-background text-sm">
                <option value="once">One-time</option>
                <option value="monthly">Monthly</option>
                <option value="annual">Annually</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium">Who can see this</label>
              <select value={dialog.data.visibility} onChange={e => setDialog({ ...dialog, data: { ...dialog.data, visibility: e.target.value } })} className="mt-1 w-full h-9 px-3 rounded-md border bg-background text-sm">
                <option value="private">Only me (and anyone I assign it to)</option>
                <option value="team">Everyone on staff</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div><label className="text-xs font-medium">Date *</label><input type="date" value={dialog.data.event_date} onChange={e => setDialog({ ...dialog, data: { ...dialog.data, event_date: e.target.value } })} className="mt-1 w-full h-9 px-3 rounded-md border bg-background text-sm" /></div>
              <div><label className="text-xs font-medium">Time</label><input type="time" value={dialog.data.event_time} onChange={e => setDialog({ ...dialog, data: { ...dialog.data, event_time: e.target.value } })} className="mt-1 w-full h-9 px-3 rounded-md border bg-background text-sm" /></div>
            </div>
            <select value={dialog.data.client_id} onChange={e => setDialog({ ...dialog, data: { ...dialog.data, client_id: e.target.value } })} className="w-full h-9 px-3 rounded-md border bg-background text-sm">
              <option value="">— No client —</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
            </select>
            <select value={dialog.data.assigned_to} onChange={e => setDialog({ ...dialog, data: { ...dialog.data, assigned_to: e.target.value } })} className="w-full h-9 px-3 rounded-md border bg-background text-sm">
              <option value="">— Unassigned —</option>
              {staff.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
            </select>
            <textarea placeholder="Notes" value={dialog.data.notes} onChange={e => setDialog({ ...dialog, data: { ...dialog.data, notes: e.target.value } })} rows={2} className="w-full px-3 py-2 rounded-md border bg-background text-sm" />
            <div className="flex gap-2">
              <button onClick={save} className="flex-1 h-10 rounded-md bg-primary text-primary-foreground text-sm font-medium">Save</button>
              {dialog.mode === "edit" && (
                <button onClick={remove} className="h-10 px-3 rounded-md border border-destructive text-destructive text-sm"><Trash2 className="h-4 w-4" /></button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
