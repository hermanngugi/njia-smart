import { Link, useRouter, useRouterState } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import {
  LayoutDashboard, Users, ClipboardCheck, Receipt, Lightbulb,
  ListTodo, Megaphone, FolderOpen, CalendarDays, UserCog, Settings,
  LogOut, Menu, History, Wallet, Monitor, Landmark, Wallet2, Briefcase,
  Contact, MessageSquare, Link2, PanelLeftClose, PanelLeftOpen, X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { NotificationBell } from "./notification-bell";
import { CommandPalette } from "./command-palette";
import { PageTransition } from "./page-transition";
import { NAV_MODULE_BY_PATH } from "@/lib/permissions";
import { useChatUnreadCount } from "@/hooks/use-chat-unread-count";
import { useChatDelivery } from "@/hooks/use-chat-delivery";
import { useNotificationSound } from "@/hooks/use-notification-sound";
import { SoundToggle } from "./sound-toggle";
import { OfflineIndicator } from "./offline-indicator";
import { ThemeToggle } from "./theme-toggle";
import { pendingChangeCount } from "@/lib/offline";

type NavLink = { to: string; label: string; icon: LucideIcon };

// Sidebar order is defined here, top to bottom. Who sees each entry is NOT
// decided here — it comes from ROLE_ACCESS in @/lib/permissions (via
// NAV_MODULE_BY_PATH), so a role with no rights never sees the entry.
const NAV: { section: string; links: NavLink[] }[] = [
  { section: "Work", links: [
    { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { to: "/clients", label: "Clients", icon: Users },
    { to: "/tasks", label: "Tasks", icon: ListTodo },
    { to: "/calendar", label: "Calendar", icon: CalendarDays },
    { to: "/documents", label: "Documents", icon: FolderOpen },
    { to: "/chat", label: "Chat", icon: MessageSquare },
  ] },
  { section: "Services", links: [
    { to: "/tax", label: "Tax", icon: Receipt },
    { to: "/audit", label: "Audit", icon: ClipboardCheck },
    { to: "/advisory", label: "Advisory", icon: Lightbulb },
    { to: "/outsourced-accounting", label: "Outsourced Accounting", icon: Landmark },
    { to: "/payroll-management", label: "Payroll Management", icon: Wallet2 },
    { to: "/financial-business-management", label: "Financial Business Mgmt", icon: Briefcase },
    { to: "/ict", label: "ICT", icon: Monitor },
  ] },
  { section: "Office", links: [
    { to: "/accounts", label: "Accounts", icon: Wallet },
    { to: "/hr", label: "HR & Employees", icon: Contact },
    { to: "/announcements", label: "Announcements", icon: Megaphone },
    { to: "/quick-links", label: "Quick Links", icon: Link2 },
    { to: "/team", label: "Team", icon: UserCog },
    { to: "/activity", label: "Activity", icon: History },
    { to: "/settings", label: "Settings", icon: Settings },
  ] },
];

const isActivePath = (pathname: string, to: string) =>
  pathname === to || pathname.startsWith(to + "/");

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, roles, canView, signOut } = useAuth();
  const router = useRouter();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [open, setOpen] = useState(false);           // phone/tablet drawer
  const [collapsed, setCollapsed] = useState(false); // desktop icon rail
  const chatUnread = useChatUnreadCount();
  // Marks incoming chat messages as delivered while the app is open (the second grey tick).
  useChatDelivery();
  useNotificationSound();

  useEffect(() => {
    try { setCollapsed(localStorage.getItem("sidebar-collapsed") === "1"); } catch { /* storage unavailable */ }
  }, []);
  const toggleCollapsed = () => setCollapsed((c) => {
    try { localStorage.setItem("sidebar-collapsed", c ? "0" : "1"); } catch { /* storage unavailable */ }
    return !c;
  });

  useEffect(() => { setOpen(false); }, [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Only show a nav entry when the user actually has rights to that module —
  // no rights means no visibility, not just a blocked click-through.
  const canSee = ({ to }: NavLink) => {
    const moduleKey = NAV_MODULE_BY_PATH[to];
    return moduleKey ? canView(moduleKey) : true;
  };
  const sections = NAV.map((s) => ({ ...s, links: s.links.filter(canSee) })).filter((s) => s.links.length);
  const pages = sections.flatMap((s) => s.links);
  const title = pages.find((l) => isActivePath(pathname, l.to))?.label ?? pathname.split("/")[1]?.replace(/-/g, " ") ?? "";

  // In the desktop icon rail, text is hidden; the phone drawer always shows it.
  const hideWhenRail = collapsed ? "lg:hidden" : "";

  async function handleSignOut() {
    const n = await pendingChangeCount();
    if (n > 0 && !window.confirm(`${n} change${n > 1 ? "s haven't" : " hasn't"} synced yet. Signing out now will discard ${n > 1 ? "them" : "it"}. Sign out anyway?`)) return;
    await signOut();
    router.navigate({ to: "/login", search: { next: undefined } });
  }

  return (
    <div className="min-h-screen bg-background">
      <aside
        id="primary-sidebar"
        className={`fixed inset-y-0 left-0 z-40 h-screen w-64 flex flex-col bg-sidebar text-sidebar-foreground transition-[transform,width,visibility] duration-200 lg:visible lg:translate-x-0 ${open ? "visible translate-x-0 shadow-xl" : "invisible -translate-x-full"} ${collapsed ? "lg:w-16" : "lg:w-60"}`}
      >
        <div className={`h-14 shrink-0 flex items-center justify-between gap-2 border-b border-sidebar-border px-4 ${collapsed ? "lg:justify-center lg:px-0" : ""}`}>
          <div className={`min-w-0 truncate text-sm font-bold ${hideWhenRail}`}>G.K Nahashon & Company</div>
          {collapsed && <div className="hidden lg:block text-sm font-bold">GK</div>}
          <button type="button" onClick={() => setOpen(false)} className="lg:hidden p-2 -mr-2" aria-label="Close menu"><X className="h-5 w-5" /></button>
        </div>

        <nav className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-2 py-2">
          {sections.map((section) => (
            <div key={section.section} className="mb-1">
              <div className={`px-3 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-sidebar-foreground/50 ${hideWhenRail}`}>{section.section}</div>
              {collapsed && <div className="hidden lg:block mx-2 my-1 border-t border-sidebar-border" />}
              {section.links.map(({ to, label, icon: Icon }) => {
                const active = isActivePath(pathname, to);
                return (
                  <Link
                    key={to}
                    to={to}
                    title={collapsed ? label : undefined}
                    aria-current={active ? "page" : undefined}
                    onClick={() => setOpen(false)}
                    className={`relative flex items-center gap-3 rounded-md px-3 py-2.5 lg:py-1 text-sm font-medium whitespace-nowrap ${collapsed ? "lg:justify-center lg:px-0 lg:py-2" : ""} ${active ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"}`}
                  >
                    {active && <span aria-hidden className="absolute left-0 inset-y-1.5 w-0.5 rounded-full bg-accent" />}
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className={`truncate ${hideWhenRail}`}>{label}</span>
                    {to === "/chat" && chatUnread > 0 && <span className="ml-auto h-2 w-2 shrink-0 rounded-full bg-accent" />}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="shrink-0 border-t border-sidebar-border p-2">
          <div className={`px-3 pb-2 ${hideWhenRail}`}>
            <div className="text-xs text-sidebar-foreground/60 truncate">{user?.email}</div>
            <div className="text-[10px] uppercase tracking-wider text-accent">{roles[0]?.replace(/_/g, " ") || "Staff"}</div>
          </div>
          <button type="button" onClick={handleSignOut} title={collapsed ? "Sign out" : undefined} className={`w-full flex items-center gap-3 rounded-md px-3 py-2 text-sm hover:bg-sidebar-accent ${collapsed ? "lg:justify-center lg:px-0" : ""}`}>
            <LogOut className="h-4 w-4 shrink-0" />
            <span className={hideWhenRail}>Sign out</span>
          </button>
        </div>
      </aside>

      {open && <div aria-hidden="true" className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={() => setOpen(false)} />}

      {/* No explicit width: the column fills whatever the margin leaves. */}
      <div className={`flex min-h-screen min-w-0 flex-col transition-[margin] duration-200 ${collapsed ? "lg:ml-16" : "lg:ml-60"}`}>
        <header className="sticky top-0 z-20 h-14 min-w-0 flex items-center gap-2 border-b bg-card px-2 sm:px-4">
          <button type="button" className="lg:hidden shrink-0 rounded-md p-2 hover:bg-muted" onClick={() => setOpen(true)} aria-label="Open navigation menu" aria-controls="primary-sidebar" aria-expanded={open}>
            <Menu className="h-5 w-5" />
          </button>
          <button type="button" className="hidden lg:inline-flex shrink-0 rounded-md p-2 -ml-2 hover:bg-muted" onClick={toggleCollapsed} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} title={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
            {collapsed ? <PanelLeftOpen className="h-5 w-5" /> : <PanelLeftClose className="h-5 w-5" />}
          </button>
          <div className="min-w-0 flex-1 truncate text-sm font-semibold capitalize">{title}</div>
          <div className="flex shrink-0 items-center sm:gap-1.5">
            <CommandPalette pages={pages} />
            <ThemeToggle />
            <OfflineIndicator paths={pages.map((l) => l.to)} />
            <SoundToggle />
            <NotificationBell />
          </div>
        </header>
        <main className="min-w-0 flex-1 p-4 md:p-6">
          <div className="mx-auto w-full max-w-[1600px]">
            <PageTransition>{children}</PageTransition>
          </div>
        </main>
      </div>
    </div>
  );
}
