import { weatherResponse } from "./weather.ts";
import { dnsFlowsResponse, type DnsFlowsContext } from "./ripeAtlas.ts";
import { adminPage, collectStats, statsSummary, type StatsEnv } from "./stats.ts";
import { launchesResponse } from "./launches.ts";
import { hazardsResponse } from "./hazards.ts";
import { runSchedule, type DispatchEnv } from "./dispatch.ts";
/**
 * Cloudflare Worker in front of the static site. Only /api/* reaches it
 * (see run_worker_first in wrangler.jsonc); everything else is served
 * straight from the assets.
 *
 * GET /api/internet/dns-flows — measured root-server queries (worker/ripeAtlas.ts).
 *
 * POST /api/stats/collect, GET /api/stats/summary, GET /admin — anonymous
 * usage statistics and their dashboard (worker/stats.ts).
 *
 * GET /api/launches — the real launch calendar snapshot (worker/launches.ts).
 *
 * GET /api/hazards — natural events and tropical cyclones (worker/hazards.ts).
 *
 * Every 15 minutes a cron trigger starts the data workflows on GitHub
 * (worker/dispatch.ts), which GitHub's own schedules do not run on time.
 *
 * GET /api/flights — aircraft positions: the OpenSky snapshot the
 * flight-data workflow publishes every 15 minutes (src/flightData.ts), checked
 * and relayed. One upstream request per isolate every FRESH_MS.
 */
import { FLIGHT_SNAPSHOT_MAX_AGE_MS, FLIGHT_SNAPSHOT_URL, FLIGHT_USER_AGENT, decodeFlights } from "../src/flightData.ts";

interface Env extends StatsEnv, DispatchEnv {
  ASSETS: { fetch(request: Request): Promise<Response> };
}

const FRESH_MS = 2 * 60_000;
/** A failed refresh may keep serving the last snapshot this long. */
const STALE_MS = 15 * 60_000;
const MAX_SNAPSHOT_BYTES = 5_000_000;

let cached: { body: string; fetchedAt: number } | null = null;
let pending: Promise<string> | null = null;

/** The latest snapshot published by the flight-data workflow (see src/flightData.ts for why). */
async function refresh(): Promise<string> {
  const response = await fetch(FLIGHT_SNAPSHOT_URL, { headers: { "User-Agent": FLIGHT_USER_AGENT }, signal: AbortSignal.timeout(15_000) })
    .catch((error) => { throw new Error("flight snapshot: " + (error instanceof Error ? error.message : String(error))); });
  if (!response.ok) throw new Error("flight snapshot: HTTP " + response.status);
  const body = await response.text();
  if (body.length > MAX_SNAPSHOT_BYTES) throw new Error("flight snapshot: oversized");
  const { time, flights } = decodeFlights(JSON.parse(body));
  if (flights.length < 100) throw new Error("flight snapshot: only " + flights.length + " aircraft");
  const age = Date.now() - time;
  // Old traffic is not shown as current: the workflow has stopped or its feed failed.
  if (age > FLIGHT_SNAPSHOT_MAX_AGE_MS) throw new Error("flight snapshot is " + Math.round(age / 60_000) + " min old");
  cached = { body, fetchedAt: Date.now() };
  return body;
}

function reply(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": status === 200 ? "public, max-age=60" : "no-store" },
  });
}

async function flights(): Promise<Response> {
  const now = Date.now();
  if (cached && now - cached.fetchedAt < FRESH_MS) return reply(cached.body);
  try {
    pending ??= refresh().finally(() => { pending = null; });
    return reply(await pending);
  } catch (error) {
    console.warn("Flight feeds unavailable", String(error));
    if (cached && now - cached.fetchedAt < STALE_MS) return reply(cached.body);
    // Which feeds failed and how (public hosts and status codes only).
    return reply(JSON.stringify({ error: "Flight data unavailable", detail: (error instanceof Error ? error.message : String(error)).slice(0, 300) }), 502);
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: DnsFlowsContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/data/weather/latest.json") return weatherResponse(request, env.ASSETS);
    if (url.pathname === "/api/internet/dns-flows") {
      if (request.method !== "GET" && request.method !== "HEAD") return new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } });
      return dnsFlowsResponse(request, env.ASSETS, ctx);
    }
    if (url.pathname === "/api/launches") return launchesResponse(request);
    if (url.pathname === "/api/hazards") return hazardsResponse(request);
    if (url.pathname === "/api/stats/collect") return collectStats(request, env, ctx);
    if (url.pathname === "/api/stats/summary") return statsSummary(request, env);
    if (url.pathname === "/admin" || url.pathname === "/admin/") return adminPage();
    if (url.pathname === "/api/flights") {
      if (request.method !== "GET" && request.method !== "HEAD") return new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } });
      return flights();
    }
    return env.ASSETS.fetch(request);
  },

  /** Cron trigger (wrangler.jsonc): start the data workflows that are due (worker/dispatch.ts). */
  async scheduled(controller: { scheduledTime: number }, env: Env, ctx: DnsFlowsContext): Promise<void> {
    ctx.waitUntil(runSchedule(controller.scheduledTime, env));
  },
};
