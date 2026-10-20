/**
 * Terrascope home composition, using a simple perspective-sphere estimate.
 *
 * Both desktop and phone look toward the SAME WGS84 geolocation. Mobile
 * portrait uses a wider camera distance only because Cesium's horizontal FOV
 * becomes much narrower than desktop on a tall aspect ratio.
 *
 * Never apply this formula to shared-scene camera states or during a manual
 * user fly-to. It is only for the ordinary home view and Reset View.
 */
export const HOME_LONGITUDE = 58;
export const HOME_LATITUDE = 19;
export const DESKTOP_HOME_HEIGHT_METRES = 17_000_000;
export const EARTH_RADIUS_METRES = 6_378_137;

// Cesium PerspectiveFrustum defaults to a ~60 degree FOV. Its documented
// fov is horizontal on landscape canvases, vertical on portrait canvases.
const CESIUM_HALF_FOV_RAD = Math.PI / 6;

/**
 * A narrow viewport needs more altitude to keep the entire sphere visible.
 * Portrait: target a diameter of ~60% of viewport width, preserving space for
 * the default-open bottom control sheet. Short landscape: ~68% of height.
 * Regular desktop retains its existing 17,000km view without repositioning.
 */
export function homeViewHeight(width: number, height: number): number {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return DESKTOP_HOME_HEIGHT_METRES;
  }
  const portraitPhone = width <= 760 && height > width;
  const shortLandscape = height <= 550 && width > height;
  if (!portraitPhone && !shortLandscape) return DESKTOP_HOME_HEIGHT_METRES;
  const fraction = portraitPhone ? 0.60 : 0.68;
  const minorOverMajor = Math.min(width, height) / Math.max(width, height);
  const minorHalfFov = Math.atan(Math.tan(CESIUM_HALF_FOV_RAD) * minorOverMajor);
  const targetHalfAngle = Math.atan(Math.tan(minorHalfFov) * fraction);
  const theoreticalHeight = EARTH_RADIUS_METRES / Math.sin(targetHalfAngle) - EARTH_RADIUS_METRES;
  return Math.min(45_000_000, Math.max(DESKTOP_HOME_HEIGHT_METRES, theoreticalHeight));
}
