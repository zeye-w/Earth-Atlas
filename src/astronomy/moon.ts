/**
 * The Moon for the globe and the cards: where it is overhead, its phase,
 * distance, and when it rises and sets for an observer. astronomy-engine,
 * computed in the browser.
 */
import { Body, Illumination, MakeTime, MoonPhase, Observer, SearchMoonQuarter, SearchRiseSet } from "astronomy-engine";
import { sublunarPoint, type GeoPoint } from "./eclipses.ts";

export type PhaseKey = "new" | "waxingCrescent" | "firstQuarter" | "waxingGibbous" | "full" | "waningGibbous" | "lastQuarter" | "waningCrescent";

export const PHASE_LABELS: Record<PhaseKey, string> = {
  new: "新月", waxingCrescent: "蛾眉月", firstQuarter: "上弦月", waxingGibbous: "盈凸月",
  full: "满月", waningGibbous: "亏凸月", lastQuarter: "下弦月", waningCrescent: "残月",
};

export interface MoonState {
  /** Where the Moon is straight overhead. */
  sublunar: GeoPoint;
  /** Ecliptic longitude difference Moon − Sun, 0–360° (0 new, 90 first quarter, 180 full). */
  phaseAngle: number;
  /** Fraction of the disc lit, 0–1. */
  illuminated: number;
  phase: PhaseKey;
  waxing: boolean;
  /** Centre-to-centre distance, km. */
  distanceKm: number;
  /** Apparent magnitude. */
  magnitude: number;
}

/** Named phase: the four principal phases within ±1 day (12.2°) of their exact moment. */
export function phaseKey(angle: number): PhaseKey {
  const a = ((angle % 360) + 360) % 360;
  const near = (target: number) => Math.abs(((a - target + 540) % 360) - 180) < 6.1;
  if (near(0)) return "new";
  if (near(90)) return "firstQuarter";
  if (near(180)) return "full";
  if (near(270)) return "lastQuarter";
  return a < 90 ? "waxingCrescent" : a < 180 ? "waxingGibbous" : a < 270 ? "waningGibbous" : "waningCrescent";
}

export function moonState(time: number): MoonState {
  const t = MakeTime(new Date(time));
  const phaseAngle = MoonPhase(t);
  const illumination = Illumination(Body.Moon, t);
  return {
    sublunar: sublunarPoint(time),
    phaseAngle,
    illuminated: illumination.phase_fraction,
    phase: phaseKey(phaseAngle),
    waxing: phaseAngle < 180,
    distanceKm: illumination.geo_dist * 149_597_870.7,
    magnitude: illumination.mag,
  };
}

export interface QuarterEvent { quarter: 0 | 1 | 2 | 3; time: number }

/** The next `count` principal phases (0 new, 1 first quarter, 2 full, 3 last quarter) after `time`. */
export function nextQuarters(time: number, count = 4): QuarterEvent[] {
  const out: QuarterEvent[] = [];
  let q = SearchMoonQuarter(MakeTime(new Date(time)));
  while (out.length < count) {
    out.push({ quarter: q.quarter as 0 | 1 | 2 | 3, time: q.time.date.getTime() });
    q = SearchMoonQuarter(q.time.AddDays(1));
  }
  return out;
}

export interface RiseSet { rise: number | null; set: number | null }

/** The Moon's next rise and set within a day of `time` for an observer (null when it does not happen). */
export function moonRiseSet(time: number, latitude: number, longitude: number): RiseSet {
  const observer = new Observer(latitude, longitude, 0);
  const start = MakeTime(new Date(time));
  const rise = SearchRiseSet(Body.Moon, observer, +1, start, 1);
  const set = SearchRiseSet(Body.Moon, observer, -1, start, 1);
  return { rise: rise ? rise.date.getTime() : null, set: set ? set.date.getTime() : null };
}

/** Perigee is about 356,500 km: a full Moon closer than 360,000 km is popularly a "supermoon". */
export const SUPERMOON_KM = 360_000;
