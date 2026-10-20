// SSEC multi-satellite hourly infrared composite. This is imagery, not a cloud mask.
// RealEarth keeps about 30 days of hourly frames (verified by the live smoke
// test), so the timeline can show the frame for any moment it reaches.
export const CLOUD_METADATA_URL = "https://realearth.ssec.wisc.edu/api/products?products=globalir&timespan=-30d";
export const CLOUD_REFRESH_MS = 15 * 60_000;
export const CLOUD_MAX_AGE_MS = 6 * 60 * 60_000;
/** A timeline moment uses the latest frame at most this much older than it. */
export const CLOUD_FRAME_TOLERANCE_MS = 2 * 60 * 60_000;

/** Valid, non-future observation times in the catalog, oldest first. */
export function cloudTimes(payload: unknown, now = Date.now()): Date[] {
  if (!Array.isArray(payload)) throw new Error("Invalid cloud catalog");
  const product = payload.find((item) => item?.id === "globalir");
  const dates: Date[] = (Array.isArray(product?.times) ? product.times : []).flatMap((time: unknown) => {
    if (typeof time !== "string" || !/^\d{8}\.\d{6}$/.test(time)) return [];
    const iso = `${time.slice(0,4)}-${time.slice(4,6)}-${time.slice(6,8)}T${time.slice(9,11)}:${time.slice(11,13)}:${time.slice(13,15)}Z`;
    const date = new Date(iso);
    return Number.isFinite(date.getTime()) && date.toISOString().replace(/[-:TZ]/g, "").slice(0,14) === time.replace(".", "") && date.getTime() <= now ? [date] : [];
  });
  return dates.sort((a, b) => a.getTime() - b.getTime());
}

export function latestCloudObservation(payload: unknown, now = Date.now()): Date {
  const latest = cloudTimes(payload, now).at(-1);
  if (!latest || now - latest.getTime() > CLOUD_MAX_AGE_MS) throw new Error("No recent cloud observation");
  return latest;
}

/**
 * The frame to show at `time`: the latest observation not after it, if one
 * exists within the tolerance (none for gaps, before the archive or in the future).
 */
export function cloudFrameAt(times: readonly Date[], time: number): Date | null {
  let lo = 0;
  let hi = times.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid].getTime() <= time) { found = mid; lo = mid + 1; } else hi = mid - 1;
  }
  if (found < 0 || time - times[found].getTime() > CLOUD_FRAME_TOLERANCE_MS) return null;
  return times[found];
}

export function cloudTileUrl(date: Date): string {
  const stamp = date.toISOString().slice(0,19).replace(/[-:]/g, "").replace("T", "_");
  return `https://realearth.ssec.wisc.edu/api/image?products=globalir_${stamp}&x={x}&y={y}&z={z}`;
}

/** All recent frames; fails when the newest is older than CLOUD_MAX_AGE_MS. */
export async function fetchCloudCatalog(signal: AbortSignal): Promise<Date[]> {
  const response = await fetch(CLOUD_METADATA_URL, { signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]) });
  if (!response.ok) throw new Error(`Cloud catalog HTTP ${response.status}`);
  const payload: unknown = await response.json();
  latestCloudObservation(payload);
  return cloudTimes(payload);
}
