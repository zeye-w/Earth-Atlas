import {
  BillboardCollection, Cartesian3, Color, HeadingPitchRange, Material, Matrix3, Matrix4,
  Primitive, Transforms, type Billboard, type Viewer,
} from "cesium";
import { getExperience, updateExperience } from "./experience.ts";
import { COUNTDOWN_SECONDS, PRELAUNCH_SECONDS, prelaunch, SHOW_DURATION, showFrame, ventPuff } from "./launchSequence.ts";
import { ARM_HINGE, ARM_SWING, launchComplex, type PadLight } from "./launchComplex.ts";
import { cylinderGeometry, exhaustPrimitive, finGeometry, solidPrimitive, type SolidPart } from "./rocketParts.ts";
import { groundPuff, trailPuff, type Puff } from "./rocketSmoke.ts";
import { exhaustMaterial } from "./visualMaterials.ts";
import { RENDER_PROFILES } from "../performance.ts";
import { EFFECT_BLEND, effectTexture } from "./visualTextures.ts";

interface Site { longitude: number; latitude: number }
// Smoke budget (halved at the eco render profile): the rising column and the
// cloud that billows around the pad while the flame still reaches it.
const TRAIL_COUNT = 140;
const GROUND_COUNT = 56;
const VENT_COUNT = 44;
const SMOKE = [0.86, 0.87, 0.9] as const;
const FIRE = [1, 0.6, 0.28] as const;
// Smoke right at the flame is lit, not burning: a pale warm tint.
const LIT = [1, 0.86, 0.66] as const;

/** Locally generated geometry and bounded particles; no model downloads. */
export class RocketOverlay {
  private viewer: Viewer;
  private onComplete: () => void;
  // Four draw calls: the moving vehicle, the launch complex, the swing arms and the exhaust plume.
  private body: Primitive | null = null;
  private pad: Primitive | null = null;
  private arms: Primitive | null = null;
  private armsMatrix = new Matrix4();
  private armPose = new Matrix4();
  private vent: Billboard[] = [];
  private padLights: { billboard: Billboard; light: PadLight }[] = [];
  private flameMatrix = new Matrix4();
  private originInverse = new Matrix4();
  private bodyMatrix = new Matrix4();
  private flameOffset = new Cartesian3(0, 0, -22);
  private particles: BillboardCollection | null = null;
  private trail: Billboard[] = [];
  private ground: Billboard[] = [];
  private padGlow: Billboard | null = null;
  private flameGlow: Billboard | null = null;
  private coreGlow: Billboard | null = null;
  private color = new Color();
  private local = new Cartesian3();
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

  /**
   * Build the launch complex and the rocket standing on it, without moving
   * the camera: called as the camera sets off, so the rocket is already there
   * when it arrives. begin() then runs the countdown and flight.
   */
  prepare(site: Site) {
    if (this.disposed || this.viewer.isDestroyed() || this.body) return;
    this.origin = Transforms.eastNorthUpToFixedFrame(Cartesian3.fromDegrees(site.longitude, site.latitude));
    const complex = launchComplex();
    const vehicle: SolidPart[] = [];
    const cylinder = (list: SolidPart[], offset: Cartesian3, length: number, topRadius: number, bottomRadius: number, color: string | Color) =>
      list.push({ geometry: cylinderGeometry(length, topRadius, bottomRadius), offset, color: typeof color === "string" ? Color.fromCssColorString(color) : color });
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
    this.pad = primitives.add(solidPrimitive(complex.pad, this.origin));
    this.arms = primitives.add(solidPrimitive(complex.arms, this.origin));
    this.body = primitives.add(solidPrimitive(vehicle, this.origin));
    Matrix4.inverseTransformation(this.origin, this.originInverse);
    this.exhaustMaterial = exhaustMaterial();
    Matrix4.multiplyByTranslation(this.origin, this.flameOffset, this.flameMatrix);
    this.flame = primitives.add(exhaustPrimitive(this.exhaustMaterial, Matrix4.clone(this.flameMatrix)));
    this.flame!.show = false;
    const particles = this.particles = this.viewer.scene.primitives.add(new BillboardCollection({ blendOption: EFFECT_BLEND }));
    // Sized in metres so near smoke is large and distant smoke small. Draw
    // order is index order: lights, pad light, smoke, then the flame glows on top.
    const billboard = (id: string, kind: "smoke" | "halo") => {
      const b = particles.add({ show: false, position: Cartesian3.ZERO, sizeInMeters: true });
      b.setImage(id, effectTexture(kind));
      return b;
    };
    const eco = this.viewer.targetFrameRate <= RENDER_PROFILES.eco.targetFrameRate;
    this.padLights = complex.lights.map(light => ({ billboard: billboard("rocket-engine-halo", "halo"), light }));
    this.padGlow = billboard("rocket-engine-halo", "halo");
    this.vent = Array.from({ length: eco ? VENT_COUNT / 2 : VENT_COUNT }, () => billboard("rocket-soft-smoke", "smoke"));
    this.ground = Array.from({ length: eco ? GROUND_COUNT / 2 : GROUND_COUNT }, () => billboard("rocket-soft-smoke", "smoke"));
    this.trail = Array.from({ length: eco ? TRAIL_COUNT / 2 : TRAIL_COUNT }, () => billboard("rocket-soft-smoke", "smoke"));
    this.flameGlow = billboard("rocket-engine-halo", "halo");
    this.coreGlow = billboard("rocket-engine-halo", "halo");
    this.elapsed = 0;
    this.draw();
  }

  /** Start the countdown (T−10) and the flight; builds the scene first if prepare() was not called. */
  start(site: Site) {
    if (this.disposed || this.viewer.isDestroyed()) return;
    this.prepare(site);
    // The panel says "heading to the pad" until here, then counts down.
    updateExperience({ phase: "countdown", altitude: 0, speed: 0, countdown: COUNTDOWN_SECONDS });
    document.addEventListener("visibilitychange", this.onVisibility);
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
    const state = this.draw();
    if (getExperience().follow) {
      const target = Matrix4.multiplyByPoint(this.transform, new Cartesian3(0, 0, 44), this.position);
      // Before liftoff the camera circles slowly in; it ends on the flight camera.
      const pre = prelaunch(this.elapsed);
      const offset = this.elapsed < COUNTDOWN_SECONDS ? new HeadingPitchRange(pre.heading, pre.pitch, pre.range)
        : new HeadingPitchRange(0, -0.025, 650 + Math.min(1500, state.altitude * 0.035));
      this.viewer.camera.lookAt(target, offset);
      this.following = true;
    } else if (this.following) this.releaseCamera();
    // Announce phases separately in the panel; numeric telemetry updates at 5 Hz.
    if (this.elapsed - this.lastStatus >= 0.2 || state.phase === "complete") {
      this.lastStatus = this.elapsed;
      updateExperience({ phase: state.phase, countdown: state.countdown, altitude: state.altitude, speed: state.speed });
    }
    if (this.elapsed >= SHOW_DURATION) this.onComplete();
    else this.schedule();
  };

  /** Pose everything for the current show time. */
  private draw() {
    const state = showFrame(this.elapsed);
    const flightTime = this.elapsed - PRELAUNCH_SECONDS;
    Matrix3.fromRotationY(state.tilt, this.rotation);
    Cartesian3.fromElements(state.east, 0, state.altitude, this.position);
    Matrix4.fromRotationTranslation(this.rotation, this.position, this.transform);
    Matrix4.multiplyTransformation(this.origin, this.transform, this.transform);
    // The vehicle is baked at the pad: move it by pose × inverse(pad frame).
    if (this.body) this.body.modelMatrix = Matrix4.multiplyTransformation(this.transform, this.originInverse, this.bodyMatrix);
    if (this.arms) {
      // Swing about the hinge on the tower face: T(hinge) · Rz · T(−hinge), in the pad frame.
      const angle = ARM_SWING * prelaunch(this.elapsed).arms;
      Matrix4.fromRotationTranslation(Matrix3.fromRotationZ(angle, this.rotation), Cartesian3.ZERO, this.armPose);
      Matrix4.multiplyByTranslation(this.armPose, Cartesian3.negate(ARM_HINGE, this.local), this.armPose);
      Matrix4.multiply(Matrix4.fromTranslation(ARM_HINGE, this.armsMatrix), this.armPose, this.armPose);
      Matrix4.multiplyTransformation(this.origin, this.armPose, this.armsMatrix);
      this.arms.modelMatrix = Matrix4.multiplyTransformation(this.armsMatrix, this.originInverse, this.armsMatrix);
    }
    if (this.flame) {
      // Held down at ignition the flame is short and spreads into the trench.
      this.plumeScale.z = Math.min(1, (state.altitude + 10) / 58) * (0.94 + Math.sin(this.elapsed * 31) * 0.06);
      this.flameOffset.z = 4 - 26 * this.plumeScale.z;
      Matrix4.multiplyByTranslation(this.transform, this.flameOffset, this.flameMatrix);
      Matrix4.multiplyByScale(this.flameMatrix, this.plumeScale, this.flameMatrix);
      this.flame.modelMatrix = this.flameMatrix;
      this.flame.show = state.thrust;
    }
    if (this.exhaustMaterial) this.exhaustMaterial.uniforms.time = this.elapsed;
    this.drawLights(state.altitude);
    this.drawGlows(state.thrust, state.altitude);
    for (let i = 0; i < this.vent.length; i++) this.drawPuff(this.vent[i], ventPuff(i, this.vent.length, this.elapsed), 0);
    for (let i = 0; i < this.trail.length; i++) this.drawPuff(this.trail[i], trailPuff(i, this.trail.length, flightTime), 1);
    // The flame lights the ground cloud only while it still reaches the pad.
    const padLight = state.thrust ? Math.max(0, 1 - state.altitude / 140) : 0;
    for (let i = 0; i < this.ground.length; i++) this.drawPuff(this.ground[i], groundPuff(i, this.ground.length, flightTime), padLight);
    this.viewer.scene.requestRender();
    return state;
  }

  /** Floodlights on the tower and blinking red obstruction lights. */
  private drawLights(altitude: number) {
    const blink = Math.sin(this.elapsed * Math.PI) > 0 ? 1 : 0.25;
    for (const { billboard, light } of this.padLights) {
      billboard.show = true;
      billboard.position = Matrix4.multiplyByPoint(this.origin, Cartesian3.fromElements(light.east, light.north, light.up, this.local), this.position);
      billboard.width = billboard.height = light.size;
      // Floodlights dim once the rocket has cleared the tower.
      billboard.color = light.color === "red" ? this.rgba([1, 0.2, 0.15], 0, 0.9 * blink) : this.rgba([1, 0.95, 0.82], 0, 0.75 * Math.max(0.3, 1 - altitude / 400));
    }
  }

  private rgba(rgb: readonly number[], warmth: number, alpha: number) {
    const c = this.color;
    c.red = rgb[0] + (LIT[0] - rgb[0]) * warmth; c.green = rgb[1] + (LIT[1] - rgb[1]) * warmth;
    c.blue = rgb[2] + (LIT[2] - rgb[2]) * warmth; c.alpha = alpha;
    return c;
  }

  /** Puffs are in pad east-north-up metres; hot ones glow orange near the flame. */
  private drawPuff(billboard: Billboard, puff: Puff | null, light: number) {
    billboard.show = puff !== null && puff.alpha > 0.005;
    if (!puff || !billboard.show) return;
    Cartesian3.fromElements(puff.east, puff.north, puff.up, this.local);
    billboard.position = Matrix4.multiplyByPoint(this.origin, this.local, this.position);
    billboard.width = billboard.height = puff.size;
    billboard.rotation = puff.rotation;
    billboard.color = this.rgba(SMOKE, Math.min(1, puff.heat * light), puff.alpha);
  }

  private drawGlows(thrust: boolean, altitude: number) {
    const flicker = 0.9 + 0.1 * Math.sin(this.elapsed * 47) * Math.sin(this.elapsed * 13);
    const glow = (billboard: Billboard | null, local: Cartesian3, frame: Matrix4, size: number, rgb: readonly number[], alpha: number) => {
      if (!billboard) return;
      billboard.show = thrust && alpha > 0.01;
      if (!billboard.show) return;
      billboard.position = Matrix4.multiplyByPoint(frame, local, this.position);
      billboard.width = billboard.height = size;
      billboard.color = this.rgba(rgb, 0, alpha);
    };
    // Light on the pad and the smoke around it, fading as the rocket climbs.
    // Raised so the ground does not slice the glow into a hard edge.
    glow(this.padGlow, Cartesian3.fromElements(0, 0, 70, this.local), this.origin, 240, FIRE, 0.38 * Math.max(0, 1 - altitude / 160) * flicker);
    glow(this.flameGlow, Cartesian3.fromElements(0, 0, -10, this.local), this.transform, 90 * flicker, FIRE, 0.8);
    glow(this.coreGlow, Cartesian3.fromElements(0, 0, 0, this.local), this.transform, 26 * flicker, [0.95, 0.97, 1], 1);
  }

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
      for (const primitive of [this.body, this.pad, this.arms, this.flame]) if (primitive) this.viewer.scene.primitives.remove(primitive);
      if (this.particles) this.viewer.scene.primitives.remove(this.particles);
      this.viewer.scene.requestRender();
    }
    this.body = null;
    this.pad = null;
    this.arms = null;
    this.particles = null;
    this.flame = null;
    this.trail = [];
    this.ground = [];
    this.vent = [];
    this.padLights = [];
    this.padGlow = this.flameGlow = this.coreGlow = null;
    this.exhaustMaterial = null;
    if (getExperience().phase !== "complete") updateExperience({ phase: "idle" });
  }
}
