import { useEffect, useRef, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { toast } from "sonner";
import { CloudDownload, Loader2, RefreshCw, Wifi, WifiOff } from "lucide-react";
import { useOfflineStatus } from "@/hooks/use-offline-status";
import { retryFailed, discardChange, syncNow } from "@/lib/offline";
import { lastPreparedAt, prepareForOffline, registerServiceWorker, scheduleBackgroundWarm } from "@/lib/offline/warmup";

const verb = (m: string) => (m === "POST" ? "Add" : m === "DELETE" ? "Delete" : "Change");

/**
 * Header control for offline mode: shows connection / waiting changes, lets
 * people review or discard changes that couldn't sync, and "Save for offline"
 * (opens every screen once so its data is stored on this device).
 */
export function OfflineIndicator({ paths }: { paths: string[] }) {
  const s = useOfflineStatus();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [prep, setPrep] = useState<{ done: number; total: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const pathsKey = paths.join(",");

  useEffect(() => {
    registerServiceWorker();
    return scheduleBackgroundWarm(router, paths);
  }, [pathsKey]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  async function prepare() {
    setOpen(false);
    setPrep({ done: 0, total: paths.length });
    try {
      await prepareForOffline(router, paths, (done, total) => setPrep({ done, total }));
      toast.success("Saved for offline use. You can keep working without internet.");
    } catch {
      toast.error("Couldn't finish saving for offline use. Try again while online.");
    } finally { setPrep(null); }
  }

  const bad = s.failed.length > 0;
  const tone = !s.online ? "text-amber-600" : bad ? "text-destructive" : s.pending > 0 || s.syncing ? "text-primary" : "text-muted-foreground";
  const badge = s.failed.length + s.pending;
  const prepared = lastPreparedAt();

  return (
    <>
      <div className="relative" ref={ref}>
        <button
          onClick={() => setOpen((o) => !o)}
          className={`relative h-9 px-2 rounded-md hover:bg-muted flex items-center gap-1.5 text-xs ${tone}`}
          aria-label="Offline and sync status"
          title={s.online ? "Online" : "Offline - changes are saved on this device"}
        >
          {s.syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : s.online ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
          {!s.online && <span className="hidden sm:inline font-medium">Offline</span>}
          {badge > 0 && (
            <span className={`min-w-4 h-4 px-1 rounded-full text-[10px] leading-4 text-center text-white ${bad ? "bg-destructive" : "bg-primary"}`}>{badge}</span>
          )}
        </button>

        {open && (
          <div className="max-sm:fixed max-sm:inset-x-2 max-sm:top-16 sm:absolute sm:right-0 sm:mt-2 sm:w-80 max-sm:max-h-[calc(100dvh-5rem)] max-sm:overflow-y-auto rounded-lg border bg-popover text-popover-foreground shadow-lg z-50 p-3 space-y-3 text-sm">
            <div>
              <div className="font-medium">{s.online ? "Online" : "Offline"}</div>
              <div className="text-xs text-muted-foreground">
                {s.online
                  ? s.syncing ? "Sending your saved changes..." : s.pending > 0 ? `${s.pending} change${s.pending > 1 ? "s" : ""} waiting to sync.` : "Everything is up to date."
                  : `You can keep working. ${s.pending > 0 ? `${s.pending} change${s.pending > 1 ? "s are" : " is"} saved on this device and will sync automatically.` : "Changes are saved on this device and sync when the connection returns."}`}
              </div>
            </div>

            {bad && (
              <div className="space-y-2">
                <div className="text-xs font-medium text-destructive">{s.failed.length} change{s.failed.length > 1 ? "s" : ""} couldn't sync</div>
                <ul className="max-h-48 overflow-auto space-y-2">
                  {s.failed.map((f) => (
                    <li key={f.id} className="rounded border p-2 text-xs">
                      <div className="font-medium">{verb(f.method)} - {f.table.replace(/_/g, " ")}{f.preview ? `: ${f.preview}` : ""}</div>
                      <div className="text-muted-foreground mt-0.5">{f.error}</div>
                      <button className="mt-1 text-destructive hover:underline" onClick={() => discardChange(f.id)}>Discard this change</button>
                    </li>
                  ))}
                </ul>
                <button className="w-full rounded-md border px-2 py-1.5 text-xs hover:bg-muted" onClick={() => retryFailed()}>Retry all</button>
              </div>
            )}

            <div className="flex gap-2">
              <button disabled={!s.online || s.syncing || s.pending === 0} onClick={() => syncNow()}
                className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-xs hover:bg-muted disabled:opacity-50">
                <RefreshCw className="h-3.5 w-3.5" /> Sync now
              </button>
              <button disabled={!s.online} onClick={prepare}
                className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-xs hover:bg-muted disabled:opacity-50">
                <CloudDownload className="h-3.5 w-3.5" /> Save for offline
              </button>
            </div>
            <div className="text-[11px] text-muted-foreground">
              {prepared ? `Last saved for offline: ${new Date(prepared).toLocaleString()}. ` : "Not saved for offline yet. "}
              Screens you open while online are also saved automatically. Uploading/downloading files, chat and invoice numbering need internet.
            </div>
          </div>
        )}
      </div>

      {prep && (
        <div className="fixed inset-0 z-[60] bg-background/80 backdrop-blur-sm flex items-center justify-center">
          <div className="w-72 rounded-lg border bg-card p-5 shadow-lg text-center space-y-3">
            <Loader2 className="h-6 w-6 animate-spin mx-auto text-primary" />
            <div className="text-sm font-medium">Saving for offline use...</div>
            <div className="h-1.5 rounded bg-muted overflow-hidden"><div className="h-full bg-primary transition-all" style={{ width: `${(prep.done / prep.total) * 100}%` }} /></div>
            <div className="text-xs text-muted-foreground">{prep.done} of {prep.total}. Please don't click anything.</div>
          </div>
        </div>
      )}
    </>
  );
}
