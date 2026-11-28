import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { ModalForm } from "@/components/modal-form";

const EMPTY = { id: "", name: "", description: "", quantity: "1", unit_cost: "", purchase_date: "", assigned_to: "" };
const FIELD = "w-full h-9 px-3 rounded-md border bg-background text-sm";

export function IctEquipment() {
  const { user } = useAuth();
  const [rows, setRows] = useState<any[]>([]);
  const [people, setPeople] = useState<{ id: string; full_name: string | null }[]>([]);
  const [form, setForm] = useState<typeof EMPTY | null>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    const [a, p] = await Promise.all([
      supabase.from("ict_assets").select("*").order("name"),
      supabase.from("profiles").select("id, full_name").order("full_name"),
    ]);
    if (a.error) toast.error(a.error.message);
    setRows(a.data ?? []);
    setPeople(p.data ?? []);
  }
  useEffect(() => { void load(); }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form || !user || saving) return;
    setSaving(true);
    const payload = {
      name: form.name.trim(), description: form.description.trim() || null, quantity: Number(form.quantity) || 1,
      unit_cost: form.unit_cost ? Number(form.unit_cost) : null, purchase_date: form.purchase_date || null, assigned_to: form.assigned_to || null,
    };
    const { error } = form.id
      ? await supabase.from("ict_assets").update(payload).eq("id", form.id)
      : await supabase.from("ict_assets").insert({ ...payload, created_by: user.id });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    setForm(null);
    void load();
  }

  async function remove(id: string, name: string) {
    if (!confirm(`Delete "${name}"?`)) return;
    const { error } = await supabase.from("ict_assets").delete().eq("id", id);
    if (error) toast.error(error.message); else void load();
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button onClick={() => setForm(EMPTY)} className="h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm inline-flex items-center gap-2"><Plus className="h-4 w-4" /> Add equipment</button>
      </div>
      <div className="bg-card border rounded-lg divide-y">
        {rows.length === 0 && <div className="py-10 text-center text-sm text-muted-foreground">No equipment recorded.</div>}
        {rows.map((a) => (
          <div key={a.id} className="p-3 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <div className="font-medium text-sm">{a.name}{a.quantity > 1 ? ` × ${a.quantity}` : ""}</div>
              <div className="text-xs text-muted-foreground">
                {[people.find((p) => p.id === a.assigned_to)?.full_name ?? "Office (shared)", a.purchase_date ? `bought ${formatDate(a.purchase_date)}` : null, a.unit_cost != null ? `KES ${Number(a.unit_cost).toLocaleString("en-KE")} each` : null, a.description].filter(Boolean).join(" · ")}
              </div>
            </div>
            <button onClick={() => setForm({ id: a.id, name: a.name, description: a.description ?? "", quantity: String(a.quantity ?? 1), unit_cost: a.unit_cost != null ? String(a.unit_cost) : "", purchase_date: a.purchase_date ?? "", assigned_to: a.assigned_to ?? "" })} title="Edit" className="p-1.5 hover:text-primary"><Pencil className="h-4 w-4" /></button>
            <button onClick={() => void remove(a.id, a.name)} title="Delete" className="p-1.5 hover:text-destructive"><Trash2 className="h-4 w-4" /></button>
          </div>
        ))}
      </div>

      {form && (
        <ModalForm title={form.id ? "Edit equipment" : "Add equipment"} onClose={() => setForm(null)} onSubmit={save}>
          <input required autoFocus placeholder="Item, e.g. Dell laptop" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={FIELD} />
          <label className="block text-xs text-muted-foreground">Who has it
            <select value={form.assigned_to} onChange={(e) => setForm({ ...form, assigned_to: e.target.value })} className={`mt-1 ${FIELD}`}>
              <option value="">Office (shared)</option>
              {people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-muted-foreground">Quantity<input type="number" min={1} required value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} className={`mt-1 ${FIELD}`} /></label>
            <label className="text-xs text-muted-foreground">Unit cost (KES)<input type="number" min={0} step="0.01" value={form.unit_cost} onChange={(e) => setForm({ ...form, unit_cost: e.target.value })} className={`mt-1 ${FIELD}`} /></label>
          </div>
          <label className="block text-xs text-muted-foreground">Date bought<input type="date" value={form.purchase_date} onChange={(e) => setForm({ ...form, purchase_date: e.target.value })} className={`mt-1 ${FIELD}`} /></label>
          <input placeholder="Notes, e.g. serial number" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className={FIELD} />
          <button disabled={saving} className="w-full h-10 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50">{saving ? "Saving…" : "Save"}</button>
        </ModalForm>
      )}
    </div>
  );
}
