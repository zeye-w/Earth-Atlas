/**
 * Real rocket launch calendar from The Space Devs' Launch Library 2.
 *
 * The free API allows 15 requests an hour per address, far too few to call
 * from browsers or from shared Worker addresses. A scheduled GitHub Action
 * (.github/workflows/launch-data.yml, scripts/fetch-launches.mjs) fetches the
 * upcoming launches every two hours, keeps only the fields drawn here and
 * publishes the snapshot as a release asset; worker/launches.ts serves it at
 * /api/launches.
 */

export const LAUNCHES_URL = "/api/launches";
export const LL2_UPCOMING_URL = "https://ll.thespacedevs.com/2.3.0/launches/upcoming/?limit=40&mode=normal";
export const LAUNCH_USER_AGENT = "TerraScope/1.0 (+https://github.com/zeye-w/Earth-Atlas)";
export const LAUNCH_REFRESH_MS = 10 * 60_000;
export const LAUNCH_PAD_ID_PREFIX = "launchpad:";
/** Launches more than this long past their time are dropped from a snapshot. */
const KEEP_PAST_MS = 24 * 3_600_000;
const MAX_LAUNCHES = 40;
const MAX_DESCRIPTION = 400;

export type LaunchStatus = "go" | "tbc" | "tbd" | "hold" | "flight" | "success" | "failure";
/** How exactly the launch time is known: to the minute, to the day, or only roughly. */
export type LaunchPrecision = "time" | "day" | "month";

export interface Launch {
  id: string;
  name: string;
  mission: string;
  missionType: string;
  description: string;
  orbit: string;
  rocket: string;
  provider: string;
  status: LaunchStatus;
  /** The provider's wording, e.g. "Go for Launch". */
  statusName: string;
  /** "No earlier than", ms since epoch. */
  net: number;
  precision: LaunchPrecision;
  windowStart: number | null;
  windowEnd: number | null;
  padId: string;
  pad: string;
  location: string;
  country: string;
  latitude: number;
  longitude: number;
  webcast: boolean;
}

export interface LaunchSnapshot {
  v: 1;
  /** When the snapshot was fetched, ms since epoch. */
  fetched: number;
  launches: Launch[];
}

const STATUSES: readonly LaunchStatus[] = ["go", "tbc", "tbd", "hold", "flight", "success", "failure"];
const PRECISIONS: readonly LaunchPrecision[] = ["time", "day", "month"];

type Json = Record<string, unknown>;
const object = (value: unknown): Json => (value && typeof value === "object" && !Array.isArray(value) ? value as Json : {});
const text = (value: unknown, max = 120): string => (typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, max) : "");
const number = (value: unknown): number | null => {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
};
const time = (value: unknown): number | null => {
  const ms = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(ms) ? ms : null;
};

/** Launch Library status abbreviations ("Go", "TBD", "In Flight", …) to our categories. */
export function launchStatus(abbrev: string, name = ""): LaunchStatus {
  const key = (abbrev || name).toLowerCase();
  if (key.includes("partial") || key.includes("fail")) return "failure";
  if (key.includes("success")) return "success";
  if (key.includes("flight")) return "flight";
  if (key.includes("hold")) return "hold";
  if (key.includes("tbc")) return "tbc";
  if (key.startsWith("go")) return "go";
  return "tbd";
}

/** Launch Library's net_precision ("Second", "Hour", "Day", "Month", "Quarter 1", …). */
export function launchPrecision(value: unknown): LaunchPrecision {
  const name = text(object(value).name).toLowerCase();
  if (!name || /second|minute|hour/.test(name)) return "time";
  if (name.includes("day")) return "day";
  return "month";
}

/** One Launch Library 2 launch (normal mode) to our compact form; null if it has no usable time or pad. */
export function parseLibraryLaunch(raw: unknown): Launch | null {
  const l = object(raw);
  const net = time(l.net);
  const pad = object(l.pad);
  const latitude = number(pad.latitude), longitude = number(pad.longitude);
  const id = text(l.id, 64);
  if (!id || net === null || latitude === null || longitude === null || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  const status = object(l.status);
  const mission = object(l.mission);
  const configuration = object(object(l.rocket).configuration);
  const provider = object(l.launch_service_provider);
  const location = object(pad.location);
  const country = object(pad.country ?? location.country);
  const name = text(l.name);
  return {
    id,
    name,
    // "Falcon 9 Block 5 | Starlink Group 10-9": the mission is the part after the bar.
    mission: text(mission.name) || name.split("|").at(-1)!.trim(),
    missionType: text(mission.type, 40),
    description: text(mission.description, MAX_DESCRIPTION),
    orbit: text(object(mission.orbit).name, 60),
    rocket: text(configuration.full_name) || text(configuration.name) || name.split("|")[0].trim(),
    provider: text(provider.name),
    status: launchStatus(text(status.abbrev, 30), text(status.name, 60)),
    statusName: text(status.name, 60),
    net,
    precision: launchPrecision(l.net_precision),
    windowStart: time(l.window_start),
    windowEnd: time(l.window_end),
    padId: String(number(pad.id) ?? (text(pad.name) || `${latitude},${longitude}`)),
    pad: text(pad.name),
    location: text(location.name),
    country: text(country.alpha_2_code ?? location.country_code ?? pad.country_code, 3).toUpperCase(),
    latitude,
    longitude,
    webcast: l.webcast_live === true,
  };
}

/** The upcoming-launches response to a snapshot, soonest first. */
export function parseLibraryResponse(json: unknown, fetched: number): LaunchSnapshot {
  const results = object(json).results;
  if (!Array.isArray(results)) throw new Error("Launch Library response has no results");
  const launches = results.map(parseLibraryLaunch)
    .filter((launch): launch is Launch => launch !== null && launch.net >= fetched - KEEP_PAST_MS)
    .sort((a, b) => a.net - b.net)
    .slice(0, MAX_LAUNCHES);
  return { v: 1, fetched, launches };
}

/** Check a snapshot from /api/launches (or the release asset) before use. */
export function parseLaunchSnapshot(json: unknown): LaunchSnapshot {
  const s = object(json);
  const fetched = number(s.fetched);
  if (s.v !== 1 || fetched === null || !Array.isArray(s.launches)) throw new Error("Invalid launch snapshot");
  const launches: Launch[] = [];
  for (const raw of s.launches) {
    const l = object(raw);
    const net = number(l.net), latitude = number(l.latitude), longitude = number(l.longitude);
    if (typeof l.id !== "string" || typeof l.padId !== "string" || net === null || latitude === null || longitude === null) continue;
    if (!STATUSES.includes(l.status as LaunchStatus) || !PRECISIONS.includes(l.precision as LaunchPrecision)) continue;
    launches.push({
      id: l.id, name: text(l.name), mission: text(l.mission), missionType: text(l.missionType, 40), description: text(l.description, MAX_DESCRIPTION),
      orbit: text(l.orbit, 60), rocket: text(l.rocket), provider: text(l.provider),
      status: l.status as LaunchStatus, statusName: text(l.statusName, 60), net, precision: l.precision as LaunchPrecision,
      windowStart: number(l.windowStart), windowEnd: number(l.windowEnd),
      padId: l.padId, pad: text(l.pad), location: text(l.location), country: text(l.country, 3),
      latitude, longitude, webcast: l.webcast === true,
    });
  }
  return { v: 1, fetched, launches };
}

export async function fetchLaunches(signal: AbortSignal): Promise<LaunchSnapshot> {
  const response = await fetch(LAUNCHES_URL, { signal });
  if (!response.ok) throw new Error("Launch calendar HTTP " + response.status);
  return parseLaunchSnapshot(await response.json());
}

export interface LaunchPad {
  id: string;
  name: string;
  location: string;
  latitude: number;
  longitude: number;
  /** This pad's launches, soonest first. */
  launches: Launch[];
}

/** Launches grouped by pad, ordered by each pad's next launch. */
export function launchPads(launches: readonly Launch[]): LaunchPad[] {
  const pads = new Map<string, LaunchPad>();
  for (const launch of [...launches].sort((a, b) => a.net - b.net)) {
    let pad = pads.get(launch.padId);
    if (!pad) {
      pad = { id: launch.padId, name: launch.pad, location: launch.location, latitude: launch.latitude, longitude: launch.longitude, launches: [] };
      pads.set(launch.padId, pad);
    }
    pad.launches.push(launch);
  }
  return [...pads.values()];
}

/** The launch a pad marker stands for: the first not yet flown, else the latest. */
export function headlineLaunch(pad: LaunchPad, at: number): Launch {
  return pad.launches.find((launch) => launch.status !== "success" && launch.status !== "failure" && launch.net >= at - 3_600_000) ?? pad.launches.at(-1)!;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/**
 * Mission clock: "T−2d 04:13:22" before the launch, "T+00:12:09" after.
 * When only the day or month is known there is nothing to count down to the
 * second: null, and the caller shows the date instead.
 */
export function countdown(launch: Pick<Launch, "net" | "precision">, at: number): string | null {
  if (launch.precision !== "time") return null;
  const diff = launch.net - at;
  const total = Math.floor(Math.abs(diff) / 1000);
  const days = Math.floor(total / 86_400);
  const clock = `${pad2(Math.floor(total / 3600) % 24)}:${pad2(Math.floor(total / 60) % 60)}:${pad2(total % 60)}`;
  return (diff > 0 ? "T−" : "T+") + (days ? `${days}d ` : "") + clock;
}
