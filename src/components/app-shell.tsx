import { Link, useRouter, useRouterState } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import {
  LayoutDashboard, Users, ClipboardCheck, Receipt, Lightbulb,
  ListTodo, Megaphone, FolderOpen, CalendarDays, UserCog, Settings,
  LogOut, Menu, History, Wallet, Monitor, Landmark, Wallet2, Briefcase,
  Contact, MessageSquare, Headset, Link2, Layers, ChevronDown,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { NotificationBell } from "./notification-bell";
import { PageTransition } from "./page-transition";
import { NAV_MODULE_BY_PATH } from "@/lib/permissions";
import { useChatUnreadCount } from "@/hooks/use-chat-unread-count";

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
  const [open, setOpen] = useState(false);
  const chatUnread = useChatUnreadCount();

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
        className={`fixed inset-y-0 left-0 z-40 w-64 h-screen bg-sidebar text-sidebar-foreground flex flex-col transition-transform ${
          open ? "translate-x-0" : "-translate-x-full"
        } lg:translate-x-0`}
      >
        <div className="px-5 py-5 border-b border-sidebar-border">
          <div className="text-base font-bold tracking-tight leading-tight">G.K Nahashon</div>
          <div className="text-xs text-sidebar-foreground/60">& Company</div>
        </div>
        <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
          {items.map((item) => {
            if (isGroup(item)) {
              const Icon = item.icon;
              const open_ = groupOpen(item);
              const childActive = item.children.some((c) => isActivePath(pathname, c.to));
              return (
                <div key={item.label}>
                  <button
                    type="button"
                    onClick={() => setOpenGroups((s) => ({ ...s, [item.label]: !open_ }))}
                    aria-expanded={open_}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                      childActive && !open_
                        ? "bg-sidebar-accent text-sidebar-accent-foreground"
                        : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    {item.label}
                    <ChevronDown className={`ml-auto h-4 w-4 transition-transform ${open_ ? "rotate-180" : ""}`} />
                  </button>
                  {open_ && (
                    <div className="mt-0.5 ml-4 pl-3 border-l border-sidebar-border space-y-0.5">
                      {item.children.map(({ to, label, icon: ChildIcon }) => {
                        const active = isActivePath(pathname, to);
                        return (
                          <Link
                            key={to}
                            to={to}
                            onClick={() => setOpen(false)}
                            className={`flex items-center gap-2.5 px-3 py-1.5 rounded-md text-[13px] font-medium transition-colors ${
                              active
                                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                                : "text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
                            }`}
                          >
                            <ChildIcon className="h-3.5 w-3.5" />
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
                onClick={() => setOpen(false)}
                className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
                }`}
              >
                <Icon className="h-4 w-4" />
                {label}
                {to === "/chat" && chatUnread > 0 && (
                  <span className="ml-auto h-2 w-2 rounded-full bg-accent shrink-0" />
                )}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-sidebar-border p-3">
          <div className="text-xs text-sidebar-foreground/60 truncate">{user?.email}</div>
          <div className="text-[10px] uppercase tracking-wider text-accent mt-1">
            {roles[0]?.replace(/_/g, " ") || "Staff"}
          </div>
          <button
            onClick={async () => {
              await signOut();
              router.navigate({ to: "/login", search: { next: undefined } });
            }}
            className="mt-3 w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm bg-sidebar-accent/40 hover:bg-sidebar-accent text-sidebar-foreground"
          >
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>
      </aside>

      {open && (
        <div className="fixed inset-0 bg-black/40 z-30 lg:hidden" onClick={() => setOpen(false)} />
      )}

      {/* Main — offset by the sidebar's width on desktop; the sidebar is
          fixed, not a flex sibling, so nothing here can pull it along. */}
      <div className="flex flex-col min-h-screen lg:ml-64">
        <header className="h-14 border-b bg-card flex items-center px-4 gap-3 sticky top-0 z-20">
          <button
            className="lg:hidden p-2 -ml-2 rounded-md hover:bg-muted"
            onClick={() => setOpen(true)}
          >
            <Menu className="h-5 w-5" />
          </button>
          <h1 className="text-sm font-semibold capitalize">
            {pathname.split("/").filter(Boolean)[0] || "Dashboard"}
          </h1>
          <div className="ml-auto flex items-center gap-2">
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
