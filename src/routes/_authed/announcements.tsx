import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Megaphone, Plus, X, Pencil, Trash2 } from "lucide-react";
import { formatDate } from "@/lib/format";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/_authed/announcements")({ component: AnnouncePage });

const EMPTY = { id: "", title: "", body: "" };

function AnnouncePage() {
  const { canView, canCreate, canUse, user } = useAuth();
  const canManageAnnouncements = canUse("announcements") && canCreate("announcements");
  const [rows, setRows] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);

  async function load() {
    const { data, error } = await supabase
      .from("announcements")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) { toast.error(error.message); return; }
    const rowsData = data ?? [];
    const authorIds = [...new Set(rowsData.map((r: any) => r.author_id).filter(Boolean))];
    let profMap = new Map<string, any>();
    if (authorIds.length) {
      const { data: profs } = await supabase.from("profiles").select("id, full_name").in("id", authorIds);
      profMap = new Map((profs ?? []).map((p: any) => [p.id, p]));
    }
    setRows(rowsData.map((r: any) => ({ ...r, profiles: r.author_id ? profMap.get(r.author_id) : null })));
  }
  useEffect(() => { load(); }, []);

  function openNew() { setForm(EMPTY); setOpen(true); }
  function openEdit(r: any) { setForm({ id: r.id, title: r.title, body: r.body }); setOpen(true); }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (form.id) {
      const { error } = await supabase.from("announcements").update({ title: form.title, body: form.body }).eq("id", form.id);
      if (error) return toast.error(error.message);
      toast.success("Updated");
    } else {
      const { error } = await supabase.from("announcements").insert({ title: form.title, body: form.body, author_id: user?.id });
      if (error) return toast.error(error.message);
      toast.success("Posted");
      // notify all staff
      const { data: profs } = await supabase.from("profiles").select("id");
      const notes = (profs ?? []).filter(p => p.id !== user?.id).map(p => ({
        user_id: p.id, type: "announcement", title: form.title, body: form.body.slice(0, 200),
      }));
      if (notes.length) await supabase.from("notifications").insert(notes);
    }
    setOpen(false); setForm(EMPTY); load();
  }

  async function remove(id: string) {
    if (!confirm("Delete this announcement?")) return;
    const { error } = await supabase.from("announcements").delete().eq("id", id);
    if (error) toast.error(error.message); else { toast.success("Deleted"); load(); }
  }

  async function removeAll() {
    if (!canManageAnnouncements || rows.length === 0) return;
    if (!confirm(`Delete all ${rows.length} announcements? This cannot be undone.`)) return;
    const { error } = await supabase.from("announcements").delete().not("id", "is", null);
    if (error) {
      toast.error(error.message);
      return;
    }
    setRows([]);
    toast.success("All announcements deleted");
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div><h1 className="text-2xl font-bold">Announcements</h1><p className="text-sm text-muted-foreground">Office-wide updates and alerts.</p></div>
        {canManageAnnouncements && <div className="flex items-center gap-2">
          {rows.length > 0 && <button onClick={() => void removeAll()} className="h-9 px-3 rounded-md border border-destructive/40 text-destructive text-sm inline-flex items-center gap-2 hover:bg-destructive/5"><Trash2 className="h-4 w-4" /> Delete all</button>}
          <button onClick={openNew} className="h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm inline-flex items-center gap-2"><Plus className="h-4 w-4" /> New post</button>
        </div>}
      </div>
      <div className="space-y-3">
        {rows.length === 0 && <div className="bg-card border rounded-lg p-8 text-center text-muted-foreground text-sm">No announcements yet.</div>}
        {rows.map(r => (
          <div key={r.id} className="bg-card border rounded-lg p-5">
            <div className="flex items-start gap-3">
              <div className="h-9 w-9 rounded-full bg-accent/15 flex items-center justify-center"><Megaphone className="h-4 w-4 text-accent" /></div>
              <div className="flex-1">
                <div className="flex justify-between items-start gap-2">
                  <h2 className="font-semibold">{r.title}</h2>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">{formatDate(r.created_at)}</span>
                    {canManageAnnouncements && (
                      <>
                        <button onClick={()=>openEdit(r)} className="p-1 hover:text-primary" title="Edit"><Pencil className="h-3.5 w-3.5" /></button>
                        <button onClick={()=>remove(r.id)} className="p-1 hover:text-destructive" title="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
                      </>
                    )}
                  </div>
                </div>
                <div className="text-xs text-muted-foreground">{r.profiles?.full_name || "Admin"}</div>
                <p className="mt-2 text-sm whitespace-pre-wrap">{r.body}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
      {open && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setOpen(false)}>
          <form onClick={e => e.stopPropagation()} onSubmit={save} className="bg-card w-full max-w-md rounded-lg p-6 space-y-3">
            <div className="flex justify-between"><h2 className="text-lg font-semibold">{form.id ? "Edit announcement" : "New announcement"}</h2><button type="button" onClick={() => setOpen(false)}><X className="h-4 w-4" /></button></div>
            <input required placeholder="Title" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} className="w-full h-9 px-3 rounded-md border bg-background text-sm" />
            <textarea required placeholder="Message" value={form.body} onChange={e => setForm({ ...form, body: e.target.value })} rows={5} className="w-full px-3 py-2 rounded-md border bg-background text-sm" />
            <button className="w-full h-10 rounded-md bg-primary text-primary-foreground text-sm font-medium">{form.id ? "Save changes" : "Post"}</button>
          </form>
        </div>
      )}
    </div>
  );
}
