/**
 * The day imagery (NASA Blue Marble in Web Mercator tiles) stops at about
 * 85.05° north and south, so the bundled Natural Earth texture showed through
 * at each pole as a paler disc. The same Blue Marble in GIBS's geographic
 * (EPSG:4326) projection covers the poles; it is requested only for the two
 * caps, from slightly inside the Mercator edge so no seam is left.
 *
 * The caps come from GIBS's WMTS tiles rather than its WMS: in November 2026
 * the EPSG:4326 WMS answered about four requests in ten with a MapServer
 * error page ("Symbol definition error") instead of an image, while the
 * pre-rendered WMTS tiles of the same layer were unaffected.
 */
export const POLAR_CAP_LAYER = "BlueMarble_ShadedRelief_Bathymetry";
export const POLAR_CAP_TILE_URL =
  `https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/${POLAR_CAP_LAYER}/default/500m/{TileMatrix}/{TileRow}/{TileCol}.jpeg`;
/** Degrees of latitude where the caps begin (Web Mercator ends at 85.05°). */
export const POLAR_CAP_EDGE = 84.5;

/**
 * GIBS's EPSG:4326 "500m" matrix set has 512 px tiles whose size halves at
 * each level, but levels 0-2 (2×1, 3×2 and 5×3 tiles of 288°, 144° and 72°)
 * are padded past the globe. From level 3 (10×5 tiles of 36°) every level is
 * an exact grid from 180°W, 90°N, so the caps use a geographic tiling scheme
 * with 10×5 level-zero tiles whose level n is GIBS's matrix n + 3.
 */
export const POLAR_CAP_TILE_SIZE = 512;
export const POLAR_CAP_LEVEL_ZERO_TILES = { x: 10, y: 5 } as const;
export const POLAR_CAP_MATRIX_OFFSET = 3;
/** GIBS matrix 6 (80×40 tiles, about 1 km a pixel): finer than the eye can tell from orbit. */
export const POLAR_CAP_MAX_MATRIX = 6;
/** The deepest matrix GIBS publishes in the 500m set (160×80 tiles). */
export const GIBS_500M_MAX_MATRIX = 7;

/** GIBS matrix identifiers for the scheme's levels 0, 1, … */
export function polarCapTileMatrixLabels(): string[] {
  const labels: string[] = [];
  for (let matrix = POLAR_CAP_MATRIX_OFFSET; matrix <= POLAR_CAP_MAX_MATRIX; matrix++) labels.push(String(matrix));
  return labels;
}

/** The tile URL for one GIBS matrix, row and column (rows count down from 90°N), for the health check. */
export function polarCapTileUrl(matrix: number, row: number, col: number): string {
  return POLAR_CAP_TILE_URL.replace("{TileMatrix}", String(matrix)).replace("{TileRow}", String(row)).replace("{TileCol}", String(col));
}

/** Latitude/longitude bounds of a GIBS tile, in degrees. */
export function polarCapTileBounds(matrix: number, row: number, col: number) {
  const size = 36 / 2 ** (matrix - POLAR_CAP_MATRIX_OFFSET);
  return { west: -180 + col * size, east: -180 + (col + 1) * size, north: 90 - row * size, south: 90 - (row + 1) * size };
}
