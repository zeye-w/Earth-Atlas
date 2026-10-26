import {
  Cartesian3, Color, ColorGeometryInstanceAttribute, CylinderGeometry, GeometryInstance,
  HeadingPitchRange, Matrix3, Matrix4, PerInstanceColorAppearance, PointPrimitiveCollection,
  Primitive, Transforms, type Viewer,
} from "cesium";
import { getExperience, updateExperience } from "./experience.ts";
import { rocketFrame, ROCKET_DURATION } from "./rocketFlight.ts";

interface Site { longitude: number; latitude: number }
interface Part { primitive: Primitive; matrix: Matrix4; offset: Cartesian3 }

/** Locally generated geometry and bounded particles; no model downloads. */
export class RocketOverlay {
  private viewer: Viewer;
  private onComplete: () => void;
  private parts: Part[] = [];
  private particles: PointPrimitiveCollection | null = null;
  private frameId = 0;
  private elapsed = 0;
  private previousTime = 0;
  private lastStatus = -1;
  private following = false;
  private disposed = false;
  private origin = new Matrix4();
  private transform = new Matrix4();
  private position = new Cartesian3();
  private rotation = new Matrix3();
  private flame: Primitive | null = null;

  constructor(viewer: Viewer, onComplete: () => void) {
    this.viewer = viewer;
    this.onComplete = onComplete;
  }

  start(site: Site) {
    if (this.disposed || this.viewer.isDestroyed()) return;
    this.origin = Transforms.eastNorthUpToFixedFrame(Cartesian3.fromDegrees(site.longitude, site.latitude));
    const cylinder = (offset: Cartesian3, length: number, topRadius: number, bottomRadius: number, color: Color) => {
      const matrix = Matrix4.multiplyByTranslation(this.origin, offset, new Matrix4());
      // Build geometry once. Entity cylinder positions would rebuild geometry
      // on every change; only these small primitive model matrices move.
      const primitive = this.viewer.scene.primitives.add(new Primitive({
        geometryInstances: new GeometryInstance({ geometry: new CylinderGeometry({
          length, topRadius, bottomRadius, slices: 24, vertexFormat: PerInstanceColorAppearance.VERTEX_FORMAT,
        }), attributes: { color: ColorGeometryInstanceAttribute.fromColor(color) } }),
        appearance: new PerInstanceColorAppearance({ closed: true, translucent: color.alpha < 1 }),
        asynchronous: false, modelMatrix: matrix, allowPicking: false,
      }));
      this.parts.push({ primitive, matrix, offset });
      return primitive;
    };
    cylinder(new Cartesian3(0, 0, 44), 60, 6, 6, Color.fromCssColorString("#e9edf4"));
    cylinder(new Cartesian3(0, 0, 84), 20, 0, 6, Color.fromCssColorString("#f0f4ff"));
    cylinder(new Cartesian3(0, 0, 25), 7, 6.15, 6.15, Color.fromCssColorString("#c45843"));
    cylinder(new Cartesian3(0, 0, 9), 10, 4.5, 3, Color.fromCssColorString("#3c4655"));
    // Two slim boosters give the silhouette depth from the side camera.
    for (const east of [-9, 9]) {
      cylinder(new Cartesian3(east, 0, 27), 42, 3, 3, Color.fromCssColorString("#b5c1ce"));
      cylinder(new Cartesian3(east, 0, 51), 6, 0, 3, Color.WHITE);
    }
    this.flame = cylinder(new Cartesian3(0, 0, -11), 30, 3.5, 0.2, Color.ORANGE.withAlpha(0.75));
    this.flame.show = false;
    this.particles = this.viewer.scene.primitives.add(new PointPrimitiveCollection());
    for (let i = 0; i < 96; i++) this.particles!.add({ show: false, pixelSize: 12 });
    document.addEventListener("visibilitychange", this.onVisibility);
    updateExperience({ phase: "countdown", altitude: 0, speed: 0, countdown: 3 });
    this.frameId = requestAnimationFrame(this.frame);
  }

  private frame = (timestamp: number) => {
    this.frameId = 0;
    if (this.disposed || this.viewer.isDestroyed()) return;
    if (this.previousTime && timestamp - this.previousTime < 30) { this.schedule(); return; }
    // The trajectory is analytic: no integration step to cap. Keep countdown
    // and duration in real seconds even on slow GPUs; hidden tabs reset below.
    if (this.previousTime) this.elapsed += Math.max(0, (timestamp - this.previousTime) / 1000);
    this.previousTime = timestamp;
    const state = rocketFrame(this.elapsed);
    Matrix3.fromRotationY(state.tilt, this.rotation);
    Cartesian3.fromElements(state.east, 0, state.altitude, this.position);
    Matrix4.fromRotationTranslation(this.rotation, this.position, this.transform);
    Matrix4.multiplyTransformation(this.origin, this.transform, this.transform);
    for (const part of this.parts) {
      Matrix4.multiplyByTranslation(this.transform, part.offset, part.matrix);
      part.primitive.modelMatrix = part.matrix;
    }
    if (this.flame) this.flame.show = state.thrust;
    const particles = this.particles!;
    for (let i = 0; i < particles.length; i++) {
      const point = particles.get(i);
      const age = (i / particles.length * 8 + this.elapsed) % 8;
      const historical = rocketFrame(this.elapsed - age);
      point.show = state.thrust && historical.thrust;
      if (!point.show) continue;
      const spread = 2 + age * 6, angle = i * 2.39996;
      Cartesian3.fromElements(historical.east + Math.cos(angle) * spread,
        Math.sin(angle) * spread, Math.max(1, historical.altitude + 3 - age * 5), this.position);
      point.position = Matrix4.multiplyByPoint(this.origin, this.position, this.position);
      point.pixelSize = age < 0.4 ? 10 : Math.min(52, 15 + age * 7);
      point.color = age < 0.4 ? new Color(1, 0.65, 0.2, 0.85) : new Color(0.65, 0.68, 0.72, 0.23 * (1 - age / 8));
    }
    if (getExperience().follow) {
      const target = Matrix4.multiplyByPoint(this.transform, new Cartesian3(0, 0, 44), this.position);
      this.viewer.camera.lookAt(target, new HeadingPitchRange(0, -0.23, 650 + Math.min(1500, state.altitude * 0.035)));
      this.following = true;
    } else if (this.following) this.releaseCamera();
    // Announce phases separately in the panel; numeric telemetry updates at 5 Hz.
    if (this.elapsed - this.lastStatus >= 0.2 || state.phase === "complete") {
      this.lastStatus = this.elapsed;
      updateExperience({ phase: state.phase, countdown: state.countdown, altitude: state.altitude, speed: state.speed });
    }
    this.viewer.scene.requestRender();
    if (this.elapsed >= ROCKET_DURATION) this.onComplete();
    else this.schedule();
  };

  private schedule() {
    if (!document.hidden && !this.disposed && !this.frameId) this.frameId = requestAnimationFrame(this.frame);
  }
  private onVisibility = () => {
    if (document.hidden) { cancelAnimationFrame(this.frameId); this.frameId = 0; }
    else { this.previousTime = 0; this.schedule(); }
  };
  private releaseCamera() {
    if (!this.viewer.isDestroyed()) this.viewer.camera.lookAtTransform(Matrix4.IDENTITY);
    this.following = false;
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.releaseCamera();
    if (!this.viewer.isDestroyed()) {
      this.parts.forEach(part => this.viewer.scene.primitives.remove(part.primitive));
      if (this.particles) this.viewer.scene.primitives.remove(this.particles);
      this.viewer.scene.requestRender();
    }
    this.parts = [];
    this.particles = null;
    this.flame = null;
    if (getExperience().phase !== "complete") updateExperience({ phase: "idle" });
  }
}
