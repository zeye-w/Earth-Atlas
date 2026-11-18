import {
  ArcType, Cartesian2, Cartesian3, Color, ColorMaterialProperty, ConstantPositionProperty, ConstantProperty, EllipsoidSurfaceAppearance, Entity,
  GeometryInstance, HorizontalOrigin, LabelStyle, Material, Math as CesiumMath, Moon, PolygonHierarchy, PolylineDashMaterialProperty, Primitive,
  Rectangle, RectangleGeometry, VerticalOrigin, type Viewer,
} from "cesium";
import { moonState, PHASE_LABELS } from "./astronomy/moon.ts";
import { obscurationGrid, shadowAt, solarEclipseTrack, sublunarPoint, type Eclipse, type EclipseTrack, type GeoPoint, type SolarEclipse } from "./astronomy/eclipses.ts";
import { altitude, visibilityGrid, type MeteorShower } from "./astronomy/meteors.ts";
import { t } from "./i18n";

/**
 * The astronomy layers on the globe: the Moon (where it is overhead, the
 * half of the Earth that can see it, and the Moon itself in the sky), a
 * selected eclipse (the central path and the Moon's shadow at the eclipse's
 * own clock, or where a lunar eclipse can be seen) and where a meteor shower
 * can be watched right now.
 */

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
/** Lines and markers sit above the translucent maps (12 km). */
const HEIGHT = 20_000;

/** The point `distance` degrees away along `bearing` (great circle). */
function destination(from: GeoPoint, bearing: number, distance: number): GeoPoint {
  const lat = from.latitude * RAD, d = distance * RAD, b = bearing * RAD;
  const lat2 = Math.asin(Math.sin(lat) * Math.cos(d) + Math.cos(lat) * Math.sin(d) * Math.cos(b));
  const lon2 = from.longitude * RAD + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(lat), Math.cos(d) - Math.sin(lat) * Math.sin(lat2));
  return { latitude: lat2 * DEG, longitude: ((lon2 * DEG + 540) % 360) - 180 };
}

/** The circle 90° from a point: the edge of the hemisphere facing a body overhead there. */
export function horizonCircle(center: GeoPoint, steps = 180): GeoPoint[] {
  return Array.from({ length: steps + 1 }, (_, i) => destination(center, (360 * i) / steps, 90));
}

const toPositions = (points: readonly GeoPoint[], height = HEIGHT) => points.map((p) => Cartesian3.fromDegrees(p.longitude, p.latitude, height));

/** A small picture of the Moon's phase: lit on the right while waxing (as seen from the north). */
export function moonIcon(phaseAngle: number, size = 48): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const g = canvas.getContext("2d")!;
  const r = size / 2 - 3, c = size / 2;
  g.fillStyle = "#2a2f3a";
  g.beginPath(); g.arc(c, c, r, 0, 2 * Math.PI); g.fill();
  const a = ((phaseAngle % 360) + 360) % 360;
  const waxing = a < 180;
  // The terminator is an ellipse of half-width r·|cos a|; it bulges into the dark side past quarter.
  const k = Math.cos(a * RAD);
  g.fillStyle = "#f2efe4";
  g.beginPath();
  g.arc(c, c, r, -Math.PI / 2, Math.PI / 2, !waxing);
  g.ellipse(c, c, r * Math.abs(k), r, 0, Math.PI / 2, -Math.PI / 2, waxing ? k > 0 : k < 0);
  g.fill();
  g.strokeStyle = "rgba(255,255,255,0.55)";
  g.lineWidth = 1.5;
  g.beginPath(); g.arc(c, c, r, 0, 2 * Math.PI); g.stroke();
  return canvas;
}

/**
 * One translucent image over the whole globe. A primitive with a flat
 * appearance rather than an imagery layer: imagery is darkened on the night
 * side by the globe's lighting, and meteor showers are seen at night.
 */
class GridImagery {
  private primitive: Primitive | null = null;
  private material: Material | null = null;
  constructor(private viewer: Viewer) {}

  async show(width: number, height: number, pixel: (index: number) => [number, number, number, number] | null): Promise<void> {
    const canvas = document.createElement("canvas");
    canvas.width = width; canvas.height = height;
    const g = canvas.getContext("2d")!;
    const image = g.createImageData(width, height);
    for (let i = 0; i < width * height; i++) {
      const rgba = pixel(i);
      if (rgba) image.data.set(rgba, i * 4);
    }
    g.putImageData(image, 0, 0);
    if (this.viewer.isDestroyed()) return;
    if (!this.primitive) {
      this.material = Material.fromType("Image", { image: canvas, color: Color.WHITE });
      this.primitive = this.viewer.scene.primitives.add(new Primitive({
        geometryInstances: new GeometryInstance({
          // Just above the ground, so it is not hidden in the globe's surface.
          geometry: new RectangleGeometry({ rectangle: Rectangle.fromDegrees(-180, -89.9, 180, 89.9), height: 12_000, granularity: CesiumMath.toRadians(2), vertexFormat: EllipsoidSurfaceAppearance.VERTEX_FORMAT }),
        }),
        appearance: new EllipsoidSurfaceAppearance({ material: this.material, flat: true, translucent: true, aboveGround: true }),
        asynchronous: false,
      }));
    } else {
      this.material!.uniforms.image = canvas;
      this.primitive.show = true;
    }
    // The scene renders on demand; the texture is uploaded during a frame and
    // shown on a later one, so ask for a few more.
    const scene = this.viewer.scene;
    scene.requestRender();
    for (const ms of [50, 200, 600]) window.setTimeout(() => { if (!this.viewer.isDestroyed()) scene.requestRender(); }, ms);
  }

  clear(): void {
    if (this.primitive && !this.viewer.isDestroyed()) this.viewer.scene.primitives.remove(this.primitive);
    this.primitive = null;
    this.material = null;
  }
}

export interface EclipseView { eclipse: Eclipse; time: number }

export class AstronomyOverlay {
  private moonOn = false;
  private moonMarker: Entity | null = null;
  private moonCircle: Entity | null = null;
  private lastPhase = Number.NaN;
  private eclipseEntities: Entity[] = [];
  private umbra: Entity | null = null;
  private eclipseKey: string | null = null;
  private track: EclipseTrack | null = null;
  private eclipseGrid: GridImagery;
  private meteorGrid: GridImagery;
  private meteorKey: string | null = null;

  constructor(private viewer: Viewer) {
    this.eclipseGrid = new GridImagery(viewer);
    this.meteorGrid = new GridImagery(viewer);
  }

  /** The Moon layer at a moment. */
  setMoon(show: boolean, time: number): void {
    const scene = this.viewer.scene;
    if (show && !scene.moon) scene.moon = new Moon({ onlySunLighting: true });
    if (scene.moon) scene.moon.show = show;
    this.moonOn = show;
    if (!show) {
      for (const e of [this.moonMarker, this.moonCircle]) if (e) this.viewer.entities.remove(e);
      this.moonMarker = this.moonCircle = null;
      this.lastPhase = Number.NaN;
      scene.requestRender();
      return;
    }
    const moon = moonState(time);
    const position = Cartesian3.fromDegrees(moon.sublunar.longitude, moon.sublunar.latitude, HEIGHT);
    const text = t("月下点") + " · " + t(PHASE_LABELS[moon.phase]) + " " + Math.round(moon.illuminated * 100) + "%";
    if (!this.moonMarker) {
      this.moonMarker = this.viewer.entities.add({
        id: "astronomy:moon",
        position,
        billboard: { image: moonIcon(moon.phaseAngle), width: 30, height: 30 },
        label: { text, font: "12px Inter, system-ui, sans-serif", fillColor: Color.fromCssColorString("#f2efe4"), outlineColor: Color.BLACK, outlineWidth: 3,
          style: LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cartesian2(0, 24), verticalOrigin: VerticalOrigin.TOP, horizontalOrigin: HorizontalOrigin.CENTER },
      });
      this.moonCircle = this.viewer.entities.add({
        id: "astronomy:moon-horizon",
        polyline: { positions: toPositions(horizonCircle(moon.sublunar)), width: 1.5, arcType: ArcType.GEODESIC,
          material: new PolylineDashMaterialProperty({ color: Color.fromCssColorString("#d9d4c3").withAlpha(0.7), dashLength: 14 }) },
      });
    } else {
      this.moonMarker.position = new ConstantPositionProperty(position);
      this.moonMarker.label!.text = new ConstantProperty(text);
      // Redraw the icon only when the phase has visibly changed.
      if (!(Math.abs(moon.phaseAngle - this.lastPhase) < 2)) this.moonMarker.billboard!.image = new ConstantProperty(moonIcon(moon.phaseAngle));
      this.moonCircle!.polyline!.positions = new ConstantProperty(toPositions(horizonCircle(moon.sublunar)));
    }
    if (!(Math.abs(moon.phaseAngle - this.lastPhase) < 2)) this.lastPhase = moon.phaseAngle;
    scene.requestRender();
  }

  get moonVisible(): boolean { return this.moonOn; }

  /** The selected eclipse at its own clock, or none. */
  setEclipse(view: EclipseView | null): void {
    const key = view?.eclipse.id ?? null;
    if (key !== this.eclipseKey) {
      this.clearEclipse();
      this.eclipseKey = key;
      if (view) this.drawEclipse(view.eclipse);
    }
    if (view?.eclipse.type === "solar") this.drawShadow(view.time);
    this.viewer.scene.requestRender();
  }

  /** The central path of a solar eclipse, computed once; for a lunar eclipse, where the Moon is up at its peak. */
  private drawEclipse(eclipse: Eclipse): void {
    if (eclipse.type === "lunar") {
      const center = sublunarPoint(eclipse.peak);
      this.eclipseEntities.push(this.viewer.entities.add({
        polyline: { positions: toPositions(horizonCircle(center)), width: 2, arcType: ArcType.GEODESIC, material: Color.fromCssColorString("#ff9a6b") },
      }));
      void this.eclipseGrid.show(180, 90, (i) => {
        const latitude = 90 - (Math.floor(i / 180) + 0.5) * 2, longitude = -180 + ((i % 180) + 0.5) * 2;
        return altitude(0, center.latitude, latitude, longitude - center.longitude, 0) > 0 ? [255, 140, 90, 70] : null;
      });
      return;
    }
    const track = solarEclipseTrack(eclipse as SolarEclipse);
    this.track = track;
    const gold = Color.fromCssColorString("#ffcf5a");
    if (track.center.length > 1) {
      this.eclipseEntities.push(this.viewer.entities.add({ polyline: { positions: toPositions(track.center), width: 2.5, arcType: ArcType.GEODESIC, material: gold } }));
      for (const limit of [track.northLimit, track.southLimit]) {
        if (limit.length > 1) this.eclipseEntities.push(this.viewer.entities.add({
          polyline: { positions: toPositions(limit), width: 1.5, arcType: ArcType.GEODESIC, material: new PolylineDashMaterialProperty({ color: gold.withAlpha(0.85), dashLength: 10 }) },
        }));
      }
    }
  }

  private shadowPending: number | null = null;
  private shadowBusy = false;

  /** The Moon's shadow at `time`: the dark central footprint and the partial-eclipse shading. */
  private drawShadow(time: number): void {
    const shadow = shadowAt(time);
    if (shadow.umbra.length >= 3) {
      const hierarchy = new PolygonHierarchy(toPositions(shadow.umbra, 0));
      if (!this.umbra) {
        this.umbra = this.viewer.entities.add({
          id: "astronomy:umbra",
          polygon: { hierarchy, material: new ColorMaterialProperty(Color.BLACK.withAlpha(0.7)) },
        });
      } else {
        this.umbra.polygon!.hierarchy = new ConstantProperty(hierarchy);
        this.umbra.show = true;
      }
    } else if (this.umbra) this.umbra.show = false;
    // The partial shading takes a few milliseconds; while playing, draw the latest moment only.
    this.shadowPending = time;
    if (this.shadowBusy) return;
    this.shadowBusy = true;
    const run = async () => {
      while (this.shadowPending !== null) {
        const at = this.shadowPending;
        this.shadowPending = null;
        const grid = obscurationGrid(at, 180, 90);
        await this.eclipseGrid.show(grid.width, grid.height, (i) => {
          const v = grid.values[i];
          return v > 0.001 ? [8, 10, 28, Math.round(40 + 150 * v)] : null;
        });
      }
      this.shadowBusy = false;
    };
    void run();
  }

  get eclipseTrack(): EclipseTrack | null { return this.track; }

  private clearEclipse(): void {
    for (const e of this.eclipseEntities) this.viewer.entities.remove(e);
    this.eclipseEntities = [];
    if (this.umbra) this.viewer.entities.remove(this.umbra);
    this.umbra = null;
    this.track = null;
    this.shadowPending = null;
    this.eclipseGrid.clear();
  }

  /** Where a shower can be watched at `time` (redrawn at most every ten minutes of scene time). */
  setMeteors(shower: MeteorShower | null, time: number): void {
    if (!shower) {
      this.meteorKey = null;
      this.meteorGrid.clear();
      this.viewer.scene.requestRender();
      return;
    }
    const key = shower.code + ":" + Math.floor(time / 600_000);
    if (key === this.meteorKey) return;
    this.meteorKey = key;
    const grid = visibilityGrid(shower, time, 360, 180);
    void this.meteorGrid.show(grid.width, grid.height, (i) => {
      const v = grid.values[i];
      return v > 0 ? [70, 230, 200, Math.round(110 * Math.sqrt(v))] : null;
    });
  }

  dispose(): void {
    this.setMoon(false, 0);
    this.clearEclipse();
    this.eclipseKey = null;
    this.setMeteors(null, 0);
  }
}
