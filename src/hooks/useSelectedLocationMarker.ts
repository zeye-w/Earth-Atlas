import { useEffect } from "react";
import { Cartesian3, Color, type Viewer } from "cesium";
import type { Coordinates } from "../layers/useGeologyQuery";

/** One selected-point marker, independent from layer visibility and user geolocation. */
export function useSelectedLocationMarker(
  viewer: Viewer | null,
  coordinates: Coordinates | null,
) {
  const latitude = coordinates?.latitude,
    longitude = coordinates?.longitude;
  useEffect(() => {
    if (!viewer || latitude === undefined || longitude === undefined) return;
    const marker = viewer.entities.add({
      id: "selected-location",
      name: "选中地点",
      position: Cartesian3.fromDegrees(longitude, latitude, 1000),
      point: {
        pixelSize: 13,
        color: Color.fromCssColorString("#ffc56d"),
        outlineColor: Color.fromCssColorString("#18232c"),
        outlineWidth: 3,
        disableDepthTestDistance: 0,
      },
    });
    viewer.scene.requestRender();
    return () => {
      if (!viewer.isDestroyed()) {
        viewer.entities.remove(marker);
        viewer.scene.requestRender();
      }
    };
  }, [viewer, latitude, longitude]);
}
