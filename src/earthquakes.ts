import {
  Cartesian3,
  Color,
  DistanceDisplayCondition,
  NearFarScalar,
  PointPrimitiveCollection,
  type Viewer,
} from "cesium";
import { QUAKE_ID_PREFIX, depthColor, magnitudePixelSize, type Earthquake } from "./earthquakeData.ts";

export class EarthquakeOverlay {
  private readonly viewer: Viewer;
  private readonly points = new PointPrimitiveCollection();

  constructor(viewer: Viewer) {
    this.viewer = viewer;
    viewer.scene.primitives.add(this.points);
  }

  setQuakes(quakes: readonly Earthquake[], now = new Date()): void {
    this.points.removeAll();
    const outlineRecent = Color.fromCssColorString("#ffffff").withAlpha(0.9);
    const outlineOld = Color.fromCssColorString("#05070b").withAlpha(0.7);
    for (const quake of quakes) {
      const recent = now.getTime() - quake.time.getTime() < 24 * 60 * 60 * 1000;
      this.points.add({
        id: QUAKE_ID_PREFIX + quake.id,
        position: Cartesian3.fromDegrees(quake.longitude, quake.latitude, 4_000),
        pixelSize: magnitudePixelSize(quake.magnitude),
        color: Color.fromCssColorString(depthColor(quake.depthKm)).withAlpha(0.82),
        outlineColor: recent ? outlineRecent : outlineOld,
        outlineWidth: recent ? 1.5 : 1,
        scaleByDistance: new NearFarScalar(500_000, 1.4, 25_000_000, 0.9),
        distanceDisplayCondition: new DistanceDisplayCondition(0, 65_000_000),
      });
    }
    this.viewer.scene.requestRender();
  }

  setVisible(visible: boolean): void {
    this.points.show = visible;
    if (!this.viewer.isDestroyed()) this.viewer.scene.requestRender();
  }

  dispose(): void {
    if (this.viewer.isDestroyed()) return;
    this.viewer.scene.primitives.remove(this.points);
    this.viewer.scene.requestRender();
  }
}
