/**
 * When and where to film: the station must be sunlit while the ground under it,
 * inside a region with dense air traffic, is already dark, so take B can lock
 * onto a flight at night and then pass a sunlit station; the aurora take must be
 * on the night side too. Returns T0 (virtual start of the film, ms) and the
 * region anchor for the first such moment, searching ahead in 10 s steps.
 */
import { FLIGHT_LOCK, STATION_CLOSEST, STATION_LOCK, REGIONS, auroraKeys } from "./story.mjs";
import { sunElevationAt, toGeo } from "./geometry.mjs";

const inBox = ({ lon, lat }, box) => lon >= box.west && lon <= box.east && lat >= box.south && lat <= box.north;

/**
 * The region anchor if a film starting at T0 meets the conditions, else null
 * (relaxed: only the station over a region, for previews).
 */
export function filmable(station, T0, relaxed = false, regionId = "") {
  const lockTime = T0 + ((FLIGHT_LOCK.start + FLIGHT_LOCK.end) / 2) * 1000;
  const lock = station.at(lockTime);
  if (!lock) return null;
  const ground = toGeo(lock);
  const area = REGIONS.find((r) => (!regionId || r.id === regionId) && inBox(ground, { west: r.west, east: r.east, south: r.south, north: r.north }));
  if (!area) return null;
  const region = { id: area.id, name: area.name, lon: Number(ground.lon.toFixed(3)), lat: Number(ground.lat.toFixed(3)) };
  if (relaxed) return region;
  // Night on the ground under the flight lock (civil twilight over), and
  // under the opening shot, which looks across the same place.
  if (sunElevationAt(ground.lon, ground.lat, lockTime) > -6) return null;
  if (sunElevationAt(ground.lon, ground.lat, T0) > -6) return null;
  // The station lit through the whole close pass.
  for (let s = STATION_LOCK.start; s <= STATION_LOCK.end; s += 0.4) if (!station.sunlit(T0 + s * 1000)) return null;
  // The aurora take looks at the night side.
  for (const key of auroraKeys({ region }).slice(0, 2)) {
    const g = toGeo(key.look);
    if (sunElevationAt(g.lon, g.lat, T0 + key.t * 1000) > -8) return null;
  }
  return region;
}

export function findFilmWindow(station, from, hours = 96, stepMs = 10_000, relaxed = false, regionId = "") {
  for (let t = from; t < from + hours * 3_600_000; t += stepMs) {
    const region = filmable(station, t, relaxed, regionId);
    if (region) {
      // Centre the window: the latest start that still qualifies, minus half.
      let end = t;
      while (end + stepMs < from + hours * 3_600_000 && filmable(station, end + stepMs, relaxed, regionId)?.id === region.id) end += stepMs;
      const T0 = Math.round((t + end) / 2);
      return { T0, first: t, last: end, region: filmable(station, T0, relaxed, regionId) ?? region };
    }
  }
  return null;
}

/** Several upcoming windows, for telling a person when to run the recording. */
export function upcomingWindows(station, from, count = 6, hours = 96, regionId = "") {
  const found = [];
  let start = from;
  while (found.length < count) {
    const window = findFilmWindow(station, start, (from + hours * 3_600_000 - start) / 3_600_000, 10_000, false, regionId);
    if (!window) break;
    found.push(window);
    start = window.last + 20 * 60_000;
  }
  return found;
}

export const STATION_CLOSEST_SECONDS = STATION_CLOSEST;
