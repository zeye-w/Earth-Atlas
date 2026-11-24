import { GeographicTilingScheme, ImageryLayer, Rectangle, WebMapTileServiceImageryProvider } from "cesium";
import {
  POLAR_CAP_EDGE, POLAR_CAP_LAYER, POLAR_CAP_LEVEL_ZERO_TILES, POLAR_CAP_MATRIX_OFFSET, POLAR_CAP_MAX_MATRIX,
  POLAR_CAP_TILE_SIZE, POLAR_CAP_TILE_URL, polarCapTileMatrixLabels,
} from "./polarCapData";

/** Blue Marble for the two polar caps, which the Mercator day tiles miss (see polarCapData.ts). */
export function createPolarCapLayers(): ImageryLayer[] {
  return [
    Rectangle.fromDegrees(-180, POLAR_CAP_EDGE, 180, 90),
    Rectangle.fromDegrees(-180, -90, 180, -POLAR_CAP_EDGE),
  ].map((rectangle) => new ImageryLayer(new WebMapTileServiceImageryProvider({
    url: POLAR_CAP_TILE_URL,
    layer: POLAR_CAP_LAYER,
    style: "default",
    format: "image/jpeg",
    tileMatrixSetID: "500m",
    tileMatrixLabels: polarCapTileMatrixLabels(),
    tilingScheme: new GeographicTilingScheme({
      numberOfLevelZeroTilesX: POLAR_CAP_LEVEL_ZERO_TILES.x,
      numberOfLevelZeroTilesY: POLAR_CAP_LEVEL_ZERO_TILES.y,
    }),
    tileWidth: POLAR_CAP_TILE_SIZE,
    tileHeight: POLAR_CAP_TILE_SIZE,
    maximumLevel: POLAR_CAP_MAX_MATRIX - POLAR_CAP_MATRIX_OFFSET,
    rectangle,
  }), { rectangle }));
}
