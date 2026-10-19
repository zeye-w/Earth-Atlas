import {
  ArcType,
  Cartesian2,
  Cartesian3,
  Color,
  ColorMaterialProperty,
  VerticalOrigin,
  ConstantPositionProperty,
  ConstantProperty,
  DistanceDisplayCondition,
  HorizontalOrigin,
  LabelStyle,
  NearFarScalar,
  type Entity,
  type Viewer,
} from "cesium";
import { LABEL_FONT } from "./labelFont.ts";
import { orbitPath, positionAt, type OrbitRecord, type OrbitalPosition } from "./satelliteOrbits.ts";

export const SATELLITE_UPDATE_MS = 5_000; // Positions every 5 s; not each WebGL frame.
export const SATELLITE_PATH_UPDATE_MS = 120_000; // Ground-fixed forecast path recomputed rarely.
export const SATELLITE_MAX_DISPLAY = 6;

function toCartesian(pos: OrbitalPosition): Cartesian3 {
  return Cartesian3.fromRadians(pos.longitudeRad, pos.latitudeRad, pos.altitudeKm * 1000);
}

// One neutral style for every orbit: thin, faint lines; the selected
// satellite's orbit is drawn a little brighter.
const ORBIT_COLOR = Color.fromCssColorString("#dfe7f5").withAlpha(0.32);
const ORBIT_SELECTED_COLOR = Color.fromCssColorString("#ffffff").withAlpha(0.75);
const LABEL_COLOR = Color.fromCssColorString("#eef2f8");
// Velocity is sampled this far ahead to point the icon along its track.
const HEADING_SAMPLE_MS = 20_000;

// Small monochrome satellite: body, two solar panels and an antenna. The
// image's "up" is the direction of travel (billboard alignedAxis).
const SATELLITE_ICON = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">' +
  '<g fill="none" stroke="#05070b" stroke-width="5" stroke-linejoin="round" opacity=".55">' +
  '<rect x="4" y="25" width="18" height="14" rx="1.5"/><rect x="42" y="25" width="18" height="14" rx="1.5"/>' +
  '<rect x="25" y="21" width="14" height="22" rx="3"/></g>' +
  '<g fill="#f4f6fa">' +
  '<rect x="4" y="25" width="18" height="14" rx="1.5"/><rect x="42" y="25" width="18" height="14" rx="1.5"/>' +
  '<rect x="22" y="31" width="20" height="2"/>' +
  '<rect x="25" y="21" width="14" height="22" rx="3"/>' +
  '<rect x="31" y="13" width="2" height="8"/><circle cx="32" cy="12" r="2.5"/></g>' +
  '<g stroke="#9aa6b8" stroke-width="1.2"><path d="M10 25v14M16 25v14M48 25v14M54 25v14M4 32h18M42 32h18"/></g>' +
  '</svg>',
);

function headingAxis(record: OrbitRecord, now: Date, here: Cartesian3): Cartesian3 | undefined {
  const ahead = positionAt(record, new Date(now.getTime() + HEADING_SAMPLE_MS));
  if (!ahead) return undefined;
  const direction = Cartesian3.subtract(toCartesian(ahead), here, new Cartesian3());
  return Cartesian3.magnitude(direction) > 0 ? Cartesian3.normalize(direction, direction) : undefined;
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
  private selectedId: string | null = null;

  constructor(viewer: Viewer, records: readonly OrbitRecord[], pathsVisible = true) {
    this.viewer = viewer;
    this.showPaths = pathsVisible;
    const now = new Date();
    for (const record of records.slice(0, SATELLITE_MAX_DISPLAY)) {
      const pos = positionAt(record, now);
      if (!pos) continue;
      const here = toCartesian(pos);
      const marker = viewer.entities.add({
        id: "satellite:" + record.choice.id,
        name: record.choice.title,
        position: new ConstantPositionProperty(here),
        billboard: {
          image: SATELLITE_ICON,
          width: record.choice.category === "station" ? 30 : 26,
          height: record.choice.category === "station" ? 30 : 26,
          alignedAxis: headingAxis(record, now, here) ?? Cartesian3.ZERO,
          verticalOrigin: VerticalOrigin.CENTER,
          disableDepthTestDistance: 0,
          scaleByDistance: new NearFarScalar(300_000, 1.3, 25_000_000, 0.85),
          distanceDisplayCondition: new DistanceDisplayCondition(0, 65_000_000),
        },
        label: {
          text: record.choice.title.split(" · ")[0].split("（")[0],
          font: "11px " + LABEL_FONT,
          style: LabelStyle.FILL_AND_OUTLINE,
          fillColor: LABEL_COLOR,
          outlineColor: Color.fromCssColorString("#05070b"),
          outlineWidth: 3,
          horizontalOrigin: HorizontalOrigin.LEFT,
          pixelOffset: new Cartesian2(16, -12),
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
          width: 1,
          material: ORBIT_COLOR,
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
      if (pos) {
        const here = toCartesian(pos);
        pair.marker.position = new ConstantPositionProperty(here);
        const axis = headingAxis(pair.record, now, here);
        if (axis) pair.marker.billboard!.alignedAxis = new ConstantProperty(axis);
      }
      pair.marker.show = Boolean(pos);
      if (updatePaths && this.showPaths) {
        const points = orbitPath(pair.record, now);
        pair.path.polyline!.positions = new ConstantProperty(points.map(toCartesian));
        pair.path.show = points.length > 1;
      }
    }
    if (updatePaths) this.lastPathUpdate = now.getTime();
    this.viewer.scene.requestRender();
  }

  setSelected(id: string | null): void {
    if (id === this.selectedId || this.viewer.isDestroyed()) return;
    this.selectedId = id;
    for (const pair of this.pairs) {
      const selected = pair.record.choice.id === id;
      pair.path.polyline!.material = new ColorMaterialProperty(selected ? ORBIT_SELECTED_COLOR : ORBIT_COLOR);
      pair.path.polyline!.width = new ConstantProperty(selected ? 1.6 : 1);
    }
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
