/**
 * The day imagery (NASA Blue Marble in Web Mercator tiles) stops at about
 * 85.05° north and south, so the bundled Natural Earth texture showed through
 * at each pole as a paler disc. The same Blue Marble from GIBS's
 * geographic-projection WMS covers the poles; it is requested only for the
 * two caps, from slightly inside the Mercator edge so no seam is left.
 */
export const POLAR_CAP_WMS_URL = "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi";
export const POLAR_CAP_LAYER = "BlueMarble_ShadedRelief_Bathymetry";
/** Degrees of latitude where the caps begin (Web Mercator ends at 85.05°). */
export const POLAR_CAP_EDGE = 84.5;
/** About 2.5 km per pixel at the caps: finer than the eye can tell from orbit. */
export const POLAR_CAP_MAX_LEVEL = 6;

/** One GetMap request as Cesium's WMS provider makes it (WMS 1.1.1, lon/lat order), for the health check. */
export function polarCapProbeUrl(west: number, south: number, east: number, north: number): string {
  const query = new URLSearchParams({
    service: "WMS", version: "1.1.1", request: "GetMap", styles: "", format: "image/jpeg",
    srs: "EPSG:4326", layers: POLAR_CAP_LAYER, bbox: [west, south, east, north].join(","), width: "256", height: "256",
  });
  return POLAR_CAP_WMS_URL + "?" + query;
}
