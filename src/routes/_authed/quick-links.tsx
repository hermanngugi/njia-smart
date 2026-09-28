import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { ExternalLink, Plus, X, Pencil, Trash2 } from "lucide-react";

export const Route = createFileRoute("/_authed/quick-links")({
  head: () => ({
    meta: [
      { title: "Quick Links | G.K Nahashon & Company" },
      { name: "description", content: "iTax, eTIMS and other portals the firm uses." },
    ],
  }),
  component: QuickLinks,
});

type QuickLink = {
  id: string;
  title: string;
  url: string;
  category: string;
  description: string | null;
  sort_order: number;
};

const EMPTY_FORM = { id: "", title: "", url: "", category: "General", description: "" };

// The generated Supabase types don't include this table until they're
// regenerated, so go through an untyped handle.
const db = supabase as any;

function QuickLinks() {
  const { isAdmin } = useAuth();
  const [links, setLinks] = useState<QuickLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  async function load() {
    const { data, error } = await db.from("quick_links").select("*").order("sort_order").order("title");
    if (error) toast.error(error.message);
    setLinks((data as QuickLink[]) ?? []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  // Group by category, keeping the order links first appear in.
  const groups = useMemo(() => {
    const map = new Map<string, QuickLink[]>();
    links.forEach((l) => map.set(l.category, [...(map.get(l.category) ?? []), l]));
    return Array.from(map.entries());
  }, [links]);
  const categories = useMemo(() => Array.from(new Set(links.map((l) => l.category))), [links]);

  function openNew() { setForm(EMPTY_FORM); setFormOpen(true); }
  function openEdit(l: QuickLink) {
    setForm({ id: l.id, title: l.title, url: l.url, category: l.category, description: l.description ?? "" });
    setFormOpen(true);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    let url = form.url.trim();
    if (!/^https?:\/\//i.test(url)) url = "https://" + url; // tolerate "itax.kra.go.ke"
    if (!/^https?:\/\/[^\s.]+\.[^\s]+$/i.test(url)) { toast.error("Enter a valid web address"); return; }
    setSaving(true);
    const payload = {
      title: form.title.trim(),
      url,
      category: form.category.trim() || "General",
      description: form.description.trim() || null,
    };
    const { error } = form.id
      ? await db.from("quick_links").update(payload).eq("id", form.id)
      : await db.from("quick_links").insert({ ...payload, sort_order: (links.reduce((m, l) => Math.max(m, l.sort_order), 0) || 0) + 10 });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(form.id ? "Link updated" : "Link added");
    setFormOpen(false);
    load();
  }

  async function remove(l: QuickLink) {
    if (!confirm(`Remove "${l.title}"?`)) return;
    const { error } = await db.from("quick_links").delete().eq("id", l.id);
    if (error) toast.error(error.message); else { toast.success("Link removed"); load(); }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap justify-between items-center gap-3">
        <div>
          <h1 className="text-2xl font-bold">Quick Links</h1>
          <p className="text-sm text-muted-foreground">iTax, eTIMS and other portals we use — opens in a new tab.</p>
        </div>
        {isAdmin && (
          <button onClick={openNew} className="h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm inline-flex items-center gap-2">
            <Plus className="h-4 w-4" /> Add link
          </button>
        )}
      </div>

      {!loading && links.length === 0 && (
        <div className="bg-card border rounded-lg p-10 text-center text-sm text-muted-foreground">No links yet.</div>
      )}

      {groups.map(([category, items]) => (
        <section key={category} className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{category}</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((l) => (
              <div key={l.id} className="group relative bg-card border rounded-lg hover:border-primary/60 hover:shadow-sm transition">
                <a href={l.url} target="_blank" rel="noopener noreferrer" className="block p-4 pr-10">
                  <div className="font-medium inline-flex items-center gap-1.5">
                    {l.title} <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                  </div>
                  {l.description && <div className="text-xs text-muted-foreground mt-1">{l.description}</div>}
                  <div className="text-[11px] text-muted-foreground/70 mt-2 truncate">{l.url.replace(/^https?:\/\//i, "")}</div>
                </a>
                {isAdmin && (
                  <div className="absolute top-2 right-2 flex flex-col gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
                    <button onClick={() => openEdit(l)} title="Edit" className="p-1 hover:text-primary"><Pencil className="h-3.5 w-3.5" /></button>
                    <button onClick={() => remove(l)} title="Remove" className="p-1 hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      ))}

      {formOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setFormOpen(false)}>
          <form onClick={(e) => e.stopPropagation()} onSubmit={save} className="bg-card w-full max-w-md rounded-lg p-6 space-y-3">
            <div className="flex justify-between">
              <h2 className="text-lg font-semibold">{form.id ? "Edit link" : "Add link"}</h2>
              <button type="button" onClick={() => setFormOpen(false)}><X className="h-4 w-4" /></button>
            </div>
            <input
              required placeholder="Name (e.g. KRA iTax)"
              value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
              className="w-full h-9 px-3 rounded-md border bg-background text-sm"
            />
            <input
              required placeholder="Web address (https://…)"
              value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })}
              className="w-full h-9 px-3 rounded-md border bg-background text-sm"
            />
            <input
              list="quick-link-categories" placeholder="Category"
              value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}
              className="w-full h-9 px-3 rounded-md border bg-background text-sm"
            />
            <datalist id="quick-link-categories">
              {categories.map((c) => <option key={c} value={c} />)}
            </datalist>
            <textarea
              placeholder="Short description (optional)" rows={2}
              value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="w-full px-3 py-2 rounded-md border bg-background text-sm"
            />
            <button disabled={saving} className="w-full h-10 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50">
              {saving ? "Saving…" : form.id ? "Save changes" : "Add link"}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
