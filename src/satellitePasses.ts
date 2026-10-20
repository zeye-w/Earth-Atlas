/**
 * Pass predictions: when the curated satellites rise above an observer's
 * horizon in the next hours, how high they climb, and whether they can be
 * seen with the naked eye (observer in darkness, satellite in sunlight).
 * SGP4 from the same CelesTrak elements as the globe. Cesium-free.
 */
import { elementsValidAt, type OrbitRecord } from "./satelliteOrbits.ts";
import { ecfAt, inSunlight, lookAngles, type Observer } from "./satelliteTelemetry.ts";
import { solarElevation, subsolarPoint } from "./solar.ts";

export type { Observer };

export interface SatellitePass {
  id: string;
  title: string;
  rise: Date;
  peak: Date;
  set: Date;
  /** Degrees above the horizon at the highest point. */
  maxElevation: number;
  riseAzimuth: number;
  setAzimuth: number;
  /** Already above the horizon when the prediction starts. */
  inProgress: boolean;
  /** Naked-eye: sky dark at the observer (Sun below −6°) while the satellite is sunlit. */
  visible: boolean;
}

/** Civil twilight: darker than this, a sunlit satellite stands out. */
const DARK_SKY_SUN_ELEVATION = -6;

interface Sample {
  time: Date;
  elevation: number;
  azimuth: number;
  sunlit: boolean;
}

function sample(record: OrbitRecord, observer: Observer, time: Date): Sample | null {
  const position = ecfAt(record, time);
  if (!position) return null;
  const look = lookAngles(observer, position.ecf);
  return { time, elevation: look.elevation, azimuth: look.azimuth, sunlit: inSunlight(position.ecf, time) };
}

/** Time where elevation crosses zero between two samples (linear). */
function crossing(a: Sample, b: Sample): Date {
  const f = a.elevation / (a.elevation - b.elevation);
  return new Date(a.time.getTime() + f * (b.time.getTime() - a.time.getTime()));
}

/**
 * Passes that end within `hours` of `start` and climb at least
 * `minElevation` degrees, sorted by rise time. Satellites whose elements are
 * too far from the window are skipped rather than predicted inaccurately.
 */
export function predictPasses(records: readonly OrbitRecord[], observer: Observer, start: Date, hours = 24, minElevation = 10, stepSeconds = 30): SatellitePass[] {
  const end = new Date(start.getTime() + hours * 3_600_000);
  const passes: SatellitePass[] = [];
  for (const record of records) {
    if (!elementsValidAt(record, start) || !elementsValidAt(record, end)) continue;
    let previous: Sample | null = null;
    let current: { rise: Sample; riseTime: Date; peak: Sample; visible: boolean; inProgress: boolean } | null = null;
    for (let t = start.getTime(); t <= end.getTime(); t += stepSeconds * 1000) {
      const now = sample(record, observer, new Date(t));
      if (!now) { previous = null; current = null; continue; }
      const sunDown = solarElevation(observer.latitude, observer.longitude, subsolarPoint(now.time)) < DARK_SKY_SUN_ELEVATION;
      if (now.elevation > 0) {
        if (!current) {
          const inProgress = !previous;
          current = { rise: now, riseTime: previous ? crossing(previous, now) : now.time, peak: now, visible: false, inProgress };
        }
        if (now.elevation > current.peak.elevation) current.peak = now;
        if (now.elevation >= minElevation && now.sunlit && sunDown) current.visible = true;
      } else if (current && previous) {
        if (current.peak.elevation >= minElevation) {
          passes.push({
            id: record.choice.id,
            title: record.choice.title,
            rise: current.riseTime,
            peak: current.peak.time,
            set: crossing(previous, now),
            maxElevation: current.peak.elevation,
            riseAzimuth: current.rise.azimuth,
            setAzimuth: now.azimuth,
            inProgress: current.inProgress,
            visible: current.visible,
          });
        }
        current = null;
      }
      previous = now;
    }
  }
  return passes.sort((a, b) => a.rise.getTime() - b.rise.getTime());
}
