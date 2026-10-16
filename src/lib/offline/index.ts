/**
 * Offline layer entry point. Importing this module (auth.tsx does) installs it
 * once in the browser. It is fail-safe: if anything it relies on is missing,
 * it does nothing and the app behaves exactly as before.
 *
 * What it does
 *  - Reads: every data read is saved on this device; when the internet or the
 *    server is unreachable the saved copy is shown instead.
 *  - Writes: while unreachable, inserts/updates/deletes are queued on the
 *    device, shown immediately in the lists, and sent in order when the
 *    connection returns.
 */
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { OFFLINE_CONFIG as cfg } from "./config.ts";
import { createOfflineFetch } from "./fetch.ts";
import * as status from "./status.ts";
import { initSync, scheduleFlush, flush, refreshCounts } from "./sync.ts";
import { clearAllOfflineData } from "./store.ts";

export { pendingChangeCount, retryFailed, discardChange, flush as syncNow } from "./sync.ts";

const UID_KEY = "naha-offline-uid";

export function getStoredUserId(): string | null {
  try { return localStorage.getItem(UID_KEY); } catch { return null; }
}

/** The saved session (even if its token has expired) - used only while offline. */
export function readStoredSession(): any | null {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && /^sb-.+-auth-token$/.test(k)) {
        const v = JSON.parse(localStorage.getItem(k) ?? "null");
        const s = v?.currentSession ?? v;
        if (s?.user?.id && s?.access_token) return s;
      }
    }
  } catch { /* ignore */ }
  return null;
}

export async function clearOfflineData() {
  try { localStorage.removeItem(UID_KEY); } catch { /* ignore */ }
  await clearAllOfflineData();
  await refreshCounts();
}

let installed = false;

function install() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  try {
    const rest: any = (supabase as any).rest;
    const authedFetch = rest?.fetch;
    const url: string | undefined = (supabase as any).supabaseUrl ?? (import.meta as any).env?.VITE_SUPABASE_URL;
    if (typeof authedFetch !== "function" || !url) {
      console.warn("[offline] supabase client shape not recognised - offline support disabled");
      return;
    }
    const restBase = `${url.replace(/\/$/, "")}/rest/v1/`;
    const apikey: string = (supabase as any).supabaseKey ?? (import.meta as any).env?.VITE_SUPABASE_PUBLISHABLE_KEY ?? "";
    const rawFetch = window.fetch.bind(window);

    // Remember who is signed in (the token may be expired while offline).
    const s0 = readStoredSession();
    if (s0?.user?.id) { try { localStorage.setItem(UID_KEY, s0.user.id); } catch { /* ignore */ } }
    supabase.auth.onAuthStateChange((event: string, session: { user?: { id?: string } } | null) => {
      try {
        if (session?.user?.id) localStorage.setItem(UID_KEY, session.user.id);
        else if (event === "SIGNED_OUT") localStorage.removeItem(UID_KEY);
      } catch { /* ignore */ }
    });

    status.initStatus({
      probeEveryMs: cfg.probeIntervalMs,
      // any HTTP answer (even 401) means the server is reachable
      probe: () => rawFetch(`${url.replace(/\/$/, "")}/auth/v1/health`, { headers: { apikey }, cache: "no-store" }).then(() => true, () => false),
      onReconnect: () => scheduleFlush(300),
    });

    initSync({
      rawFetch,
      apiKey: apikey,
      getUserId: getStoredUserId,
      getAccessToken: async () => (await supabase.auth.getSession()).data.session?.access_token ?? null,
      refreshToken: async () => (await supabase.auth.refreshSession()).data.session?.access_token ?? null,
      notify: (kind, count) => {
        if (kind === "synced") toast.success(`${count} offline change${count > 1 ? "s" : ""} synced`);
        else toast.error(`${count} change${count > 1 ? "s" : ""} couldn't sync - open the offline menu (top bar) to review`, { duration: 10000 });
      },
    });

    rest.fetch = createOfflineFetch({
      baseFetch: authedFetch,
      restBase,
      apiKey: apikey,
      getUserId: getStoredUserId,
      scheduleFlush: () => scheduleFlush(status.isOnline() ? 500 : cfg.retryIntervalMs),
      onQueued: () => toast.info("Saved on this device - it will sync when you're back online", { id: "offline-queued" }),
    });

    // Pages call auth.getUser() to stamp "created by"; that is a network call.
    // Offline, answer from the saved session instead.
    const auth: any = supabase.auth;
    const origGetUser = auth.getUser.bind(auth);
    auth.getUser = async (jwt?: string) => {
      const fallback = () => { const s = readStoredSession(); return s?.user ? { data: { user: s.user }, error: null } : null; };
      if (!jwt && !status.isOnline()) { const f = fallback(); if (f) return f; }
      try {
        const res = await origGetUser(jwt);
        if (res?.error && !jwt && ["AuthRetryableFetchError", "AuthSessionMissingError"].includes(res.error.name)) return fallback() ?? res;
        return res;
      } catch (e) {
        const f = !jwt ? fallback() : null;
        if (f) return f;
        throw e;
      }
    };

    void flush();
  } catch (e) {
    console.warn("[offline] setup failed - offline support disabled", e);
  }
}

install();
