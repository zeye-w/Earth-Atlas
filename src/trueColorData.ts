/**
 * Daily true-colour imagery from NASA GIBS: VIIRS corrected reflectance,
 * one global mosaic per UTC day assembled from the satellite's daytime
 * passes (public domain). https://nasa-gibs.github.io/gibs-api-docs/
 */
export const TRUE_COLOR_LAYER = "VIIRS_NOAA20_CorrectedReflectance_TrueColor";
export const TRUE_COLOR_SOURCE = "NOAA-20 VIIRS";
export const TRUE_COLOR_MAX_LEVEL = 9;

export function trueColorUrl(date: string, layer = TRUE_COLOR_LAYER): string {
  return "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/" + layer + "/default/" + date + "/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg";
}

const DAY_MS = 24 * 60 * 60 * 1000;
/**
 * How long after a UTC day ends its mosaic is complete. GIBS processes each
 * pass within a few hours, so the last passes of a day (over the Pacific,
 * just before midnight UTC) arrive in the small hours: at 01:00 UTC
 * yesterday's tiles there were still empty.
 */
export const TRUE_COLOR_LATENCY_MS = 8 * 60 * 60 * 1000;
const isoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * The UTC day of imagery to show for a moment `at`: that day, or the latest
 * complete mosaic when `at` is later (today's is still filling in, and
 * yesterday's until TRUE_COLOR_LATENCY_MS after midnight UTC).
 */
export function trueColorDate(at: Date, now = new Date()): string {
  const latestComplete = Math.floor((now.getTime() - TRUE_COLOR_LATENCY_MS) / DAY_MS) * DAY_MS - DAY_MS;
  return isoDate(Math.min(at.getTime(), latestComplete));
}
