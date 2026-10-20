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
const isoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * The UTC day of imagery to show for a moment `at`. Today's mosaic is still
 * filling in (and the future has none), so anything from today on shows
 * yesterday's complete mosaic.
 */
export function trueColorDate(at: Date, now = new Date()): string {
  const today = Math.floor(now.getTime() / DAY_MS) * DAY_MS;
  return isoDate(Math.min(at.getTime(), today - DAY_MS));
}
