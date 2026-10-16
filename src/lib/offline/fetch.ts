import { OFFLINE_CONFIG as cfg } from "./config.ts";
import * as store from "./store.ts";
import * as status from "./status.ts";
import type { Row } from "./filters.ts";
import { parseQuery } from "./filters.ts";

export type FetchDeps = {
  baseFetch: typeof fetch;             // supabase's own (auth-attaching) fetch
  restBase: string;                    // e.g. https://xyz.supabase.co/rest/v1/
  getUserId: () => string | null;      // the signed-in user, even when the token is expired
  onQueued?: (info: { table: string; method: string }) => void;
  scheduleFlush?: () => void;
  uuid?: () => string;
};

const sleep = (ms: number) => new Promise<"timeout">((r) => setTimeout(() => r("timeout"), ms));

function jwtSub(auth: string | null): string | null {
  try {
    const p = (auth ?? "").replace(/^Bearer\s+/i, "").split(".")[1];
    if (!p) return null;
    const json = JSON.parse(atob(p.replace(/-/g, "+").replace(/_/g, "/")));
    return typeof json.sub === "string" ? json.sub : null;
  } catch { return null; }
}

const isAbort = (e: unknown, init?: RequestInit) =>
  !!init?.signal?.aborted || (e as any)?.name === "AbortError";

const json = (status_: number, body: unknown, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status: status_, headers: { "content-type": "application/json", "x-offline-queued": "1", ...extra } });

export function createOfflineFetch(deps: FetchDeps): typeof fetch {
  const excluded = new Set(cfg.excludeTables);
  const newId = deps.uuid ?? (() => crypto.randomUUID());

  async function read(input: any, init: RequestInit | undefined, url: string, table: string, headers: Headers, userId: string, method: string) {
    const skipCache = excluded.has(table);
    const key = [userId, method, url, headers.get("accept") ?? "", headers.get("prefer") ?? "", headers.get("range") ?? ""].join("|");

    if (!skipCache && !status.isOnline()) {
      const hit = await store.cacheGet(key);
      if (hit) return store.toResponse(hit);
    }

    const done = status.trackInflight();
    try {
      const settled = deps.baseFetch(input, init).then((r) => ({ r }), (e) => ({ e }));
      let first: any = await Promise.race([settled, sleep(cfg.readTimeoutMs)]);
      if (first === "timeout") {
        const hit = skipCache ? undefined : await store.cacheGet(key);
        if (hit) { // slow connection: show the device copy, refresh it when the network answers
          settled.then((o: any) => { if (o.r?.ok) save(o.r, key, userId, table, method, url); });
          return store.toResponse(hit);
        }
        // Do not wait indefinitely when there is no cached copy. Let the caller
        // handle this as a temporary network failure; the next refresh can retry.
        status.markReachable(false);
        throw new TypeError("Network request timed out");
      }
      if ("e" in first) {
        if (isAbort(first.e, init)) throw first.e;
        status.markReachable(false);
        if (!skipCache) { const hit = await store.cacheGet(key); if (hit) return store.toResponse(hit); }
        throw first.e;
      }
      const res: Response = first.r;
      status.markReachable(true);
      if ((res.ok || res.status === 206) && !skipCache) save(res, key, userId, table, method, url);
      else if (res.status >= 502 && res.status <= 504 && !skipCache) {
        const hit = await store.cacheGet(key); if (hit) return store.toResponse(hit);
      }
      return res;
    } finally { done(); }
  }

  function save(res: Response, key: string, userId: string, table: string, method: string, url: string) {
    const clone = res.clone();
    clone.text().then((text) => {
      if (text.length > cfg.maxBodyBytes) return;
      return store.cachePut({
        key, ut: `${userId}|${table}`, userId, table, method, url, status: res.status,
        contentType: res.headers.get("content-type"), contentRange: res.headers.get("content-range"),
        body: store.redact(table, text), ts: Date.now(),
      });
    }).catch(() => {});
  }

  async function write(input: any, init: RequestInit, url: string, table: string, headers: Headers, userId: string, method: string) {
    const isRpc = table.startsWith("rpc/");
    const rpcName = isRpc ? table.slice(4) : "";
    const bodyText = typeof init.body === "string" ? init.body : null;
    const queueable = !excluded.has(table) && (!isRpc || cfg.queueableRpc.includes(rpcName)) && (init.body == null || bodyText !== null);
    if (!queueable) return passWrite(input, init);

    if (status.isOnline()) {
      const safeToRepeat = method === "PATCH" || method === "DELETE" || isRpc;
      try {
        const net = deps.baseFetch(input, init);
        const res = safeToRepeat ? await Promise.race([net, sleep(cfg.writeTimeoutMs).then(() => { throw new TypeError("write timeout"); })]) : await net;
        status.markReachable(true);
        return res as Response;
      } catch (e) {
        if (isAbort(e, init)) throw e;
        status.markReachable(false);
      }
    }
    return queue(init, url, table, headers, userId, method, bodyText, isRpc);
  }

  async function passWrite(input: any, init: RequestInit) {
    try { const r = await deps.baseFetch(input, init); status.markReachable(true); return r; }
    catch (e) { if (!isAbort(e, init)) status.markReachable(false); throw e; }
  }

  async function queue(init: RequestInit, url: string, table: string, headers: Headers, userId: string, method: string, bodyText: string | null, isRpc: boolean) {
    const prefer = headers.get("prefer") ?? "";
    const accept = headers.get("accept") ?? "";
    let body = bodyText; let injected = false; let insertRows: Row[] = []; let patch: Row = {};

    if (!isRpc && bodyText) {
      try {
        const parsed = JSON.parse(bodyText);
        if (method === "POST") {
          const rows: Row[] = Array.isArray(parsed) ? parsed : [parsed];
          if (!/resolution=/.test(prefer)) for (const r of rows) if (r.id === undefined) { r.id = newId(); injected = true; }
          insertRows = rows; body = JSON.stringify(Array.isArray(parsed) ? rows : rows[0]);
        } else patch = parsed;
      } catch { /* not JSON: queue as-is */ }
    }

    const keep: Record<string, string> = {};
    for (const h of ["content-type", "apikey", "prefer", "content-profile", "accept-profile"]) {
      const v = headers.get(h); if (v) keep[h] = v;
    }
    try {
      await store.outboxAdd({ userId, method, url, table, headers: keep, body, ts: Date.now(), status: "pending", injectedId: injected, attempts: 0 });
    } catch (e) { throw new TypeError("Failed to fetch"); } // can't persist -> behave like a normal network failure

    let matched: Row[] = [];
    if (!isRpc) {
      const where = parseQuery(url);
      const op = method === "POST" ? { kind: "insert" as const, rows: insertRows }
        : method === "DELETE" ? { kind: "delete" as const, where } : { kind: "update" as const, where, patch };
      matched = await store.applyOptimistic(userId, table, op);
      if ((method === "PATCH" || method === "DELETE") && !matched.length) {
        for (const f of where.filters) {
          if (f.col === "id" && f.op === "eq") matched.push({ id: f.value });
          if (f.col === "id" && f.op === "in") f.value.replace(/^\(|\)$/g, "").split(",").forEach((v) => matched.push({ id: v.replace(/"/g, "") }));
        }
      }
    }

    deps.onQueued?.({ table, method });
    deps.scheduleFlush?.();

    if (isRpc) return new Response(null, { status: 204, headers: { "x-offline-queued": "1" } });
    const wantsRep = /return=representation/.test(prefer);
    const single = accept.includes("vnd.pgrst.object");
    if (method === "POST") {
      if (!wantsRep) return new Response(null, { status: 201, headers: { "x-offline-queued": "1" } });
      return json(201, single ? insertRows[0] : insertRows);
    }
    if (!wantsRep) return new Response(null, { status: 204, headers: { "x-offline-queued": "1" } });
    const sel = parseQuery(url).select;
    const cols = sel && /^[\w,\s]+$/.test(sel) ? sel.split(",").map((s) => s.trim()) : null;
    const rows = matched.map((r) => (cols ? Object.fromEntries(cols.filter((c) => c in r).map((c) => [c, r[c]])) : r));
    return json(200, single ? (rows[0] ?? {}) : rows);
  }

  return (async (input: any, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : null;
    if (!url || !url.startsWith(deps.restBase)) return deps.baseFetch(input, init);
    const method = (init?.method ?? "GET").toUpperCase();
    const table = url.slice(deps.restBase.length).split("?")[0];
    const headers = new Headers(init?.headers);
    const userId = jwtSub(headers.get("authorization")) ?? deps.getUserId() ?? "anon";
    if (method === "GET" || method === "HEAD") return read(input, init, url, table, headers, userId, method);
    if (["POST", "PATCH", "DELETE", "PUT"].includes(method)) return write(input, init ?? {}, url, table, headers, userId, method);
    return deps.baseFetch(input, init);
  }) as typeof fetch;
}
