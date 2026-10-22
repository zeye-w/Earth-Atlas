/**
 * When to film: the ISS must be sunlit while the ground under it, inside
 * Europe, is already dark, so take B can lock onto a European flight at night
 * and then pass a sunlit ISS. Returns T0 (virtual start of the film, ms) for
 * the first such moment, searching ahead in 10 s steps.
 */
import { EUROPE, FLIGHT_LOCK, ISS_CLOSEST, ISS_LOCK } from "./story.mjs";
import { sunElevationAt, toGeo } from "./geometry.mjs";

const inBox = ({ lon, lat }, box) => lon >= box.west && lon <= box.east && lat >= box.south && lat <= box.north;

/** Whether a film starting at T0 meets the conditions (relaxed: only the ISS over Europe). */
export function filmable(iss, T0, relaxed = false) {
  const lockTime = T0 + ((FLIGHT_LOCK.start + FLIGHT_LOCK.end) / 2) * 1000;
  const lock = iss.at(lockTime);
  if (!lock) return false;
  const ground = toGeo(lock);
  if (!inBox(ground, EUROPE.box)) return false;
  if (relaxed) return true;
  // Night on the ground under the flight lock (civil twilight over).
  if (sunElevationAt(ground.lon, ground.lat, lockTime) > -6) return false;
  // The ISS lit through the whole close pass.
  for (let s = ISS_LOCK.start; s <= ISS_LOCK.end; s += 0.4) if (!iss.sunlit(T0 + s * 1000)) return false;
  // Europe (the opening shot) in darkness as well.
  return sunElevationAt(EUROPE.lon, EUROPE.lat, T0) < -6;
}

export function findFilmWindow(iss, from, hours = 96, stepMs = 10_000, relaxed = false) {
  for (let t = from; t < from + hours * 3_600_000; t += stepMs) {
    if (filmable(iss, t, relaxed)) {
      // Centre the window: the latest start that still qualifies, minus half.
      let end = t;
      while (end + stepMs < from + hours * 3_600_000 && filmable(iss, end + stepMs, relaxed)) end += stepMs;
      return { T0: Math.round((t + end) / 2), first: t, last: end };
    }
  }
  return null;
}

/** Several upcoming windows, for telling a person when to run the recording. */
export function upcomingWindows(iss, from, count = 6, hours = 96) {
  const found = [];
  let start = from;
  while (found.length < count) {
    const window = findFilmWindow(iss, start, (from + hours * 3_600_000 - start) / 3_600_000);
    if (!window) break;
    found.push(window);
    start = window.last + 3_600_000;
  }
  return found;
}

export const ISS_CLOSEST_SECONDS = ISS_CLOSEST;
