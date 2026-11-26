import { useEffect, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { Search, Users, Receipt, ClipboardCheck, UserCog, Link2, type LucideIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { ClientTypeBadge } from "@/components/client-type-badge";
import { clientDisplayName, clientSearchFilter } from "@/lib/client-search";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";

export type PaletteLink = { to: string; label: string; icon: LucideIcon };

type Records = {
  clients: { id: string; client_type: string | null; company_name: string | null; first_name: string | null; last_name: string | null; kra_pin: string | null; id_number: string | null; email: string | null }[];
  invoices: { id: string; invoice_number: string; status: string | null; total: number | null; currency: string | null }[];
  audits: { id: string; title: string; status: string | null }[];
  team: { id: string; full_name: string | null; job_title: string | null; department: string | null }[];
  links: { id: string; title: string; url: string; category: string | null }[];
};
const EMPTY: Records = { clients: [], invoices: [], audits: [], team: [], links: [] };
const MIN_CHARS = 2;
const LIMIT = 5;

/** Strip characters that would break a PostgREST filter string (commas, parentheses, quotes, wildcards). */
export function cleanQuery(raw: string): string {
  return raw.replace(/[%,()"\\*]/g, " ").replace(/\s+/g, " ").trim();
}

/** Only ever open real web links from the palette. */
export function isSafeUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

/** Global search: press Ctrl/Cmd+K anywhere (or use the header button) to jump to a page or record. */
export function CommandPalette({ pages }: { pages: PaletteLink[] }) {
  const router = useRouter();
  const { canView } = useAuth();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [records, setRecords] = useState<Records>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [isMac, setIsMac] = useState(false);

  // Same visibility rules as the sidebar. Row-level security still applies on top of these.
  const seeClients = canView("clients");
  const seeInvoices = canView("accounts");
  const seeAudits = canView("audit");
  const seeTeam = canView("team");

  useEffect(() => {
    setIsMac(/mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent));
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open) { setQuery(""); setRecords(EMPTY); setLoading(false); }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const q = cleanQuery(query);
    if (q.length < MIN_CHARS) { setRecords(EMPTY); setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      const like = `%${q}%`;
      const db = supabase as any;
      // A failing group (no access, network blip) just shows nothing instead of breaking the whole search.
      const run = async (enabled: boolean, fn: () => PromiseLike<{ data: any; error: any }>) => {
        if (!enabled) return [];
        try { const { data, error } = await fn(); return error ? [] : (data ?? []); } catch { return []; }
      };
      const [clients, invoices, audits, team, links] = await Promise.all([
        run(seeClients, () => db.from("clients").select("id, client_type, company_name, first_name, last_name, kra_pin, id_number, email")
          .or(clientSearchFilter(q))
          .order("company_name").limit(8)),
        run(seeInvoices, () => db.from("invoices").select("id, invoice_number, status, total, currency")
          .ilike("invoice_number", like).order("created_at", { ascending: false }).limit(LIMIT)),
        run(seeAudits, () => db.from("engagements").select("id, title, status")
          .eq("type", "audit").ilike("title", like).order("created_at", { ascending: false }).limit(LIMIT)),
        run(seeTeam, () => db.from("profiles").select("id, full_name, job_title, department")
          .ilike("full_name", like).order("full_name").limit(LIMIT)),
        run(true, () => db.from("quick_links").select("id, title, url, category")
          .or(`title.ilike.${like},category.ilike.${like},description.ilike.${like}`)
          .order("sort_order").limit(LIMIT)),
      ]);
      if (cancelled) return;
      setRecords({ clients, invoices, audits, team, links });
      setLoading(false);
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [query, open, seeClients, seeInvoices, seeAudits, seeTeam]);

  const go = (path: string) => {
    setOpen(false);
    router.history.push(path);
  };
  const openExternal = (url: string) => {
    setOpen(false);
    if (isSafeUrl(url)) window.open(url, "_blank", "noopener,noreferrer");
  };

  const q = cleanQuery(query);
  const shownPages = q ? pages.filter((p) => p.label.toLowerCase().includes(q.toLowerCase())) : pages;
  const hasRecords = Object.values(records).some((r) => r.length > 0);
  const nothing = shownPages.length === 0 && !hasRecords;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Search"
        className="inline-flex items-center gap-2 h-8 px-2.5 rounded-md border bg-background text-xs text-muted-foreground hover:bg-muted"
      >
        <Search className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Search…</span>
        <kbd className="hidden md:inline rounded border bg-muted px-1.5 py-0.5 text-[10px] font-medium">{isMac ? "⌘" : "Ctrl"} K</kbd>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="mobile-search-dialog overflow-hidden p-0 max-w-xl top-[20%] translate-y-0">
          <DialogTitle className="sr-only">Search</DialogTitle>
          <Command shouldFilter={false} className="[&_[cmdk-input]]:h-12 [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-2.5 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group]]:px-2">
            <CommandInput value={query} onValueChange={setQuery} placeholder="Search pages, clients (company or individual), invoices, audits, team…" />
            <CommandList className="max-h-[360px]">
              {loading && <div className="py-6 text-center text-sm text-muted-foreground">Searching…</div>}
              {!loading && nothing && q.length >= MIN_CHARS && <CommandEmpty>No results for “{q}”.</CommandEmpty>}
              {!loading && nothing && q.length < MIN_CHARS && <CommandEmpty>No matching pages. Type {MIN_CHARS}+ characters to search records.</CommandEmpty>}

              {shownPages.length > 0 && (
                <CommandGroup heading={q ? "Pages" : "Go to"}>
                  {shownPages.map(({ to, label, icon: Icon }) => (
                    <CommandItem key={to} value={`page-${to}`} onSelect={() => go(to)}>
                      <Icon className="mr-2 h-4 w-4 text-muted-foreground" />{label}
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}

              {records.clients.length > 0 && (
                <CommandGroup heading="Clients">
                  {records.clients.map((c) => (
                    <CommandItem key={c.id} value={`client-${c.id}`} onSelect={() => go(`/clients/${c.id}`)}>
                      <Users className="mr-2 h-4 w-4 text-muted-foreground" />
                      <span className="truncate">{clientDisplayName(c)}</span>
                      <span className="ml-2"><ClientTypeBadge type={c.client_type} /></span>
                      {(c.kra_pin || c.id_number || c.email) && <span className="ml-2 text-xs text-muted-foreground truncate">{c.kra_pin || c.id_number || c.email}</span>}
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}

              {records.invoices.length > 0 && (
                <CommandGroup heading="Invoices">
                  {records.invoices.map((i) => (
                    <CommandItem key={i.id} value={`invoice-${i.id}`} onSelect={() => go(`/accounts/${i.id}`)}>
                      <Receipt className="mr-2 h-4 w-4 text-muted-foreground" />
                      <span>{i.invoice_number}</span>
                      <span className="ml-2 text-xs text-muted-foreground capitalize">
                        {[i.status?.replace(/_/g, " "), i.total != null ? `${i.currency ?? "KES"} ${Number(i.total).toLocaleString("en-KE")}` : null].filter(Boolean).join(" · ")}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}

              {records.audits.length > 0 && (
                <CommandGroup heading="Audit engagements">
                  {records.audits.map((a) => (
                    <CommandItem key={a.id} value={`audit-${a.id}`} onSelect={() => go(`/audit/${a.id}`)}>
                      <ClipboardCheck className="mr-2 h-4 w-4 text-muted-foreground" />
                      <span>{a.title}</span>
                      {a.status && <span className="ml-2 text-xs text-muted-foreground capitalize">{a.status.replace(/_/g, " ")}</span>}
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}

              {records.team.length > 0 && (
                <CommandGroup heading="Team">
                  {records.team.map((p) => (
                    <CommandItem key={p.id} value={`team-${p.id}`} onSelect={() => go(`/team/${p.id}`)}>
                      <UserCog className="mr-2 h-4 w-4 text-muted-foreground" />
                      <span>{p.full_name || "Unnamed"}</span>
                      {(p.job_title || p.department) && <span className="ml-2 text-xs text-muted-foreground truncate">{p.job_title || p.department}</span>}
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}

              {records.links.length > 0 && (
                <CommandGroup heading="Quick links">
                  {records.links.map((l) => (
                    <CommandItem key={l.id} value={`link-${l.id}`} onSelect={() => openExternal(l.url)}>
                      <Link2 className="mr-2 h-4 w-4 text-muted-foreground" />
                      <span>{l.title}</span>
                      {l.category && <span className="ml-2 text-xs text-muted-foreground">{l.category}</span>}
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
            </CommandList>
            <div className="border-t px-3 py-2 text-[11px] text-muted-foreground flex gap-4">
              <span>↑↓ navigate</span><span>↵ open</span><span>esc close</span>
            </div>
          </Command>
        </DialogContent>
      </Dialog>
    </>
  );
}
