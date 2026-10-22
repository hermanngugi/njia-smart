import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Eye, EyeOff, LockKeyhole, Plus, Search, Pencil, Trash2, Copy, ShieldCheck, KeyRound, LogOut, RefreshCw } from "lucide-react";

type VaultConfig = { id: boolean; salt: string; verification_iv: string; verification_ciphertext: string };
type VaultRow = { id: string; encrypted_data: string; iv: string; created_at: string; updated_at: string; created_by: string | null; updated_by: string | null };
type Entry = { id?: string; name: string; category: string; username: string; password: string; url: string; notes: string; updated_at?: string; created_at?: string };

const CATEGORIES = ["Email", "Network / Wi-Fi", "Router / Firewall", "Software / Licences", "Website / Domain", "Cloud / Hosting", "Printer / Copier", "Computer / Device", "Business System", "Other"];
const EMPTY_ENTRY: Entry = { name: "", category: CATEGORIES[0], username: "", password: "", url: "", notes: "" };
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary);
}
function fromBase64(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}
function randomBytes(length: number) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}
async function deriveKey(passphrase: string, salt: Uint8Array) {
  const material = await crypto.subtle.importKey("raw", encoder.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: 310_000, hash: "SHA-256" }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
async function encryptText(key: CryptoKey, value: string) {
  const iv = randomBytes(12);
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(value));
  return { iv: toBase64(iv), ciphertext: toBase64(new Uint8Array(encrypted)) };
}
async function decryptText(key: CryptoKey, iv: string, ciphertext: string) {
  const clear = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(iv) }, key, fromBase64(ciphertext));
  return decoder.decode(clear);
}

/**
 * Office credentials are encrypted in the browser using a shared vault passphrase.
 * The passphrase/key are never stored in localStorage, sessionStorage or the database.
 */
export function IctPasswordVault() {
  const [config, setConfig] = useState<VaultConfig | null>(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [passphrase, setPassphrase] = useState("");
  const [confirmPassphrase, setConfirmPassphrase] = useState("");
  const [key, setKey] = useState<CryptoKey | null>(null);
  const [rows, setRows] = useState<VaultRow[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("All categories");
  const [editing, setEditing] = useState<Entry | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<Entry>(EMPTY_ENTRY);
  const [saving, setSaving] = useState(false);
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [visiblePasswords, setVisiblePasswords] = useState<Set<string>>(new Set());
  const [showFormPassword, setShowFormPassword] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    if (!key) return;
    let timer: ReturnType<typeof setTimeout>;
    const lockAfterIdle = () => {
      setKey(null);
      setEntries([]);
      setRows([]);
      setVisiblePasswords(new Set());
      setEditing(null);
      setForm(EMPTY_ENTRY);
      setFormOpen(false);
      toast.info("The password vault was locked after 10 minutes of inactivity.");
    };
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(lockAfterIdle, 10 * 60 * 1000);
    };
    const activityEvents: (keyof WindowEventMap)[] = ["pointerdown", "keydown", "touchstart"];
    activityEvents.forEach((event) => window.addEventListener(event, schedule, { passive: true }));
    schedule();
    return () => {
      clearTimeout(timer);
      activityEvents.forEach((event) => window.removeEventListener(event, schedule));
    };
  }, [key]);

  useEffect(() => {
    let active = true;
    (async () => {
      const [{ data: auth }, { data, error }] = await Promise.all([
        supabase.auth.getUser(),
        (supabase.from("ict_password_vault_config" as any) as any).select("id,salt,verification_iv,verification_ciphertext").eq("id", true).maybeSingle(),
      ]);
      if (!active) return;
      if (error) toast.error(`Could not load vault configuration: ${error.message}`);
      setUserId(auth.user?.id ?? null);
      setConfig((data as VaultConfig | null) ?? null);
      setConfigLoading(false);
    })();
    return () => { active = false; };
  }, []);

  async function loadEntries(activeKey: CryptoKey): Promise<boolean> {
    setLoading(true);
    const { data, error } = await (supabase.from("ict_password_vault" as any) as any)
      .select("id,encrypted_data,iv,created_at,updated_at,created_by,updated_by")
      .order("updated_at", { ascending: false });
    if (error) {
      toast.error(`Could not load vault entries: ${error.message}`);
      setLoading(false);
      return false;
    }
    const loadedRows = (data ?? []) as VaultRow[];
    try {
      const decoded = await Promise.all(loadedRows.map(async (row) => ({
        ...(JSON.parse(await decryptText(activeKey, row.iv, row.encrypted_data)) as Omit<Entry, "id">),
        id: row.id,
        created_at: row.created_at,
        updated_at: row.updated_at,
      })));
      setRows(loadedRows);
      setEntries(decoded);
      return true;
    } catch {
      setKey(null);
      setRows([]);
      setEntries([]);
      toast.error("The vault could not be decrypted. It may have been changed or the passphrase is incorrect. The vault has been locked.");
      return false;
    } finally {
      setLoading(false);
    }
  }

  async function unlockOrInitialize(event: React.FormEvent) {
    event.preventDefault();
    if (!passphrase.trim()) { toast.error("Enter the vault passphrase."); return; }
    setLoading(true);
    try {
      if (!config) {
        if (passphrase.length < 12) { toast.error("Choose a strong vault passphrase with at least 12 characters."); setLoading(false); return; }
        if (passphrase !== confirmPassphrase) { toast.error("The passphrases do not match."); setLoading(false); return; }
        const salt = randomBytes(16);
        const derived = await deriveKey(passphrase, salt);
        const verification = await encryptText(derived, "NJIA-SMART-ICT-VAULT-VERIFIED-V1");
        const { data, error } = await (supabase.from("ict_password_vault_config" as any) as any).insert({
          id: true,
          salt: toBase64(salt),
          verification_iv: verification.iv,
          verification_ciphertext: verification.ciphertext,
          created_by: userId,
        }).select("id,salt,verification_iv,verification_ciphertext").single();
        if (error) {
          // If another authorised operator initialized the vault at the same time, reload the shared configuration.
          const { data: existing } = await (supabase.from("ict_password_vault_config" as any) as any).select("id,salt,verification_iv,verification_ciphertext").eq("id", true).maybeSingle();
          if (existing) {
            setConfig(existing as VaultConfig);
            toast.error("The vault was initialized by another operator. Enter the shared vault passphrase to unlock it.");
          } else toast.error(`Could not initialize vault: ${error.message}`);
          setLoading(false);
          return;
        }
        setConfig(data as VaultConfig);
        setKey(derived);
        setPassphrase("");
        setConfirmPassphrase("");
        const loaded = await loadEntries(derived);
        if (loaded) toast.success("Password vault initialized and unlocked.");
        return;
      }
      const derived = await deriveKey(passphrase, fromBase64(config.salt));
      const check = await decryptText(derived, config.verification_iv, config.verification_ciphertext);
      if (check !== "NJIA-SMART-ICT-VAULT-VERIFIED-V1") throw new Error("Incorrect passphrase");
      setKey(derived);
      setPassphrase("");
      setConfirmPassphrase("");
      const loaded = await loadEntries(derived);
      if (loaded) toast.success("Password vault unlocked.");
    } catch {
      toast.error("Unable to unlock the vault. Check the passphrase and try again.");
    } finally {
      setLoading(false);
    }
  }

  function lockVault() {
    setKey(null);
    setEntries([]);
    setRows([]);
    setVisiblePasswords(new Set());
    setEditing(null);
    setForm(EMPTY_ENTRY);
    setFormOpen(false);
    setPassphrase("");
    setConfirmPassphrase("");
  }

  function openNewEntry() { setEditing(null); setForm(EMPTY_ENTRY); setShowFormPassword(false); setFormOpen(true); }
  function openEditEntry(entry: Entry) { setEditing(entry); setForm({ ...EMPTY_ENTRY, ...entry }); setShowFormPassword(false); setFormOpen(true); }

  async function saveEntry(event: React.FormEvent) {
    event.preventDefault();
    if (!key || !form.name.trim() || !form.password) { toast.error("A system name and password are required."); return; }
    setSaving(true);
    try {
      const encrypted = await encryptText(key, JSON.stringify({
        name: form.name.trim(), category: form.category, username: form.username.trim(),
        password: form.password, url: form.url.trim(), notes: form.notes.trim(),
      }));
      const payload = { encrypted_data: encrypted.ciphertext, iv: encrypted.iv, updated_by: userId, updated_at: new Date().toISOString() };
      const query = supabase.from("ict_password_vault" as any) as any;
      const result = editing?.id
        ? await query.update(payload).eq("id", editing.id)
        : await query.insert({ ...payload, created_by: userId });
      if (result.error) throw result.error;
      toast.success(editing ? "Credential updated." : "Credential saved.");
      setEditing(null);
      setForm(EMPTY_ENTRY);
      setFormOpen(false);
      await loadEntries(key);
    } catch (error: any) {
      toast.error(`Could not save credential: ${error?.message ?? "Unknown error"}`);
    } finally { setSaving(false); }
  }

  async function deleteEntry(entry: Entry) {
    if (!entry.id || !window.confirm(`Delete the saved credentials for “${entry.name}”? This cannot be undone.`)) return;
    const { error } = await (supabase.from("ict_password_vault" as any) as any).delete().eq("id", entry.id);
    if (error) { toast.error(`Could not delete credential: ${error.message}`); return; }
    toast.success("Credential deleted.");
    if (key) await loadEntries(key);
  }

  async function copyValue(value: string, label: string) {
    try { await navigator.clipboard.writeText(value); toast.success(`${label} copied. Clear it from the clipboard when finished.`); }
    catch { toast.error("Clipboard access was blocked by the browser."); }
  }

  const filteredEntries = useMemo(() => entries.filter((entry) => {
    const matchesCategory = categoryFilter === "All categories" || entry.category === categoryFilter;
    const term = search.trim().toLowerCase();
    return matchesCategory && (!term || [entry.name, entry.category, entry.username, entry.url, entry.notes].some((v) => v.toLowerCase().includes(term)));
  }), [entries, categoryFilter, search]);

  if (configLoading) return <section className="rounded-lg border bg-card p-5 text-sm text-muted-foreground">Loading password vault…</section>;

  return (
    <section className="rounded-lg border bg-card overflow-hidden">
      <div className="px-4 py-3 border-b flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center"><LockKeyhole className="h-5 w-5 text-primary" /></div>
          <div><h2 className="font-semibold">ICT Password Vault</h2><p className="text-xs text-muted-foreground">Encrypted office credentials, organised by system and category.</p></div>
        </div>
        {key && <button type="button" onClick={lockVault} className="h-8 px-3 rounded-md border text-xs inline-flex items-center gap-1.5"><LogOut className="h-3.5 w-3.5" /> Lock vault</button>}
      </div>

      {!key ? (
        <form onSubmit={unlockOrInitialize} className="p-4 sm:p-6 max-w-xl space-y-4">
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
            <div className="flex items-center gap-2 font-medium"><ShieldCheck className="h-4 w-4" /> Encrypted vault</div>
            <p className="mt-1 text-muted-foreground">Credentials are encrypted in your browser before being saved. Use one strong shared vault passphrase with authorised vault users. The passphrase is never saved by this app.</p>
          </div>
          {!config && <p className="text-sm text-muted-foreground">This vault has not been initialized. The first authorised operator must create the shared passphrase. Store it safely: it cannot be recovered if lost.</p>}
          <label className="block text-sm font-medium">{config ? "Vault passphrase" : "Create shared vault passphrase"}
            <div className="mt-1 flex gap-2"><input autoComplete="current-password" type={showPassphrase ? "text" : "password"} value={passphrase} onChange={(e) => setPassphrase(e.target.value)} required minLength={config ? 1 : 12} className="h-10 w-full rounded-md border bg-background px-3 text-sm" placeholder="Enter vault passphrase" /><button type="button" onClick={() => setShowPassphrase((v) => !v)} className="h-10 w-10 shrink-0 rounded-md border inline-flex items-center justify-center" aria-label={showPassphrase ? "Hide passphrase" : "Show passphrase"}>{showPassphrase ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></div>
          </label>
          {!config && <label className="block text-sm font-medium">Confirm passphrase<input autoComplete="new-password" type={showPassphrase ? "text" : "password"} value={confirmPassphrase} onChange={(e) => setConfirmPassphrase(e.target.value)} required minLength={12} className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm" /></label>}
          <button disabled={loading} className="h-10 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium inline-flex items-center gap-2 disabled:opacity-50">{loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}{loading ? "Unlocking…" : config ? "Unlock vault" : "Initialize vault"}</button>
        </form>
      ) : (
        <div className="p-4 space-y-4">
          <div className="flex flex-col lg:flex-row gap-2 lg:items-center">
            <div className="relative flex-1"><Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search systems, usernames, URLs or notes…" className="h-9 w-full rounded-md border bg-background pl-9 pr-3 text-sm" /></div>
            <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="h-9 rounded-md border bg-background px-3 text-sm"><option>All categories</option>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
            <button type="button" onClick={openNewEntry} className="h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm inline-flex items-center justify-center gap-1.5"><Plus className="h-4 w-4" /> Add credential</button>
          </div>
          {formOpen ? (
            <form onSubmit={saveEntry} className="rounded-lg border bg-muted/20 p-4 space-y-3">
              <div className="flex items-center justify-between gap-2"><h3 className="font-semibold">{editing ? "Edit credential" : "New credential"}</h3><button type="button" onClick={() => { setEditing(null); setForm(EMPTY_ENTRY); setFormOpen(false); }} className="text-sm text-muted-foreground">Cancel</button></div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-sm font-medium">System / service name *<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Office Wi-Fi, domain registrar" className="mt-1 h-9 w-full rounded-md border bg-background px-3 font-normal" /></label>
                <label className="text-sm font-medium">Category<select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="mt-1 h-9 w-full rounded-md border bg-background px-3 font-normal">{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></label>
                <label className="text-sm font-medium">Username / account<input autoComplete="off" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder="Account username or email" className="mt-1 h-9 w-full rounded-md border bg-background px-3 font-normal" /></label>
                <label className="text-sm font-medium">Password / secret *<div className="mt-1 flex gap-2"><input required autoComplete="new-password" type={showFormPassword ? "text" : "password"} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="h-9 w-full min-w-0 rounded-md border bg-background px-3 font-normal" placeholder="Password or secret key" /><button type="button" onClick={() => setShowFormPassword((v) => !v)} className="h-9 w-9 shrink-0 rounded-md border inline-flex items-center justify-center" aria-label={showFormPassword ? "Hide password" : "Show password"}>{showFormPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></div></label>
                <label className="text-sm font-medium sm:col-span-2">Login URL / location<input autoComplete="off" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="Website URL, device location or admin portal" className="mt-1 h-9 w-full rounded-md border bg-background px-3 font-normal" /></label>
                <label className="text-sm font-medium sm:col-span-2">Notes / recovery instructions<textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} placeholder="Non-secret context, owner, renewal date, recovery instructions…" className="mt-1 w-full rounded-md border bg-background px-3 py-2 font-normal" /></label>
              </div>
              <button disabled={saving} className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm disabled:opacity-50">{saving ? "Saving…" : editing ? "Save changes" : "Save credential"}</button>
            </form>
          ) : null}

          {loading ? <div className="py-8 text-center text-sm text-muted-foreground">Decrypting vault entries…</div> : filteredEntries.length === 0 ? (
            <div className="py-10 text-center"><KeyRound className="h-8 w-8 mx-auto text-muted-foreground/50" /><p className="mt-2 text-sm font-medium">{entries.length ? "No matching credentials" : "No credentials saved yet"}</p><p className="mt-1 text-xs text-muted-foreground">Add each office system as a separate entry and assign the right category.</p></div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {filteredEntries.map((entry) => {
                const showPassword = visiblePasswords.has(entry.id ?? "");
                return <article key={entry.id} className="rounded-lg border p-4 min-w-0 space-y-3">
                  <div className="flex items-start gap-2"><div className="min-w-0 flex-1"><span className="inline-flex rounded-full bg-primary/10 text-primary px-2 py-0.5 text-[11px]">{entry.category}</span><h3 className="mt-1 font-semibold break-words">{entry.name}</h3></div><button type="button" title="Edit credential" onClick={() => openEditEntry(entry)} className="p-1.5 rounded hover:bg-muted"><Pencil className="h-4 w-4" /></button><button type="button" title="Delete credential" onClick={() => deleteEntry(entry)} className="p-1.5 rounded hover:bg-destructive/10 hover:text-destructive"><Trash2 className="h-4 w-4" /></button></div>
                  {entry.username && <div className="text-sm"><div className="text-xs text-muted-foreground">Username / account</div><div className="flex items-center gap-2"><span className="min-w-0 flex-1 break-all">{entry.username}</span><button type="button" title="Copy username" onClick={() => void copyValue(entry.username, "Username")} className="p-1 text-muted-foreground hover:text-primary"><Copy className="h-3.5 w-3.5" /></button></div></div>}
                  <div className="text-sm"><div className="text-xs text-muted-foreground">Password / secret</div><div className="flex items-center gap-2"><code className="min-w-0 flex-1 break-all font-mono">{showPassword ? entry.password : "••••••••••••"}</code><button type="button" title={showPassword ? "Hide password" : "Reveal password"} onClick={() => setVisiblePasswords((prev) => { const next = new Set(prev); if (showPassword) next.delete(entry.id ?? ""); else next.add(entry.id ?? ""); return next; })} className="p-1 text-muted-foreground hover:text-primary">{showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}</button><button type="button" title="Copy password" onClick={() => void copyValue(entry.password, "Password")} className="p-1 text-muted-foreground hover:text-primary"><Copy className="h-3.5 w-3.5" /></button></div></div>
                  {entry.url && <div className="text-sm min-w-0"><div className="text-xs text-muted-foreground">URL / location</div><span className="break-all">{entry.url}</span></div>}
                  {entry.notes && <div className="text-sm"><div className="text-xs text-muted-foreground">Notes</div><p className="whitespace-pre-wrap break-words">{entry.notes}</p></div>}
                  <div className="pt-1 text-[11px] text-muted-foreground">Updated {entry.updated_at ? new Date(entry.updated_at).toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" }) : "—"}</div>
                </article>;
              })}
            </div>
          )}
          <p className="text-xs text-muted-foreground">Security reminder: use unique passwords, enable MFA where available, and do not store recovery codes or highly sensitive personal data unless your organisation has approved this vault for that purpose. Lock the vault when finished.</p>
        </div>
      )}
    </section>
  );
}
