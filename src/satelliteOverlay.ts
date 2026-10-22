import {
  ArcType,
  Cartesian2,
  Cartesian3,
  Color,
  ColorMaterialProperty,
  ConstantPositionProperty,
  ConstantProperty,
  DistanceDisplayCondition,
  HorizontalOrigin,
  LabelStyle,
  NearFarScalar,
  VerticalOrigin,
  type Entity,
  type Viewer,
} from "cesium";
import { LABEL_FONT } from "./labelFont.ts";
import { elementsValidAt, orbitPath, positionAt, type OrbitRecord, type OrbitalPosition } from "./satelliteOrbits.ts";
import { telemetryAt, type Observer, type Telemetry } from "./satelliteTelemetry.ts";
import { now } from "./clock.ts";

// Ground-fixed forecast path is recomputed after this much simulated time.
export const SATELLITE_PATH_UPDATE_MS = 120_000;
export const SATELLITE_MAX_DISPLAY = 6;
// Positions are re-propagated continuously, but only as often as the motion
// is visible on screen: a few frames per second at globe scale (real-time
// LEO motion is ~1 px/s there) and up to 30 when zoomed in or accelerated.
export const SATELLITE_MIN_FPS = 2;
export const SATELLITE_MAX_FPS = 30;
export const SATELLITE_SPEEDS = [1, 60, 300] as const;
export type SatelliteSpeed = (typeof SATELLITE_SPEEDS)[number];
const LEO_SPEED_M_PER_S = 7_700;

/** Frames per second needed for about half-pixel steps, clamped. */
export function satelliteFrameRate(speed: number, cameraHeightM: number, viewportHeightPx: number): number {
  const metersPerPixel = Math.max(cameraHeightM, 1) * 1.15 / Math.max(viewportHeightPx, 1);
  const pixelsPerSecond = LEO_SPEED_M_PER_S * Math.max(speed, 1) / metersPerPixel;
  return Math.min(SATELLITE_MAX_FPS, Math.max(SATELLITE_MIN_FPS, pixelsPerSecond * 2));
}

function toCartesian(pos: OrbitalPosition, result?: Cartesian3): Cartesian3 {
  return Cartesian3.fromRadians(pos.longitudeRad, pos.latitudeRad, pos.altitudeKm * 1000, undefined, result);
}

// One neutral style for every orbit: thin, faint lines; the
// selected satellite's orbit is drawn a little brighter.
const ORBIT_COLOR = Color.fromCssColorString("#e6edf8").withAlpha(0.3);
const ORBIT_SELECTED_COLOR = Color.fromCssColorString("#ffffff").withAlpha(0.8);
const ORBIT_WIDTH = 1.1;
const ORBIT_SELECTED_WIDTH = 1.8;
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

interface MarkerPair {
  record: OrbitRecord;
  marker: Entity;
  path: Entity;
  position: ConstantPositionProperty;
  axis: ConstantProperty;
}

export class SatelliteOverlay {
  private readonly viewer: Viewer;
  private readonly pairs: MarkerPair[] = [];
  private showPaths = true;
  private lastPathSimMs = Number.NEGATIVE_INFINITY;
  private selectedId: string | null = null;
  private speed: SatelliteSpeed = 1;
  // Simulated clock: simMs = anchorSimMs + (realNow - anchorRealMs) * speed.
  private anchorRealMs = now();
  private anchorSimMs = now();
  // Set while the timeline shows a moment other than "live".
  private clock: (() => Date) | null = null;
  private frameHandle: number | null = null;
  private lastFrameMs = 0;
  private readonly scratchHere = new Cartesian3();
  private readonly scratchAhead = new Cartesian3();

  constructor(viewer: Viewer, records: readonly OrbitRecord[], pathsVisible = true) {
    this.viewer = viewer;
    this.showPaths = pathsVisible;
    const now = new Date();
    for (const record of records.slice(0, SATELLITE_MAX_DISPLAY)) {
      const pos = positionAt(record, now);
      if (!pos) continue;
      const position = new ConstantPositionProperty(toCartesian(pos));
      const axis = new ConstantProperty(Cartesian3.ZERO);
      const size = record.choice.category === "station" ? 22 : 18;
      const marker = viewer.entities.add({
        id: "satellite:" + record.choice.id,
        name: record.choice.title,
        position,
        billboard: {
          image: SATELLITE_ICON,
          width: size,
          height: size,
          alignedAxis: axis,
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
          pixelOffset: new Cartesian2(13, -10),
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
          width: ORBIT_WIDTH,
          material: ORBIT_COLOR,
          distanceDisplayCondition: new DistanceDisplayCondition(0, 55_000_000),
        },
      });
      this.pairs.push({ record, marker, path, position, axis });
    }
    this.update(true);
    this.frameHandle = requestAnimationFrame(this.onFrame);
  }

  /** Current simulated instant (equals real time at 1x). */
  simulatedTime(): Date {
    if (this.clock) return this.clock();
    return new Date(this.anchorSimMs + (now() - this.anchorRealMs) * this.speed);
  }

  /** Follow the timeline (null: back to the live, speed-controlled clock). */
  setClock(clock: (() => Date) | null): void {
    this.clock = clock;
    if (!clock) {
      this.anchorRealMs = now();
      this.anchorSimMs = this.speed === 1 ? this.anchorRealMs : this.anchorSimMs;
    }
    this.update(true);
  }

  setSpeed(speed: SatelliteSpeed): void {
    const realNow = now();
    // Returning to 1x snaps back to the true current position.
    this.anchorSimMs = speed === 1 ? realNow : this.simulatedTime().getTime();
    this.anchorRealMs = realNow;
    this.speed = speed;
    this.update(true);
  }

  private readonly onFrame = (frameMs: number): void => {
    if (this.viewer.isDestroyed()) return;
    this.frameHandle = requestAnimationFrame(this.onFrame);
    if (document.visibilityState !== "visible") return;
    const camera = this.viewer.scene.camera;
    const height = camera.positionCartographic.height;
    const fps = satelliteFrameRate(this.speed, height, this.viewer.canvas.clientHeight);
    if (frameMs - this.lastFrameMs < 1000 / fps) return;
    this.lastFrameMs = frameMs;
    this.update();
  };

  update(forcePaths = false): void {
    if (this.viewer.isDestroyed()) return;
    const now = this.simulatedTime();
    const updatePaths = forcePaths || (this.showPaths && Math.abs(now.getTime() - this.lastPathSimMs) > SATELLITE_PATH_UPDATE_MS);
    const ahead = new Date(now.getTime() + HEADING_SAMPLE_MS);
    for (const pair of this.pairs) {
      // Far from the element epoch SGP4 drifts by hundreds of km: hide
      // rather than draw a position we cannot vouch for.
      const valid = elementsValidAt(pair.record, now);
      const pos = valid ? positionAt(pair.record, now) : null;
      pair.marker.show = Boolean(pos);
      if (!valid) pair.path.show = false;
      if (pos) {
        const here = toCartesian(pos, this.scratchHere);
        pair.position.setValue(here);
        const next = positionAt(pair.record, ahead);
        if (next) {
          const direction = Cartesian3.subtract(toCartesian(next, this.scratchAhead), here, this.scratchAhead);
          if (Cartesian3.magnitude(direction) > 0) pair.axis.setValue(Cartesian3.normalize(direction, new Cartesian3()));
        }
      }
      if (valid && updatePaths && this.showPaths) {
        const points = orbitPath(pair.record, now);
        pair.path.polyline!.positions = new ConstantProperty(points.map((point) => toCartesian(point)));
        pair.path.show = points.length > 1;
      }
    }
    if (updatePaths) this.lastPathSimMs = now.getTime();
    this.viewer.scene.requestRender();
  }

  setSelected(id: string | null): void {
    if (id === this.selectedId || this.viewer.isDestroyed()) return;
    this.selectedId = id;
    for (const pair of this.pairs) {
      const selected = pair.record.choice.id === id;
      pair.path.polyline!.material = new ColorMaterialProperty(selected ? ORBIT_SELECTED_COLOR : ORBIT_COLOR);
      pair.path.polyline!.width = new ConstantProperty(selected ? ORBIT_SELECTED_WIDTH : ORBIT_WIDTH);
    }
    this.viewer.scene.requestRender();
  }

  togglePaths(visible: boolean): void {
    this.showPaths = visible;
    for (const pair of this.pairs) pair.path.show = visible;
    if (visible) this.update(true);
    else if (!this.viewer.isDestroyed()) this.viewer.scene.requestRender();
  }

  dispose(): void {
    if (this.frameHandle !== null) cancelAnimationFrame(this.frameHandle);
    this.frameHandle = null;
    if (this.viewer.isDestroyed()) return;
    for (const pair of this.pairs) {
      this.viewer.entities.remove(pair.marker);
      this.viewer.entities.remove(pair.path);
    }
    this.pairs.length = 0;
    this.viewer.scene.requestRender();
  }
  /** The marker entity, for the camera to track. */
  markerEntity(id: string): Entity | undefined {
    return this.pairs.find((pair) => pair.record.choice.id === id)?.marker;
  }

  /** Current marker position, or undefined while hidden (no reliable position). */
  markerPosition(id: string): Cartesian3 | undefined {
    const pair = this.pairs.find((p) => p.record.choice.id === id);
    return pair && pair.marker.show ? pair.position.getValue() : undefined;
  }

  /** Live readouts at the overlay's current (live or timeline) moment. */
  telemetry(id: string, observer: Observer | null): Telemetry | null {
    const pair = this.pairs.find((p) => p.record.choice.id === id);
    const time = this.simulatedTime();
    if (!pair || !elementsValidAt(pair.record, time)) return null;
    return telemetryAt(pair.record, time, observer);
  }

  get count(): number { return this.pairs.length; }
  get followsTimeline(): boolean { return this.clock !== null; }
}
