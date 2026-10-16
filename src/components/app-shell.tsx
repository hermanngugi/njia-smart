import { Link, useRouter, useRouterState } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import {
  LayoutDashboard, Users, ClipboardCheck, Receipt, Lightbulb,
  ListTodo, Megaphone, FolderOpen, CalendarDays, UserCog, Settings,
  LogOut, Menu, History, Wallet, Monitor, Landmark, Wallet2, Briefcase,
  Contact, MessageSquare, Headset, Link2, Layers, ChevronDown, Pin, PinOff,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { NotificationBell } from "./notification-bell";
import { CommandPalette } from "./command-palette";
import { PageTransition } from "./page-transition";
import { NAV_MODULE_BY_PATH } from "@/lib/permissions";
import { useChatUnreadCount } from "@/hooks/use-chat-unread-count";
import { useNotificationSound } from "@/hooks/use-notification-sound";
import { SoundToggle } from "./sound-toggle";
import { OfflineIndicator } from "./offline-indicator";
import { ThemeToggle } from "./theme-toggle";
import { pendingChangeCount } from "@/lib/offline";

type NavLink = { to: string; label: string; icon: LucideIcon };
type NavGroup = { label: string; icon: LucideIcon; children: NavLink[] };
type NavItem = NavLink | NavGroup;

const isGroup = (item: NavItem): item is NavGroup => "children" in item;

// Sidebar order is defined here, top to bottom. Who sees each entry is NOT
// decided here — it comes from ROLE_ACCESS in @/lib/permissions (via
// NAV_MODULE_BY_PATH), so a role with no rights never sees the entry.
const NAV: NavItem[] = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/clients", label: "Clients", icon: Users },
  { to: "/tax", label: "Tax", icon: Receipt },
  { to: "/audit", label: "Audit", icon: ClipboardCheck },
  { to: "/advisory", label: "Advisory", icon: Lightbulb },
  { to: "/ict", label: "ICT", icon: Monitor },
  { to: "/ict-service-desk", label: "ICT Service Desk", icon: Headset },
  {
    label: "Other Services",
    icon: Layers,
    children: [
      { to: "/outsourced-accounting", label: "Outsourced Accounting", icon: Landmark },
      { to: "/payroll-management", label: "Payroll Management", icon: Wallet2 },
      { to: "/financial-business-management", label: "Financial Business Mgmt", icon: Briefcase },
    ],
  },
  { to: "/hr", label: "HR & Employees", icon: Contact },
  { to: "/documents", label: "Documents", icon: FolderOpen },
  { to: "/chat", label: "Chat", icon: MessageSquare },
  { to: "/quick-links", label: "Quick Links", icon: Link2 },
  { to: "/tasks", label: "Tasks", icon: ListTodo },
  { to: "/calendar", label: "Calendar", icon: CalendarDays },
  { to: "/accounts", label: "Accounts", icon: Wallet },
  { to: "/announcements", label: "Announcements", icon: Megaphone },
  {
    label: "Activity & Team",
    icon: UserCog,
    children: [
      { to: "/team", label: "Team", icon: UserCog },
      { to: "/activity", label: "Activity", icon: History },
    ],
  },
  { to: "/settings", label: "Settings", icon: Settings },
];

const isActivePath = (pathname: string, to: string) =>
  pathname === to || pathname.startsWith(to + "/");

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, roles, canView, signOut } = useAuth();
  const router = useRouter();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [open, setOpen] = useState(false);        // opened with the menu button (slides over the page)
  const [hovered, setHovered] = useState(false);  // expanded by hovering the icon strip (desktop only)
  const [pinned, setPinned] = useState(false);    // kept open on desktop and pushes the page over
  const suppressHover = useRef(false);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const expanded = pinned || open || hovered;
  const chatUnread = useChatUnreadCount();
  useNotificationSound();

  useEffect(() => {
    try { setPinned(localStorage.getItem("sidebar-pinned") === "1"); } catch { /* storage unavailable */ }
  }, []);
  const togglePin = () => setPinned((p) => {
    const next = !p;
    try { localStorage.setItem("sidebar-pinned", next ? "1" : "0"); } catch { /* storage unavailable */ }
    return next;
  });

  const clearHoverTimer = () => { if (hoverTimer.current) { clearTimeout(hoverTimer.current); hoverTimer.current = null; } };
  const canHover = () => typeof window !== "undefined" && window.matchMedia("(hover: hover) and (min-width: 1024px)").matches;
  const onSidebarEnter = () => {
    if (suppressHover.current || !canHover()) return;
    clearHoverTimer();
    hoverTimer.current = setTimeout(() => setHovered(true), 120);
  };
  const onSidebarLeave = () => { clearHoverTimer(); suppressHover.current = false; setHovered(false); };
  // After choosing a page (or pressing Esc) collapse straight away, even though the mouse is still over the strip.
  const collapse = () => { clearHoverTimer(); setOpen(false); setHovered(false); suppressHover.current = true; };

  useEffect(() => {
    if (!open && !hovered) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") collapse(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, hovered]);

  // Only show a nav entry when the user actually has rights to that module —
  // no rights means no visibility, not just a blocked click-through. A group
  // (dropdown) is shown only if at least one of its children is visible.
  const canSee = ({ to }: NavLink) => {
    const moduleKey = NAV_MODULE_BY_PATH[to];
    return moduleKey ? canView(moduleKey) : true;
  };

  const items: NavItem[] = NAV.flatMap((item): NavItem[] => {
    if (!isGroup(item)) return canSee(item) ? [item] : [];
    const children = item.children.filter(canSee);
    return children.length ? [{ ...item, children }] : [];
  });

  // Groups open automatically when one of their pages is the current route;
  // clicking the header toggles them either way.
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const groupOpen = (g: NavGroup) =>
    openGroups[g.label] ?? g.children.some((c) => isActivePath(pathname, c.to));

  return (
    <div className="min-h-screen bg-background">
      {/* Sidebar — always position: fixed to the viewport, at every breakpoint.
          It is intentionally taken out of the document flow entirely so no
          page's content height, scroll container, or layout can drag it
          along when the page scrolls. The main column below is simply
          offset by the sidebar's width via margin-left on desktop. */}
      <aside
        onMouseEnter={onSidebarEnter}
        onMouseLeave={onSidebarLeave}
        className={`fixed inset-y-0 left-0 z-40 h-screen w-64 bg-sidebar text-sidebar-foreground flex flex-col overflow-hidden shadow-xl transition-[transform,width] duration-300 ease-in-out lg:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        } ${expanded ? "lg:w-64" : "lg:w-16"} ${expanded && !pinned ? "" : "lg:shadow-none"}`}
      >
        <div className={`px-5 py-5 border-b border-sidebar-border whitespace-nowrap ${expanded ? "" : "lg:px-1"}`}>
          <div className={`flex items-center justify-between gap-2 ${expanded ? "" : "lg:hidden"}`}>
            <div>
              <div className="text-base font-bold tracking-tight leading-tight">G.K Nahashon</div>
              <div className="text-xs text-sidebar-foreground/60">& Company</div>
            </div>
            <button
              type="button"
              onClick={togglePin}
              aria-pressed={pinned}
              title={pinned ? "Unpin sidebar" : "Keep sidebar open"}
              className="hidden lg:inline-flex p-1.5 rounded-md text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
            >
              {pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
            </button>
          </div>
          <div className={`hidden text-center text-base font-bold tracking-tight ${expanded ? "" : "lg:block"}`}>GK</div>
        </div>
        <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto overflow-x-hidden">
          {items.map((item) => {
            if (isGroup(item)) {
              const Icon = item.icon;
              const open_ = groupOpen(item);
              const childActive = item.children.some((c) => isActivePath(pathname, c.to));
              return (
                <div key={item.label}>
                  <button
                    type="button"
                    title={!expanded ? item.label : undefined}
                    onClick={() => {
                      // In the icon rail, a group can't show its pages inline, so open the sidebar first.
                      if (!expanded) { setOpen(true); setOpenGroups((s) => ({ ...s, [item.label]: true })); }
                      else setOpenGroups((s) => ({ ...s, [item.label]: !open_ }));
                    }}
                    aria-expanded={expanded && open_}
                    className={`relative w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium whitespace-nowrap transition-colors duration-150 ${expanded ? "" : "lg:justify-center lg:px-0"} ${
                      childActive && (!open_ || !expanded)
                        ? "bg-sidebar-accent text-sidebar-accent-foreground"
                        : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground hover:translate-x-0.5"
                    }`}
                  >
                    {childActive && <span aria-hidden className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-accent transition-all duration-200 ease-out" />}
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className={expanded ? "" : "lg:hidden"}>{item.label}</span>
                    <ChevronDown className={`ml-auto h-4 w-4 transition-transform duration-200 ease-out ${open_ ? "rotate-180" : ""} ${expanded ? "" : "lg:hidden"}`} />
                  </button>
                  {open_ && expanded && (
                    <div className="nav-submenu-enter mt-0.5 ml-4 pl-3 border-l border-sidebar-border space-y-0.5">
                      {item.children.map(({ to, label, icon: ChildIcon }) => {
                        const active = isActivePath(pathname, to);
                        return (
                          <Link
                            key={to}
                            to={to}
                            onClick={collapse}
                            className={`relative flex items-center gap-2.5 px-3 py-1.5 rounded-md text-[13px] font-medium whitespace-nowrap transition-colors duration-150 ${
                              active
                                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                                : "text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground hover:translate-x-0.5"
                            }`}
                          >
                            {active && <span aria-hidden className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-accent transition-all duration-200 ease-out" />}
                            <ChildIcon className="h-3.5 w-3.5 shrink-0" />
                            {label}
                          </Link>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            }
            const { to, label, icon: Icon } = item;
            const active = isActivePath(pathname, to);
            return (
              <Link
                key={to}
                to={to}
                title={!expanded ? label : undefined}
                onClick={collapse}
                className={`relative flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium whitespace-nowrap transition-colors duration-150 ${expanded ? "" : "lg:justify-center lg:px-0"} ${
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground hover:translate-x-0.5"
                }`}
              >
                {active && <span aria-hidden className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-accent transition-all duration-200 ease-out" />}
                <Icon className="h-4 w-4 shrink-0" />
                <span className={expanded ? "" : "lg:hidden"}>{label}</span>
                {to === "/chat" && chatUnread > 0 && (
                  <span className={`h-2 w-2 rounded-full bg-accent shrink-0 animate-pulse ${expanded ? "ml-auto" : "ml-auto lg:absolute lg:top-1.5 lg:right-2 lg:ml-0"}`} />
                )}
              </Link>
            );
          })}
        </nav>
        <div className={`border-t border-sidebar-border p-3 ${expanded ? "" : "lg:px-2"}`}>
          <div className={expanded ? "" : "lg:hidden"}>
            <div className="text-xs text-sidebar-foreground/60 truncate">{user?.email}</div>
            <div className="text-[10px] uppercase tracking-wider text-accent mt-1">
              {roles[0]?.replace(/_/g, " ") || "Staff"}
            </div>
          </div>
          <button
            title={!expanded ? "Sign out" : undefined}
            onClick={async () => {
              const n = await pendingChangeCount();
              if (n > 0 && !window.confirm(`${n} change${n > 1 ? "s haven't" : " hasn't"} synced yet. Signing out now will discard ${n > 1 ? "them" : "it"}. Sign out anyway?`)) return;
              await signOut();
              router.navigate({ to: "/login", search: { next: undefined } });
            }}
            className={`mt-3 w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm whitespace-nowrap bg-sidebar-accent/40 hover:bg-sidebar-accent text-sidebar-foreground ${expanded ? "" : "lg:mt-0 lg:justify-center lg:px-0"}`}
          >
            <LogOut className="h-4 w-4 shrink-0" />
            <span className={expanded ? "" : "lg:hidden"}>Sign out</span>
          </button>
        </div>
      </aside>

      <div
        className={`fixed inset-0 bg-black/40 z-30 transition-opacity duration-300 ${open ? (pinned ? "opacity-100 lg:opacity-0 lg:pointer-events-none" : "opacity-100") : "opacity-0 pointer-events-none"}`}
        onClick={() => setOpen(false)}
      />

      {/* Main — offset by the sidebar's width on desktop; the sidebar is
          fixed, not a flex sibling, so nothing here can pull it along. */}
      <div className={`flex flex-col min-h-screen transition-[margin-left] duration-300 ease-in-out ${pinned ? "lg:ml-64" : "lg:ml-16"}`}>
        <header className="h-14 border-b bg-card flex items-center px-4 gap-3 sticky top-0 z-20">
          <button
            className={`p-2 -ml-2 rounded-md hover:bg-muted ${pinned ? "lg:hidden" : ""}`}
            onClick={() => setOpen(true)}
          >
            <Menu className="h-5 w-5" />
          </button>
          <h1 className="text-sm font-semibold capitalize">
            {pathname.split("/").filter(Boolean)[0] || "Dashboard"}
          </h1>
          <div className="ml-auto flex items-center gap-2">
            <CommandPalette pages={items.flatMap((i) => (isGroup(i) ? i.children : [i]))} />
            <ThemeToggle />
            <OfflineIndicator paths={items.flatMap((i) => (isGroup(i) ? i.children : [i]).map((l) => l.to))} />
            <SoundToggle />
            <NotificationBell />
          </div>
        </header>
        <main className="flex-1 p-4 md:p-6 overflow-x-hidden">
          <PageTransition>{children}</PageTransition>
        </main>
      </div>
    </div>
  );
}
