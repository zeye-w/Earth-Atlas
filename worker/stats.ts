import {
  BREAKDOWNS, country, dayString, INSERT_SQL, insertRows, KEEP_DAYS, MAX_BODY_BYTES, parseBatch, PRUNE_SQL,
  SCHEMA_SQL, shiftDay, SUMMARY_SQL,
} from "./statsCore.ts";
import { ADMIN_HTML } from "./statsAdmin.ts";

/**
 * POST /api/stats/collect — anonymous usage events from src/analytics.ts.
 * GET  /api/stats/summary — aggregates for /admin; needs the STATS_TOKEN secret.
 * GET  /admin             — the dashboard page (asks for the token itself).
 *
 * Storage is the D1 database bound as STATS. Without it collection is a
 * no-op and the dashboard says statistics are not set up yet.
 */
interface D1Statement { bind(...values: unknown[]): D1Statement; run(): Promise<unknown>; all<T>(): Promise<{ results: T[] }>; first<T>(): Promise<T | null> }
export interface D1Database { prepare(sql: string): D1Statement; batch(statements: D1Statement[]): Promise<unknown> }
export interface StatsEnv { STATS?: D1Database; STATS_TOKEN?: string }
interface Ctx { waitUntil(promise: Promise<unknown>): void }

// Create the table on first use, once per database binding.
const schemaReady = new WeakMap<D1Database, Promise<unknown>>();
function ensureSchema(db: D1Database) {
  let ready = schemaReady.get(db);
  if (!ready) {
    ready = db.batch(SCHEMA_SQL.map((sql) => db.prepare(sql))).catch((error) => { schemaReady.delete(db); throw error; });
    schemaReady.set(db, ready);
  }
  return ready;
}

const noStore = { "Cache-Control": "no-store" };

export async function collectStats(request: Request, env: StatsEnv, ctx: Ctx): Promise<Response> {
  if (request.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST" } });
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return new Response(null, { status: 413, headers: noStore });
  let json: unknown;
  try { json = JSON.parse(text); } catch { return new Response(null, { status: 400, headers: noStore }); }
  const batch = parseBatch(json);
  if (!batch) return new Response(null, { status: 400, headers: noStore });
  const db = env.STATS;
  if (!db) return new Response(null, { status: 204, headers: noStore });
  const now = Date.now();
  const cf = (request as Request & { cf?: { country?: unknown } }).cf;
  const self = new URL(request.url).hostname.replace(/^www\./, "");
  if (batch.referrer === self) batch.referrer = "";
  const rows = insertRows(batch, now, country(cf?.country));
  // Answer at once; the write finishes in the background.
  ctx.waitUntil((async () => {
    await ensureSchema(db);
    const statements = rows.map((row) => db.prepare(INSERT_SQL).bind(...row));
    // Now and then, drop rows past the retention period.
    if (Math.random() < 0.01) statements.push(db.prepare(PRUNE_SQL).bind(shiftDay(dayString(now), -KEEP_DAYS)));
    await db.batch(statements);
  })().catch((error) => console.warn("stats write failed", String(error))));
  return new Response(null, { status: 204, headers: noStore });
}

/** Constant-time comparison, so the token cannot be guessed byte by byte. */
function sameToken(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...noStore } });
}

export async function statsSummary(request: Request, env: StatsEnv): Promise<Response> {
  if (!env.STATS_TOKEN) return json({ error: "not_configured", detail: "STATS_TOKEN secret is not set" }, 503);
  const auth = request.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ") || !sameToken(auth.slice(7), env.STATS_TOKEN)) return json({ error: "unauthorized" }, 401);
  const db = env.STATS;
  if (!db) return json({ error: "not_configured", detail: "D1 database STATS is not bound" }, 503);
  await ensureSchema(db);
  const url = new URL(request.url);
  const days = Math.min(365, Math.max(1, Number(url.searchParams.get("days")) || 30));
  const to = dayString(Date.now()), from = shiftDay(to, -(days - 1));
  const q = (sql: string, ...args: unknown[]) => db.prepare(sql).bind(...args);
  const [daily, totals, wauMau, retention, features, ...breakdowns] = await Promise.all([
    q(SUMMARY_SQL.daily, from, to).all(),
    q(SUMMARY_SQL.totals, from, to).first(),
    q(SUMMARY_SQL.wauMau, shiftDay(to, -7), to, shiftDay(to, -30)).first(),
    q(SUMMARY_SQL.retention, from, to, to).first(),
    q(SUMMARY_SQL.features, from, to).all(),
    ...BREAKDOWNS.map((dimension) => q(SUMMARY_SQL.breakdown, from, to, dimension).all()),
  ]);
  return json({
    from, to, days,
    daily: daily.results, totals, activity: wauMau, retention, features: features.results,
    breakdowns: Object.fromEntries(BREAKDOWNS.map((dimension, i) => [dimension, breakdowns[i].results])),
  });
}

export function adminPage(): Response {
  return new Response(ADMIN_HTML, {
    headers: {
      "Content-Type": "text/html; charset=utf-8", ...noStore,
      "X-Robots-Tag": "noindex", "Referrer-Policy": "no-referrer", "X-Frame-Options": "DENY",
      "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src data:",
    },
  });
}
