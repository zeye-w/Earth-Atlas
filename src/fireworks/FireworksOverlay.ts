import {
  BoundingSphere, Cartesian3, Color, HeadingPitchRange, Math as CesiumMath, Matrix4, PointPrimitiveCollection,
  Transforms, type PointPrimitive, type Viewer,
} from "cesium";
import { createFireworkShow, particleAt, type FireworkShow, type FireworkStyle } from "./physics.ts";

export interface FireworkSite { longitude: number; latitude: number; label: string }

/** Transient, georeferenced decoration. No external assets, telemetry or persistent layers. */
export class FireworksOverlay {
  private collection: PointPrimitiveCollection | null = null;
  private points: { head: PointPrimitive; tail: PointPrimitive }[] = [];
  private flares: PointPrimitive[] = [];
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

  private viewer: Viewer;
  private onRunning: (running: boolean) => void;

  constructor(viewer: Viewer, onRunning: (running: boolean) => void) {
    this.viewer = viewer;
    this.onRunning = onRunning;
    document.addEventListener("visibilitychange", this.onVisibilityChange);
  }

  launch(site: FireworkSite, style: FireworkStyle): boolean {
    if (this.disposed || this.viewer.isDestroyed() ||
      !Number.isFinite(site.longitude) || Math.abs(site.longitude) > 180 ||
      !Number.isFinite(site.latitude) || Math.abs(site.latitude) > 90) return false;
    this.stop();
    // A restore still waiting from the last show keeps its original value.
    const previousMinimumZoom = this.restoreMinimumZoom();
    const token = ++this.generation;
    const cameraController = this.viewer.scene.screenSpaceCameraController;
    this.previousMinimumZoom = previousMinimumZoom;
    // The side view is about 700 m above ground; do not push it back above 900 m.
    cameraController.minimumZoomDistance = 100;
    this.pendingFlight = true;
    this.onRunning(true);
    const target = Cartesian3.fromDegrees(site.longitude, site.latitude, 230);
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.viewer.camera.flyToBoundingSphere(new BoundingSphere(target, 400), {
      offset: new HeadingPitchRange(0, CesiumMath.toRadians(-15), 1800),
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
    this.show = createFireworkShow(style, ++this.seed);
    const origin = Cartesian3.fromDegrees(site.longitude, site.latitude, 0);
    this.localToWorld = Transforms.eastNorthUpToFixedFrame(origin);
    const collection = new PointPrimitiveCollection();
    this.collection = this.viewer.scene.primitives.add(collection);
    this.flares = this.show.bursts.map(() => collection.add({ position: origin, show: false, pixelSize: 5, color: Color.WHITE }));
    this.points = this.show.particles.map(() => ({
      head: collection.add({ position: origin, show: false, pixelSize: 3, color: Color.WHITE }),
      tail: collection.add({ position: origin, show: false, pixelSize: 2, color: Color.WHITE }),
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
    for (let i = 0; i < this.show.bursts.length; i++) {
      const burst = this.show.bursts[i], point = this.flares[i];
      const ascent = t - (burst.start - 0.78);
      point.show = ascent >= 0 && ascent < 0.78;
      if (!point.show) continue;
      const fraction = ascent / 0.78;
      point.position = this.toWorld(burst.east, burst.north, burst.height * fraction * fraction);
      point.color = new Color(1, 0.88, 0.65, 1 - fraction * 0.2);
    }
    for (let i = 0; i < this.show.particles.length; i++) {
      const p = this.show.particles[i], { head, tail } = this.points[i];
      const current = particleAt(p, t);
      head.show = current !== null;
      if (current) {
        head.position = this.toWorld(current.east, current.north, current.height);
        head.color = new Color(...p.rgb, current.opacity);
        head.pixelSize = p.size;
      }
      const trailing = particleAt(p, t - 0.075);
      tail.show = trailing !== null && current !== null;
      if (trailing && current) {
        tail.position = this.toWorld(trailing.east, trailing.north, trailing.height);
        tail.color = new Color(...p.rgb, trailing.opacity * 0.35);
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
    if (this.animationFrame) cancelAnimationFrame(this.animationFrame);
    this.animationFrame = 0;
    if (this.pendingFlight && !this.viewer.isDestroyed()) {
      this.pendingFlight = false;
      this.viewer.camera.cancelFlight();
    }
    if (this.collection && !this.viewer.isDestroyed()) this.viewer.scene.primitives.remove(this.collection);
    this.collection = null;
    this.points = [];
    this.flares = [];
    this.show = null;
    this.lastFrame = 0;
    this.deferMinimumZoomRestore();
    if (!this.viewer.isDestroyed()) this.viewer.scene.requestRender();
    if (!this.disposed) this.onRunning(false);
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
    if (!this.viewer.isDestroyed()) this.restoreMinimumZoom();
    else { this.removeZoomRestore = null; this.previousMinimumZoom = null; }
  }
}
