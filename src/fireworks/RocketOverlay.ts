import {
  BillboardCollection, BlendOption, Cartesian3, Color, HeadingPitchRange, Material, Matrix3, Matrix4,
  Primitive, Transforms, type Billboard, type Viewer,
} from "cesium";
import { getExperience, updateExperience } from "./experience.ts";
import { rocketFrame, ROCKET_DURATION } from "./rocketFlight.ts";
import { cylinderGeometry, exhaustPrimitive, finGeometry, solidPrimitive, type SolidPart } from "./rocketParts.ts";
import { exhaustMaterial } from "./visualMaterials.ts";
import { effectTexture } from "./visualTextures.ts";

interface Site { longitude: number; latitude: number }
const SMOKE_COUNT = 72;

/** Locally generated geometry and bounded particles; no model downloads. */
export class RocketOverlay {
  private viewer: Viewer;
  private onComplete: () => void;
  // Three draw calls: the moving vehicle, the launch pad and the exhaust plume.
  private body: Primitive | null = null;
  private pad: Primitive | null = null;
  private flameMatrix = new Matrix4();
  private originInverse = new Matrix4();
  private bodyMatrix = new Matrix4();
  private flameOffset = new Cartesian3(0, 0, -22);
  private particles: BillboardCollection | null = null;
  private engineGlow: Billboard | null = null;
  private exhaustMaterial: Material | null = null;
  private plumeScale = new Cartesian3(1, 1, 1);
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
    const vehicle: SolidPart[] = [], pad: SolidPart[] = [];
    const cylinder = (list: SolidPart[], offset: Cartesian3, length: number, topRadius: number, bottomRadius: number, color: string | Color) =>
      list.push({ geometry: cylinderGeometry(length, topRadius, bottomRadius), offset, color: typeof color === "string" ? Color.fromCssColorString(color) : color });
    cylinder(pad, new Cartesian3(0, 0, 0.5), 1, 29, 29, "#71808b");
    cylinder(pad, new Cartesian3(0, 0, 1.1), 1.2, 26, 26, "#25343e");
    for (const x of [-9, 9]) cylinder(pad, new Cartesian3(x, 0, 3.8), 4.2, 1.5, 2, "#687887");
    cylinder(vehicle, new Cartesian3(0, 0, 44), 60, 6, 6, "#e9edf4");
    cylinder(vehicle, new Cartesian3(0, 0, 84), 20, 0, 6, "#f0f4ff");
    cylinder(vehicle, new Cartesian3(0, 0, 25), 4, 6.1, 6.1, "#20354a");
    cylinder(vehicle, new Cartesian3(0, 0, 70), 1, 6.05, 6.05, "#8596a6");
    cylinder(vehicle, new Cartesian3(0, 0, 17), 1, 6.1, 6.1, "#cda56a");
    cylinder(vehicle, new Cartesian3(0, 0, 9), 10, 4.2, 5.5, "#202932");
    for (let fin = 0; fin < 4; fin++) vehicle.push({ geometry: finGeometry(fin * Math.PI / 2), offset: Cartesian3.ZERO, color: Color.fromCssColorString("#45556b") });
    // Two slim boosters give the silhouette depth from the side camera.
    for (const east of [-9, 9]) {
      cylinder(vehicle, new Cartesian3(east, 0, 27), 42, 3, 3, "#b5c1ce");
      cylinder(vehicle, new Cartesian3(east, 0, 51), 6, 0, 3, Color.WHITE);
    }
    const primitives = this.viewer.scene.primitives;
    this.pad = primitives.add(solidPrimitive(pad, this.origin));
    this.body = primitives.add(solidPrimitive(vehicle, this.origin));
    Matrix4.inverseTransformation(this.origin, this.originInverse);
    this.exhaustMaterial = exhaustMaterial();
    Matrix4.multiplyByTranslation(this.origin, this.flameOffset, this.flameMatrix);
    this.flame = primitives.add(exhaustPrimitive(this.exhaustMaterial, Matrix4.clone(this.flameMatrix)));
    this.flame!.show = false;
    this.particles = this.viewer.scene.primitives.add(new BillboardCollection({ blendOption: BlendOption.TRANSLUCENT }));
    for (let i = 0; i < SMOKE_COUNT; i++) {
      const puff = this.particles!.add({ show: false, position: Cartesian3.ZERO });
      puff.setImage("rocket-soft-smoke", effectTexture("smoke"));
    }
    this.engineGlow = this.particles!.add({ show: false, position: Cartesian3.ZERO });
    this.engineGlow.setImage("rocket-engine-halo", effectTexture("halo"));
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
    // The vehicle is baked at the pad: move it by pose × inverse(pad frame).
    if (this.body) this.body.modelMatrix = Matrix4.multiplyTransformation(this.transform, this.originInverse, this.bodyMatrix);
    if (this.flame) {
      this.plumeScale.z = Math.min(1, (state.altitude + 4) / 52) * (0.94 + Math.sin(this.elapsed * 31) * 0.06);
      this.flameOffset.z = 4 - 26 * this.plumeScale.z;
      Matrix4.multiplyByTranslation(this.transform, this.flameOffset, this.flameMatrix);
      Matrix4.multiplyByScale(this.flameMatrix, this.plumeScale, this.flameMatrix);
      this.flame.modelMatrix = this.flameMatrix;
    }
    if (this.flame) this.flame.show = state.thrust;
    if (this.exhaustMaterial) this.exhaustMaterial.uniforms.time = this.elapsed;
    const viewScale = 650 / (650 + Math.min(1500, state.altitude * 0.035));
    if (this.engineGlow) {
      this.engineGlow.show = state.thrust;
      this.engineGlow.position = Matrix4.multiplyByPoint(this.transform, new Cartesian3(0, 0, 4), this.position);
      this.engineGlow.width = this.engineGlow.height = 48 * viewScale;
      this.engineGlow.color = new Color(0.72, 0.87, 1, 0.6);
    }
    const particles = this.particles!;
    for (let i = 0; i < SMOKE_COUNT; i++) {
      const point = particles.get(i);
      const age = (i / SMOKE_COUNT * 5 + this.elapsed) % 5;
      const historical = rocketFrame(this.elapsed - age);
      point.show = state.thrust && historical.thrust;
      if (!point.show) continue;
      const spread = 1 + age * 7, angle = i * 2.39996;
      Cartesian3.fromElements(historical.east + Math.cos(angle) * spread,
        Math.sin(angle) * spread, Math.max(1, historical.altitude + 3 - age * 5), this.position);
      point.position = Matrix4.multiplyByPoint(this.origin, this.position, this.position);
      point.width = (22 + age * 16) * viewScale; point.height = point.width * 1.2;
      point.rotation = i * 0.73 + age * 0.08;
      point.color = age < 0.35 ? new Color(1, 0.84, 0.64, 0.5) : new Color(0.78, 0.82, 0.88, 0.6 * (1 - age / 5));
    }
    if (getExperience().follow) {
      const target = Matrix4.multiplyByPoint(this.transform, new Cartesian3(0, 0, 44), this.position);
      this.viewer.camera.lookAt(target, new HeadingPitchRange(0, -0.025, 650 + Math.min(1500, state.altitude * 0.035)));
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
      for (const primitive of [this.body, this.pad, this.flame]) if (primitive) this.viewer.scene.primitives.remove(primitive);
      if (this.particles) this.viewer.scene.primitives.remove(this.particles);
      this.viewer.scene.requestRender();
    }
    this.body = null;
    this.pad = null;
    this.particles = null;
    this.flame = null;
    this.engineGlow = null;
    this.exhaustMaterial = null;
    if (getExperience().phase !== "complete") updateExperience({ phase: "idle" });
  }
}
