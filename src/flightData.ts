/**
 * Live aircraft positions (ADS-B / MLAT). Browsers cannot call the public
 * feeds directly (no CORS, and adsb.lol asks for an identifying User-Agent),
 * so the Cloudflare Worker in worker/index.ts fetches them, keeps only the
 * fields drawn here and serves the result at /api/flights.
 *
 * Primary feed: adsb.lol (ODbL 1.0, volunteer receivers). Fallback: the
 * OpenSky Network REST API. Positions are live only: neither keeps history
 * we could replay on the timeline.
 */

export const FLIGHTS_URL = "/api/flights";
export const ADSB_LOL_URL = "https://re-api.adsb.lol/?all_with_pos";
export const OPENSKY_URL = "https://opensky-network.org/api/states/all";
export const FLIGHT_USER_AGENT = "TerraScope/1.0 (+https://github.com/zeye-w/Earth-Atlas)";
export const FLIGHT_REFRESH_MS = 60_000;
/** Positions older than this at fetch time are dropped. */
export const FLIGHT_MAX_POSITION_AGE_S = 60;

const FEET = 0.3048;
const KNOT = 0.514444;

export type FlightSource = "adsb.lol" | "opensky";

/** One aircraft as served by /api/flights (a compact tuple, ~5,000–8,000 per response). */
export type FlightTuple = [
  hex: string,
  callsign: string,
  latitude: number,
  longitude: number,
  /** Metres; null on the ground. */
  altitude: number | null,
  /** Ground speed, m/s (null if unknown). */
  speed: number | null,
  /** Track over ground, degrees from north (null if unknown). */
  track: number | null,
  /** ICAO type designator, e.g. "B738" ("" if unknown). */
  type: string,
  registration: string,
  /** Seconds between the position report and `time`. */
  age: number,
];

export interface FlightSnapshot {
  v: 1;
  source: FlightSource;
  /** Data time, ms since epoch. */
  time: number;
  aircraft: FlightTuple[];
}

export interface Flight {
  hex: string;
  callsign: string;
  latitude: number;
  longitude: number;
  altitude: number | null;
  speed: number | null;
  track: number | null;
  type: string;
  registration: string;
  /** When the position was reported, ms since epoch. */
  reportedAt: number;
}

const round = (value: number, digits: number) => Math.round(value * 10 ** digits) / 10 ** digits;
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

interface ReadsbAircraft {
  hex?: string; flight?: string; r?: string; t?: string; category?: string;
  lat?: number; lon?: number; alt_baro?: number | "ground"; alt_geom?: number;
  gs?: number; track?: number; true_heading?: number; seen_pos?: number;
}

/** adsb.lol readsb JSON ({ now (s), aircraft: [...] }) to a compact snapshot. */
export function parseAdsbLol(json: unknown): FlightSnapshot {
  const data = json as { now?: number; aircraft?: ReadsbAircraft[] };
  if (!finite(data?.now) || !Array.isArray(data.aircraft)) throw new Error("Unexpected adsb.lol payload");
  const aircraft: FlightTuple[] = [];
  for (const a of data.aircraft) {
    if (!finite(a.lat) || !finite(a.lon) || Math.abs(a.lat) > 90 || Math.abs(a.lon) > 180) continue;
    const age = finite(a.seen_pos) ? a.seen_pos : 0;
    if (age > FLIGHT_MAX_POSITION_AGE_S) continue;
    // Category C: airport surface vehicles and obstacles, not aircraft.
    if (a.category?.startsWith("C")) continue;
    const onGround = a.alt_baro === "ground";
    const feet = finite(a.alt_geom) ? a.alt_geom : finite(a.alt_baro) ? a.alt_baro : null;
    const track = finite(a.track) ? a.track : finite(a.true_heading) ? a.true_heading : null;
    aircraft.push([
      text(a.hex).toLowerCase(),
      text(a.flight),
      round(a.lat, 4),
      round(a.lon, 4),
      onGround || feet === null ? null : Math.round(feet * FEET),
      finite(a.gs) ? round(a.gs * KNOT, 1) : null,
      track === null ? null : Math.round(track),
      text(a.t),
      text(a.r),
      round(age, 1),
    ]);
  }
  return { v: 1, source: "adsb.lol", time: Math.round(data.now * 1000), aircraft };
}

/** OpenSky /states/all ({ time (s), states: [[icao24, callsign, …]] }) to a compact snapshot. */
export function parseOpenSky(json: unknown): FlightSnapshot {
  const data = json as { time?: number; states?: unknown[][] | null };
  if (!finite(data?.time)) throw new Error("Unexpected OpenSky payload");
  const aircraft: FlightTuple[] = [];
  for (const s of data.states ?? []) {
    const [icao24, callsign, , timePosition, , lon, lat, baroAltitude, onGround, velocity, trueTrack, , , geoAltitude] = s;
    if (!finite(lat) || !finite(lon) || !finite(timePosition)) continue;
    const age = Math.max(0, data.time - timePosition);
    if (age > FLIGHT_MAX_POSITION_AGE_S) continue;
    const metres = finite(geoAltitude) ? geoAltitude : finite(baroAltitude) ? baroAltitude : null;
    aircraft.push([
      text(icao24).toLowerCase(),
      text(callsign),
      round(lat, 4),
      round(lon, 4),
      onGround === true || metres === null ? null : Math.round(metres),
      finite(velocity) ? round(velocity, 1) : null,
      finite(trueTrack) ? Math.round(trueTrack) : null,
      "",
      "",
      age,
    ]);
  }
  return { v: 1, source: "opensky", time: data.time * 1000, aircraft };
}

/** Snapshot (from /api/flights) to flights; throws if it is not one. */
export function decodeFlights(json: unknown): { source: FlightSource; time: number; flights: Flight[] } {
  const data = json as FlightSnapshot;
  if (data?.v !== 1 || !finite(data.time) || !Array.isArray(data.aircraft)) throw new Error("Unexpected flight snapshot");
  const flights = data.aircraft.map(([hex, callsign, latitude, longitude, altitude, speed, track, type, registration, age]) => ({
    hex, callsign, latitude, longitude, altitude, speed, track, type, registration, reportedAt: data.time - age * 1000,
  }));
  return { source: data.source, time: data.time, flights };
}

export async function fetchFlights(signal?: AbortSignal) {
  const response = await fetch(FLIGHTS_URL, { signal, headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error("Flights HTTP " + response.status);
  return decodeFlights(await response.json());
}

/** Longest dead reckoning from a report; beyond it the aircraft stays put. */
export const MAX_EXTRAPOLATION_S = 120;

/**
 * Where the aircraft would be `seconds` after its report at constant ground
 * speed and track (great-circle step). Airborne only; an estimate.
 */
export function extrapolate(flight: Pick<Flight, "latitude" | "longitude" | "speed" | "track" | "altitude">, seconds: number): { latitude: number; longitude: number } {
  const { latitude, longitude, speed, track, altitude } = flight;
  if (altitude === null || speed === null || track === null || seconds <= 0) return { latitude, longitude };
  const distance = speed * Math.min(seconds, MAX_EXTRAPOLATION_S) / 6_371_008.8;
  const lat1 = latitude * Math.PI / 180;
  const lon1 = longitude * Math.PI / 180;
  const bearing = track * Math.PI / 180;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(distance) + Math.cos(lat1) * Math.sin(distance) * Math.cos(bearing));
  const lon2 = lon1 + Math.atan2(Math.sin(bearing) * Math.sin(distance) * Math.cos(lat1), Math.cos(distance) - Math.sin(lat1) * Math.sin(lat2));
  return { latitude: lat2 * 180 / Math.PI, longitude: ((lon2 * 180 / Math.PI + 540) % 360) - 180 };
}

export type AltitudeBand = "ground" | "low" | "mid" | "high";

/** Ground, below 3,000 m (climb/approach), 3,000–9,000 m, cruise above 9,000 m. */
export function altitudeBand(altitude: number | null): AltitudeBand {
  if (altitude === null) return "ground";
  if (altitude < 3_000) return "low";
  if (altitude < 9_000) return "mid";
  return "high";
}

/** One-line summary for a clicked aircraft, e.g. "CES5766 · B738 B-6145 · 高度 6,320 m · 地速 709 km/h · 航向 243° · 12 秒前的位置报告". */
export function describeFlight(flight: Flight, now: number): string {
  const parts = [flight.callsign || flight.registration || flight.hex.toUpperCase()];
  const airframe = [flight.type, flight.registration && flight.registration !== parts[0] ? flight.registration : ""].filter(Boolean).join(" ");
  if (airframe) parts.push(airframe);
  parts.push(flight.altitude === null ? "地面" : "高度 " + flight.altitude.toLocaleString("zh-CN") + " m");
  if (flight.speed !== null) parts.push("地速 " + Math.round(flight.speed * 3.6) + " km/h");
  if (flight.track !== null) parts.push("航向 " + flight.track + "°");
  parts.push(Math.max(0, Math.round((now - flight.reportedAt) / 1000)) + " 秒前的位置报告");
  return parts.join(" · ");
}
