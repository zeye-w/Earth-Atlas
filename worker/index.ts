/**
 * Cloudflare Worker in front of the static site. Only /api/* reaches it
 * (see run_worker_first in wrangler.jsonc); everything else is served
 * straight from the assets.
 *
 * GET /api/flights — live aircraft positions from adsb.lol (OpenSky as a
 * fallback), trimmed to the fields the globe draws. One upstream request per
 * isolate every FRESH_MS, however many visitors ask.
 */
import { ADSB_LOL_URL, FLIGHT_USER_AGENT, OPENSKY_URL, parseAdsbLol, parseOpenSky, type FlightSnapshot } from "../src/flightData.ts";

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
}

const FRESH_MS = 30_000;
/** A failed refresh may keep serving the last snapshot this long. */
const STALE_MS = 5 * 60_000;

let cached: { body: string; fetchedAt: number } | null = null;
let pending: Promise<string> | null = null;

async function upstream(url: string, parse: (json: unknown) => FlightSnapshot): Promise<FlightSnapshot> {
  const response = await fetch(url, { headers: { "User-Agent": FLIGHT_USER_AGENT, Accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(url + " HTTP " + response.status);
  const snapshot = parse(await response.json());
  if (snapshot.aircraft.length < 100) throw new Error(url + " returned only " + snapshot.aircraft.length + " aircraft");
  return snapshot;
}

async function refresh(): Promise<string> {
  let snapshot: FlightSnapshot;
  try {
    snapshot = await upstream(ADSB_LOL_URL, parseAdsbLol);
  } catch (error) {
    console.warn("adsb.lol failed, trying OpenSky", String(error));
    snapshot = await upstream(OPENSKY_URL, parseOpenSky);
  }
  const body = JSON.stringify(snapshot);
  cached = { body, fetchedAt: Date.now() };
  return body;
}

function reply(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": status === 200 ? "public, max-age=20" : "no-store" },
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
    return reply(JSON.stringify({ error: "Flight data unavailable" }), 502);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/flights") {
      if (request.method !== "GET" && request.method !== "HEAD") return new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } });
      return flights();
    }
    return env.ASSETS.fetch(request);
  },
};
