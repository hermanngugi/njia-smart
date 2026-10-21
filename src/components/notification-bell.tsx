import { useEffect, useRef, useState } from "react";
import { Bell, Check, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { useLiveRefresh } from "@/hooks/use-live-refresh";
import { useRouter } from "@tanstack/react-router";

export function NotificationBell() {
  const { user } = useAuth();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<any[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  async function load() {
    if (!user) return;
    const { data } = await supabase
      .from("notifications").select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(20);
    setItems(data ?? []);
  }

  useEffect(() => { load(); }, [user?.id]);

  // Live: new reminders arrive instantly, and read/unread stays in sync
  // across tabs and devices (INSERT + UPDATE + DELETE, own rows only).
  useLiveRefresh(["notifications"], load, {
    enabled: !!user,
    filter: user ? `user_id=eq.${user.id}` : undefined,
    debounceMs: 150,
  });

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const unread = items.filter(i => !i.read_at).length;

  async function markAll() {
    if (!user) return;
    const { error } = await supabase.from("notifications").update({ read_at: new Date().toISOString() })
      .eq("user_id", user.id).is("read_at", null);
    if (error) {
      toast.error("Could not mark notifications as read");
      return;
    }
    await load();
    toast.success("All notifications marked as read");
  }

  async function clearAll() {
    if (!user) return;
    if (!window.confirm("Clear all your notifications? This cannot be undone.")) return;
    const { error } = await supabase.from("notifications").delete().eq("user_id", user.id);
    if (error) {
      toast.error("Could not clear notifications");
      return;
    }
    setItems([]);
    toast.success("Notifications cleared");
  }
  async function markOne(id: string) {
    if (!user) return;
    await supabase.from("notifications").update({ read_at: new Date().toISOString() })
      .eq("id", id).eq("user_id", user.id);
    await load();
  }

  async function openNotification(n: any) {
    if (!n.read_at) await markOne(n.id);
    setOpen(false);
    if (typeof n.link === "string" && n.link.trim()) {
      router.history.push(n.link);
    }
  }

  return (
    <div className="relative" ref={ref}>
      <button onClick={()=>setOpen(o=>!o)} className="relative p-2 rounded-md hover:bg-muted">
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute top-1 right-1 bg-accent text-accent-foreground text-[10px] rounded-full h-4 min-w-4 px-1 flex items-center justify-center">
            {unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-80 max-h-96 overflow-auto bg-card border rounded-lg shadow-lg z-50">
          <div className="flex items-center justify-between p-3 border-b">
            <div className="font-semibold text-sm">Notifications</div>
            <div className="flex items-center gap-3">
              {unread > 0 && <button onClick={() => void markAll()} className="text-xs text-primary hover:underline">Mark all read</button>}
              {items.length > 0 && <button onClick={() => void clearAll()} className="flex items-center gap-1 text-xs text-destructive hover:underline" title="Clear all notifications"><Trash2 className="h-3 w-3" />Clear</button>}
            </div>
          </div>
          {items.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">No notifications</div>
          ) : items.map(n => (
            <div
              key={n.id}
              role="button"
              tabIndex={0}
              onClick={() => void openNotification(n)}
              onKeyDown={e => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  void openNotification(n);
                }
              }}
              title={n.link ? "Open notification" : "This notification has no destination"}
              className={`p-3 border-b last:border-0 text-sm ${!n.read_at ? "bg-accent/5" : ""} ${n.link ? "cursor-pointer hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" : "cursor-default"}`}
            >
              <div className="flex justify-between gap-2">
                <div className={`font-medium ${n.type === "deadline_reminder" ? "text-destructive" : ""}`}>{n.title}</div>
                {!n.read_at && <button onClick={e => { e.stopPropagation(); void markOne(n.id); }} title="Mark read" aria-label="Mark notification read"><Check className="h-3 w-3 text-muted-foreground hover:text-primary" /></button>}
              </div>
              {n.body && <div className="text-xs text-muted-foreground mt-0.5">{n.body}</div>}
              <div className="text-[10px] text-muted-foreground mt-1">{formatDate(n.created_at)}{n.link ? " · Click to open" : ""}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
