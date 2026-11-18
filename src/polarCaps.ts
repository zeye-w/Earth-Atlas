import { ImageryLayer, Rectangle, WebMapServiceImageryProvider } from "cesium";
import { POLAR_CAP_EDGE, POLAR_CAP_LAYER, POLAR_CAP_MAX_LEVEL, POLAR_CAP_WMS_URL } from "./polarCapData";

/** Blue Marble for the two polar caps, which the Mercator day tiles miss (see polarCapData.ts). */
export function createPolarCapLayers(): ImageryLayer[] {
  return [
    Rectangle.fromDegrees(-180, POLAR_CAP_EDGE, 180, 90),
    Rectangle.fromDegrees(-180, -90, 180, -POLAR_CAP_EDGE),
  ].map((rectangle) => new ImageryLayer(new WebMapServiceImageryProvider({
    url: POLAR_CAP_WMS_URL,
    layers: POLAR_CAP_LAYER,
    parameters: { format: "image/jpeg", transparent: false },
    rectangle,
    maximumLevel: POLAR_CAP_MAX_LEVEL,
  }), { rectangle }));
}
