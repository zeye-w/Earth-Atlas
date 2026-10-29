/**
 * Natural hazards: open events from NASA EONET (wildfires, sea ice, dust,
 * floods, volcanoes…) and tropical cyclones from GDACS (alert level, forecast
 * track, uncertainty cone, wind swaths), merged with EONET's six-hourly
 * observed tracks and winds. worker/hazards.ts fetches both, keeps only what
 * is drawn here and serves the snapshot at /api/hazards.
 *
 * Pure: shared by the Worker (building the snapshot) and the client (checking
 * it, intensity scales, positions along the timeline).
 */

export const HAZARDS_URL = "/api/hazards";
export const EONET_URL = "https://eonet.gsfc.nasa.gov/api/v3/events?status=open&days=30";
export const GDACS_TC_URL = "https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=TC";
export const HAZARD_USER_AGENT = "TerraScope/1.0 (+https://github.com/zeye-w/Earth-Atlas)";
export const HAZARD_REFRESH_MS = 30 * 60_000;
export const HAZARD_ID_PREFIX = "hazard:";
const MAX_EVENTS = 300;
const MAX_STORMS = 12;
const MAX_TRACK = 160;
const MAX_RING = 180;
const KNOT_KMH = 1.852;

export const EVENT_CATEGORIES = ["wildfires", "volcanoes", "seaLakeIce", "dustHaze", "floods", "landslides", "drought", "snow", "tempExtremes", "waterColor", "manmade"] as const;
export type EventCategory = (typeof EVENT_CATEGORIES)[number];

export interface NaturalEvent {
  id: string;
  title: string;
  category: EventCategory;
  /** Latest observation, ms since epoch. */
  time: number;
  latitude: number;
  longitude: number;
  source: string;
  url: string | null;
}

export interface TrackPoint { time: number; latitude: number; longitude: number; windKt: number | null }
export type AlertLevel = "green" | "orange" | "red";
export interface WindSwath { level: AlertLevel; ring: [number, number][] }

export interface Storm {
  id: string;
  /** Short name, e.g. "CHAMPI" or "Vance". */
  name: string;
  source: string;
  alert: AlertLevel | null;
  countries: string[];
  /** Strongest wind GDACS reports for the storm, km/h. */
  maxWindKmh: number | null;
  /** Time of the latest advisory, ms; forecast points come after it. */
  advisory: number | null;
  track: TrackPoint[];
  forecast: TrackPoint[];
  /** Forecast uncertainty cone (lon, lat). */
  cone: [number, number][] | null;
  /** Areas swept by winds of 60 / 90 / 120 km/h and more (GDACS green / orange / red). */
  swaths: WindSwath[];
  report: string | null;
}

export interface HazardSnapshot { v: 1; fetched: number; events: NaturalEvent[]; storms: Storm[] }

type Json = Record<string, unknown>;
const object = (value: unknown): Json => (value && typeof value === "object" && !Array.isArray(value) ? value as Json : {});
const text = (value: unknown, max = 120) => (typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, max) : "");
const finite = (value: unknown): number | null => {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
};
const validLatLon = (lat: number | null, lon: number | null): lat is number => lat !== null && lon !== null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
/** GDACS times have no zone; they are UTC. */
const utc = (value: unknown): number | null => {
  const s = text(value, 40);
  if (!s) return null;
  const ms = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : s + "Z");
  return Number.isFinite(ms) ? ms : null;
};
const round = (n: number, places = 3) => Math.round(n * 10 ** places) / 10 ** places;

/** Centre of a GeoJSON Point or of a Polygon's outer ring. */
function centre(geometry: Json): [number, number] | null {
  const coordinates = geometry.coordinates;
  if (geometry.type === "Point" && Array.isArray(coordinates)) {
    const lon = finite(coordinates[0]), lat = finite(coordinates[1]);
    return validLatLon(lat, lon) ? [lon!, lat] : null;
  }
  if (geometry.type === "Polygon" && Array.isArray(coordinates) && Array.isArray(coordinates[0])) {
    const ring = (coordinates[0] as unknown[]).filter(Array.isArray) as unknown[][];
    // A closed ring repeats its first vertex at the end: count it once.
    const last = ring.at(-1);
    if (ring.length > 1 && last && last[0] === ring[0][0] && last[1] === ring[0][1]) ring.pop();
    if (!ring.length) return null;
    let lon = 0, lat = 0;
    for (const p of ring) { lon += Number(p[0]); lat += Number(p[1]); }
    lon /= ring.length; lat /= ring.length;
    return validLatLon(lat, lon) ? [lon, lat] : null;
  }
  return null;
}

/** Keep at most `max` vertices of a ring, evenly spaced. */
function thinRing(raw: unknown, max = MAX_RING): [number, number][] {
  if (!Array.isArray(raw)) return [];
  const ring = raw.map((p) => (Array.isArray(p) ? [finite(p[0]), finite(p[1])] : [null, null]))
    .filter((p): p is [number, number] => validLatLon(p[1], p[0]));
  if (ring.length <= max) return ring.map(([lon, lat]) => [round(lon), round(lat)]);
  const step = ring.length / max;
  return Array.from({ length: max }, (_, i) => ring[Math.floor(i * step)]).map(([lon, lat]) => [round(lon), round(lat)]);
}

/** "Super Typhoon Champi" / "Tropical Storm Olana" → "Champi" / "Olana"; "IN-FA-26" → "IN-FA". */
export function stormName(title: string): string {
  return title.replace(/^(post-tropical|extratropical|subtropical|super|severe|very severe|extremely severe|tropical|typhoon|cyclone|cyclonic|storm|hurricane|depression|\s)+/i, "").replace(/-\d{2}$/, "").trim() || title;
}
const nameKey = (name: string) => stormName(name).toLowerCase().replace(/[^a-z]/g, "");

const STORM_CATEGORY = "severeStorms";

/** EONET's open events: natural events (not storms) and storm tracks. */
export function parseEonet(json: unknown): { events: NaturalEvent[]; tracks: { id: string; name: string; source: string; track: TrackPoint[] }[] } {
  const raw = object(json).events;
  if (!Array.isArray(raw)) throw new Error("EONET response has no events");
  const events: NaturalEvent[] = [];
  const tracks: { id: string; name: string; source: string; track: TrackPoint[] }[] = [];
  for (const item of raw) {
    const e = object(item);
    const id = text(e.id, 40);
    const category = text(object(Array.isArray(e.categories) ? e.categories[0] : null).id, 30);
    const geometry = (Array.isArray(e.geometry) ? e.geometry : []).map(object);
    const sources = (Array.isArray(e.sources) ? e.sources : []).map(object);
    if (!id || !geometry.length) continue;
    if (category === STORM_CATEGORY) {
      const track = geometry.map((g) => {
        const at = centre(g), time = utc(g.date);
        if (!at || time === null) return null;
        const magnitude = finite(g.magnitudeValue);
        return { time, latitude: at[1], longitude: at[0], windKt: magnitude !== null && text(g.magnitudeUnit) === "kts" ? magnitude : null };
      }).filter((p): p is TrackPoint => p !== null).sort((a, b) => a.time - b.time).slice(-MAX_TRACK);
      if (track.length) tracks.push({ id, name: stormName(text(e.title)), source: text(sources[0]?.id, 20), track });
      continue;
    }
    if (!(EVENT_CATEGORIES as readonly string[]).includes(category)) continue;
    // The latest observation stands for the event.
    const latest = geometry.map((g) => ({ at: centre(g), time: utc(g.date) })).filter((g) => g.at && g.time !== null).sort((a, b) => b.time! - a.time!)[0];
    if (!latest) continue;
    const url = text(sources[0]?.url, 300);
    events.push({
      id, title: text(e.title), category: category as EventCategory, time: latest.time!,
      latitude: round(latest.at![1]), longitude: round(latest.at![0]),
      source: text(sources[0]?.id, 20), url: /^https:\/\//.test(url) ? url : null,
    });
  }
  events.sort((a, b) => b.time - a.time);
  return { events: events.slice(0, MAX_EVENTS), tracks };
}

export interface GdacsStorm { eventId: string; name: string; source: string; alert: AlertLevel | null; countries: string[]; maxWindKmh: number | null; geometryUrl: string | null; report: string | null; from: number | null }

/** GDACS's tropical-cyclone list: the storms still current. */
export function parseGdacsList(json: unknown): GdacsStorm[] {
  const features = object(json).features;
  if (!Array.isArray(features)) throw new Error("GDACS response has no features");
  const storms: GdacsStorm[] = [];
  for (const f of features) {
    const p = object(object(f).properties);
    if (p.eventtype !== "TC" || p.iscurrent !== "true") continue;
    const eventId = String(finite(p.eventid) ?? "");
    if (!eventId) continue;
    const url = object(p.url);
    const level = text(p.alertlevel).toLowerCase();
    const severity = object(p.severitydata);
    const affected = (Array.isArray(p.affectedcountries) ? p.affectedcountries : []).map((c) => text(object(c).countryname, 60)).filter(Boolean);
    const geometryUrl = text(url.geometry, 300), report = text(url.report, 300);
    storms.push({
      eventId, name: stormName(text(p.eventname)), source: text(p.source, 20),
      alert: level === "green" || level === "orange" || level === "red" ? level : null,
      countries: affected.length ? affected : text(p.country, 300).split(",").map((c) => c.trim()).filter(Boolean),
      maxWindKmh: text(severity.severityunit) === "km/h" ? finite(severity.severity) : null,
      geometryUrl: geometryUrl.startsWith("https://www.gdacs.org/") ? geometryUrl : null,
      report: report.startsWith("https://www.gdacs.org/") ? report : null,
      from: utc(p.fromdate),
    });
  }
  return storms.slice(0, MAX_STORMS);
}

/** "10181800" (month, day, hour, minute) near `reference` → ms; GDACS omits the year. */
export function gdacsKeyTime(key: string, reference: number): number | null {
  const m = /^(\d\d)(\d\d)(\d\d)(\d\d)$/.exec(key);
  if (!m) return null;
  const year = new Date(reference).getUTCFullYear();
  const candidates = [year - 1, year, year + 1].map((y) => Date.UTC(y, Number(m[1]) - 1, Number(m[2]), Number(m[3]), Number(m[4])));
  return candidates.reduce((best, t) => (Math.abs(t - reference) < Math.abs(best - reference) ? t : best));
}

/** One storm's GDACS geometry: track points (observed and forecast), cone and wind swaths. */
export function parseGdacsGeometry(json: unknown, reference: number) {
  const features = object(json).features;
  if (!Array.isArray(features)) throw new Error("GDACS geometry has no features");
  const points: TrackPoint[] = [];
  let cone: [number, number][] | null = null, advisory: number | null = null;
  const swaths: WindSwath[] = [];
  for (const raw of features) {
    const f = object(raw), p = object(f.properties), g = object(f.geometry);
    const cls = text(p.Class, 40);
    if (cls.startsWith("Point_Polygon_Point")) {
      const at = centre(g), time = gdacsKeyTime(text(p.key, 12), reference);
      if (at && time !== null) points.push({ time, latitude: round(at[1]), longitude: round(at[0]), windKt: null });
      advisory ??= utc(p.polygondate);
    } else if (cls === "Poly_Cones" && g.type === "Polygon" && Array.isArray(g.coordinates)) {
      cone = thinRing(g.coordinates[0], 240);
    } else if (/^Poly_(Green|Orange|Red)$/.test(cls)) {
      const level = cls.slice(5).toLowerCase() as AlertLevel;
      const rings = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" && Array.isArray(g.coordinates) ? g.coordinates : [];
      for (const polygon of rings) if (Array.isArray(polygon)) {
        const ring = thinRing(polygon[0]);
        if (ring.length >= 4) swaths.push({ level, ring });
      }
    }
  }
  points.sort((a, b) => a.time - b.time);
  return { points, cone: cone && cone.length >= 4 ? cone : null, advisory, swaths: swaths.slice(0, 60) };
}

/**
 * One storm per cyclone: EONET's observed track (with winds) where it has
 * one, GDACS's alert, forecast after the latest advisory, cone and swaths.
 */
export function mergeStorms(
  gdacs: { storm: GdacsStorm; geometry: ReturnType<typeof parseGdacsGeometry> | null }[],
  eonet: { id: string; name: string; source: string; track: TrackPoint[] }[],
): Storm[] {
  const used = new Set<string>();
  const storms: Storm[] = gdacs.map(({ storm, geometry }) => {
    const match = eonet.find((e) => !used.has(e.id) && nameKey(e.name) === nameKey(storm.name));
    if (match) used.add(match.id);
    const points = geometry?.points ?? [];
    const advisory = geometry?.advisory ?? null;
    const observed = match?.track ?? points.filter((p) => advisory === null || p.time <= advisory);
    const last = observed.at(-1)?.time ?? advisory ?? -Infinity;
    return {
      id: "gdacs-" + storm.eventId, name: match?.name ?? storm.name, source: storm.source || match?.source || "",
      alert: storm.alert, countries: storm.countries, maxWindKmh: storm.maxWindKmh, advisory,
      track: observed.slice(-MAX_TRACK), forecast: points.filter((p) => p.time > last).slice(0, 40),
      cone: geometry?.cone ?? null, swaths: geometry?.swaths ?? [], report: storm.report,
    };
  });
  for (const e of eonet) if (!used.has(e.id)) storms.push({
    id: "eonet-" + e.id, name: e.name, source: e.source, alert: null, countries: [], maxWindKmh: null, advisory: null,
    track: e.track, forecast: [], cone: null, swaths: [], report: null,
  });
  return storms.filter((s) => s.track.length || s.forecast.length).slice(0, MAX_STORMS);
}

/** Check a snapshot from /api/hazards before use. */
export function parseHazardSnapshot(json: unknown): HazardSnapshot {
  const s = object(json);
  const fetched = finite(s.fetched);
  if (s.v !== 1 || fetched === null || !Array.isArray(s.events) || !Array.isArray(s.storms)) throw new Error("Invalid hazard snapshot");
  const point = (raw: unknown): TrackPoint | null => {
    const p = object(raw), time = finite(p.time), lat = finite(p.latitude), lon = finite(p.longitude), wind = finite(p.windKt);
    return time !== null && validLatLon(lat, lon) ? { time, latitude: lat, longitude: lon!, windKt: wind } : null;
  };
  const pairs = (raw: unknown) => (Array.isArray(raw) ? raw : []).filter((p) => Array.isArray(p) && validLatLon(finite(p[1]), finite(p[0]))) as [number, number][];
  const events: NaturalEvent[] = [];
  for (const raw of s.events) {
    const e = object(raw), time = finite(e.time), lat = finite(e.latitude), lon = finite(e.longitude);
    if (typeof e.id !== "string" || time === null || !validLatLon(lat, lon) || !(EVENT_CATEGORIES as readonly string[]).includes(e.category as string)) continue;
    const url = text(e.url, 300);
    events.push({ id: e.id, title: text(e.title), category: e.category as EventCategory, time, latitude: lat, longitude: lon!, source: text(e.source, 20), url: url.startsWith("https://") ? url : null });
  }
  const storms: Storm[] = [];
  for (const raw of s.storms) {
    const st = object(raw);
    if (typeof st.id !== "string") continue;
    const track = (Array.isArray(st.track) ? st.track : []).map(point).filter((p): p is TrackPoint => p !== null);
    const forecast = (Array.isArray(st.forecast) ? st.forecast : []).map(point).filter((p): p is TrackPoint => p !== null);
    if (!track.length && !forecast.length) continue;
    const alert = st.alert === "green" || st.alert === "orange" || st.alert === "red" ? st.alert : null;
    const cone = pairs(st.cone);
    const report = text(st.report, 300);
    storms.push({
      id: st.id, name: text(st.name, 60), source: text(st.source, 20), alert,
      countries: (Array.isArray(st.countries) ? st.countries : []).map((c) => text(c, 60)).filter(Boolean),
      maxWindKmh: finite(st.maxWindKmh), advisory: finite(st.advisory), track, forecast,
      cone: cone.length >= 4 ? cone : null,
      swaths: (Array.isArray(st.swaths) ? st.swaths : []).map(object)
        .filter((w) => w.level === "green" || w.level === "orange" || w.level === "red")
        .map((w) => ({ level: w.level as AlertLevel, ring: pairs(w.ring) })).filter((w) => w.ring.length >= 4),
      report: report.startsWith("https://") ? report : null,
    });
  }
  return { v: 1, fetched, events, storms };
}

export async function fetchHazards(signal: AbortSignal): Promise<HazardSnapshot> {
  const response = await fetch(HAZARDS_URL, { signal });
  if (!response.ok) throw new Error("Hazards HTTP " + response.status);
  return parseHazardSnapshot(await response.json());
}

// ---- Intensity scales -------------------------------------------------------

export interface IntensityLevel { key: string; label: string; color: string }

/**
 * China Meteorological Administration grades (GB/T 19201), by maximum
 * sustained wind in m/s. The feeds give 1-minute winds (JTWC/NHC) where CMA
 * uses 2-minute winds, so a storm can read one grade higher than CMA's.
 */
export const CMA_LEVELS: readonly (IntensityLevel & { minMs: number })[] = [
  { key: "td", label: "热带低压", color: "#6ec1ff", minMs: 0 },
  { key: "ts", label: "热带风暴", color: "#5ee08a", minMs: 17.2 },
  { key: "sts", label: "强热带风暴", color: "#e8e05a", minMs: 24.5 },
  { key: "ty", label: "台风", color: "#ffb347", minMs: 32.7 },
  { key: "sty", label: "强台风", color: "#ff6b4a", minMs: 41.5 },
  { key: "superty", label: "超强台风", color: "#d65cff", minMs: 51.0 },
];

/** Saffir–Simpson hurricane wind scale, by 1-minute sustained wind in knots. */
export const SAFFIR_SIMPSON_LEVELS: readonly (IntensityLevel & { minKt: number })[] = [
  { key: "td", label: "Tropical depression", color: "#6ec1ff", minKt: 0 },
  { key: "ts", label: "Tropical storm", color: "#5ee08a", minKt: 34 },
  { key: "c1", label: "Category 1", color: "#e8e05a", minKt: 64 },
  { key: "c2", label: "Category 2", color: "#ffc35a", minKt: 83 },
  { key: "c3", label: "Category 3", color: "#ff9447", minKt: 96 },
  { key: "c4", label: "Category 4", color: "#ff5a4a", minKt: 113 },
  { key: "c5", label: "Category 5", color: "#d65cff", minKt: 137 },
];

const UNKNOWN: IntensityLevel = { key: "unknown", label: "强度未知", color: "#c9d1db" };

export function cmaLevel(windKt: number | null): IntensityLevel {
  if (windKt === null || !Number.isFinite(windKt)) return UNKNOWN;
  const ms = windKt * 0.514444;
  return [...CMA_LEVELS].reverse().find((l) => ms >= l.minMs)!;
}
export function saffirSimpsonLevel(windKt: number | null): IntensityLevel {
  if (windKt === null || !Number.isFinite(windKt)) return UNKNOWN;
  return [...SAFFIR_SIMPSON_LEVELS].reverse().find((l) => windKt >= l.minKt)!;
}
export const knotsToKmh = (kt: number) => kt * KNOT_KMH;
export const kmhToKnots = (kmh: number) => kmh / KNOT_KMH;

// ---- Position along the track --------------------------------------------------

/** Longitudes unwrapped along a track, so interpolation never crosses the globe the long way round. */
function unwrap(points: readonly TrackPoint[]): TrackPoint[] {
  const out: TrackPoint[] = [];
  for (const p of points) {
    const previous = out.at(-1);
    let lon = p.longitude;
    if (previous) while (lon - previous.longitude > 180) lon -= 360;
    if (previous) while (lon - previous.longitude < -180) lon += 360;
    out.push({ ...p, longitude: lon });
  }
  return out;
}
const wrap = (lon: number) => ((lon + 540) % 360) - 180;

/** Every point of a storm in time order: observed track, then forecast. */
export function stormPath(storm: Pick<Storm, "track" | "forecast">): TrackPoint[] {
  return unwrap([...storm.track, ...storm.forecast].sort((a, b) => a.time - b.time));
}

export interface StormFix { latitude: number; longitude: number; windKt: number | null; forecast: boolean; time: number }

/**
 * Where the storm is at `time`: interpolated between six-hourly fixes; null
 * before its first fix or after its last (an hour of tolerance at either end).
 * Wind is the latest observed one (forecast points carry none).
 */
export function stormAt(storm: Pick<Storm, "track" | "forecast">, time: number): StormFix | null {
  const path = stormPath(storm);
  if (!path.length) return null;
  const first = path[0], last = path.at(-1)!;
  if (time < first.time - 3_600_000 || time > last.time + 3_600_000) return null;
  const lastObserved = storm.track.length ? Math.max(...storm.track.map((p) => p.time)) : -Infinity;
  const wind = (t: number) => {
    const known = storm.track.filter((p) => p.time <= t && p.windKt !== null).at(-1) ?? storm.track.find((p) => p.windKt !== null);
    return known?.windKt ?? null;
  };
  if (time <= first.time) return { latitude: first.latitude, longitude: wrap(first.longitude), windKt: wind(first.time), forecast: first.time > lastObserved, time };
  if (time >= last.time) return { latitude: last.latitude, longitude: wrap(last.longitude), windKt: wind(last.time), forecast: last.time > lastObserved, time };
  const i = path.findIndex((p) => p.time > time);
  const a = path[i - 1], b = path[i];
  const f = (time - a.time) / (b.time - a.time);
  return {
    latitude: a.latitude + (b.latitude - a.latitude) * f,
    longitude: wrap(a.longitude + (b.longitude - a.longitude) * f),
    windKt: wind(time), forecast: time > lastObserved, time,
  };
}

/** Heading (degrees from north) and speed (km/h) at `time`, from the fixes either side. */
export function stormMotion(storm: Pick<Storm, "track" | "forecast">, time: number): { heading: number; speedKmh: number } | null {
  const path = stormPath(storm);
  if (path.length < 2) return null;
  let i = path.findIndex((p) => p.time > time);
  if (i <= 0) i = i === 0 ? 1 : path.length - 1;
  const a = path[i - 1], b = path[i];
  const lat = ((a.latitude + b.latitude) / 2) * Math.PI / 180;
  const north = (b.latitude - a.latitude) * 111.32, east = (b.longitude - a.longitude) * 111.32 * Math.cos(lat);
  const hours = (b.time - a.time) / 3_600_000;
  if (hours <= 0) return null;
  return { heading: (Math.atan2(east, north) * 180 / Math.PI + 360) % 360, speedKmh: Math.hypot(north, east) / hours };
}
