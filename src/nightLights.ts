import { Math as CesiumMath, UrlTemplateImageryProvider, type ImageryTypes, type Request } from "cesium";
import { rectangleFullyDaylit, subsolarPoint } from "./solar";

// Tiles whose whole area has the Sun at least this high are invisible on a
// night-only layer (dayAlpha = 0), so they are not downloaded at all.
export const DAYLIT_MARGIN_DEG = 12;
// The Sun moves 15°/h; rebuilding the layer every 24 min (6°) keeps every
// skipped tile at least 6° inside daylight before it can be needed.
export const NIGHT_LIGHTS_REFRESH_MS = 24 * 60 * 1000;
// Level 0–1 tiles span more than 90° and are few; always fetch them.
const MIN_SKIP_LEVEL = 2;

let blankTile: HTMLCanvasElement | null = null;
function transparentTile(): HTMLCanvasElement {
  if (!blankTile) {
    blankTile = document.createElement("canvas");
    blankTile.width = 1;
    blankTile.height = 1;
  }
  return blankTile;
}

/** Black Marble provider that skips tiles lying entirely in daylight. */
export class NightLightsImageryProvider extends UrlTemplateImageryProvider {
  skippedTiles = 0;

  override requestImage(x: number, y: number, level: number, request?: Request): Promise<ImageryTypes> | undefined {
    if (level >= MIN_SKIP_LEVEL) {
      const rect = this.tilingScheme.tileXYToRectangle(x, y, level);
      const degrees = {
        west: CesiumMath.toDegrees(rect.west), south: CesiumMath.toDegrees(rect.south),
        east: CesiumMath.toDegrees(rect.east), north: CesiumMath.toDegrees(rect.north),
      };
      if (rectangleFullyDaylit(degrees, subsolarPoint(new Date()), DAYLIT_MARGIN_DEG)) {
        this.skippedTiles++;
        return Promise.resolve(transparentTile());
      }
    }
    return super.requestImage(x, y, level, request);
  }
}
