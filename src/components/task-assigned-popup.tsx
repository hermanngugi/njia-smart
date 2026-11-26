import { useEffect, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { ClipboardList } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useLiveRefresh } from "@/hooks/use-live-refresh";
import { formatDate, formatDateTime, daysUntil, STATUS_COLORS } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

type Detail = { task: any; sender: string | null };

/**
 * Pops up for the signed-in person whenever a task is assigned to them: who sent
 * it, when, and the full instructions (description, client, priority, due date). Works for tasks that arrive while they are online
 * and for ones sent while they were away (shown on their next visit).
 * Closing the popup marks that notification read; it stays in the bell either way.
 */
export function TaskAssignedPopup() {
  const { user } = useAuth();
  const router = useRouter();
  const [queue, setQueue] = useState<any[]>([]);          // unread "task assigned" notifications, oldest first
  const [seen, setSeen] = useState<Set<string>>(new Set()); // acknowledged here (avoids a flash while the list reloads)
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(false);

  async function loadPending() {
    if (!user) return;
    // Only recent ones, so switching this on doesn't flood people with old unread items.
    const since = new Date(Date.now() - 3 * 86400000).toISOString();
    const { data } = await supabase.from("notifications").select("*")
      .eq("user_id", user.id).eq("type", "task_assigned").is("read_at", null)
      .gte("created_at", since).order("created_at", { ascending: true }).limit(20);
    setQueue(data ?? []);
  }

  useEffect(() => { loadPending(); }, [user?.id]);
  useLiveRefresh(["notifications"], loadPending, {
    enabled: !!user,
    filter: user ? `user_id=eq.${user.id}` : undefined,
    debounceMs: 150,
  });

  const current = queue.find(n => !seen.has(n.id)) ?? null;
  const waiting = queue.filter(n => !seen.has(n.id)).length - 1;

  // Load the task behind the current notification.
  useEffect(() => {
    setDetail(null);
    if (!current) return;
    const taskId = /[?&]task=([0-9a-f-]{36})/i.exec(String(current.link ?? ""))?.[1];
    if (!taskId) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      const { data: task } = await supabase.from("tasks").select("*, clients(company_name)").eq("id", taskId).maybeSingle();
      const ids = [current.actor_id].filter(Boolean) as string[];
      const { data: people } = ids.length ? await supabase.from("profiles").select("id, full_name").in("id", ids) : { data: [] as any[] };
      if (cancelled) return;
      const name = (id?: string | null) => (id ? (people ?? []).find((p: any) => p.id === id)?.full_name ?? null : null);
      setDetail(task ? { task, sender: name(current.actor_id) } : null);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [current?.id]);

  async function acknowledge(openTask: boolean) {
    if (!current || !user) return;
    const n = current;
    setSeen(prev => new Set(prev).add(n.id));
    await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", n.id).eq("user_id", user.id);
    if (openTask && typeof n.link === "string" && n.link.trim()) router.history.push(n.link);
    loadPending();
  }

  if (!current) return null;
  const t = detail?.task;
  const days = t ? daysUntil(t.due_date) : null;

  return (
    <Dialog open onOpenChange={o => { if (!o) acknowledge(false); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><ClipboardList className="h-5 w-5 text-primary" /> New task assigned to you</DialogTitle>
        </DialogHeader>

        <div className="rounded-md bg-muted/50 px-3 py-2 text-sm">
          From <span className="font-semibold">{detail?.sender ?? "Management"}</span>
          <span className="text-xs text-muted-foreground"> · {formatDateTime(current.created_at)}</span>
        </div>

        {loading && <p className="text-sm text-muted-foreground">Loading the instructions…</p>}

        {t ? (
          <div className="space-y-3 text-sm">
            <div className="text-base font-semibold">{t.title}</div>
            <div>
              <div className="text-xs font-medium text-muted-foreground mb-1">Instructions</div>
              <div className="rounded-md border p-3 whitespace-pre-wrap break-words max-h-52 overflow-y-auto">
                {t.description?.trim() || "No written instructions were given. Ask the sender if anything is unclear."}
              </div>
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
              <div><dt className="text-muted-foreground">Client</dt><dd className="font-medium">{t.clients?.company_name ?? "Not linked to a client"}</dd></div>
              <div>
                <dt className="text-muted-foreground">Priority</dt>
                <dd><span className={`px-2 py-0.5 rounded capitalize ${STATUS_COLORS[t.priority] ?? "bg-muted"}`}>{t.priority}</span></dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Due</dt>
                <dd className="font-medium">
                  {t.due_date ? formatDate(t.due_date) : "No due date"}
                  {days !== null && <span className={days < 0 ? "text-destructive" : "text-muted-foreground"}>{days < 0 ? ` · ${-days}d overdue` : days === 0 ? " · today" : ` · in ${days}d`}</span>}
                </dd>
              </div>
            </dl>
          </div>
        ) : !loading && (
          <div className="text-sm space-y-1">
            <div className="font-medium">{current.title}</div>
            {current.body && <div className="text-muted-foreground">{current.body}</div>}
            <div className="text-xs text-muted-foreground">The full instructions couldn&apos;t be loaded here — open the task to read them.</div>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          {waiting > 0 && <span className="mr-auto self-center text-xs text-muted-foreground">{waiting} more task{waiting === 1 ? "" : "s"} waiting</span>}
          <Button variant="outline" onClick={() => acknowledge(false)}>Got it</Button>
          <Button onClick={() => acknowledge(true)}>Open task</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
