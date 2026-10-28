import {
  BillboardCollection, BoundingSphere, Cartesian3, Color, Ellipsoid,
  EllipsoidalOccluder, HeadingPitchRange, LabelCollection, Matrix4, PerspectiveFrustum,
  PointPrimitiveCollection, PolylineCollection, Transforms,
  type Billboard, type Label, type PointPrimitive, type Polyline, type Viewer,
} from "cesium";
import { getExperience } from "./experience.ts";
import { createFireworkShow, particleAt, FIREWORK_STYLES, type FireworkParticle, type FireworkShow } from "./physics.ts";
import { rocketFrame } from "./rocketFlight.ts";
import { cameraRange, GIANT_SCALE, starStride, planCenter, planDuration, planError, siteDelay, siteDistance, SPACE_DURATION, type SpaceSite } from "./spacePlan.ts";
import { getSpaceState, subscribeSpace, updateSpace } from "./spaceState.ts";
import { RENDER_PROFILES } from "../performance.ts";
import { subscribeLocale, t } from "../i18n.ts";
import { EFFECT_BLEND, effectTexture, siteLabelStyle } from "./visualTextures.ts";
import { cometMaterial, fadeSparks, RibbonCollection, sparkMaterials } from "./visualMaterials.ts";
import { sparkWake } from "./showVisuals.ts";

interface Base { frame: Matrix4; site: SpaceSite; delay: number; anchor: Cartesian3; label: Label }
interface Fireworks extends Base {
  kind: "fireworks"; show: FireworkShow; materials: ReturnType<typeof sparkMaterials>;
  stars: { particle: FireworkParticle; head: PointPrimitive; glow: Billboard; wake: Polyline; rgb: readonly [number, number, number] }[];
  flashes: Billboard[]; launches: { head: Billboard; trail: Polyline }[]; samples: number;
}
interface Rocket extends Base { kind: "rocket"; head: PointPrimitive; flame: Billboard; trail: Polyline }
type Visual = Fireworks | Rocket;

/** One shared clock and particle budget; no city assets, global lighting or timeline changes. */
export class SpaceShow {
  private viewer: Viewer;
  private onRunning: (running: boolean) => void;
  private points: PointPrimitiveCollection | null = null;
  private glows: BillboardCollection | null = null;
  private labels: LabelCollection | null = null;
  private trails: PolylineCollection | null = null;
  private visuals: Visual[] = [];
  private sites: SpaceSite[] = [];
  private occluder: EllipsoidalOccluder;
  private frameId = 0;
  private previousTime = 0;
  private elapsed = 0;
  private lastStatus = -1;
  private duration = SPACE_DURATION;
  private generation = 0;
  private pendingFlight = false;
  private disposed = false;
  private running = false;
  private scratch = new Cartesian3();
  private color = new Color();
  private removeSettings: () => void;
  private removeLocale: () => void;
  private cameraKey = "";

  constructor(viewer: Viewer, onRunning: (running: boolean) => void) {
    this.viewer = viewer; this.onRunning = onRunning;
    this.occluder = new EllipsoidalOccluder(Ellipsoid.WGS84);
    this.removeSettings = subscribeSpace(() => {
      const s = getSpaceState(), key = `${s.tilt},${s.zoom},${s.heading},${s.reset}`;
      if (key !== this.cameraKey) {
        this.cameraKey = key;
        if (getExperience().mode === "space" && !planError(s.sites)) this.fitCamera(false);
      }
    });
    window.addEventListener("resize", this.onResize);
    this.removeLocale = subscribeLocale(() => {
      if (viewer.isDestroyed()) return;
      this.visuals.forEach(v => { v.label.text = t(v.site.label) + " · " + t(v.kind === "rocket" ? "火箭" : "巨型烟花"); });
      viewer.scene.requestRender();
    });
  }

  launch(): boolean {
    const settings = getSpaceState(), error = planError(settings.sites);
    if (error || this.disposed || this.viewer.isDestroyed()) { if (error) updateSpace({ message: error }); return false; }
    this.stop();
    const generation = ++this.generation;
    this.sites = settings.sites.map(site => ({ ...site }));
    this.duration = planDuration(this.sites.length, settings.relay);
    this.points = this.viewer.scene.primitives.add(new PointPrimitiveCollection());
    this.glows = this.viewer.scene.primitives.add(new BillboardCollection({ blendOption: EFFECT_BLEND }));
    this.labels = this.viewer.scene.primitives.add(new LabelCollection());
    this.trails = this.viewer.scene.primitives.add(new RibbonCollection());
    const eco = this.viewer.targetFrameRate <= RENDER_PROFILES.eco.targetFrameRate;
    const point = () => this.points!.add({ show: false, pixelSize: 3, disableDepthTestDistance: 0 });
    const glow = (comet = false) => { const b = this.glows!.add({ show: false, position: Cartesian3.ZERO }); b.setImage(comet ? "space-comet" : "space-halo", effectTexture(comet ? "comet" : "halo")); return b; };
    this.visuals = this.sites.map((site, index): Visual => {
      // Fireworks captions hang just below their bursts (100-370 km up), so the
      // name and the show read together; rockets are captioned at the pad.
      const anchor = Cartesian3.fromDegrees(site.longitude, site.latitude, site.kind === "rocket" ? 3000 : GIANT_SCALE * 120);
      const base: Base = { site, anchor, frame: Transforms.eastNorthUpToFixedFrame(Cartesian3.fromDegrees(site.longitude, site.latitude)),
        delay: siteDelay(index, settings.relay), label: this.labels!.add({ position: anchor, text: t(site.label) + " · " + t(site.kind === "rocket" ? "火箭" : "巨型烟花"),
          ...siteLabelStyle(), show: false }),
      };
      if (site.kind === "rocket") return { ...base, kind: "rocket", head: point(), flame: glow(true), trail: this.trails!.add({ positions: [], width: eco ? 6 : 10,
        material: cometMaterial(), show: false }) };
      const style = FIREWORK_STYLES[index % FIREWORK_STYLES.length];
      const show = createFireworkShow(style, 2026 + index * 97), materials = sparkMaterials(show, style);
      const stride = starStride(show.particles.length, eco);
      const ascentMaterial = cometMaterial();
      return { ...base, kind: "fireworks", show, materials, samples: eco ? 4 : 7, flashes: show.bursts.map(() => glow()),
        launches: show.bursts.map(() => ({ head: glow(true), trail: this.trails!.add({ positions: [], width: eco ? 3 : 5, material: ascentMaterial, show: false }) })),
        stars: show.particles.filter((_, i) => i % stride === 0).map(particle => {
          const tint = materials.byParticle.get(particle)!;
          return { particle, head: point(), glow: glow(), rgb: tint.rgb,
            wake: this.trails!.add({ positions: [], width: eco ? 2.5 : 4, material: tint.material, show: false }) };
        }) };
    });
    this.elapsed = 0; this.previousTime = 0; this.lastStatus = -1;
    this.running = true; this.onRunning(true);
    document.addEventListener("visibilitychange", this.onVisibility);
    updateSpace({ phase: "flying", elapsed: 0, message: "" });
    this.fitCamera(true, () => {
      if (generation !== this.generation || this.disposed) return;
      this.pendingFlight = false;
      updateSpace({ phase: "playing" }); this.schedule();
    });
    return true;
  }

  private fitCamera(animate: boolean, complete?: () => void) {
    if (this.viewer.isDestroyed()) return;
    const s = getSpaceState();
    if (!this.running && !planError(s.sites)) this.sites = s.sites.map(site => ({ ...site }));
    if (!this.sites.length) return;
    const center = planCenter(this.sites);
    const centerSite = { ...center, label: "center", kind: "fireworks" as const };
    const span = Math.max(...this.sites.map(site => siteDistance(centerSite, site)));
    const canvas = this.viewer.scene.canvas, frustum = this.viewer.camera.frustum;
    const fov = frustum instanceof PerspectiveFrustum ? frustum.fovy ?? Math.PI / 3 : Math.PI / 3;
    const range = cameraRange(span, fov, canvas.clientWidth / Math.max(1, canvas.clientHeight), s.zoom);
    const target = Cartesian3.fromDegrees(center.longitude, center.latitude, 110_000);
    const offset = new HeadingPitchRange(s.heading * Math.PI / 180, -Math.max(8, Math.min(90, s.tilt)) * Math.PI / 180, range);
    if (animate) {
      this.pendingFlight = true;
      this.viewer.camera.flyToBoundingSphere(new BoundingSphere(target, 220_000), {
        offset, duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 1.6,
        complete: () => { this.viewer.camera.lookAtTransform(Matrix4.IDENTITY); complete?.(); },
        cancel: () => { if (this.pendingFlight) this.stop(); },
      });
    } else {
      // A slider takes over the approach flight, not the performance itself.
      // Clear the flag before cancelFlight so its cancel callback cannot stop us.
      if (this.pendingFlight) {
        this.pendingFlight = false;
        this.viewer.camera.cancelFlight();
        updateSpace({ phase: "playing" });
        this.schedule();
      }
      this.viewer.camera.lookAt(target, offset);
      this.viewer.camera.lookAtTransform(Matrix4.IDENTITY);
    }
    this.viewer.scene.requestRender();
  }

  private position(v: Base, east: number, north: number, height: number, result = this.scratch) {
    Cartesian3.fromElements(east, north, height, result);
    return Matrix4.multiplyByPoint(v.frame, result, result);
  }

  private rgba(r: number, g: number, b: number, a: number) {
    this.color.red = r; this.color.green = g; this.color.blue = b; this.color.alpha = a;
    return this.color;
  }

  private frame = (timestamp: number) => {
    this.frameId = 0;
    if (!this.running || this.disposed || this.viewer.isDestroyed()) return;
    const eco = this.viewer.targetFrameRate <= RENDER_PROFILES.eco.targetFrameRate;
    if (this.previousTime && timestamp - this.previousTime < (eco ? 50 : 33)) { this.schedule(); return; }
    if (this.previousTime) this.elapsed += Math.max(0, (timestamp - this.previousTime) / 1000);
    this.previousTime = timestamp;
    this.occluder.cameraPosition = this.viewer.camera.positionWC;
    for (const v of this.visuals) {
      const t = this.elapsed - v.delay;
      v.label.show = this.occluder.isPointVisible(v.anchor);
      if (v.label.show) this.fadeLabel(v.label, t);
      if (v.kind === "rocket") this.drawRocket(v, t);
      else this.drawFireworks(v, t);
    }
    if (this.elapsed - this.lastStatus >= 0.25) { this.lastStatus = this.elapsed; updateSpace({ elapsed: Math.min(this.elapsed, this.duration) }); }
    this.viewer.scene.requestRender();
    if (this.elapsed >= this.duration) this.stop(true);
    else this.schedule();
  };

  /** Captions introduce each site, then step back once its show begins. */
  private fadeLabel(label: Label, t: number) {
    const alpha = Math.round((1 - 0.6 * Math.min(1, Math.max(0, (t - 3) / 1.5))) * 20) / 20;
    if (label.fillColor.alpha === alpha) return;
    label.fillColor = label.fillColor.withAlpha(alpha);
    label.outlineColor = label.outlineColor.withAlpha(0.75 * alpha);
  }

  private drawFireworks(v: Fireworks, t: number) {
    const showTime = Math.max(0, t - 3);
    // Four complete cycles; let every last star fade rather than cutting a burst.
    const local = showTime < 40 ? showTime % 10 : 10 + showTime - 40;
    const active = t >= 3 && t < SPACE_DURATION;
    fadeSparks(v.materials.entries, local);
    for (const { particle, head, glow, wake, rgb } of v.stars) {
      const p = active ? particleAt(particle, local) : null;
      head.show = glow.show = wake.show = false;
      if (p) {
        const world = this.position(v, p.east * GIANT_SCALE, p.north * GIANT_SCALE, p.height * GIANT_SCALE);
        head.show = this.occluder.isPointVisible(world); head.position = world;
        head.pixelSize = 1.8 + p.heat * 1.5;
        head.color = this.rgba(rgb[0] + (1 - rgb[0]) * 0.6, rgb[1] + (1 - rgb[1]) * 0.6, rgb[2] + (1 - rgb[2]) * 0.6, p.opacity);
        glow.show = head.show; glow.position = world;
        glow.width = glow.height = 18 + p.heat * 22;
        glow.color = this.rgba(...rgb, p.opacity * 0.36);
        const positions = sparkWake(particle, local, v.samples, 2.1).map(sample => this.position(v, sample.east * GIANT_SCALE, sample.north * GIANT_SCALE, sample.height * GIANT_SCALE, new Cartesian3()));
        wake.show = head.show && positions.length > 1;
        if (positions.length > 1) wake.positions = positions;
      }
    }
    v.flashes.forEach((flash, index) => {
      const burst = v.show.bursts[index], since = local - burst.start;
      const world = this.position(v, burst.east * GIANT_SCALE, burst.north * GIANT_SCALE, burst.height * GIANT_SCALE);
      flash.show = active && since >= 0 && since < 0.65 && this.occluder.isPointVisible(world);
      if (flash.show) {
        flash.position = world; flash.width = flash.height = 130 + since * 170;
        flash.color = this.rgba(...v.materials.entries[index].rgb, (1 - since / 0.65) * 0.55);
      }
      const ascent = local - burst.start + 0.78, launch = v.launches[index];
      launch.head.show = launch.trail.show = active && ascent >= 0 && ascent < 0.78;
      if (launch.head.show) {
        const positions = Array.from({ length: 8 }, (_, i) => {
          const fraction = Math.max(0, (ascent - (1 - i / 7) * 0.34) / 0.78);
          return this.position(v, burst.east * GIANT_SCALE, burst.north * GIANT_SCALE, Math.max(500, burst.height * fraction * fraction * GIANT_SCALE), new Cartesian3());
        });
        const head = positions[positions.length - 1];
        launch.head.show = launch.trail.show = this.occluder.isPointVisible(head);
        launch.head.position = head; launch.head.width = 12; launch.head.height = 35; launch.head.color = Color.WHITE;
        launch.head.alignedAxis = Matrix4.multiplyByPointAsVector(v.frame, Cartesian3.UNIT_Z, new Cartesian3());
        launch.trail.positions = positions;
      }
    });
  }

  private drawRocket(v: Rocket, t: number) {
    const state = rocketFrame(Math.max(0, t));
    const world = this.position(v, state.east * 5, 0, state.altitude * 5 + 1000);
    v.head.show = t >= 0 && t < SPACE_DURATION && this.occluder.isPointVisible(world);
    const fade = t > 45 ? Math.max(0, (SPACE_DURATION - t) / 3) : 1;
    v.head.position = world; v.head.pixelSize = 2.5; v.head.color = this.rgba(1, 0.95, 0.82, fade);
    v.flame.show = v.head.show && state.thrust; v.flame.position = world;
    v.flame.width = 24; v.flame.height = 60; v.flame.color = this.rgba(1, 1, 1, fade);
    const past = rocketFrame(Math.max(3, t - 0.1));
    const previous = this.position(v, past.east * 5, 0, past.altitude * 5 + 1000, new Cartesian3());
    const velocity = Cartesian3.subtract(world, previous, new Cartesian3());
    if (Cartesian3.magnitudeSquared(velocity) > 0.01) v.flame.alignedAxis = Cartesian3.normalize(velocity, velocity);
    const positions: Cartesian3[] = [];
    if (t >= 3 && t < SPACE_DURATION) {
      for (let i = 0; i <= 60; i++) {
        const historical = rocketFrame(3 + (Math.min(t, 45) - 3) * i / 60);
        const p = this.position(v, historical.east * 5, 0, historical.altitude * 5 + 1000, new Cartesian3());
        if (this.occluder.isPointVisible(p)) positions.push(p);
      }
    }
    v.trail.show = positions.length > 1;
    v.trail.material.uniforms.fade = fade;
    if (positions.length > 1) v.trail.positions = positions;
  }

  private schedule() { if (!document.hidden && this.running && !this.frameId) this.frameId = requestAnimationFrame(this.frame); }
  private onVisibility = () => { if (document.hidden) { cancelAnimationFrame(this.frameId); this.frameId = 0; } else { this.previousTime = 0; this.schedule(); } };
  private onResize = () => { if (getExperience().mode === "space" && this.sites.length) this.fitCamera(false); };

  stop(completed = false) {
    this.generation++; this.running = false;
    cancelAnimationFrame(this.frameId); this.frameId = 0;
    document.removeEventListener("visibilitychange", this.onVisibility);
    if (this.pendingFlight && !this.viewer.isDestroyed()) { this.pendingFlight = false; this.viewer.camera.cancelFlight(); }
    if (!this.viewer.isDestroyed()) {
      for (const collection of [this.points, this.glows, this.labels, this.trails]) if (collection) this.viewer.scene.primitives.remove(collection);
      this.viewer.scene.requestRender();
    }
    this.points = null; this.glows = null; this.labels = null; this.trails = null; this.visuals = [];
    updateSpace({ phase: completed ? "complete" : "idle", elapsed: completed ? this.duration : 0 });
    if (!this.disposed) this.onRunning(false);
  }
  dispose() { this.disposed = true; this.stop(); this.removeSettings(); this.removeLocale(); window.removeEventListener("resize", this.onResize); }
}
