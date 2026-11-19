import {
  ArcType, Cartesian2, Cartesian3, Color, ColorMaterialProperty, ConstantPositionProperty, ConstantProperty, Entity, Matrix3, NearFarScalar,
  PolylineDashMaterialProperty, SceneTransforms, Transforms, type Viewer,
} from "cesium";
import { AU_KM, BELT_RINGS, eclipticRing, ECLIPTIC_NORTH, helio, orbit, SOLAR_PLANETS, sunFromEarth, type SolarBodyKey, type Vec3 } from "./astronomy/solarSystem.ts";
import { probeAt, probeInfo, type SpaceSnapshot } from "./spaceData";
import { t } from "./i18n";

/**
 * The solar system around the globe: the planets (and Pluto) at their
 * positions for a moment, their orbits, the asteroid and Kuiper belts, the
 * Sun, and the deep space probes. Everything is computed heliocentric in the
 * ICRF, made Earth-centred, and turned into the Earth-fixed frame of the
 * scene's clock, so it lines up with the star background.
 */

const KM = 1000;
/** Labels and points only from about a million kilometres out: near the Earth they are clutter. */
const FADE = new NearFarScalar(5.0e8, 0, 2.0e9, 1);
const ORBIT = new ColorMaterialProperty(Color.WHITE.withAlpha(0.32));
const ORBIT_SELECTED = new ColorMaterialProperty(Color.WHITE.withAlpha(0.75));



/**
 * Names drawn as page text over the scene. Cesium's own labels lose float
 * precision at these distances (billions of km) and come out garbled; the
 * points are fine, so the names follow them on screen after each frame.
 */
class HtmlLabels {
  private root: HTMLDivElement;
  private items: { el: HTMLSpanElement; position: Cartesian3 | null }[] = [];
  private removeListener: () => void;
  private scratch = new Cartesian2();

  constructor(private viewer: Viewer) {
    this.root = document.createElement("div");
    this.root.className = "solar-labels";
    this.root.setAttribute("aria-hidden", "true");
    viewer.container.appendChild(this.root);
    this.removeListener = viewer.scene.postRender.addEventListener(() => this.place());
  }

  add(text: string, color: string): number {
    const el = document.createElement("span");
    el.textContent = text;
    el.style.color = color;
    this.root.appendChild(el);
    this.items.push({ el, position: null });
    return this.items.length - 1;
  }

  set(index: number, position: Cartesian3 | null): void { this.items[index].position = position; }

  remove(index: number): void { this.items[index].el.remove(); this.items[index].position = null; }

  private place(): void {
    const { scene, camera } = this.viewer;
    // Only from far out, as with the points (near the Earth they would be clutter).
    const far = Cartesian3.magnitude(camera.positionWC) > 1.0e9;
    this.root.style.display = far ? "" : "none";
    if (!far) return;
    for (const item of this.items) {
      const p = item.position;
      const inFront = p && Cartesian3.dot(Cartesian3.subtract(p, camera.positionWC, new Cartesian3()), camera.directionWC) > 0;
      const screen = inFront ? SceneTransforms.worldToWindowCoordinates(scene, p!, this.scratch) : undefined;
      if (!screen) { item.el.style.display = "none"; continue; }
      item.el.style.display = "";
      item.el.style.transform = `translate(${Math.round(screen.x + 9)}px, ${Math.round(screen.y - 8)}px)`;
    }
  }

  dispose(): void {
    this.removeListener();
    this.root.remove();
  }
}

export class SolarSystemOverlay {
  private labels: HtmlLabels;
  private labelOf = new Map<Entity, number>();
  private planets = new Map<SolarBodyKey, Entity>();
  private orbits = new Map<SolarBodyKey, { entity: Entity; helio: Vec3[] }>();
  private belts: { entity: Entity; helio: Vec3[] }[] = [];
  private sun: Entity;
  private probes: { entity: Entity; at: (time: number) => Vec3 }[] = [];
  private beltLabels: { entity: Entity; helio: Vec3 }[] = [];
  private orbitsFrom = Number.NaN;
  private selected: SolarBodyKey | null = null;

  constructor(private viewer: Viewer) {
    this.labels = new HtmlLabels(viewer);
    const named = (entity: Entity, text: string, color: string) => { this.labelOf.set(entity, this.labels.add(text, color)); return entity; };
    const add = (o: ConstructorParameters<typeof Entity>[0]) => viewer.entities.add(o!);
    this.sun = named(add({ point: { pixelSize: 12, color: Color.fromCssColorString("#ffd27a"), translucencyByDistance: FADE } }), t("太阳"), "#ffd27a");
    for (const p of SOLAR_PLANETS) {
      const color = Color.fromCssColorString(p.color);
      // The Earth is the globe itself; it gets a name and a point too, as it is a speck from out here.
      this.planets.set(p.key, named(add({ point: { pixelSize: p.size, color, outlineColor: Color.BLACK, outlineWidth: 1, translucencyByDistance: FADE } }), t(p.name), p.color));
      // All orbits the same thin pale white; the planets' own colours are on their points.
      this.orbits.set(p.key, { entity: add({ polyline: { positions: [], width: 1, arcType: ArcType.NONE, material: ORBIT } }), helio: [] });
    }
    for (const belt of BELT_RINGS) {
      const color = Color.fromCssColorString(belt.color);
      for (const r of [belt.from, belt.to]) {
        this.belts.push({ entity: add({ polyline: { positions: [], width: 1, arcType: ArcType.NONE, material: new PolylineDashMaterialProperty({ color: color.withAlpha(0.45), dashLength: 14 }) } }), helio: eclipticRing(r) });
      }
      const mid = eclipticRing((belt.from + belt.to) / 2, 8)[2];
      this.beltLabels.push({ entity: named(add({}), t(belt.name), belt.color), helio: mid });
    }
  }

  /** The probes (heliocentric = Earth-centred + the Earth's position). */
  setProbes(data: SpaceSnapshot | null): void {
    for (const p of this.probes) { this.viewer.entities.remove(p.entity); const i = this.labelOf.get(p.entity); if (i !== undefined) this.labels.remove(i); }
    this.probes = [];
    const cyan = Color.fromCssColorString("#8fe3ff");
    for (const p of data?.probes ?? []) {
      const info = probeInfo(p.key);
      // The ones near the Earth (Webb, SOHO) would sit on top of it at this scale.
      if (!info || Math.hypot(...p.position) < 0.05 * AU_KM) continue;
      const entity = this.viewer.entities.add({ point: { pixelSize: 5, color: cyan, translucencyByDistance: FADE } });
      this.labelOf.set(entity, this.labels.add(t(info.name.split("（")[0]), "#8fe3ff"));
      this.probes.push({ entity, at: (time) => probeAt(p, time) });
    }
  }

  setSelected(key: SolarBodyKey | null): void {
    this.selected = key;
    for (const [k, entity] of this.planets) entity.point!.pixelSize = new ConstantProperty(SOLAR_PLANETS.find((p) => p.key === k)!.size + (k === key ? 4 : 0));
    // The chosen planet's orbit a little brighter, to see which one it is.
    for (const [k, o] of this.orbits) o.entity.polyline!.material = k === key ? ORBIT_SELECTED : ORBIT;
    this.viewer.scene.requestRender();
  }

  /**
   * Positions at `time` (the solar system's own clock, which can run fast),
   * turned into the Earth-fixed frame of the scene's clock, as the stars are.
   */
  setTime(time: number): void {
    if (this.viewer.isDestroyed()) return;
    const julian = this.viewer.clock.currentTime;
    const m = Transforms.computeIcrfToFixedMatrix(julian) ?? Transforms.computeTemeToPseudoFixedMatrix(julian);
    const sun = sunFromEarth(time);
    const fixed = (v: Vec3) => Matrix3.multiplyByVector(m, new Cartesian3(v[0] * KM, v[1] * KM, v[2] * KM), new Cartesian3());
    // Heliocentric → Earth-centred → fixed.
    const place = (h: Vec3) => fixed([h[0] + sun[0], h[1] + sun[1], h[2] + sun[2]]);

    this.sun.position = new ConstantPositionProperty(fixed(sun));
    for (const [key, entity] of this.planets) entity.position = new ConstantPositionProperty(place(helio(key, time)));
    // Orbits change shape only over centuries: resample at most once a simulated year.
    if (!(Math.abs(time - this.orbitsFrom) < 365 * 86_400_000)) {
      this.orbitsFrom = time;
      for (const [key, o] of this.orbits) o.helio = orbit(key, time);
    }
    for (const o of this.orbits.values()) o.entity.polyline!.positions = new ConstantProperty(o.helio.map(place));
    for (const b of this.belts) b.entity.polyline!.positions = new ConstantProperty(b.helio.map(place));
    for (const b of this.beltLabels) b.entity.position = new ConstantPositionProperty(place(b.helio));
    for (const p of this.probes) p.entity.position = new ConstantPositionProperty(fixed(p.at(time)));
    const julianNow = this.viewer.clock.currentTime;
    for (const [entity, index] of this.labelOf) this.labels.set(index, entity.position?.getValue(julianNow) ?? null);
    this.viewer.scene.requestRender();
  }

  get selectedKey(): SolarBodyKey | null { return this.selected; }

  dispose(): void {
    if (this.viewer.isDestroyed()) return;
    const all = [this.sun, ...this.planets.values(), ...[...this.orbits.values()].map((o) => o.entity), ...this.belts.map((b) => b.entity), ...this.beltLabels.map((b) => b.entity), ...this.probes.map((p) => p.entity)];
    for (const e of all) this.viewer.entities.remove(e);
    this.labels.dispose();
    this.viewer.scene.requestRender();
  }
}

/**
 * A camera looking down on the Sun from the ecliptic's north at `au`
 * astronomical units, slightly tilted, in the Earth-fixed frame of the scene
 * clock. `shift` (fraction of the distance) moves the Sun right of a side panel.
 */
export function solarSystemCamera(viewer: Viewer, au: number, time: number, shift = 0, target: Vec3 | null = null): { destination: Cartesian3; direction: Cartesian3; up: Cartesian3 } {
  const julian = viewer.clock.currentTime;
  const m = Transforms.computeIcrfToFixedMatrix(julian) ?? Transforms.computeTemeToPseudoFixedMatrix(julian);
  const toFixed = (v: Vec3) => Matrix3.multiplyByVector(m, new Cartesian3(v[0], v[1], v[2]), new Cartesian3());
  const sun = sunFromEarth(time);
  const center = target ?? sun;
  const d = au * AU_KM * KM;
  const north = toFixed(ECLIPTIC_NORTH);
  // Tilt: back a little along the direction from the Sun to the Earth, so the plane has depth.
  const tilt = Cartesian3.normalize(toFixed([-sun[0], -sun[1], -sun[2]]), new Cartesian3());
  const centerFixed = Cartesian3.multiplyByScalar(toFixed(center), KM, new Cartesian3());
  const destination = Cartesian3.add(centerFixed, Cartesian3.add(Cartesian3.multiplyByScalar(north, d * 0.9, new Cartesian3()), Cartesian3.multiplyByScalar(tilt, d * 0.42, new Cartesian3()), new Cartesian3()), new Cartesian3());
  const direction = Cartesian3.normalize(Cartesian3.subtract(centerFixed, destination, new Cartesian3()), new Cartesian3());
  const right = Cartesian3.normalize(Cartesian3.cross(direction, north, new Cartesian3()), new Cartesian3());
  const up = Cartesian3.normalize(Cartesian3.cross(right, direction, new Cartesian3()), new Cartesian3());
  if (shift) Cartesian3.add(destination, Cartesian3.multiplyByScalar(right, -shift * d, new Cartesian3()), destination);
  return { destination, direction, up };
}
