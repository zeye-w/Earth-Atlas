/**
 * "Today's highlights": a few things worth looking at right now, picked from
 * the live data the globe already uses (cyclones, launches, earthquakes,
 * geomagnetic activity, volcanoes), with evergreen fallbacks. Pure, so the
 * choice can be tested; the card (panels/HighlightsCard.tsx) words them.
 */
import { stormAt, type HazardSnapshot, type NaturalEvent, type Storm } from "./hazardData.ts";
import type { Launch, LaunchSnapshot } from "./launchData.ts";
import type { Earthquake } from "./earthquakeData.ts";
import type { Eclipse } from "./astronomy/eclipses.ts";
import type { ShowerOutlook } from "./astronomy/meteors.ts";
import type { Flare } from "./solarActivity.ts";
import { LUNAR_DISTANCE_KM, type Asteroid } from "./spaceData.ts";

export type Highlight =
  | { kind: "storm"; id: string; score: number; storm: Storm; windKt: number | null; latitude: number; longitude: number }
  | { kind: "launch"; id: string; score: number; launch: Launch }
  | { kind: "quake"; id: string; score: number; quake: Earthquake }
  | { kind: "aurora"; id: string; score: number; kp: number }
  | { kind: "volcano"; id: string; score: number; event: NaturalEvent }
  | { kind: "terminator"; id: string; score: number }
  | { kind: "iss"; id: string; score: number }
  | { kind: "eclipse"; id: string; score: number; eclipse: Eclipse }
  | { kind: "meteor"; id: string; score: number; outlook: ShowerOutlook }
  | { kind: "flare"; id: string; score: number; flare: Flare }
  | { kind: "asteroid"; id: string; score: number; asteroid: Asteroid };

export interface HighlightInput {
  hazards: HazardSnapshot | null;
  launches: LaunchSnapshot | null;
  quakes: readonly Earthquake[] | null;
  kp: number | null;
  /** Eclipses around now and the meteor shower outlook (computed in the browser). */
  sky?: { eclipses: readonly Eclipse[]; showers: readonly ShowerOutlook[] } | null;
  /** Solar flares of the last days (NOAA GOES). */
  flares?: readonly Flare[] | null;
  /** Near-Earth asteroids' close approaches (NASA JPL). */
  asteroids?: readonly Asteroid[] | null;
  now: number;
}

const HOUR = 3_600_000;
export const MAX_HIGHLIGHTS = 4;
const MIN_HIGHLIGHTS = 3;
/** Earthquakes from this magnitude are news. */
export const QUAKE_MIN_MAGNITUDE = 5.5;
/** Geomagnetic storm (G1) and stronger. */
export const KP_STORM = 5;
/** Flares worth a highlight: M5 and stronger. */
export const BIG_FLARE_FLUX = 5e-5;
/** Showers worth a highlight at their peak (Quadrantids, Eta Aquariids, Perseids, Geminids). */
export const MAJOR_SHOWER_ZHR = 50;
/** Strong typhoon (CMA) and stronger, in knots (41.5 m/s). */
const STRONG_STORM_KT = 80.7;

/** Up to four highlights, most notable first; evergreen ones fill in when the world is quiet. */
export function pickHighlights({ hazards, launches, quakes, kp, sky, flares, asteroids, now }: HighlightInput): Highlight[] {
  const picks: Highlight[] = [];

  // Tropical cyclones under way now: alerts first, then intensity. One, or two if both are red.
  const storms = (hazards?.storms ?? []).flatMap((storm) => {
    const fix = stormAt(storm, now);
    if (!fix || fix.forecast) return [];
    const strong = (fix.windKt ?? 0) >= STRONG_STORM_KT;
    if (storm.alert !== "red" && storm.alert !== "orange" && !strong) return [];
    const score = (storm.alert === "red" ? 100 : storm.alert === "orange" ? 90 : 80) + (fix.windKt ?? 0) / 100;
    return [{ kind: "storm" as const, id: "storm:" + storm.id, score, storm, windKt: fix.windKt, latitude: fix.latitude, longitude: fix.longitude }];
  }).sort((a, b) => b.score - a.score);
  picks.push(...storms.filter((s, i) => i === 0 || s.storm.alert === "red").slice(0, 2));

  // The next launch with a known time: within 48 hours it is news, within a week a filler.
  const next = (launches?.launches ?? [])
    .filter((l) => l.precision === "time" && l.net > now && l.status !== "success" && l.status !== "failure")
    .sort((a, b) => a.net - b.net)[0];
  if (next && next.net - now <= 7 * 24 * HOUR) {
    picks.push({ kind: "launch", id: "launch:" + next.id, score: next.net - now <= 48 * HOUR ? 70 : 30, launch: next });
  }

  // The strongest earthquake of the last day, if it is a notable one.
  const quake = (quakes ?? []).filter((q) => q.magnitude >= QUAKE_MIN_MAGNITUDE && now - q.time.getTime() <= 24 * HOUR && q.time.getTime() <= now)
    .sort((a, b) => b.magnitude - a.magnitude)[0];
  if (quake) picks.push({ kind: "quake", id: "quake:" + quake.id, score: 60 + (quake.magnitude - QUAKE_MIN_MAGNITUDE) * 10, quake });

  if (kp !== null && kp >= KP_STORM) picks.push({ kind: "aurora", id: "aurora", score: 65 + (kp - KP_STORM) * 5, kp });

  // A volcano reported in the last week.
  const volcano = (hazards?.events ?? []).filter((e) => e.category === "volcanoes" && now - e.time <= 7 * 24 * HOUR).sort((a, b) => b.time - a.time)[0];
  if (volcano) picks.push({ kind: "volcano", id: "volcano:" + volcano.id, score: 50, event: volcano });

  // An eclipse in the coming week (or under way); faint penumbral lunar eclipses are left out.
  const eclipse = (sky?.eclipses ?? []).filter((e) => !(e.type === "lunar" && e.kind === "penumbral") && e.peak > now - 3 * HOUR && e.peak - now <= 7 * 24 * HOUR)
    .sort((a, b) => a.peak - b.peak)[0];
  if (eclipse) picks.push({ kind: "eclipse", id: "eclipse:" + eclipse.id, score: eclipse.peak - now <= 48 * HOUR ? 72 : 40, eclipse });

  // A major meteor shower peaking from a day ago to two days ahead.
  const shower = (sky?.showers ?? []).filter((o) => o.shower.zhr >= MAJOR_SHOWER_ZHR && o.peak > now - 24 * HOUR && o.peak - now <= 48 * HOUR)
    .sort((a, b) => b.shower.zhr - a.shower.zhr)[0];
  if (shower) picks.push({ kind: "meteor", id: "meteor:" + shower.shower.code, score: 55 + (shower.moonAtPeak < 0.5 ? 5 : 0), outlook: shower });

  // The strongest big flare of the last day: X class is news, a strong M flare a filler.
  const flare = (flares ?? []).filter((f) => f.peakFlux >= BIG_FLARE_FLUX && f.peak <= now && now - f.peak <= 24 * HOUR)
    .sort((a, b) => b.peakFlux - a.peakFlux)[0];
  if (flare) picks.push({ kind: "flare", id: "flare:" + flare.begin, score: flare.peakFlux >= 1e-4 ? 68 + Math.min(10, flare.peakFlux / 1e-4) : 45, flare });

  // An asteroid passing inside the Moon's distance, from a day ago to three days ahead.
  const rock = (asteroids ?? []).filter((a) => a.distanceKm < LUNAR_DISTANCE_KM && a.approach > now - 24 * HOUR && a.approach - now <= 72 * HOUR)
    .sort((a, b) => a.distanceKm - b.distanceKm)[0];
  if (rock) picks.push({ kind: "asteroid", id: "asteroid:" + rock.id, score: 52 + (1 - rock.distanceKm / LUNAR_DISTANCE_KM) * 20, asteroid: rock });

  picks.sort((a, b) => b.score - a.score);
  const chosen = picks.slice(0, MAX_HIGHLIGHTS);
  for (const filler of [{ kind: "terminator" as const, id: "terminator", score: 10 }, { kind: "iss" as const, id: "iss", score: 9 }]) {
    if (chosen.length >= MIN_HIGHLIGHTS) break;
    chosen.push(filler);
  }
  return chosen;
}
