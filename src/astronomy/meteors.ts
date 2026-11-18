/**
 * The major annual meteor showers. Peak times are fixed by the Sun's
 * ecliptic longitude, so each year's peak is found with astronomy-engine.
 * Values from the International Meteor Organization's working list
 * (zenithal hourly rate under ideal skies; real counts are lower, more so
 * with moonlight or a low radiant). The radiant is its position at the peak;
 * it drifts about a degree a day, which is ignored here.
 */
import { Body, Illumination, MakeTime, SearchSunLongitude, SiderealTime } from "astronomy-engine";
import { subsolarPoint } from "../solar.ts";

export interface MeteorShower {
  code: string;
  name: string;
  /** Solar longitude of the peak, degrees (J2000). */
  peakLongitude: number;
  /** Activity from…to as month-day pairs (may wrap the year end). */
  active: [[number, number], [number, number]];
  zhr: number;
  /** Radiant at the peak, degrees. */
  ra: number;
  dec: number;
  /** Entry speed, km/s. */
  speed: number;
}

export const METEOR_SHOWERS: readonly MeteorShower[] = [
  { code: "QUA", name: "象限仪座流星雨", peakLongitude: 283.15, active: [[12, 28], [1, 12]], zhr: 80, ra: 230, dec: 49, speed: 41 },
  { code: "LYR", name: "天琴座流星雨", peakLongitude: 32.32, active: [[4, 14], [4, 30]], zhr: 18, ra: 271, dec: 34, speed: 49 },
  { code: "ETA", name: "宝瓶座η流星雨", peakLongitude: 45.5, active: [[4, 19], [5, 28]], zhr: 50, ra: 338, dec: -1, speed: 66 },
  { code: "SDA", name: "宝瓶座南δ流星雨", peakLongitude: 127, active: [[7, 12], [8, 23]], zhr: 25, ra: 340, dec: -16, speed: 41 },
  { code: "PER", name: "英仙座流星雨", peakLongitude: 140.0, active: [[7, 17], [8, 24]], zhr: 100, ra: 48, dec: 58, speed: 59 },
  { code: "DRA", name: "天龙座流星雨", peakLongitude: 195.4, active: [[10, 6], [10, 10]], zhr: 10, ra: 262, dec: 54, speed: 21 },
  { code: "ORI", name: "猎户座流星雨", peakLongitude: 208, active: [[10, 2], [11, 7]], zhr: 20, ra: 95, dec: 16, speed: 66 },
  { code: "LEO", name: "狮子座流星雨", peakLongitude: 235.27, active: [[11, 6], [11, 30]], zhr: 15, ra: 152, dec: 22, speed: 71 },
  { code: "GEM", name: "双子座流星雨", peakLongitude: 262.2, active: [[12, 4], [12, 20]], zhr: 150, ra: 112, dec: 33, speed: 35 },
  { code: "URS", name: "小熊座流星雨", peakLongitude: 270.7, active: [[12, 17], [12, 26]], zhr: 10, ra: 217, dec: 76, speed: 33 },
];

const DAY = 86_400_000;

/**
 * The first peak of a shower after `time`. The listed longitudes are J2000;
 * astronomy-engine searches the longitude of date, which precession moves by
 * 1.397° a century. Searched in two half-year windows: a single search over
 * more than a year can skip the nearest crossing.
 */
export function nextPeak(shower: MeteorShower, time: number): number {
  const centuries = (time - Date.UTC(2000, 0, 1, 12)) / (36_525 * DAY);
  const longitude = (shower.peakLongitude + 1.3969713 * centuries) % 360;
  const first = SearchSunLongitude(longitude, MakeTime(new Date(time)), 200);
  if (first) return first.date.getTime();
  return SearchSunLongitude(longitude, MakeTime(new Date(time + 190 * DAY)), 200)!.date.getTime();
}

/** Whether `time` (UTC date) falls in the shower's activity period. */
export function isActive(shower: MeteorShower, time: number): boolean {
  const d = new Date(time);
  const day = (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
  const [[m1, d1], [m2, d2]] = shower.active;
  const from = m1 * 100 + d1, to = m2 * 100 + d2;
  return from <= to ? day >= from && day <= to : day >= from || day <= to;
}

export interface ShowerOutlook {
  shower: MeteorShower;
  /** The coming (or, while active, the current season's) peak. */
  peak: number;
  active: boolean;
  /** Moonlight at the peak: fraction of the Moon lit. */
  moonAtPeak: number;
}

/** Every shower with its next peak (a peak up to two days ago still counts while active), soonest first. */
export function showerOutlook(time: number): ShowerOutlook[] {
  return METEOR_SHOWERS.map((shower) => {
    const active = isActive(shower, time);
    const peak = nextPeak(shower, active ? time - 2 * DAY : time);
    return { shower, peak, active, moonAtPeak: Illumination(Body.Moon, MakeTime(new Date(peak))).phase_fraction };
  }).sort((a, b) => a.peak - b.peak);
}

const RAD = Math.PI / 180;

/** Altitude of a fixed sky position (degrees) seen from a place, given Greenwich sidereal time in degrees. */
export function altitude(ra: number, dec: number, latitude: number, longitude: number, siderealDegrees: number): number {
  const hourAngle = (siderealDegrees + longitude - ra) * RAD;
  const sinAlt = Math.sin(latitude * RAD) * Math.sin(dec * RAD) + Math.cos(latitude * RAD) * Math.cos(dec * RAD) * Math.cos(hourAngle);
  return Math.asin(Math.max(-1, Math.min(1, sinAlt))) / RAD;
}

/** Sun more than 12° below the horizon: dark enough for meteors. */
export const DARK_SUN_ALTITUDE = -12;

export interface VisibilityGrid { width: number; height: number; values: Float32Array }

/**
 * Where the shower can be seen now: sin(radiant altitude), faded in through
 * twilight (Sun from −6° to −12°) — roughly proportional to the meteors an
 * observer would count. Row 0 at 90°N, column 0 at 180°W.
 */
export function visibilityGrid(shower: MeteorShower, time: number, width = 180, height = 90): VisibilityGrid {
  const sidereal = SiderealTime(MakeTime(new Date(time))) * 15;
  const sun = subsolarPoint(new Date(time));
  const values = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    const latitude = 90 - (y + 0.5) * (180 / height);
    for (let x = 0; x < width; x++) {
      const longitude = -180 + (x + 0.5) * (360 / width);
      // The Sun's altitude from the subsolar point (its declination and the longitude difference).
      const sunAlt = altitude(0, sun.latitude, latitude, longitude - sun.longitude, 0);
      if (sunAlt > -6) continue;
      const radiant = altitude(shower.ra, shower.dec, latitude, longitude, sidereal);
      const darkness = Math.min(1, (-6 - sunAlt) / (-6 - DARK_SUN_ALTITUDE));
      if (radiant > 0) values[y * width + x] = Math.sin(radiant * RAD) * darkness;
    }
  }
  return { width, height, values };
}
