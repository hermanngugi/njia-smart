import { OFFLINE_CONFIG as cfg } from "./config.ts";
import * as store from "./store.ts";
import * as status from "./status.ts";
import type { OutboxItem } from "./store.ts";

export type SyncDeps = {
  rawFetch: typeof fetch;                       // plain fetch, NOT the caching wrapper
  apiKey: string;                               // Supabase publishable/anon key for REST replay
  getAccessToken: () => Promise<string | null>; // fresh token (refreshes if needed)
  refreshToken: () => Promise<string | null>;
  getUserId: () => string | null;
  notify: (kind: "synced" | "failed", count: number) => void;
};

let deps: SyncDeps | null = null;
let flushing = false;
let timer: ReturnType<typeof setTimeout> | null = null;
const REPLAY_TIMEOUT_MS = 12_000;
const AUTH_TIMEOUT_MS = 8_000;

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); }),
  ]).finally(() => { if (timer) clearTimeout(timer); });
}

export function initSync(d: SyncDeps) {
  deps = d;
  if (typeof window === "undefined") return;
  window.addEventListener("online", () => scheduleFlush(500));
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") scheduleFlush(500); });
  setInterval(() => { void refreshCounts(); if (status.getSnapshot().pending > 0 && status.isOnline()) scheduleFlush(0); }, cfg.retryIntervalMs);
  void refreshCounts();
}

export function scheduleFlush(delayMs = 1000) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { timer = null; void flush(); }, delayMs);
}

function previewOf(body: string | null): string {
  try {
    const j = JSON.parse(body ?? "null"); const r = Array.isArray(j) ? j[0] : j;
    for (const k of ["title", "name", "company_name", "subject", "ticket_number", "description"]) if (typeof r?.[k] === "string") return r[k].slice(0, 60);
  } catch { /* ignore */ }
  return "";
}

export async function refreshCounts() {
  const uid = deps?.getUserId();
  const all = (await store.outboxAll()).filter((i) => !uid || i.userId === uid);
  status.setCounts(
    all.filter((i) => i.status === "pending").length,
    all.filter((i) => i.status === "failed").map((i) => ({
      id: i.id!, method: i.method, table: i.table, error: i.error ?? "Failed", ts: i.ts, preview: previewOf(i.body),
    })),
  );
}

export async function pendingChangeCount(): Promise<number> {
  const uid = deps?.getUserId();
  return (await store.outboxAll()).filter((i) => (!uid || i.userId === uid)).length;
}

type Result = { kind: "ok" } | { kind: "retry" } | { kind: "again" } | { kind: "failed"; error: string };

function replayHeaders(item: OutboxItem, token: string): Headers {
  const h = new Headers();
  for (const k of ["content-type", "content-profile", "accept-profile"]) if (item.headers[k]) h.set(k, item.headers[k]);
  // Outbox records created by older app versions may not contain apikey. Always
  // attach the configured project key when replaying, rather than relying on saved headers.
  const apiKey = item.headers.apikey || deps?.apiKey;
  if (apiKey) h.set("apikey", apiKey);
  const prefer = (item.headers["prefer"] ?? "").split(",").map((s) => s.trim()).filter((p) => p && !p.startsWith("return="));
  prefer.push(item.method === "PATCH" ? "return=representation" : "return=minimal");
  h.set("Prefer", prefer.join(","));
  if (item.method === "PATCH") h.set("Accept", "application/json");
  h.set("Authorization", `Bearer ${token}`);
  return h;
}

async function replay(item: OutboxItem, token: string): Promise<Result> {
  let res: Response;
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const request = deps!.rawFetch(item.url, {
      method: item.method,
      headers: replayHeaders(item, token),
      body: item.body ?? undefined,
      signal: controller.signal,
    });
    res = await Promise.race([
      request,
      new Promise<Response>((_, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(new Error("Sync request timed out"));
        }, REPLAY_TIMEOUT_MS);
      }),
    ]);
  } catch { return { kind: "retry" }; }
  finally { if (timeout) clearTimeout(timeout); }

  if (res.ok) {
    if (item.method === "PATCH") {
      const rows = await res.json().catch(() => null);
      if (Array.isArray(rows) && rows.length === 0) return { kind: "failed", error: "The record no longer exists, or you don't have permission to change it." };
    }
    return { kind: "ok" };
  }

  const text = await res.text().catch(() => "");
  let err: any = null; try { err = JSON.parse(text); } catch { /* not json */ }
  const message: string = err?.message ?? `Server said ${res.status}`;

  if (res.status === 401 || /jwt/i.test(message)) return { kind: "retry" };
  if (res.status >= 500 || res.status === 429 || res.status === 408) return { kind: "retry" };

  if (item.injectedId) {
    if ((res.status === 409 || err?.code === "23505") && /Key \(id\)/.test(`${err?.details ?? ""}${text}`)) return { kind: "ok" }; // already applied
    if (["PGRST204", "428C9", "22P02"].includes(err?.code)) { // table doesn't take our generated id
      try {
        const j = JSON.parse(item.body ?? "null");
        (Array.isArray(j) ? j : [j]).forEach((r: any) => { delete r.id; });
        item.body = JSON.stringify(j); item.injectedId = false;
        return { kind: "again" };
      } catch { /* fall through */ }
    }
  }
  return { kind: "failed", error: message };
}

export async function flush(): Promise<void> {
  if (!deps || flushing || !status.isOnline()) return;
  const run = async () => {
    flushing = true;
    let ok = 0; let failed = 0;
    try {
      const uid = deps!.getUserId();
      let token = await withTimeout(deps!.getAccessToken(), AUTH_TIMEOUT_MS, "Authentication timed out").catch(() => null);
      if (!uid || !token) return;
      status.setSyncing(true);
      let guard = 0;
      while (guard++ < 1000) {
        const next = (await store.outboxAll()).find((i) => i.status === "pending" && i.userId === uid);
        if (!next) break;
        let r = await replay(next, token);
        if (r.kind === "again") r = await replay(next, token);
        if (r.kind === "retry") {
          const fresh = await withTimeout(deps!.refreshToken(), AUTH_TIMEOUT_MS, "Token refresh timed out").catch(() => null);
          if (fresh && fresh !== token) { token = fresh; r = await replay(next, token); }
        }
        if (r.kind === "ok") { await store.outboxDelete(next.id!); ok++; }
        else if (r.kind === "failed") { await store.outboxPut({ ...next, status: "failed", error: r.error, attempts: next.attempts + 1 }); failed++; }
        else { await store.outboxPut({ ...next, attempts: next.attempts + 1 }); break; } // network/server trouble: try again later
        await refreshCounts();
      }
    } finally {
      flushing = false;
      status.setSyncing(false);
      await refreshCounts();
      if (ok > 0) { status.setSynced(); deps!.notify("synced", ok); }
      if (failed > 0) deps!.notify("failed", failed);
      if (ok > 0 || failed > 0) window.dispatchEvent(new Event("naha:refresh"));
    }
  };
  // one tab at a time (Web Locks), otherwise just run
  const locks = (navigator as any).locks;
  if (locks?.request) await locks.request("naha-outbox-flush", { ifAvailable: true }, async (lock: unknown) => { if (lock) await run(); });
  else await run();
}

export async function retryFailed() {
  const all = await store.outboxAll();
  for (const i of all) if (i.status === "failed") await store.outboxPut({ ...i, status: "pending", error: undefined });
  await refreshCounts();
  scheduleFlush(0);
}
export async function discardChange(id: number) { await store.outboxDelete(id); await refreshCounts(); }
