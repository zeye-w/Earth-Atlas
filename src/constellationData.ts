/**
 * Satellite constellations from CelesTrak GP data (CSV form of CCSDS OMM:
 * about a quarter of the JSON size, which matters for ~10,000 Starlink
 * satellites). Positions are SGP4 predictions, not telemetry.
 * https://celestrak.org/NORAD/documentation/gp-data-formats.php
 */
export interface Constellation {
  id: string;
  group: string;
  title: string;
}

export const STARLINK: Constellation = { id: "starlink", group: "starlink", title: "Starlink" };
/** CelesTrak updates GP data about every two hours; do not refetch sooner. */
export const CONSTELLATION_CACHE_MS = 2 * 60 * 60 * 1000;
export const CONSTELLATION_MAX_ELEMENT_AGE_DAYS = 10;

export function constellationUrl(constellation: Constellation): string {
  return "https://celestrak.org/NORAD/elements/gp.php?GROUP=" + constellation.group + "&FORMAT=csv";
}

/** OMM fields satellite.js json2satrec needs, plus the name. */
export interface OmmRecord {
  OBJECT_NAME: string;
  OBJECT_ID: string;
  EPOCH: string;
  MEAN_MOTION: number;
  ECCENTRICITY: number;
  INCLINATION: number;
  RA_OF_ASC_NODE: number;
  ARG_OF_PERICENTER: number;
  MEAN_ANOMALY: number;
  EPHEMERIS_TYPE: number;
  CLASSIFICATION_TYPE: string;
  NORAD_CAT_ID: number;
  ELEMENT_SET_NO: number;
  REV_AT_EPOCH: number;
  BSTAR: number;
  MEAN_MOTION_DOT: number;
  MEAN_MOTION_DDOT: number;
}

const NUMERIC = ["MEAN_MOTION", "ECCENTRICITY", "INCLINATION", "RA_OF_ASC_NODE", "ARG_OF_PERICENTER", "MEAN_ANOMALY", "EPHEMERIS_TYPE", "NORAD_CAT_ID", "ELEMENT_SET_NO", "REV_AT_EPOCH", "BSTAR", "MEAN_MOTION_DOT", "MEAN_MOTION_DDOT"] as const;
const REQUIRED = ["OBJECT_NAME", "EPOCH", ...NUMERIC] as const;

/** Parses CelesTrak's OMM CSV (header row, comma-separated, no quoting in practice). */
export function parseOmmCsv(text: string): OmmRecord[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
  if (lines.length < 2) throw new Error("CelesTrak CSV is empty");
  const header = lines[0].split(",").map((cell) => cell.trim());
  const index = Object.fromEntries(header.map((name, i) => [name, i]));
  for (const name of REQUIRED) if (index[name] === undefined) throw new Error("CelesTrak CSV lacks " + name);
  const records: OmmRecord[] = [];
  for (const line of lines.slice(1)) {
    const cells = line.split(",");
    const record: Record<string, string | number> = {
      OBJECT_NAME: (cells[index.OBJECT_NAME] ?? "").trim(),
      OBJECT_ID: (cells[index.OBJECT_ID] ?? "").trim(),
      EPOCH: (cells[index.EPOCH] ?? "").trim(),
      CLASSIFICATION_TYPE: (cells[index.CLASSIFICATION_TYPE] ?? "U").trim() || "U",
    };
    let valid = record.OBJECT_NAME !== "" && record.EPOCH !== "";
    for (const name of NUMERIC) {
      const value = Number(cells[index[name]]);
      if (!Number.isFinite(value)) valid = false;
      record[name] = value;
    }
    if (valid) records.push(record as unknown as OmmRecord);
  }
  if (records.length === 0) throw new Error("CelesTrak CSV has no valid records");
  return records;
}

export function epochOf(record: OmmRecord): Date {
  return new Date(/(?:Z|[+-]\d\d:\d\d)$/i.test(record.EPOCH) ? record.EPOCH : record.EPOCH + "Z");
}

/** Orbit shells by inclination, for the legend (e.g. 53°, 70°, 97.6°). */
export function shellCounts(records: readonly OmmRecord[]): { inclination: number; count: number }[] {
  const counts = new Map<number, number>();
  for (const record of records) {
    const key = Math.round(record.INCLINATION);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].map(([inclination, count]) => ({ inclination, count })).sort((a, b) => b.count - a.count);
}

const CACHE_NAME = "terrascope-constellations-v1";
const memory = new Map<string, { at: number; records: OmmRecord[] }>();

/**
 * Elements for a constellation, at most one download per two hours: kept in
 * memory and in the Cache Storage (localStorage is too small for ~1.5 MB).
 */
export async function fetchConstellation(constellation: Constellation, signal?: AbortSignal): Promise<{ records: OmmRecord[]; fetchedAt: Date }> {
  const url = constellationUrl(constellation);
  const now = Date.now();
  const inMemory = memory.get(url);
  if (inMemory && now - inMemory.at < CONSTELLATION_CACHE_MS) return { records: inMemory.records, fetchedAt: new Date(inMemory.at) };
  const cache = typeof caches !== "undefined" ? await caches.open(CACHE_NAME).catch(() => null) : null;
  const cached = await cache?.match(url).catch(() => undefined);
  const cachedAt = Number(cached?.headers.get("x-fetched-at"));
  if (cached && Number.isFinite(cachedAt) && now - cachedAt < CONSTELLATION_CACHE_MS && cachedAt <= now + 60_000) {
    const records = parseOmmCsv(await cached.text());
    memory.set(url, { at: cachedAt, records });
    return { records, fetchedAt: new Date(cachedAt) };
  }
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error("CelesTrak HTTP " + response.status);
  const text = await response.text();
  const records = parseOmmCsv(text);
  memory.set(url, { at: now, records });
  await cache?.put(url, new Response(text, { headers: { "content-type": "text/csv", "x-fetched-at": String(now) } })).catch(() => undefined);
  return { records, fetchedAt: new Date(now) };
}
