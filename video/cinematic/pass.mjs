/**
 * When and where to film: the ISS must be sunlit while the ground under it,
 * inside a region with dense air traffic, is already dark, so take B can lock
 * onto a flight at night and then pass a sunlit ISS; the aurora take must be
 * on the night side too. Returns T0 (virtual start of the film, ms) and the
 * region anchor for the first such moment, searching ahead in 10 s steps.
 */
import { FLIGHT_LOCK, ISS_CLOSEST, ISS_LOCK, REGIONS, auroraKeys } from "./story.mjs";
import { sunElevationAt, toGeo } from "./geometry.mjs";

const inBox = ({ lon, lat }, box) => lon >= box.west && lon <= box.east && lat >= box.south && lat <= box.north;

/**
 * The region anchor if a film starting at T0 meets the conditions, else null
 * (relaxed: only the ISS over a region, for previews).
 */
export function filmable(iss, T0, relaxed = false) {
  const lockTime = T0 + ((FLIGHT_LOCK.start + FLIGHT_LOCK.end) / 2) * 1000;
  const lock = iss.at(lockTime);
  if (!lock) return null;
  const ground = toGeo(lock);
  const area = REGIONS.find((r) => inBox(ground, { west: r.west, east: r.east, south: r.south, north: r.north }));
  if (!area) return null;
  const region = { id: area.id, name: area.name, lon: Number(ground.lon.toFixed(3)), lat: Number(ground.lat.toFixed(3)) };
  if (relaxed) return region;
  // Night on the ground under the flight lock (civil twilight over), and
  // under the opening shot, which looks across the same place.
  if (sunElevationAt(ground.lon, ground.lat, lockTime) > -6) return null;
  if (sunElevationAt(ground.lon, ground.lat, T0) > -6) return null;
  // The ISS lit through the whole close pass.
  for (let s = ISS_LOCK.start; s <= ISS_LOCK.end; s += 0.4) if (!iss.sunlit(T0 + s * 1000)) return null;
  // The aurora take looks at the night side.
  for (const key of auroraKeys({ region }).slice(0, 2)) {
    const g = toGeo(key.look);
    if (sunElevationAt(g.lon, g.lat, T0 + key.t * 1000) > -8) return null;
  }
  return region;
}

export function findFilmWindow(iss, from, hours = 96, stepMs = 10_000, relaxed = false) {
  for (let t = from; t < from + hours * 3_600_000; t += stepMs) {
    const region = filmable(iss, t, relaxed);
    if (region) {
      // Centre the window: the latest start that still qualifies, minus half.
      let end = t;
      while (end + stepMs < from + hours * 3_600_000 && filmable(iss, end + stepMs, relaxed)?.id === region.id) end += stepMs;
      const T0 = Math.round((t + end) / 2);
      return { T0, first: t, last: end, region: filmable(iss, T0, relaxed) ?? region };
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
    start = window.last + 20 * 60_000;
  }
  return found;
}

export const ISS_CLOSEST_SECONDS = ISS_CLOSEST;
