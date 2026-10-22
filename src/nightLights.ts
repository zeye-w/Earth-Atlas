import { Math as CesiumMath, UrlTemplateImageryProvider, type ImageryTypes, type Request } from "cesium";
import { rectangleFullyDaylit, subsolarPoint } from "./solar";
import { extractLights } from "./nightLightsColor";

// Tiles whose whole area has the Sun at least this high are invisible on a
// night-only layer (dayAlpha = 0), so they are not downloaded at all.
export const DAYLIT_MARGIN_DEG = 12;
// The Sun moves 15°/h; rebuilding the layer every 24 min (6°) keeps every
// skipped tile at least 6° inside daylight before it can be needed.
export const NIGHT_LIGHTS_REFRESH_MS = 24 * 60 * 1000;
// Level 0–1 tiles span more than 90° and are few; always fetch them.
const MIN_SKIP_LEVEL = 2;

// Soft halo drawn under the sharp lights so cities read as glowing.
const GLOW_BLUR_PX = 1.2;
const GLOW_OPACITY = 0.28;

let blankTile: HTMLCanvasElement | null = null;
function transparentTile(): HTMLCanvasElement {
  if (!blankTile) {
    blankTile = document.createElement("canvas");
    blankTile.width = 1;
    blankTile.height = 1;
  }
  return blankTile;
}

/** Lights-only tile with a soft glow, from a Black Marble tile. */
function lightsCanvas(image: ImageryTypes): HTMLCanvasElement {
  const width = image.width;
  const height = image.height;
  const lights = document.createElement("canvas");
  lights.width = width;
  lights.height = height;
  const lightsContext = lights.getContext("2d", { willReadFrequently: true })!;
  lightsContext.drawImage(image as CanvasImageSource, 0, 0);
  const pixels = lightsContext.getImageData(0, 0, width, height);
  extractLights(pixels.data);
  lightsContext.putImageData(pixels, 0, 0);

  const out = document.createElement("canvas");
  out.width = width;
  out.height = height;
  const context = out.getContext("2d")!;
  context.filter = "blur(" + GLOW_BLUR_PX + "px)";
  context.globalAlpha = GLOW_OPACITY;
  context.drawImage(lights, 0, 0);
  context.filter = "none";
  context.globalAlpha = 1;
  context.drawImage(lights, 0, 0);
  return out;
}

// Cesium decodes imagery into ImageBitmaps that are already flipped for
// WebGL and uploads them as-is, while canvases get flipped on upload. Hand
// back the same kind of image so the tile keeps its orientation.
function lightsTile(image: ImageryTypes): ImageryTypes | Promise<ImageryTypes> {
  const canvas = lightsCanvas(image);
  return typeof ImageBitmap !== "undefined" && image instanceof ImageBitmap ? createImageBitmap(canvas) : canvas;
}

/**
 * Black Marble provider that skips tiles lying entirely in daylight and
 * keeps only the city lights (with a glow) from the tiles it does load.
 */
export class NightLightsImageryProvider extends UrlTemplateImageryProvider {
  skippedTiles = 0;
  /** Off while the timeline shows another moment: "daylit now" would be wrong then. */
  skipDaylit = true;

  override requestImage(x: number, y: number, level: number, request?: Request): Promise<ImageryTypes> | undefined {
    if (this.skipDaylit && level >= MIN_SKIP_LEVEL) {
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
    return super.requestImage(x, y, level, request)?.then(lightsTile);
  }
}
