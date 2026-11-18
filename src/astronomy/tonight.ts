/**
 * "What's in the sky tonight" for one place: when it gets dark, the Moon,
 * the naked-eye planets that are up during the night, active meteor showers
 * and the next eclipse that can be seen from there. All computed in the
 * browser; the place never leaves it.
 */
import { Body, Equator, Horizon, Illumination, MakeTime, Observer, SearchAltitude, SearchLocalSolarEclipse, SiderealTime } from "astronomy-engine";
import { listEclipses, type Eclipse } from "./eclipses.ts";
import { moonRiseSet, moonState, type MoonState, type RiseSet } from "./moon.ts";
import { DARK_SUN_ALTITUDE, altitude, isActive, METEOR_SHOWERS, nextPeak, type MeteorShower } from "./meteors.ts";

export type PlanetKey = "Mercury" | "Venus" | "Mars" | "Jupiter" | "Saturn";
export const PLANETS: readonly PlanetKey[] = ["Mercury", "Venus", "Mars", "Jupiter", "Saturn"];
export const PLANET_LABELS: Record<PlanetKey, string> = { Mercury: "水星", Venus: "金星", Mars: "火星", Jupiter: "木星", Saturn: "土星" };

export interface PlanetSighting {
  planet: PlanetKey;
  /** When it stands highest during the night window. */
  best: number;
  altitude: number;
  azimuth: number;
  magnitude: number;
}

export interface ShowerTonight { shower: MeteorShower; peak: number; radiantMaxAltitude: number }

export interface LocalEclipse {
  eclipse: Eclipse;
  /** Solar: fraction of the Sun hidden here at greatest eclipse. Lunar: null. */
  obscuration: number | null;
  /** Moment it is greatest here (solar), or the global peak (lunar). */
  time: number;
}

export interface Tonight {
  /** The night window: Sun below −6° (planets) from `from` to `to`; null in polar day. */
  night: { from: number; to: number } | null;
  /** Fully dark (Sun below −12°), if it gets that dark. */
  dark: { from: number; to: number } | null;
  moon: MoonState & RiseSet;
  planets: PlanetSighting[];
  showers: ShowerTonight[];
  eclipse: LocalEclipse | null;
}

const MINUTE = 60_000, HOUR = 60 * MINUTE, DAY = 24 * HOUR;
const PLANET_MIN_ALTITUDE = 10;

/** The next (or current) night: from when the Sun sinks below `angle` until it rises above it. */
export function nightWindow(time: number, observer: Observer, angle: number): { from: number; to: number } | null {
  const start = MakeTime(new Date(time));
  const dusk = horizontal(Body.Sun, time, observer).altitude < angle ? start : SearchAltitude(Body.Sun, observer, -1, start, 1, angle);
  if (!dusk) return null;
  const dawn = SearchAltitude(Body.Sun, observer, +1, dusk, 1, angle);
  return { from: dusk.date.getTime(), to: dawn ? dawn.date.getTime() : dusk.date.getTime() + 12 * HOUR };
}

function horizontal(body: Body, time: number, observer: Observer) {
  const t = MakeTime(new Date(time));
  const eq = Equator(body, t, observer, true, true);
  return Horizon(t, observer, eq.ra, eq.dec, "normal");
}

export function planetsTonight(night: { from: number; to: number }, observer: Observer): PlanetSighting[] {
  const sightings: PlanetSighting[] = [];
  for (const planet of PLANETS) {
    let best: PlanetSighting | null = null;
    for (let time = night.from; time <= night.to; time += 20 * MINUTE) {
      const h = horizontal(Body[planet], time, observer);
      if (!best || h.altitude > best.altitude) best = { planet, best: time, altitude: h.altitude, azimuth: h.azimuth, magnitude: 0 };
    }
    if (best && best.altitude >= PLANET_MIN_ALTITUDE) {
      best.magnitude = Illumination(Body[planet], MakeTime(new Date(best.best))).mag;
      sightings.push(best);
    }
  }
  return sightings.sort((a, b) => a.magnitude - b.magnitude);
}

export function showersTonight(dark: { from: number; to: number }, latitude: number, longitude: number): ShowerTonight[] {
  return METEOR_SHOWERS.filter((s) => isActive(s, dark.from) || isActive(s, dark.to)).map((shower) => {
    let max = -90;
    for (let time = dark.from; time <= dark.to; time += 20 * MINUTE) {
      max = Math.max(max, altitude(shower.ra, shower.dec, latitude, longitude, SiderealTime(MakeTime(new Date(time))) * 15));
    }
    return { shower, peak: nextPeak(shower, dark.from - 3 * DAY), radiantMaxAltitude: max };
  }).filter((s) => s.radiantMaxAltitude > 10).sort((a, b) => b.shower.zhr - a.shower.zhr);
}

/** The first eclipse in the next ~13 months that can be seen from here. */
export function nextLocalEclipse(time: number, latitude: number, longitude: number, eclipses: readonly Eclipse[] = listEclipses(time, time + 400 * DAY)): LocalEclipse | null {
  const observer = new Observer(latitude, longitude, 0);
  const solar = SearchLocalSolarEclipse(MakeTime(new Date(time)), observer);
  for (const eclipse of eclipses) {
    if (eclipse.peak < time) continue;
    if (eclipse.type === "lunar") {
      // Visible where the Moon is up at the greatest moment.
      if (horizontal(Body.Moon, eclipse.peak, observer).altitude > 0) return { eclipse, obscuration: null, time: eclipse.peak };
    } else {
      const local = solar.peak.time.date.getTime();
      // The local search returns the next eclipse seen from here; match it to this global one.
      if (Math.abs(local - eclipse.peak) < 6 * HOUR && solar.peak.altitude > 0) return { eclipse, obscuration: solar.obscuration, time: local };
    }
  }
  return null;
}

export function tonight(time: number, latitude: number, longitude: number): Tonight {
  const observer = new Observer(latitude, longitude, 0);
  const night = nightWindow(time, observer, -6);
  const dark = nightWindow(time, observer, DARK_SUN_ALTITUDE);
  return {
    night,
    dark,
    moon: { ...moonState(time), ...moonRiseSet(time, latitude, longitude) },
    planets: night ? planetsTonight(night, observer) : [],
    showers: dark ? showersTonight(dark, latitude, longitude) : [],
    eclipse: nextLocalEclipse(time, latitude, longitude),
  };
}
