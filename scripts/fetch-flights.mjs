/**
 * Fetch an anonymous OpenSky snapshot of all aircraft and write the compact
 * snapshot served at /api/flights (see src/flightData.ts for why the Worker
 * does not call the feed itself). Run by .github/workflows/flight-data.yml.
 *
 *   node --experimental-strip-types scripts/fetch-flights.mjs flights.json
 */
import { writeFileSync } from "node:fs";
import { FLIGHT_USER_AGENT, OPENSKY_URL, parseOpenSky } from "../src/flightData.ts";

const out = process.argv[2] ?? "flights.json";
const response = await fetch(OPENSKY_URL, { headers: { "User-Agent": FLIGHT_USER_AGENT, Accept: "application/json" }, signal: AbortSignal.timeout(60_000) });
// Anonymous use has a daily credit allowance; the header says what is left.
console.log("OpenSky HTTP", response.status, "credits left", response.headers.get("x-rate-limit-remaining") ?? "(not sent)");
if (!response.ok) throw new Error("OpenSky HTTP " + response.status + " " + (await response.text()).slice(0, 200));
const snapshot = parseOpenSky(await response.json());
if (snapshot.aircraft.length < 1000) throw new Error("Only " + snapshot.aircraft.length + " aircraft; keeping the previous snapshot");
writeFileSync(out, JSON.stringify(snapshot));
console.log(snapshot.aircraft.length, "aircraft at", new Date(snapshot.time).toISOString());
