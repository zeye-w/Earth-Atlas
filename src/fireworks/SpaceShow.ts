import {
  BillboardCollection, BlendOption, BoundingSphere, Cartesian3, Color, Ellipsoid,
  EllipsoidalOccluder, HeadingPitchRange, LabelCollection, Matrix4, PerspectiveFrustum,
  PointPrimitiveCollection, PolylineCollection, Material, Transforms,
  type Billboard, type Label, type PointPrimitive, type Polyline, type Viewer,
} from "cesium";
import { getExperience } from "./experience.ts";
import { createFireworkShow, particleAt, FIREWORK_STYLES, type FireworkParticle, type FireworkShow } from "./physics.ts";
import { rocketFrame } from "./rocketFlight.ts";
import { cameraRange, GIANT_SCALE, planCenter, planDuration, planError, siteDelay, siteDistance, SPACE_DURATION, type SpaceSite } from "./spacePlan.ts";
import { getSpaceState, subscribeSpace, updateSpace } from "./spaceState.ts";
import { RENDER_PROFILES } from "../performance.ts";

interface Base { frame: Matrix4; site: SpaceSite; delay: number; ground: Cartesian3; label: Label }
interface Fireworks extends Base { kind: "fireworks"; show: FireworkShow; stars: { particle: FireworkParticle; head: PointPrimitive; tails: PointPrimitive[] }[]; flashes: Billboard[] }
interface Rocket extends Base { kind: "rocket"; head: PointPrimitive; flame: Billboard; trail: Polyline }
type Visual = Fireworks | Rocket;
let halo: HTMLCanvasElement | null = null;
function haloImage() {
  if (halo) return halo;
  halo = document.createElement("canvas"); halo.width = halo.height = 64;
  const ctx = halo.getContext("2d");
  if (ctx) {
    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, "rgba(255,255,255,1)"); gradient.addColorStop(0.18, "rgba(255,255,255,0.5)"); gradient.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, 64, 64);
  }
  return halo;
}

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
  }

  launch(): boolean {
    const settings = getSpaceState(), error = planError(settings.sites);
    if (error || this.disposed || this.viewer.isDestroyed()) { if (error) updateSpace({ message: error }); return false; }
    this.stop();
    const generation = ++this.generation;
    this.sites = settings.sites.map(site => ({ ...site }));
    this.duration = planDuration(this.sites.length, settings.relay);
    this.points = this.viewer.scene.primitives.add(new PointPrimitiveCollection());
    this.glows = this.viewer.scene.primitives.add(new BillboardCollection({ blendOption: BlendOption.TRANSLUCENT }));
    this.labels = this.viewer.scene.primitives.add(new LabelCollection());
    this.trails = this.viewer.scene.primitives.add(new PolylineCollection());
    const eco = this.viewer.targetFrameRate <= RENDER_PROFILES.eco.targetFrameRate;
    const point = () => this.points!.add({ show: false, pixelSize: 3, disableDepthTestDistance: 0 });
    const glow = () => { const b = this.glows!.add({ show: false, position: Cartesian3.ZERO }); b.setImage("space-show-halo", haloImage()); return b; };
    this.visuals = this.sites.map((site, index): Visual => {
      const ground = Cartesian3.fromDegrees(site.longitude, site.latitude, 3000);
      const base: Base = { site, ground, frame: Transforms.eastNorthUpToFixedFrame(Cartesian3.fromDegrees(site.longitude, site.latitude)),
        delay: siteDelay(index, settings.relay), label: this.labels!.add({ position: ground, text: `${site.label} · ${site.kind === "rocket" ? "火箭" : "巨型烟花"}`,
          font: "13px sans-serif", fillColor: Color.fromCssColorString("#fff1d4"), showBackground: true,
          backgroundColor: Color.BLACK.withAlpha(0.6), show: false, disableDepthTestDistance: 0 }),
      };
      if (site.kind === "rocket") return { ...base, kind: "rocket", head: point(), flame: glow(), trail: this.trails!.add({ positions: [], width: eco ? 2 : 3,
        material: Material.fromType("PolylineGlow", { glowPower: 0.22, color: Color.fromCssColorString("#ffc37d") }), show: false }) };
      const show = createFireworkShow(FIREWORK_STYLES[index % FIREWORK_STYLES.length], 2026 + index * 97);
      return { ...base, kind: "fireworks", show, flashes: show.bursts.map(glow),
        stars: show.particles.filter((_, i) => i % (eco ? 4 : 2) === 0).map(particle => ({ particle, head: point(), tails: Array.from({ length: eco ? 1 : 2 }, point) })) };
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
      v.label.show = this.occluder.isPointVisible(v.ground);
      if (v.kind === "rocket") this.drawRocket(v, t);
      else this.drawFireworks(v, t);
    }
    if (this.elapsed - this.lastStatus >= 0.25) { this.lastStatus = this.elapsed; updateSpace({ elapsed: Math.min(this.elapsed, this.duration) }); }
    this.viewer.scene.requestRender();
    if (this.elapsed >= this.duration) this.stop(true);
    else this.schedule();
  };

  private drawFireworks(v: Fireworks, t: number) {
    const showTime = Math.max(0, t - 3);
    // Four complete cycles; let every last star fade rather than cutting a burst.
    const local = showTime < 40 ? showTime % 10 : 10 + showTime - 40;
    const active = t >= 3 && t < SPACE_DURATION;
    for (const { particle, head, tails } of v.stars) {
      const p = active ? particleAt(particle, local) : null;
      head.show = false;
      if (p) {
        const world = this.position(v, p.east * GIANT_SCALE, p.north * GIANT_SCALE, p.height * GIANT_SCALE);
        head.show = this.occluder.isPointVisible(world); head.position = world;
        head.pixelSize = particle.size * 1.4;
        head.color = this.rgba(...particle.rgb, p.opacity);
      }
      tails.forEach((tail, index) => {
        const p = active ? particleAt(particle, local - (index + 1) * 0.09) : null;
        tail.show = false;
        if (!p) return;
        const world = this.position(v, p.east * GIANT_SCALE, p.north * GIANT_SCALE, p.height * GIANT_SCALE);
        tail.show = this.occluder.isPointVisible(world); tail.position = world; tail.pixelSize = 2.3 - index * 0.5;
        tail.color = this.rgba(...particle.rgb, p.opacity * (0.5 - index * 0.15));
      });
    }
    v.flashes.forEach((flash, index) => {
      const burst = v.show.bursts[index], since = local - burst.start;
      const world = this.position(v, burst.east * GIANT_SCALE, burst.north * GIANT_SCALE, burst.height * GIANT_SCALE);
      flash.show = active && since >= 0 && since < 0.65 && this.occluder.isPointVisible(world);
      if (!flash.show) return;
      flash.position = world; flash.width = flash.height = 45 + since * 70;
      flash.color = this.rgba(1, 0.78, 0.55, (1 - since / 0.65) * 0.65);
    });
  }

  private drawRocket(v: Rocket, t: number) {
    const state = rocketFrame(Math.max(0, t));
    const world = this.position(v, state.east * 5, 0, state.altitude * 5 + 1000);
    v.head.show = t >= 0 && t < SPACE_DURATION && this.occluder.isPointVisible(world);
    const fade = t > 45 ? Math.max(0, (SPACE_DURATION - t) / 3) : 1;
    v.head.position = world; v.head.pixelSize = 7; v.head.color = this.rgba(1, 0.95, 0.82, fade);
    v.flame.show = v.head.show && state.thrust; v.flame.position = world;
    v.flame.width = v.flame.height = 30; v.flame.color = Color.ORANGE.withAlpha(0.75);
    const positions: Cartesian3[] = [];
    if (t >= 3 && t < SPACE_DURATION) {
      for (let i = 0; i <= 60; i++) {
        const historical = rocketFrame(3 + (Math.min(t, 45) - 3) * i / 60);
        const p = this.position(v, historical.east * 5, 0, historical.altitude * 5 + 1000, new Cartesian3());
        if (this.occluder.isPointVisible(p)) positions.push(p);
      }
    }
    v.trail.show = positions.length > 1;
    v.trail.material.uniforms.color = new Color(1, 0.76, 0.49, fade);
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
  dispose() { this.disposed = true; this.stop(); this.removeSettings(); window.removeEventListener("resize", this.onResize); }
}
