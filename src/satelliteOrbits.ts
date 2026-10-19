/**
 * Lightweight orbit source and SGP4 positions for curated Earth satellites.
 *
 * Orbital elements: CelesTrak GP JSON (CCSDS OMM), not live spacecraft telemetry.
 * The browser requests at most one copy per endpoint per two-hour cache window.
 * https://celestrak.org/NORAD/documentation/gp-data-formats.php
 */
import { eciToGeodetic, gstime, json2satrec, propagate } from "satellite.js";

export interface SatelliteChoice {
  id: string;
  noradId: number;
  title: string;
  category: "station" | "science" | "earth";
  color: string;
}
export const SATELLITE_CHOICES: readonly SatelliteChoice[] = [
  { id: "iss", noradId: 25544, title: "ISS · 国际空间站", category: "station", color: "#e2f4ff" },
  { id: "tiangong", noradId: 48274, title: "天宫空间站（天和核心舱）", category: "station", color: "#d4b7fc" },
  { id: "hubble", noradId: 20580, title: "Hubble · 哈勃望远镜", category: "science", color: "#ffc9a2" },
  { id: "terra", noradId: 25994, title: "Terra · 对地观测", category: "earth", color: "#b5eac2" },
  { id: "noaa20", noradId: 43013, title: "NOAA-20 · 气象卫星", category: "earth", color: "#a9d9ff" },
  { id: "landsat9", noradId: 49260, title: "Landsat 9 · 陆地观测", category: "earth", color: "#f4d5a0" },
];
export const GP_CACHE_MS = 2 * 60 * 60 * 1000;
export const MAX_ELEMENT_AGE_DAYS = 10;
const STORAGE_KEY = "earth-atlas-orbits-omm-v1";
const BASE_URL = "https://celestrak.org/NORAD/elements/gp.php";
const REMOTE_QUERIES = ["GROUP=STATIONS", ...SATELLITE_CHOICES.filter((item) => item.category !== "station").map((item) => "CATNR=" + item.noradId)];

type GPRecord = Record<string, unknown>;
export type SatRec = ReturnType<typeof json2satrec>;
export interface OrbitRecord {
  choice: SatelliteChoice;
  epoch: Date;
  satrec: SatRec;
}
export interface OrbitalPosition {
  longitudeRad: number;
  latitudeRad: number;
  altitudeKm: number;
}
export interface OrbitalCatalog {
  satellites: OrbitRecord[];
  receivedAt: Date;
}

function validGPRecord(value: unknown): value is GPRecord {
  if (!value || Array.isArray(value) || typeof value !== "object") return false;
  const record = value as GPRecord;
  return Number.isSafeInteger(Number(record.NORAD_CAT_ID)) &&
    typeof record.EPOCH === "string" && Number.isFinite(Date.parse(record.EPOCH));
}
export function parseGPRecords(value: unknown): GPRecord[] {
  if (!Array.isArray(value)) throw new Error("CelesTrak GP response is not an array");
  return value.filter(validGPRecord);
}
function recordAgeDays(epoch: Date, now: Date): number {
  return Math.abs(now.getTime() - epoch.getTime()) / 86_400_000;
}
export function convertGPRecords(records: readonly GPRecord[], now = new Date()): OrbitRecord[] {
  const byCatalog = new Map<number, GPRecord>();
  for (const record of records) {
    if (!validGPRecord(record)) continue;
    const id = Number(record.NORAD_CAT_ID);
    const previous = byCatalog.get(id);
    if (!previous || Date.parse(String(record.EPOCH)) > Date.parse(String(previous.EPOCH))) {
      byCatalog.set(id, record);
    }
  }
  const found: OrbitRecord[] = [];
  for (const choice of SATELLITE_CHOICES) {
    const gp = byCatalog.get(choice.noradId);
    if (!gp) continue;
    const epoch = new Date(String(gp.EPOCH));
    // Stale or future-dated data is not a defensible "current orbit" estimate.
    if (recordAgeDays(epoch, now) > MAX_ELEMENT_AGE_DAYS) continue;
    try {
      const satrec = json2satrec(gp as Parameters<typeof json2satrec>[0]);
      const point = positionAt({ choice, epoch, satrec }, now);
      if (point) found.push({ choice, epoch, satrec });
    } catch {
      // An incomplete OMM record must not become a fabricated orbit.
    }
  }
  return found;
}
export function positionAt(record: OrbitRecord, time: Date): OrbitalPosition | null {
  const result = propagate(record.satrec, time);
  if (!result || !result.position || typeof result.position !== "object") return null;
  const pos = result.position;
  if (![pos.x, pos.y, pos.z].every(Number.isFinite)) return null;
  const geodetic = eciToGeodetic(pos, gstime(time));
  if (!Number.isFinite(geodetic.latitude) || !Number.isFinite(geodetic.longitude) ||
      !Number.isFinite(geodetic.height) || geodetic.height < 100 || geodetic.height > 100_000) return null;
  return {
    longitudeRad: geodetic.longitude,
    latitudeRad: geodetic.latitude,
    altitudeKm: geodetic.height,
  };
}
export function orbitPath(record: OrbitRecord, now: Date, durationMinutes = 90, stepMinutes = 3): OrbitalPosition[] {
  if (durationMinutes <= 0 || durationMinutes > 120 || stepMinutes <= 0) return [];
  const points: OrbitalPosition[] = [];
  for (let minute = -durationMinutes / 2; minute <= durationMinutes / 2; minute += stepMinutes) {
    const next = positionAt(record, new Date(now.getTime() + minute * 60_000));
    if (!next) return []; // No broken partial trajectory drawn as a continuous path.
    points.push(next);
  }
  return points;
}
export function formatEpoch(epoch: Date): string {
  return epoch.toISOString().replace("T", " ").slice(0, 16) + " UTC";
}
function readCache(now: Date): { records: GPRecord[]; receivedAt: Date } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const payload = JSON.parse(raw) as { at: number; records: unknown };
    if (!Number.isFinite(payload.at) || now.getTime() - payload.at >= GP_CACHE_MS ||
        payload.at > now.getTime() + 60_000) return null;
    return { receivedAt: new Date(payload.at), records: parseGPRecords(payload.records) };
  } catch {
    return null;
  }
}
function saveCache(records: GPRecord[], now: Date): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ at: now.getTime(), records }));
  } catch {
    // Storage can be blocked/private; transient network data still works.
  }
}
/**
 * Fails only if no usable orbits are available. Individual CelesTrak endpoints
 * may return [] for decayed satellites and do not block the others.
 */
export async function fetchSatelliteCatalog(signal?: AbortSignal): Promise<OrbitalCatalog> {
  const now = new Date();
  const cached = readCache(now);
  if (cached) {
    return { receivedAt: cached.receivedAt, satellites: convertGPRecords(cached.records, now) };
  }
  const results = await Promise.allSettled(REMOTE_QUERIES.map(async (query) => {
    const response = await fetch(BASE_URL + "?" + query + "&FORMAT=JSON", {
      headers: { Accept: "application/json" },
      signal,
    });
    if (!response.ok) throw new Error("CelesTrak HTTP " + response.status);
    if (!/json/i.test(response.headers.get("content-type") ?? "")) {
      throw new Error("CelesTrak returned non-JSON data");
    }
    return parseGPRecords(await response.json());
  }));
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const records = results.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  const satellites = convertGPRecords(records, now);
  if (satellites.length === 0) throw new Error("No current orbital elements available from CelesTrak");
  saveCache(records, now);
  return { satellites, receivedAt: now };
}
