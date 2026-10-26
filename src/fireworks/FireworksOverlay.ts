import {
  BillboardCollection, BlendOption, BoundingSphere, Cartesian3, Color, HeadingPitchRange, Math as CesiumMath, Matrix4,
  PointPrimitiveCollection, Transforms, type Billboard, type PointPrimitive, type Viewer,
} from "cesium";
import { createFireworkShow, particleAt, type FireworkShow, type FireworkStyle } from "./physics.ts";
import { CityContext, retainCity } from "./cityContext.ts";
import { RocketOverlay } from "./RocketOverlay.ts";
import type { ExperienceMode } from "./experience.ts";

export interface FireworkSite { longitude: number; latitude: number; label: string }

/** Fading points behind each star and rocket; willow trails hang longer. */
const TRAIL_STEPS = 5;
const ROCKET_SPARKS = 4;
const ASCENT_SECONDS = 0.78;
const FLASH_SECONDS = 0.4;

interface Star { head: PointPrimitive; trail: PointPrimitive[]; glow: Billboard }
interface Rocket { head: PointPrimitive; sparks: PointPrimitive[]; flash: Billboard }

let glowCanvas: HTMLCanvasElement | null = null;
/** A soft radial halo, drawn once and shared by every glow billboard (no image asset). */
function glowImage(): HTMLCanvasElement {
  if (glowCanvas) return glowCanvas;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const context = canvas.getContext("2d");
  if (context) {
    const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(0.22, "rgba(255,255,255,0.45)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 64, 64);
  }
  return (glowCanvas = canvas);
}

/** Transient fireworks with an optional, show-scoped ion city backdrop. */
export class FireworksOverlay {
  private collection: PointPrimitiveCollection | null = null;
  private glows: BillboardCollection | null = null;
  private stars: Star[] = [];
  private rockets: Rocket[] = [];
  private trailStep = 0.045;
  private color = new Color();
  private localToWorld = new Matrix4();
  private localPosition = new Cartesian3();
  private worldPosition = new Cartesian3();
  private show: FireworkShow | null = null;
  private elapsed = 0;
  private lastFrame = 0;
  private animationFrame = 0;
  private pendingFlight = false;
  private generation = 0;
  private previousMinimumZoom: number | null = null;
  private removeZoomRestore: (() => void) | null = null;
  private disposed = false;
  private seed = 0;
  private cityContext: CityContext;
  private removeCityRestore: (() => void) | null = null;
  private rocketShow: RocketOverlay | null = null;
  private experience: ExperienceMode = "fireworks";

  private viewer: Viewer;
  private onRunning: (running: boolean) => void;

  constructor(viewer: Viewer, onRunning: (running: boolean) => void) {
    this.viewer = viewer;
    this.onRunning = onRunning;
    this.cityContext = new CityContext(viewer);
    document.addEventListener("visibilitychange", this.onVisibilityChange);
  }

  launch(site: FireworkSite, style: FireworkStyle, experience: ExperienceMode = "fireworks"): boolean {
    if (this.disposed || this.viewer.isDestroyed() ||
      !Number.isFinite(site.longitude) || Math.abs(site.longitude) > 180 ||
      !Number.isFinite(site.latitude) || Math.abs(site.latitude) > 90) return false;
    this.stop();
    this.experience = experience;
    this.removeCityRestore?.();
    this.removeCityRestore = null;
    void this.cityContext.show(site);
    // A restore still waiting from the last show keeps its original value.
    const previousMinimumZoom = this.restoreMinimumZoom();
    const token = ++this.generation;
    const cameraController = this.viewer.scene.screenSpaceCameraController;
    this.previousMinimumZoom = previousMinimumZoom;
    // The side view is about 770 m above ground; do not push it back above 900 m.
    cameraController.minimumZoomDistance = 100;
    this.pendingFlight = true;
    this.onRunning(true);
    const target = Cartesian3.fromDegrees(site.longitude, site.latitude, experience === "rocket" ? 44 : 300);
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.viewer.camera.flyToBoundingSphere(new BoundingSphere(target, experience === "rocket" ? 120 : 500), {
      offset: new HeadingPitchRange(0, CesiumMath.toRadians(-15), experience === "rocket" ? 650 : 1800),
      duration: reducedMotion ? 0 : 1.6,
      complete: () => {
        if (this.generation !== token || this.disposed) return;
        this.viewer.camera.lookAtTransform(Matrix4.IDENTITY);
        this.pendingFlight = false;
        this.start(site, style);
      },
      cancel: () => { if (this.generation === token) this.stop(); },
    });
    return true;
  }

  private start(site: FireworkSite, style: FireworkStyle) {
    if (this.viewer.isDestroyed()) return;
    if (this.experience === "rocket") {
      this.rocketShow = new RocketOverlay(this.viewer, () => this.stop());
      this.rocketShow.start(site);
      return;
    }
    this.show = createFireworkShow(style, ++this.seed);
    this.trailStep = style === "willow" ? 0.085 : 0.045;
    const origin = Cartesian3.fromDegrees(site.longitude, site.latitude, 0);
    this.localToWorld = Transforms.eastNorthUpToFixedFrame(origin);
    const collection = new PointPrimitiveCollection();
    const glows = new BillboardCollection({ blendOption: BlendOption.TRANSLUCENT });
    // Halos first, so the sharp points draw over them.
    this.glows = this.viewer.scene.primitives.add(glows);
    this.collection = this.viewer.scene.primitives.add(collection);
    const point = (pixelSize: number) => collection.add({ position: origin, show: false, pixelSize, color: Color.WHITE });
    const glow = () => {
      const billboard = glows.add({ position: origin, show: false, color: Color.WHITE });
      billboard.setImage("terrascope-firework-glow", glowImage()); // one shared atlas entry
      return billboard;
    };
    this.rockets = this.show.bursts.map(() => ({
      head: point(5),
      sparks: Array.from({ length: ROCKET_SPARKS }, (_, i) => point(Math.max(1.5, 3.5 - i * 0.5))),
      flash: glow(),
    }));
    this.stars = this.show.particles.map((p) => ({
      head: point(p.size),
      trail: Array.from({ length: TRAIL_STEPS }, (_, i) => point(Math.max(1, p.size * (1 - (i + 1) * 0.13)))),
      glow: glow(),
    }));
    this.elapsed = 0;
    this.lastFrame = 0;
    this.scheduleFrame();
  }

  private toWorld(east: number, north: number, height: number): Cartesian3 {
    // Never mutate point.position in place: Cesium's setter must detect a change
    // and copy it into _actualPosition / the GPU buffer. Setters copy this scratch.
    Cartesian3.fromElements(east, north, Math.max(1, height), this.localPosition);
    return Matrix4.multiplyByPoint(this.localToWorld, this.localPosition, this.worldPosition);
  }

  private scheduleFrame() {
    if (!this.animationFrame && !document.hidden && this.show && !this.disposed) {
      this.animationFrame = requestAnimationFrame(this.frame);
    }
  }

  private frame = (timestamp: number) => {
    this.animationFrame = 0;
    if (!this.show || this.viewer.isDestroyed() || this.disposed) return;
    if (this.lastFrame && timestamp - this.lastFrame < 30) { this.scheduleFrame(); return; }
    if (this.lastFrame) this.elapsed += Math.min(0.1, (timestamp - this.lastFrame) / 1000);
    this.lastFrame = timestamp;
    const t = this.elapsed;
    const color = this.color;
    // Setters copy the colour, so one scratch instance serves every primitive.
    const rgba = (red: number, green: number, blue: number, alpha: number) => {
      color.red = red; color.green = green; color.blue = blue; color.alpha = alpha;
      return color;
    };
    for (let i = 0; i < this.show.bursts.length; i++) {
      const burst = this.show.bursts[i], { head, sparks, flash } = this.rockets[i];
      const ascent = t - (burst.start - ASCENT_SECONDS);
      const rising = ascent >= 0 && ascent < ASCENT_SECONDS;
      head.show = rising;
      if (rising) {
        const fraction = ascent / ASCENT_SECONDS;
        head.position = this.toWorld(burst.east, burst.north, burst.height * fraction * fraction);
        head.color = Color.fromBytes(255, 224, 166, Math.round(255 * (1 - fraction * 0.2)), color);
      }
      for (let j = 0; j < sparks.length; j++) {
        const lag = ascent - (j + 1) * 0.05;
        sparks[j].show = rising && lag >= 0;
        if (!sparks[j].show) continue;
        const fraction = lag / ASCENT_SECONDS;
        sparks[j].position = this.toWorld(burst.east, burst.north, burst.height * fraction * fraction);
        sparks[j].color = Color.fromBytes(255, 190, 110, Math.round(255 * (0.55 - j * 0.11)), color);
      }
      // A brief warm flash lights the sky where the shell bursts.
      const since = t - burst.start;
      flash.show = since >= 0 && since < FLASH_SECONDS;
      if (flash.show) {
        const fade = 1 - since / FLASH_SECONDS;
        flash.position = this.toWorld(burst.east, burst.north, burst.height);
        flash.color = Color.fromBytes(255, 237, 204, Math.round(255 * 0.5 * fade * fade), color);
        flash.width = flash.height = 70 + 150 * (1 - fade);
      }
    }
    for (let i = 0; i < this.show.particles.length; i++) {
      const p = this.show.particles[i], { head, trail, glow } = this.stars[i];
      const current = particleAt(p, t);
      head.show = current !== null;
      glow.show = current !== null && current.opacity > 0.05;
      if (current) {
        // Stars leave the burst white-hot, then cool into their own colour.
        const [r, g, b] = p.rgb, heat = current.heat;
        head.position = this.toWorld(current.east, current.north, current.height);
        head.color = rgba(r + (1 - r) * heat, g + (1 - g) * heat, b + (1 - b) * heat, current.opacity);
        head.pixelSize = p.size * (1 + 0.6 * heat);
        if (glow.show) {
          glow.position = head.position;
          glow.color = rgba(r, g, b, Math.min(1, 0.16 * current.opacity + 0.3 * heat));
          glow.width = glow.height = p.size * (5 + 3 * heat);
        }
      }
      for (let j = 0; j < trail.length; j++) {
        const sample = current && particleAt(p, t - (j + 1) * this.trailStep);
        trail[j].show = Boolean(sample);
        if (!sample) continue;
        const [r, g, b] = p.rgb;
        trail[j].position = this.toWorld(sample.east, sample.north, sample.height);
        trail[j].color = rgba(r, g, b, sample.opacity * (0.5 - j * 0.08));
      }
    }
    this.viewer.scene.requestRender();
    if (t >= this.show.duration) this.stop();
    else this.scheduleFrame();
  };

  private onVisibilityChange = () => {
    if (document.hidden) {
      if (this.animationFrame) cancelAnimationFrame(this.animationFrame);
      this.animationFrame = 0;
    } else {
      this.lastFrame = 0; // A hidden tab must not fast-forward the show.
      this.scheduleFrame();
    }
  };

  stop() {
    this.generation++;
    this.rocketShow?.dispose();
    this.rocketShow = null;
    if (this.animationFrame) cancelAnimationFrame(this.animationFrame);
    this.animationFrame = 0;
    if (this.pendingFlight && !this.viewer.isDestroyed()) {
      this.pendingFlight = false;
      this.viewer.camera.cancelFlight();
    }
    if (!this.viewer.isDestroyed()) {
      if (this.collection) this.viewer.scene.primitives.remove(this.collection);
      if (this.glows) this.viewer.scene.primitives.remove(this.glows);
    }
    this.collection = null;
    this.glows = null;
    this.stars = [];
    this.rockets = [];
    this.show = null;
    this.lastFrame = 0;
    this.deferMinimumZoomRestore();
    this.deferCityHide();
    if (!this.viewer.isDestroyed()) this.viewer.scene.requestRender();
    if (!this.disposed) this.onRunning(false);
  }

  /** Switching to a wide space view must not keep streaming city tiles. */
  clearBackdrop() {
    this.removeCityRestore?.();
    this.removeCityRestore = null;
    this.cityContext.hide();
  }

  /**
   * Restoring the old minimum zoom while the camera sits below it makes Cesium
   * yank the camera kilometres up in one frame. Keep the camera where the show
   * left it and restore once the user has zoomed out past the old minimum.
   */
  private deferMinimumZoomRestore() {
    const previous = this.previousMinimumZoom;
    if (previous === null || this.removeZoomRestore || this.viewer.isDestroyed()) return;
    const camera = this.viewer.camera;
    const restoreWhenAbove = () => {
      if (this.viewer.isDestroyed()) return;
      if (camera.positionCartographic.height >= previous) this.restoreMinimumZoom();
    };
    this.removeZoomRestore = camera.moveEnd.addEventListener(restoreWhenAbove);
    restoreWhenAbove();
  }

  private deferCityHide() {
    if (this.removeCityRestore || this.viewer.isDestroyed() || this.disposed) return;
    const hideWhenAbove = () => {
      if (this.viewer.isDestroyed()) return;
      if (!retainCity(this.viewer.camera.positionCartographic.height, Boolean(this.rocketShow || this.show || this.pendingFlight))) {
        this.removeCityRestore?.();
        this.removeCityRestore = null;
        this.cityContext.hide();
      }
    };
    this.removeCityRestore = this.viewer.camera.moveEnd.addEventListener(hideWhenAbove);
    hideWhenAbove();
  }

  /** Puts back the minimum zoom saved by launch(); returns the current one. */
  private restoreMinimumZoom(): number {
    this.removeZoomRestore?.();
    this.removeZoomRestore = null;
    const previous = this.previousMinimumZoom;
    this.previousMinimumZoom = null;
    const controller = this.viewer.scene.screenSpaceCameraController;
    if (previous !== null) controller.minimumZoomDistance = previous;
    return controller.minimumZoomDistance;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
    this.stop();
    this.removeCityRestore?.();
    this.removeCityRestore = null;
    this.cityContext.dispose();
    if (!this.viewer.isDestroyed()) this.restoreMinimumZoom();
    else { this.removeZoomRestore = null; this.previousMinimumZoom = null; }
  }
}
