import {
  ArcType,
  Cartesian2,
  Cartesian3,
  Color,
  ConstantPositionProperty,
  DistanceDisplayCondition,
  HorizontalOrigin,
  LabelStyle,
  NearFarScalar,
  type Entity,
  type Viewer,
} from "cesium";
import { orbitPath, positionAt, type OrbitRecord, type OrbitalPosition } from "./satelliteOrbits";

export const SATELLITE_UPDATE_MS = 5_000; // Positions every 5 s; not each WebGL frame.
export const SATELLITE_PATH_UPDATE_MS = 120_000; // Ground-fixed forecast path recomputed rarely.
export const SATELLITE_MAX_DISPLAY = 6;

function toCartesian(pos: OrbitalPosition): Cartesian3 {
  return Cartesian3.fromRadians(pos.longitudeRad, pos.latitudeRad, pos.altitudeKm * 1000);
}

interface MarkerPair {
  record: OrbitRecord;
  marker: Entity;
  path: Entity;
}
export class SatelliteOverlay {
  private readonly viewer: Viewer;
  private readonly pairs: MarkerPair[] = [];
  private showPaths = true;
  private lastPathUpdate = 0;

  constructor(viewer: Viewer, records: readonly OrbitRecord[], pathsVisible = true) {
    this.viewer = viewer;
    this.showPaths = pathsVisible;
    const now = new Date();
    for (const record of records.slice(0, SATELLITE_MAX_DISPLAY)) {
      const pos = positionAt(record, now);
      if (!pos) continue;
      const mainColor = Color.fromCssColorString(record.choice.color);
      const marker = viewer.entities.add({
        id: "satellite:" + record.choice.id,
        name: record.choice.title,
        position: new ConstantPositionProperty(toCartesian(pos)),
        point: {
          pixelSize: record.choice.category === "station" ? 7 : 5,
          color: mainColor,
          outlineColor: Color.fromCssColorString("#122c49"),
          outlineWidth: 2,
          disableDepthTestDistance: 0,
          scaleByDistance: new NearFarScalar(300_000, 1.4, 25_000_000, 0.75),
          distanceDisplayCondition: new DistanceDisplayCondition(0, 65_000_000),
        },
        label: {
          text: record.choice.title.split(" · ")[0].split("（")[0],
          font: "11px 'DM Sans', 'Noto Sans SC', sans-serif",
          style: LabelStyle.FILL_AND_OUTLINE,
          fillColor: mainColor,
          outlineColor: Color.fromCssColorString("#051222"),
          outlineWidth: 3,
          horizontalOrigin: HorizontalOrigin.LEFT,
          pixelOffset: new Cartesian2(10, -9),
          scaleByDistance: new NearFarScalar(300_000, 1, 25_000_000, 0.74),
          distanceDisplayCondition: new DistanceDisplayCondition(0, 40_000_000),
          disableDepthTestDistance: 0,
        },
      });
      const path = viewer.entities.add({
        id: "orbit:" + record.choice.id,
        show: pathsVisible,
        polyline: {
          positions: [],
          arcType: ArcType.NONE,
          width: 1.4,
          material: mainColor.withAlpha(0.43),
          distanceDisplayCondition: new DistanceDisplayCondition(0, 55_000_000),
        },
      });
      this.pairs.push({ record, marker, path });
    }
    this.update(now, true);
  }

  update(now = new Date(), forcePaths = false): void {
    if (this.viewer.isDestroyed()) return;
    const updatePaths = forcePaths || (this.showPaths && now.getTime() - this.lastPathUpdate > SATELLITE_PATH_UPDATE_MS);
    for (const pair of this.pairs) {
      const pos = positionAt(pair.record, now);
      if (pos) pair.marker.position = new ConstantPositionProperty(toCartesian(pos));
      pair.marker.show = Boolean(pos);
      if (updatePaths && this.showPaths) {
        const points = orbitPath(pair.record, now);
        pair.path.polyline!.positions = points.map(toCartesian);
        pair.path.show = points.length > 1;
      }
    }
    if (updatePaths) this.lastPathUpdate = now.getTime();
    this.viewer.scene.requestRender();
  }

  togglePaths(visible: boolean): void {
    this.showPaths = visible;
    for (const pair of this.pairs) pair.path.show = visible;
    if (visible) this.update(new Date(), true);
    else if (!this.viewer.isDestroyed()) this.viewer.scene.requestRender();
  }

  dispose(): void {
    if (this.viewer.isDestroyed()) return;
    for (const pair of this.pairs) {
      this.viewer.entities.remove(pair.marker);
      this.viewer.entities.remove(pair.path);
    }
    this.pairs.length = 0;
    this.viewer.scene.requestRender();
  }
  get count(): number { return this.pairs.length; }
}
