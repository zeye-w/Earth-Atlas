/**
 * Fetches the near-Earth close approaches and the deep space probes from NASA
 * JPL and writes the snapshot served at /api/space (src/spaceData.ts).
 * Run by .github/workflows/space-data.yml.
 *
 *   node --experimental-strip-types scripts/fetch-space.mjs space.json
 *
 * - Close approaches: SBDB close-approach API, the next 60 days within 10
 *   lunar distances, at most MAX_ASTEROIDS (closest first).
 * - Each asteroid's track: Horizons geocentric vectors (ICRF), hourly for
 *   three days either side of the approach.
 * - Each probe: Horizons geocentric position and velocity now, and its
 *   distance from the Sun.
 * Requests are made one at a time, as JPL asks of automated clients.
 */
import { writeFileSync } from "node:fs";
import { AU_KM, LUNAR_DISTANCE_KM, PROBES, SPACE_USER_AGENT, parseSpaceSnapshot } from "../src/spaceData.ts";

const out = process.argv[2] ?? "space.json";
const MAX_ASTEROIDS = 15;
const TRACK_DAYS = 3;
const HOUR = 3_600_000, DAY = 24 * HOUR;

async function getJson(url) {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(url, { headers: { "User-Agent": SPACE_USER_AGENT, Accept: "application/json" }, signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error("HTTP " + response.status);
      return await response.json();
    } catch (error) {
      if (attempt >= 3) throw new Error(url.split("?")[0] + ": " + (error?.message ?? error));
      await new Promise((r) => setTimeout(r, 2_000 * attempt));
    }
  }
}

const iso = (ms) => new Date(ms).toISOString().slice(0, 16).replace("T", " ");

/** Horizons vectors (km, km/s, ICRF) as [time ms, x, y, z, vx, vy, vz] rows. */
async function vectors(command, center, start, stop, step) {
  const params = new URLSearchParams({
    format: "json", COMMAND: `'${command}'`, OBJ_DATA: "NO", MAKE_EPHEM: "YES", EPHEM_TYPE: "VECTORS",
    CENTER: `'${center}'`, REF_PLANE: "FRAME", REF_SYSTEM: "ICRF", VEC_TABLE: "2", OUT_UNITS: "KM-S", TIME_TYPE: "UT",
    CSV_FORMAT: "YES", START_TIME: `'${iso(start)}'`, STOP_TIME: `'${iso(stop)}'`, STEP_SIZE: `'${step}'`,
  });
  const json = await getJson("https://ssd.jpl.nasa.gov/api/horizons.api?" + params);
  const result = String(json.result ?? "");
  const a = result.indexOf("$$SOE"), b = result.indexOf("$$EOE");
  if (a < 0 || b < 0) throw new Error("Horizons " + command + ": " + result.slice(0, 300).replace(/\s+/g, " "));
  const rows = [];
  for (const line of result.slice(a + 5, b).trim().split("\n")) {
    const cells = line.split(",").map((c) => c.trim());
    // JDUT, calendar date, X, Y, Z, VX, VY, VZ
    const jd = Number(cells[0]), nums = cells.slice(2, 8).map(Number);
    if (Number.isFinite(jd) && nums.length === 6 && nums.every(Number.isFinite)) rows.push([Math.round((jd - 2440587.5) * DAY), ...nums]);
  }
  if (!rows.length) throw new Error("Horizons " + command + ": no rows");
  return rows;
}

const now = Date.now();
const cad = await getJson("https://ssd-api.jpl.nasa.gov/cad.api?" + new URLSearchParams({ "dist-max": "10LD", "date-min": "now", "date-max": "+60", sort: "dist", diameter: "true", fullname: "true" }));
const f = Object.fromEntries(cad.fields.map((name, i) => [name, i]));
const rows = (cad.data ?? []).slice(0, MAX_ASTEROIDS);
console.log(`${cad.count} close approaches within 10 LD in 60 days; tracking ${rows.length}`);

const asteroids = [];
for (const row of rows) {
  const id = row[f.des];
  const approach = Math.round((Number(row[f.jd]) - 2440587.5) * DAY);
  try {
    const track = await vectors(`DES=${id};`, "500@399", approach - TRACK_DAYS * DAY, approach + TRACK_DAYS * DAY, "1h");
    asteroids.push({
      id, name: String(row[f.fullname] ?? id).trim(), approach,
      distanceKm: Number(row[f.dist]) * AU_KM, distanceRangeKm: [Number(row[f.dist_min]) * AU_KM, Number(row[f.dist_max]) * AU_KM],
      speedKms: Number(row[f.v_rel]), h: Number(row[f.h]),
      diameterM: row[f.diameter] ? Number(row[f.diameter]) * 1000 : null,
      // Metre precision is plenty for drawing and keeps the snapshot small.
      track: track.map(([t, x, y, z]) => [t, Math.round(x), Math.round(y), Math.round(z)]),
    });
    console.log(`  ${id}: ${iso(approach)} at ${(Number(row[f.dist]) * AU_KM / LUNAR_DISTANCE_KM).toFixed(2)} LD, ${track.length} points`);
  } catch (error) {
    console.warn(`  ${id}: skipped (${error.message})`);
  }
}

const probes = [];
for (const probe of PROBES) {
  try {
    const [geo] = await vectors(String(probe.id), "500@399", now, now + HOUR, "1h");
    const [sun] = await vectors(String(probe.id), "500@10", now, now + HOUR, "1h");
    probes.push({ id: probe.id, key: probe.key, time: geo[0], position: geo.slice(1, 4).map((n) => Math.round(n)), velocity: geo.slice(4, 7).map((n) => Math.round(n * 1000) / 1000),
      sunDistanceKm: Math.round(Math.hypot(sun[1], sun[2], sun[3])) });
    console.log(`  ${probe.key}: ${(Math.hypot(geo[1], geo[2], geo[3]) / AU_KM).toFixed(3)} AU from the Earth`);
  } catch (error) {
    console.warn(`  ${probe.key}: skipped (${error.message})`);
  }
}

if (!probes.length) throw new Error("No probe positions: Horizons is not answering");
const snapshot = parseSpaceSnapshot({ v: 1, fetched: now, asteroids, probes });
writeFileSync(out, JSON.stringify(snapshot));
console.log(`Wrote ${out}: ${snapshot.asteroids.length} asteroids, ${snapshot.probes.length} probes, ${JSON.stringify(snapshot).length} bytes`);
