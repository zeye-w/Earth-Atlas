import {
  ArcType, BillboardCollection, Cartesian2, Cartesian3, Color, ColorGeometryInstanceAttribute, DistanceDisplayCondition,
  GeometryInstance, LabelCollection, LabelStyle, Material, NearFarScalar, PerInstanceColorAppearance, PointPrimitiveCollection,
  PolygonGeometry, PolygonHierarchy, PolylineCollection, Primitive, VerticalOrigin,
  type Billboard, type Label, type Viewer,
} from "cesium";
import {
  HAZARD_ID_PREFIX, stormAt, stormPath, type AlertLevel, type EventCategory, type HazardSnapshot, type IntensityLevel, type NaturalEvent, type Storm,
} from "./hazardData.ts";

// ---- Icons ------------------------------------------------------------------

const svg = (body: string) => "data:image/svg+xml;charset=utf-8," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">${body}</svg>`);
const disc = (fill: string, glyph: string, ink = "#fff") =>
  svg(`<circle cx="16" cy="16" r="13" fill="${fill}" stroke="rgba(5,9,16,.85)" stroke-width="2.5"/><g fill="none" stroke="${ink}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${glyph}</g>`);

export const EVENT_STYLE: Record<EventCategory, { color: string; icon: string }> = {
  wildfires: { color: "#ff7a2f", icon: disc("#ff7a2f", `<path d="M16 8c3 4 5 6 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-6 1-9z" fill="#fff" stroke="none"/>`) },
  volcanoes: { color: "#e5483b", icon: disc("#e5483b", `<path d="M9 22l5-9h4l5 9z" fill="#fff" stroke="none"/><path d="M15 10l-1-3M17 10l1-3"/>`) },
  seaLakeIce: { color: "#7fd3ff", icon: disc("#7fd3ff", `<path d="M16 8v16M9 12l14 8M23 12L9 20"/>`, "#0b2a3d") },
  dustHaze: { color: "#d4a35c", icon: disc("#d4a35c", `<path d="M9 12h11a2 2 0 1 0-2-2M8 16h15M10 20h9a2 2 0 1 1-2 2"/>`) },
  floods: { color: "#3f8cff", icon: disc("#3f8cff", `<path d="M8 13c2-2 4-2 6 0s4 2 6 0 3-1 4 0M8 19c2-2 4-2 6 0s4 2 6 0 3-1 4 0"/>`) },
  landslides: { color: "#9a6b45", icon: disc("#9a6b45", `<path d="M8 22h16L12 10z" fill="#fff" stroke="none"/><circle cx="21" cy="12" r="1.6" fill="#fff" stroke="none"/>`) },
  drought: { color: "#e0b84a", icon: disc("#e0b84a", `<circle cx="16" cy="16" r="4"/><path d="M16 7v2M16 23v2M7 16h2M23 16h2M10 10l1.4 1.4M20.6 20.6L22 22M10 22l1.4-1.4M20.6 11.4L22 10"/>`) },
  snow: { color: "#dfe8f5", icon: disc("#dfe8f5", `<path d="M16 8v16M9 12l14 8M23 12L9 20"/>`, "#24405e") },
  tempExtremes: { color: "#ff4f7b", icon: disc("#ff4f7b", `<path d="M14 18V9a2 2 0 0 1 4 0v9"/><circle cx="16" cy="21" r="3"/>`) },
  waterColor: { color: "#2fc3b0", icon: disc("#2fc3b0", `<path d="M16 8c3 4 5 7 5 10a5 5 0 0 1-10 0c0-3 2-6 5-10z" fill="#fff" stroke="none"/>`) },
  manmade: { color: "#a0a7b0", icon: disc("#a0a7b0", `<path d="M9 23V14l5 3v-3l5 3V9h4v14z" fill="#fff" stroke="none"/>`) },
};

/** A cyclone symbol in the level's colour; arms turn anticlockwise in the north, clockwise in the south. */
const cycloneIcons = new Map<string, string>();
function cycloneIcon(color: string, south: boolean): string {
  const key = color + south;
  let icon = cycloneIcons.get(key);
  if (!icon) {
    const arms = `<path d="M16 3c7 0 12 4 12 10" /><path d="M16 29c-7 0-12-4-12-10"/>`;
    icon = svg(`<g transform="${south ? "translate(32 0) scale(-1 1)" : ""}" fill="none" stroke-linecap="round">
      <g stroke="rgba(5,9,16,.85)" stroke-width="7">${arms}</g><g stroke="${color}" stroke-width="4">${arms}</g>
      <circle cx="16" cy="16" r="8" fill="${color}" stroke="rgba(5,9,16,.85)" stroke-width="2.5"/><circle cx="16" cy="16" r="3" fill="rgba(5,9,16,.9)"/></g>`);
    cycloneIcons.set(key, icon);
  }
  return icon;
}

const SWATH_COLORS: Record<AlertLevel, Color> = {
  green: Color.fromCssColorString("#4cd07a").withAlpha(0.13),
  orange: Color.fromCssColorString("#ff9d3a").withAlpha(0.18),
  red: Color.fromCssColorString("#ff4a3a").withAlpha(0.22),
};
const CONE_COLOR = Color.WHITE.withAlpha(0.12);
/** Above the ground so the areas do not z-fight with the globe. */
const AREA_HEIGHT = 3_000;
const LINE_HEIGHT = 6_000;

export interface HazardLayers {
  events: boolean;
  storms: boolean;
  categories: ReadonlySet<EventCategory>;
}

/** Natural-event markers and tropical-cyclone tracks, forecasts, cones and wind swaths. */
export class HazardOverlay {
  private readonly viewer: Viewer;
  private readonly eventBillboards = new BillboardCollection();
  private readonly lines = new PolylineCollection();
  private readonly fixes = new PointPrimitiveCollection();
  private readonly markers = new BillboardCollection();
  private readonly labels = new LabelCollection();
  private areas: Primitive | null = null;
  private layers: HazardLayers = { events: false, storms: false, categories: new Set() };
  private level: (windKt: number | null) => IntensityLevel = () => ({ key: "unknown", label: "", color: "#fff" });
  private time = Date.now();
  private selected: string | null = null;
  private storms: { storm: Storm; marker: Billboard; label: Label; image: string }[] = [];
  private events: { event: NaturalEvent; billboard: Billboard }[] = [];

  constructor(viewer: Viewer) {
    this.viewer = viewer;
    const primitives = viewer.scene.primitives;
    for (const collection of [this.lines, this.fixes, this.eventBillboards, this.markers, this.labels]) primitives.add(collection);
  }

  /** Rebuild everything from a snapshot (data, visibility or intensity scale changed). */
  set(snapshot: HazardSnapshot | null, layers: HazardLayers, level: (windKt: number | null) => IntensityLevel, displayName: (storm: Storm) => string) {
    this.layers = layers;
    this.level = level;
    this.eventBillboards.removeAll();
    this.lines.removeAll();
    this.fixes.removeAll();
    this.markers.removeAll();
    this.labels.removeAll();
    if (this.areas) { this.viewer.scene.primitives.remove(this.areas); this.areas = null; }
    this.events = [];
    this.storms = [];
    if (!snapshot) { this.requestRender(); return; }
    if (layers.events) for (const event of snapshot.events) {
      if (!layers.categories.has(event.category)) continue;
      const billboard = this.eventBillboards.add({
        id: HAZARD_ID_PREFIX + "event:" + event.id,
        position: Cartesian3.fromDegrees(event.longitude, event.latitude, 2_000),
        image: EVENT_STYLE[event.category].icon, width: 20, height: 20, verticalOrigin: VerticalOrigin.CENTER,
        scaleByDistance: new NearFarScalar(500_000, 1.3, 25_000_000, 0.8),
      });
      this.events.push({ event, billboard });
    }
    if (layers.storms) this.buildStorms(snapshot.storms, displayName);
    this.setTime(this.time);
  }

  private buildStorms(storms: readonly Storm[], displayName: (storm: Storm) => string) {
    const instances: GeometryInstance[] = [];
    const area = (ring: readonly [number, number][], color: Color) => {
      // Unwrap so a ring across the antimeridian stays one small polygon.
      const lons: number[] = [];
      for (const [lon] of ring) {
        let l = lon;
        const prev = lons.at(-1);
        if (prev !== undefined) { while (l - prev > 180) l -= 360; while (l - prev < -180) l += 360; }
        lons.push(l);
      }
      const positions = ring.map(([, lat], i) => Cartesian3.fromDegrees(lons[i], lat));
      instances.push(new GeometryInstance({
        geometry: new PolygonGeometry({ polygonHierarchy: new PolygonHierarchy(positions), height: AREA_HEIGHT, vertexFormat: PerInstanceColorAppearance.VERTEX_FORMAT, arcType: ArcType.RHUMB }),
        attributes: { color: ColorGeometryInstanceAttribute.fromColor(color) },
      }));
    };
    for (const storm of storms) {
      const id = HAZARD_ID_PREFIX + "storm:" + storm.id;
      for (const swath of storm.swaths) area(swath.ring, SWATH_COLORS[swath.level]);
      if (storm.cone) area(storm.cone, CONE_COLOR);
      const path = stormPath(storm);
      const observed = path.slice(0, storm.track.length);
      // Observed track: one segment per six hours, coloured by intensity at its start.
      for (let i = 1; i < observed.length; i++) {
        const a = observed[i - 1], b = observed[i];
        this.lines.add({
          id, width: 3.2, arcType: ArcType.GEODESIC,
          positions: [Cartesian3.fromDegrees(a.longitude, a.latitude, LINE_HEIGHT), Cartesian3.fromDegrees(b.longitude, b.latitude, LINE_HEIGHT)],
          material: Material.fromType("Color", { color: Color.fromCssColorString(this.level(a.windKt).color) }),
        });
      }
      for (const fix of observed) this.fixes.add({
        id, position: Cartesian3.fromDegrees(fix.longitude, fix.latitude, LINE_HEIGHT), pixelSize: 5,
        color: Color.fromCssColorString(this.level(fix.windKt).color), outlineColor: Color.fromCssColorString("#05090f"), outlineWidth: 1,
        distanceDisplayCondition: new DistanceDisplayCondition(0, 18_000_000),
      });
      // Forecast: dashed, from the latest fix on.
      const ahead = path.slice(Math.max(0, storm.track.length - 1));
      if (ahead.length > 1) this.lines.add({
        id, width: 2.4, arcType: ArcType.GEODESIC,
        positions: ahead.map((p) => Cartesian3.fromDegrees(p.longitude, p.latitude, LINE_HEIGHT)),
        material: Material.fromType("PolylineDash", { color: Color.WHITE.withAlpha(0.85), dashLength: 14 }),
      });
      const marker = this.markers.add({ id, position: Cartesian3.ZERO, width: 30, height: 30, verticalOrigin: VerticalOrigin.CENTER, show: false,
        scaleByDistance: new NearFarScalar(800_000, 1.3, 25_000_000, 0.85) });
      const label = this.labels.add({
        id, position: Cartesian3.ZERO, text: displayName(storm), show: false,
        font: "600 13px -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif",
        fillColor: Color.WHITE, outlineColor: Color.fromCssColorString("#05070b"), outlineWidth: 3, style: LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: VerticalOrigin.BOTTOM, pixelOffset: new Cartesian2(0, -20),
        distanceDisplayCondition: new DistanceDisplayCondition(0, 30_000_000),
      });
      this.storms.push({ storm, marker, label, image: "" });
    }
    if (instances.length) {
      this.areas = this.viewer.scene.primitives.add(new Primitive({
        geometryInstances: instances, appearance: new PerInstanceColorAppearance({ translucent: true, closed: false, flat: true }),
        asynchronous: true, allowPicking: false,
      }));
    }
  }

  /** Move each storm to where it was (or will be) at `time`; events appear once observed. */
  setTime(time: number) {
    this.time = time;
    for (const { event, billboard } of this.events) billboard.show = event.time <= time + 3_600_000;
    for (const entry of this.storms) {
      const { storm, marker, label } = entry;
      const fix = stormAt(storm, time);
      marker.show = label.show = fix !== null;
      if (!fix) continue;
      const position = Cartesian3.fromDegrees(fix.longitude, fix.latitude, LINE_HEIGHT + 2_000);
      const level = this.level(fix.windKt);
      marker.position = label.position = position;
      const image = HAZARD_ID_PREFIX + level.color + (fix.latitude < 0 ? "S" : "N");
      if (entry.image !== image) { marker.setImage(image, cycloneIcon(level.color, fix.latitude < 0)); entry.image = image; }
      const selected = this.selected === storm.id;
      marker.width = marker.height = selected ? 40 : 30;
      // Forecast positions are drawn translucent: not yet observed.
      marker.color = fix.forecast ? Color.WHITE.withAlpha(0.6) : Color.WHITE;
    }
    this.requestRender();
  }

  setSelected(stormId: string | null) {
    this.selected = stormId;
    this.setTime(this.time);
  }

  private requestRender() {
    if (!this.viewer.isDestroyed()) this.viewer.scene.requestRender();
  }

  dispose() {
    if (this.viewer.isDestroyed()) return;
    const primitives = this.viewer.scene.primitives;
    for (const collection of [this.lines, this.fixes, this.eventBillboards, this.markers, this.labels]) primitives.remove(collection);
    if (this.areas) primitives.remove(this.areas);
    this.areas = null;
    this.requestRender();
  }
}
