// Temporary: why /api/flights times out and /api/internet/dns-flows returns 503 in production.
import { ADSB_LOL_URL, OPENSKY_URL, FLIGHT_USER_AGENT, parseAdsbLol, parseOpenSky } from "../src/flightData.ts";
import { createDnsFlowsHandler } from "../worker/ripeAtlas.ts";

const SITE = "https://earth-atlas.edwardlab.workers.dev";
const time = async (label, fn) => {
  const t0 = performance.now();
  try { const out = await fn(); console.log(`${label}: OK in ${Math.round(performance.now() - t0)} ms`, out ?? ""); }
  catch (e) { console.log(`${label}: FAILED after ${Math.round(performance.now() - t0)} ms -`, String(e?.message ?? e)); }
};

console.log("== Flights");
for (const [label, url, parse] of [["adsb.lol", ADSB_LOL_URL, parseAdsbLol], ["OpenSky", OPENSKY_URL, parseOpenSky]]) {
  await time(label + " download", async () => {
    const r = await fetch(url, { headers: { "User-Agent": FLIGHT_USER_AGENT, Accept: "application/json" }, signal: AbortSignal.timeout(45_000) });
    const text = await r.text();
    const t1 = performance.now();
    const json = JSON.parse(text);
    const parsed = t1;
    let aircraft = "-";
    try { aircraft = parse(json).aircraft.length; } catch (e) { aircraft = "parse error: " + e.message; }
    return `HTTP ${r.status}, ${(text.length / 1e6).toFixed(2)} MB, JSON.parse+trim ${Math.round(performance.now() - parsed)} ms, aircraft ${aircraft}, retry-after ${r.headers.get("retry-after")}, ratelimit ${r.headers.get("x-rate-limit-remaining") ?? r.headers.get("x-ratelimit-remaining")}`;
  });
}
await time("production /api/flights", async () => {
  const r = await fetch(SITE + "/api/flights", { signal: AbortSignal.timeout(60_000) });
  const text = await r.text();
  return `HTTP ${r.status}, ${(text.length / 1e6).toFixed(2)} MB, cf-ray ${r.headers.get("cf-ray")}, body ${text.slice(0, 120)}`;
});

console.log("\n== DNS flows (the Worker's own handler, run in Node without an edge cache)");
let count = 0;
const calls = [];
const counting = async (url, init) => {
  count++;
  const t0 = performance.now();
  try {
    const r = await fetch(url, init);
    calls.push(`${r.status} ${Math.round(performance.now() - t0)}ms ${String(url).slice(0, 110)}`);
    return r;
  } catch (e) {
    calls.push(`ERR ${Math.round(performance.now() - t0)}ms ${String(url).slice(0, 110)} ${e?.message}`);
    throw e;
  }
};
const handler = createDnsFlowsHandler(counting);
await time("handler", async () => {
  const r = await handler(new Request("https://example.com/api/internet/dns-flows"));
  const text = await r.text();
  return `HTTP ${r.status}, ${text.length} bytes, subrequests ${count}, body ${text.slice(0, 160)}`;
});
console.log("subrequests:", count);
for (const c of calls) console.log("  ", c);
await time("production /api/internet/dns-flows", async () => {
  const r = await fetch(SITE + "/api/internet/dns-flows", { signal: AbortSignal.timeout(60_000) });
  return `HTTP ${r.status}, ${(await r.text()).slice(0, 160)}`;
});
