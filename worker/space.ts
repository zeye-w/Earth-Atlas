import { parseSpaceSnapshot } from "../src/spaceData.ts";

/**
 * GET /api/space — near-Earth close approaches and deep space probes, published daily
 * by .github/workflows/space-data.yml as a release asset (see
 * src/spaceData.ts for why browsers do not call NASA JPL directly).
 */
const RELEASE = "https://github.com/zeye-w/Earth-Atlas/releases/download/space-data/space.json";
const FRESH_MS = 30 * 60_000;
/** A failed refresh keeps serving the last snapshot this long. */
const STALE_MS = 48 * 3_600_000;
const MAX_BYTES = 800_000;

let cached: { body: string; at: number } | null = null;
let pending: Promise<string> | null = null;

async function load(): Promise<string> {
  const response = await fetch(RELEASE, { signal: AbortSignal.timeout(8_000), headers: { "User-Agent": "Earth-Atlas space" } });
  if (!response.ok) throw new Error("Space release HTTP " + response.status);
  const body = await response.text();
  if (body.length > MAX_BYTES) throw new Error("Oversized space snapshot");
  // Re-serialise the checked snapshot rather than passing the asset through.
  const snapshot = parseSpaceSnapshot(JSON.parse(body));
  return JSON.stringify(snapshot);
}

function reply(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": status === 200 ? "public, max-age=900" : "no-store" },
  });
}

export async function spaceResponse(request: Request): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") return new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } });
  const now = Date.now();
  if (cached && now - cached.at < FRESH_MS) return reply(cached.body);
  try {
    pending ??= load().then((body) => { cached = { body, at: Date.now() }; return body; }).finally(() => { pending = null; });
    return reply(await pending);
  } catch (error) {
    console.warn("Space data unavailable", String(error));
    if (cached && now - cached.at < STALE_MS) return reply(cached.body);
    return reply(JSON.stringify({ error: "Space data unavailable" }), 502);
  }
}
