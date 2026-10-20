import {
  Cartesian3,
  type PointPrimitive,
  Color,
  DistanceDisplayCondition,
  NearFarScalar,
  PointPrimitiveCollection,
  type Viewer,
} from "cesium";
import { QUAKE_ID_PREFIX, depthColor, magnitudePixelSize, type Earthquake } from "./earthquakeData.ts";

const RECENT_MS = 24 * 60 * 60 * 1000;
const OUTLINE_RECENT = Color.fromCssColorString("#ffffff").withAlpha(0.9);
const OUTLINE_OLD = Color.fromCssColorString("#05070b").withAlpha(0.7);

export class EarthquakeOverlay {
  private readonly viewer: Viewer;
  private readonly points = new PointPrimitiveCollection();
  private entries: { point: PointPrimitive; time: number }[] = [];
  private time = Date.now();

  constructor(viewer: Viewer) {
    this.viewer = viewer;
    viewer.scene.primitives.add(this.points);
  }

  setQuakes(quakes: readonly Earthquake[]): void {
    this.points.removeAll();
    this.entries = [];
    for (const quake of quakes) {
      const point = this.points.add({
        id: QUAKE_ID_PREFIX + quake.id,
        position: Cartesian3.fromDegrees(quake.longitude, quake.latitude, 4_000),
        pixelSize: magnitudePixelSize(quake.magnitude),
        color: Color.fromCssColorString(depthColor(quake.depthKm)).withAlpha(0.82),
        scaleByDistance: new NearFarScalar(500_000, 1.4, 25_000_000, 0.9),
        distanceDisplayCondition: new DistanceDisplayCondition(0, 65_000_000),
      });
      this.entries.push({ point, time: quake.time.getTime() });
    }
    this.setTime(this.time);
  }

  /**
   * Shows the events that had happened by `time` (the timeline moment);
   * those in the 24 hours before it get a white outline.
   */
  setTime(time: number): void {
    this.time = time;
    for (const { point, time: quakeTime } of this.entries) {
      const age = time - quakeTime;
      point.show = age >= 0;
      const recent = age >= 0 && age < RECENT_MS;
      point.outlineColor = recent ? OUTLINE_RECENT : OUTLINE_OLD;
      point.outlineWidth = recent ? 1.5 : 1;
    }
    if (!this.viewer.isDestroyed()) this.viewer.scene.requestRender();
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
