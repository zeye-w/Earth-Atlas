/**
 * Fetch the upcoming launches from Launch Library 2 and write the compact
 * snapshot served at /api/launches (see src/launchData.ts).
 * Run by .github/workflows/launch-data.yml; requires network access.
 *
 *   node --experimental-strip-types scripts/fetch-launches.mjs launches.json
 */
import { writeFileSync } from "node:fs";
import { LAUNCH_USER_AGENT, LL2_UPCOMING_URL, parseLibraryResponse } from "../src/launchData.ts";

const out = process.argv[2] ?? "launches.json";
const response = await fetch(LL2_UPCOMING_URL, { signal: AbortSignal.timeout(60_000), headers: { Accept: "application/json", "User-Agent": LAUNCH_USER_AGENT } });
console.log("Launch Library HTTP", response.status, "rate limit remaining", response.headers.get("x-ratelimit-remaining") ?? "(not sent)");
if (!response.ok) throw new Error("Launch Library HTTP " + response.status);
const json = await response.json();
console.log("results:", json.results?.length, "first:", JSON.stringify(json.results?.[0] ?? {}).slice(0, 600));
const snapshot = parseLibraryResponse(json, Date.now());
if (snapshot.launches.length < 3) throw new Error("Only " + snapshot.launches.length + " usable launches; keeping the previous snapshot");
writeFileSync(out, JSON.stringify(snapshot));
console.log(snapshot.launches.length, "launches at", new Set(snapshot.launches.map((l) => l.padId)).size, "pads; next:", snapshot.launches[0].name, new Date(snapshot.launches[0].net).toISOString());
