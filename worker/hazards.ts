import {
  EONET_URL, GDACS_TC_URL, HAZARD_USER_AGENT, mergeStorms, parseEonet, parseGdacsGeometry, parseGdacsList, type HazardSnapshot,
} from "../src/hazardData.ts";

/**
 * GET /api/hazards — open natural events (NASA EONET) and current tropical
 * cyclones (GDACS, with EONET's observed tracks), trimmed to what the globe
 * draws (see src/hazardData.ts). One upstream round per isolate every FRESH_MS.
 */
const FRESH_MS = 30 * 60_000;
/** A failed refresh keeps serving the last snapshot this long. */
const STALE_MS = 6 * 3_600_000;
const MAX_BYTES = 3_000_000;

let cached: { body: string; at: number } | null = null;
let pending: Promise<string> | null = null;

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url, { headers: { "User-Agent": HAZARD_USER_AGENT, Accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(url + " HTTP " + response.status);
  const body = await response.text();
  if (body.length > MAX_BYTES) throw new Error(url + " oversized");
  // EONET labels its JSON application/rss+xml; parse the text whatever the type.
  return JSON.parse(body);
}

export async function buildHazards(now = Date.now()): Promise<HazardSnapshot> {
  const [eonet, gdacs] = await Promise.allSettled([getJson(EONET_URL).then(parseEonet), getJson(GDACS_TC_URL).then(parseGdacsList)]);
  if (eonet.status === "rejected" && gdacs.status === "rejected") throw new Error("Both hazard feeds failed: " + String(eonet.reason));
  const events = eonet.status === "fulfilled" ? eonet.value.events : [];
  const tracks = eonet.status === "fulfilled" ? eonet.value.tracks : [];
  const current = gdacs.status === "fulfilled" ? gdacs.value : [];
  // Each storm's geometry is its own request; one failing only drops its forecast.
  const geometries = await Promise.all(current.map(async (storm) => ({
    storm,
    geometry: storm.geometryUrl ? await getJson(storm.geometryUrl).then((json) => parseGdacsGeometry(json, storm.from ?? now)).catch(() => null) : null,
  })));
  return { v: 1, fetched: now, events, storms: mergeStorms(geometries, tracks) };
}

function reply(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": status === 200 ? "public, max-age=600" : "no-store" },
  });
}

export async function hazardsResponse(request: Request): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") return new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } });
  const now = Date.now();
  if (cached && now - cached.at < FRESH_MS) return reply(cached.body);
  try {
    pending ??= buildHazards().then((snapshot) => {
      const body = JSON.stringify(snapshot);
      cached = { body, at: Date.now() };
      return body;
    }).finally(() => { pending = null; });
    return reply(await pending);
  } catch (error) {
    console.warn("Hazard feeds unavailable", String(error));
    if (cached && now - cached.at < STALE_MS) return reply(cached.body);
    return reply(JSON.stringify({ error: "Hazard data unavailable" }), 502);
  }
}
