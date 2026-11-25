import {
  ArcType, Cartesian2, Cartesian3, Color, ColorMaterialProperty, ConstantPositionProperty, ConstantProperty, Entity, Matrix3, Matrix4, NearFarScalar,
  PerspectiveFrustum, PolylineDashMaterialProperty, SceneTransforms, Transforms, type Viewer,
} from "cesium";
import { closeViewDistanceKm, hasSphere, MOONS, moonFrame, moonPositions, moonViewDistanceKm, PLANET_FACTS, planetFrame, SUN_RADIUS_KM, type MoonInfo, type SphereKey } from "./astronomy/planetBodies.ts";
import { PlanetSpheres } from "./planetSpheres";
import { AU_KM, BELT_RINGS, eclipticRing, ECLIPTIC_NORTH, fromEarth, helio, length, orbit, SOLAR_PLANETS, sunFromEarth, type SolarBodyKey, type Vec3 } from "./astronomy/solarSystem.ts";
import { probeAt, probeInfo, type SpaceSnapshot } from "./spaceData";
import { t } from "./i18n";

/**
 * The solar system around the globe: the planets (and Pluto) at their
 * positions for a moment, their orbits, the asteroid and Kuiper belts, the
 * Sun, and the deep space probes. Everything is computed heliocentric in the
 * ICRF, made Earth-centred, and turned into the Earth-fixed frame of the
 * scene's clock, so it lines up with the star background.
 */


/** What the camera can turn around: the Sun, a planet, or a moon (by its key). */
export type PivotKey = "sun" | SolarBodyKey | string;
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
  private items: { el: HTMLSpanElement; position: Cartesian3 | null; offset: number }[] = [];
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
    this.items.push({ el, position: null, offset: 0 });
    return this.items.length - 1;
  }

  set(index: number, position: Cartesian3 | null): void { this.items[index].position = position; }

  /** Extra distance (px) from the point, to clear a planet's disc. */
  setOffset(index: number, px: number): void { this.items[index].offset = px; }

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
      item.el.style.transform = `translate(${Math.round(screen.x + 9 + item.offset * 0.72)}px, ${Math.round(screen.y - 8 - item.offset * 0.72)}px)`;
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
  /** What the camera turns around (the Sun or a planet), as the camera's own transform; null: the Earth, as usual. */
  private pivotKey: PivotKey | null = null;
  private pivotMatrix: Matrix4 | null = null;
  /** The pivot body's radius, m: our zoom stops a little outside it. */
  private pivotRadius = 0;
  /** Cesium's own zoom setting, restored when the pivot goes. */
  private cesiumZoom = true;
  private removeZoom: () => void = () => {};
  private restoreCamera: () => void;
  private spheres: PlanetSpheres;
  private moons: { moon: MoonInfo; entity: Entity; label: number; position: Cartesian3 | null }[] = [];
  /** Per planet: whether its point is hidden behind its disc, and its moons shown. */
  private near = new Map<SphereKey, { disc: boolean; moons: boolean }>();
  private removePreRender: () => void;
  private closeView = false;
  private minimumZoom: number;
  private constrainedAxis: Cartesian3 | undefined;
  /** J2000 → Earth-fixed at the scene clock (the frame everything here is drawn in). */
  private toFixed: Matrix3 = Matrix3.IDENTITY;

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
    this.spheres = new PlanetSpheres(viewer);
    for (const moon of MOONS) {
      const entity = add({ show: false, point: { pixelSize: 4, color: Color.fromCssColorString("#ddd6c8") } });
      this.moons.push({ moon, entity, label: this.labels.add(t(moon.name), "#ddd6c8"), position: null });
    }
    this.minimumZoom = viewer.scene.screenSpaceCameraController.minimumZoomDistance;
    this.constrainedAxis = viewer.camera.constrainedAxis && Cartesian3.clone(viewer.camera.constrainedAxis);
    this.removePreRender = viewer.scene.preRender.addEventListener(() => this.updateNear());
    // Any other flight (reset, search, a place) is in Earth coordinates: give the camera back to the Earth first.
    const camera = viewer.camera;
    const flyTo = camera.flyTo, setView = camera.setView;
    camera.flyTo = (options) => { if (!options.endTransform) this.setPivot(null); return flyTo.call(camera, options); };
    camera.setView = (options) => { if (!options?.endTransform) this.setPivot(null); return setView.call(camera, options); };
    this.restoreCamera = () => { camera.flyTo = flyTo; camera.setView = setView; };
    this.removeZoom = this.installZoom();
  }

  /**
   * Zoom toward the pivot body. Cesium's zoom moves along the view direction
   * (or the ray under the cursor) by steps sized by the height over the
   * Earth: near a planet shown right of the side panel that went off to one
   * side, by steps fit for the Earth's distance. Around a body, the wheel and
   * a two-finger pinch instead scale the camera's distance to the body's
   * centre, keeping its direction, so the body stays where it is on screen.
   */
  private installZoom(): () => void {
    const canvas = this.viewer.scene.canvas;
    const onWheel = (event: WheelEvent) => {
      if (!this.pivotActive()) return;
      event.preventDefault();
      const pixels = event.deltaY * (event.deltaMode === 1 ? 40 : event.deltaMode === 2 ? 800 : 1);
      this.zoomBy(Math.exp(Math.max(-400, Math.min(400, pixels)) * 0.0015));
    };
    const touches = new Map<number, { x: number; y: number }>();
    let spread = 0;
    const span = () => { const [a, b] = [...touches.values()]; return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0; };
    const onDown = (event: PointerEvent) => { if (event.pointerType === "touch") { touches.set(event.pointerId, { x: event.clientX, y: event.clientY }); spread = span(); } };
    const onMove = (event: PointerEvent) => {
      if (event.pointerType !== "touch" || !touches.has(event.pointerId)) return;
      touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (touches.size !== 2 || !this.pivotActive()) return;
      const now = span();
      if (spread > 0 && now > 0) this.zoomBy(spread / now);
      spread = now;
    };
    const onUp = (event: PointerEvent) => { touches.delete(event.pointerId); spread = span(); };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    for (const type of ["pointerup", "pointercancel", "pointerleave"] as const) canvas.addEventListener(type, onUp);
    return () => {
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      for (const type of ["pointerup", "pointercancel", "pointerleave"] as const) canvas.removeEventListener(type, onUp);
    };
  }

  private pivotActive(): boolean {
    return this.pivotMatrix !== null && Matrix4.equals(this.viewer.camera.transform, this.pivotMatrix);
  }

  /** Scales the camera's distance to the pivot body's centre by `factor` (in the pivot's frame, the body is the origin). */
  zoomBy(factor: number): void {
    if (!this.pivotActive()) return;
    const camera = this.viewer.camera;
    const d = Cartesian3.magnitude(camera.position);
    if (!(d > 0)) return;
    const target = Math.min(Math.max(d * factor, this.pivotRadius * 1.15), 2e14);
    Cartesian3.multiplyByScalar(camera.position, target / d, camera.position);
    this.viewer.scene.requestRender();
  }

  /** The point rotation and zoom turn around: the Sun, a planet, or (null) the Earth again. */
  setPivot(key: PivotKey | null): void {
    const camera = this.viewer.camera;
    const ours = this.pivotMatrix !== null && Matrix4.equals(camera.transform, this.pivotMatrix);
    this.pivotKey = key;
    const controller = this.viewer.scene.screenSpaceCameraController;
    if (key === null) {
      if (ours) camera.lookAtTransform(Matrix4.IDENTITY);
      if (this.pivotMatrix) {
        camera.constrainedAxis = this.constrainedAxis && Cartesian3.clone(this.constrainedAxis);
        controller.minimumZoomDistance = this.minimumZoom;
        controller.enableZoom = this.cesiumZoom;
      }
      this.pivotMatrix = null;
      return;
    }
    const origin = this.positionOf(key);
    if (!origin) return;
    // Around a body the zoom limit is measured from it, less the Earth's radius (Cesium
    // measures height over the Earth's ellipsoid): keep the camera outside the body,
    // and not so close to the centre that Cesium's rotation (scaled by that height) stalls.
    const EARTH = 6_371_000;
    const moon = MOONS.find((m) => m.key === key);
    const radius = (key === "sun" ? SUN_RADIUS_KM * 1.6 : moon ? moon.radius * 1.6 : hasSphere(key as SolarBodyKey) ? PLANET_FACTS[key as SphereKey].radius * 1.6 : 0) * KM;
    controller.minimumZoomDistance = Math.max(this.minimumZoom, radius - EARTH, EARTH * 0.5);
    this.pivotRadius = radius / 1.6;
    // Our zoom (zoomBy) replaces Cesium's while the camera turns around a body.
    if (!this.pivotMatrix) this.cesiumZoom = controller.enableZoom;
    controller.enableZoom = false;
    // The pivot's frame is the stars' (J2000), not the Earth's: it does not turn with
    // the Earth, and rotation goes round the ecliptic's pole, so the planets' plane
    // stays level instead of wobbling round the Earth's axis.
    this.pivotMatrix = Matrix4.fromRotationTranslation(this.toFixed, origin);
    // Keeps the camera where it is; only the centre and frame of rotation change.
    camera.lookAtTransform(this.pivotMatrix);
    camera.constrainedAxis = new Cartesian3(...ECLIPTIC_NORTH);
    this.viewer.scene.requestRender();
  }

  private positionOf(key: PivotKey): Cartesian3 | undefined {
    const moon = this.moons.find((x) => x.moon.key === key);
    if (moon) return moon.position ?? undefined;
    const entity = key === "sun" ? this.sun : this.planets.get(key as SolarBodyKey);
    return entity?.position?.getValue(this.viewer.clock.currentTime);
  }

  /**
   * Close to a planet: its textured disc (once more than a pixel across) in
   * place of its point, and its moons (once their orbits spread out on screen).
   */
  private updateNear(): void {
    const { camera, canvas } = this.viewer.scene;
    const fovy = camera.frustum instanceof PerspectiveFrustum ? camera.frustum.fovy ?? 1 : 1;
    const pxPerRadian = canvas.clientHeight / 2 / Math.tan(fovy / 2);
    let changed = false;
    for (const key of Object.keys(PLANET_FACTS) as SphereKey[]) {
      const center = this.spheres.center(key);
      if (!center) continue;
      const d = Math.max(1, Cartesian3.distance(camera.positionWC, center));
      const discPx = (PLANET_FACTS[key].radius * KM / d) * pxPerRadian;
      this.spheres.setVisible(key, discPx > 0.6);
      const moons = this.moons.filter((x) => x.moon.planet === key);
      const orbitPx = moons.length ? (Math.min(...moons.map((x) => x.moon.distance)) * KM / d) * pxPerRadian : 0;
      const state = { disc: discPx > 4, moons: orbitPx > 10 };
      const before = this.near.get(key);
      const planet = this.planets.get(key)!;
      const label = this.labelOf.get(planet);
      if (label !== undefined) this.labels.setOffset(label, state.disc ? discPx : 0);
      if (before && before.disc === state.disc && before.moons === state.moons) continue;
      this.near.set(key, state);
      changed = true;
      planet.point!.show = new ConstantProperty(!state.disc);
      for (const item of moons) {
        item.entity.show = state.moons;
        this.labels.set(item.label, state.moons ? item.position : null);
      }
    }
    // Moons with a map: their sphere once more than a pixel across, and in place of their point once it is a disc.
    for (const item of this.moons) {
      if (!item.moon.texture || !item.position) continue;
      const d = Math.max(1, Cartesian3.distance(camera.positionWC, item.position));
      const discPx = (item.moon.radius * KM / d) * pxPerRadian;
      const planetNear = this.near.get(item.moon.planet)?.moons ?? false;
      this.spheres.setVisible(item.moon.key, planetNear && discPx > 0.6);
      const disc = planetNear && discPx > 4;
      if ((item.entity.point!.show?.getValue(this.viewer.clock.currentTime) ?? true) === disc) {
        item.entity.point!.show = new ConstantProperty(!disc);
        changed = true;
      }
      this.labels.setOffset(item.label, disc ? discPx : 0);
    }
    // In a close view the orbits and belts would cut across the disc: hide them.
    const close = [...this.near.values()].some((n) => n.disc);
    if (close !== this.closeView) {
      this.closeView = close;
      for (const o of this.orbits.values()) o.entity.show = !close;
      for (const b of this.belts) b.entity.show = !close;
      changed = true;
    }
    if (changed) this.viewer.scene.requestRender();
  }

  /** After the bodies move, the camera moves with its pivot (keeping its offset and direction). */
  private followPivot(): void {
    if (!this.pivotKey || !this.pivotMatrix) return;
    const camera = this.viewer.camera;
    // Something else took the camera (a satellite, a show): leave it alone.
    if (!Matrix4.equals(camera.transform, this.pivotMatrix)) {
      this.pivotKey = null;
      this.pivotMatrix = null;
      camera.constrainedAxis = this.constrainedAxis && Cartesian3.clone(this.constrainedAxis);
      this.viewer.scene.screenSpaceCameraController.minimumZoomDistance = this.minimumZoom;
      this.viewer.scene.screenSpaceCameraController.enableZoom = this.cesiumZoom;
      return;
    }
    const origin = this.positionOf(this.pivotKey);
    if (!origin) return;
    // Keep the camera's place and orientation in the pivot's (star-fixed) frame.
    const position = Cartesian3.clone(camera.position), direction = Cartesian3.clone(camera.direction), up = Cartesian3.clone(camera.up);
    this.pivotMatrix = Matrix4.fromRotationTranslation(this.toFixed, origin);
    camera.lookAtTransform(this.pivotMatrix);
    Cartesian3.clone(position, camera.position);
    Cartesian3.clone(direction, camera.direction);
    Cartesian3.clone(up, camera.up);
    Cartesian3.cross(direction, up, camera.right);
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
    this.toFixed = Matrix3.clone(m);
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
    // The planets' discs and moons, for the close views.
    for (const key of Object.keys(PLANET_FACTS) as SphereKey[]) {
      const h = helio(key, time);
      const center = place(h);
      const frame = planetFrame(key, time);
      const toSun = Cartesian3.normalize(fixed([-h[0], -h[1], -h[2]]), new Cartesian3());
      this.spheres.setPose(key, PLANET_FACTS[key], center, m, frame.body, frame.equator, toSun);
      for (const { moon, position } of moonPositions(key, time)) {
        const item = this.moons.find((x) => x.moon.key === moon.key)!;
        item.position = Cartesian3.add(center, fixed(position), new Cartesian3());
        item.entity.position = new ConstantPositionProperty(item.position);
        // Moons with a map: a sphere keeping one face to the planet, lit like it.
        if (moon.texture) {
          const body = moonFrame(moon, time);
          this.spheres.setPose(moon.key, { radius: moon.radius, polarRadius: moon.radius, texture: moon.texture }, item.position, m, body, body, toSun);
        }
      }
    }
    const julianNow = this.viewer.clock.currentTime;
    for (const [entity, index] of this.labelOf) this.labels.set(index, entity.position?.getValue(julianNow) ?? null);
    this.near.clear();
    this.updateNear();
    this.followPivot();
    this.viewer.scene.requestRender();
  }

  get selectedKey(): SolarBodyKey | null { return this.selected; }

  dispose(): void {
    if (this.viewer.isDestroyed()) return;
    this.setPivot(null);
    this.removeZoom();
    this.restoreCamera();
    this.removePreRender();
    this.spheres.dispose();
    for (const item of this.moons) this.viewer.entities.remove(item.entity);
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

/**
 * A close look at one of the moons drawn as spheres: from its day side, a
 * little to one side, close enough for the disc to fill much of the view.
 */
export function moonCamera(viewer: Viewer, key: string, time: number, shift = 0): { destination: Cartesian3; direction: Cartesian3; up: Cartesian3 } | null {
  const moon = MOONS.find((m) => m.key === key);
  if (!moon) return null;
  const julian = viewer.clock.currentTime;
  const m = Transforms.computeIcrfToFixedMatrix(julian) ?? Transforms.computeTemeToPseudoFixedMatrix(julian);
  const toFixed = (v: Vec3) => Matrix3.multiplyByVector(m, new Cartesian3(v[0], v[1], v[2]), new Cartesian3());
  const planetHelio = helio(moon.planet, time);
  const rel = moonPositions(moon.planet, time).find((x) => x.moon.key === key)!.position;
  const fromEarthKm = fromEarth(moon.planet, time);
  const center = Cartesian3.multiplyByScalar(toFixed([fromEarthKm[0] + rel[0], fromEarthKm[1] + rel[1], fromEarthKm[2] + rel[2]]), KM, new Cartesian3());
  const d = moonViewDistanceKm(moon) * KM;
  const north = toFixed(ECLIPTIC_NORTH);
  const toSun = Cartesian3.normalize(toFixed([-(planetHelio[0] + rel[0]), -(planetHelio[1] + rel[1]), -(planetHelio[2] + rel[2])]), new Cartesian3());
  const side = Cartesian3.normalize(Cartesian3.cross(north, toSun, new Cartesian3()), new Cartesian3());
  const offset = Cartesian3.normalize(Cartesian3.add(Cartesian3.add(Cartesian3.multiplyByScalar(toSun, 0.85, new Cartesian3()), Cartesian3.multiplyByScalar(north, 0.3, new Cartesian3()), new Cartesian3()), Cartesian3.multiplyByScalar(side, 0.5, new Cartesian3()), new Cartesian3()), new Cartesian3());
  const destination = Cartesian3.add(center, Cartesian3.multiplyByScalar(offset, d, new Cartesian3()), new Cartesian3());
  const direction = Cartesian3.normalize(Cartesian3.subtract(center, destination, new Cartesian3()), new Cartesian3());
  const right = Cartesian3.normalize(Cartesian3.cross(direction, north, new Cartesian3()), new Cartesian3());
  const up = Cartesian3.normalize(Cartesian3.cross(right, direction, new Cartesian3()), new Cartesian3());
  if (shift) Cartesian3.add(destination, Cartesian3.multiplyByScalar(right, -shift * d, new Cartesian3()), destination);
  return { destination, direction, up };
}

/**
 * A close look at one planet: from its day side, a little above the ecliptic
 * and to one side (so the disc has a terminator), at a distance that shows
 * the whole disc (and the rings).
 */
export function planetCamera(viewer: Viewer, key: SolarBodyKey, time: number, shift = 0): { destination: Cartesian3; direction: Cartesian3; up: Cartesian3 } {
  const julian = viewer.clock.currentTime;
  const m = Transforms.computeIcrfToFixedMatrix(julian) ?? Transforms.computeTemeToPseudoFixedMatrix(julian);
  const toFixed = (v: Vec3) => Matrix3.multiplyByVector(m, new Cartesian3(v[0], v[1], v[2]), new Cartesian3());
  const h = helio(key, time);
  const d = (hasSphere(key) ? closeViewDistanceKm(key) : Math.max(0.05 * AU_KM, length(h) * 0.03)) * KM;
  const north = toFixed(ECLIPTIC_NORTH);
  const toSun = Cartesian3.normalize(toFixed([-h[0], -h[1], -h[2]]), new Cartesian3());
  // Saturn from well above its ring plane, so the ring opens up (seen from the Sun it is nearly edge-on around 2025).
  const above = hasSphere(key) && PLANET_FACTS[key].ring ? toFixed(planetFrame(key, time).north) : north;
  const side = Cartesian3.normalize(Cartesian3.cross(north, toSun, new Cartesian3()), new Cartesian3());
  const offset = Cartesian3.normalize(Cartesian3.add(Cartesian3.add(Cartesian3.multiplyByScalar(toSun, 0.85, new Cartesian3()), Cartesian3.multiplyByScalar(above, above === north ? 0.35 : 0.75, new Cartesian3()), new Cartesian3()), Cartesian3.multiplyByScalar(side, 0.55, new Cartesian3()), new Cartesian3()), new Cartesian3());
  const center = Cartesian3.multiplyByScalar(toFixed(fromEarth(key, time)), KM, new Cartesian3());
  const destination = Cartesian3.add(center, Cartesian3.multiplyByScalar(offset, d, new Cartesian3()), new Cartesian3());
  const direction = Cartesian3.normalize(Cartesian3.subtract(center, destination, new Cartesian3()), new Cartesian3());
  const right = Cartesian3.normalize(Cartesian3.cross(direction, north, new Cartesian3()), new Cartesian3());
  const up = Cartesian3.normalize(Cartesian3.cross(right, direction, new Cartesian3()), new Cartesian3());
  if (shift) Cartesian3.add(destination, Cartesian3.multiplyByScalar(right, -shift * d, new Cartesian3()), destination);
  return { destination, direction, up };
}
