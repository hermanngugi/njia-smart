import { useEffect } from "react";
import { useRouter } from "@tanstack/react-router";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { playIctRequestSound, playNotificationSound } from "@/lib/sound";

type NotificationRow = { id: string; type: string; title: string; body: string | null; link: string | null };

/**
 * Mounted once in AppShell so a sound + a short-lived toast popup fire for
 * a brand-new notification row no matter which page you're on - chat
 * messages and deadline reminders included. New ICT Service Desk requests use a
 * separate, more noticeable alarm; critical ICT requests use a longer alarm.
 *
 * Deadline reminders (type "deadline_reminder", written by the database
 * when something assigned to you is due within 3 days) get a warning toast
 * that stays longer. Because the daily scan runs before people are online,
 * a single summary toast is also shown once per browser session for any
 * unread reminders waiting for you.
 */
export function useNotificationSound() {
  const { user } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!user) return;
    const ch = supabase
      .channel("notif-sound-" + user.id)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` },
        (payload) => {
          const n = payload.new as NotificationRow;
          const isDeadline = n.type === "deadline_reminder";
          const isIctRequest = n.type === "ict_ticket";
          const isCriticalIct = isIctRequest && n.title.toUpperCase().startsWith("CRITICAL");
          if (isIctRequest) playIctRequestSound(isCriticalIct);
          else playNotificationSound();
          const show = isCriticalIct ? toast.error : (isDeadline || isIctRequest ? toast.warning : toast);
          show(n.title, {
            description: n.body ?? undefined,
            duration: isCriticalIct ? 18000 : isDeadline || isIctRequest ? 14000 : 6000,
            // In-app navigation - no full page reload.
            action: n.link
              ? { label: "View", onClick: () => router.history.push(n.link as string) }
              : undefined,
          });
        })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user?.id]);

  // Once per session: unread deadline reminders that arrived while offline.
  useEffect(() => {
    if (!user) return;
    const key = `deadline-summary-${user.id}`;
    try { if (sessionStorage.getItem(key)) return; } catch { /* storage blocked - just show it */ }
    (async () => {
      const { count } = await supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("type", "deadline_reminder")
        .is("read_at", null);
      try { sessionStorage.setItem(key, "1"); } catch { /* ignore */ }
      if (count && count > 0) {
        playNotificationSound();
        toast.warning(
          `${count} deadline${count > 1 ? "s" : ""} due within 3 days`,
          { description: "Open the bell to see what needs attention.", duration: 12000 },
        );
      }
    })();
  }, [user?.id]);
}
