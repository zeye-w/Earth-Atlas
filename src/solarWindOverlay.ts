import {
  Cartesian3,
  Color,
  ComponentDatatype,
  Geometry,
  GeometryAttribute,
  GeometryInstance,
  GeometryPipeline,
  Material,
  MaterialAppearance,
  Matrix3,
  Matrix4,
  NearFarScalar,
  PointPrimitiveCollection,
  Primitive,
  PrimitiveType,
  BoundingSphere,
  type PointPrimitive,
  type Viewer,
} from "cesium";
import { EARTH_RADIUS_KM, bowShock, boundaryRadius, type Magnetopause } from "./solarWindData.ts";

const RE = EARTH_RADIUS_KM * 1000;
/** Shells are drawn up to this angle from the Sun–Earth line (the tail is open). */
const THETA_MAX = (135 * Math.PI) / 180;
const THETA_STEPS = 48;
const PHI_STEPS = 72;
/** Particles enter this far upstream (Earth radii) and leave this far downstream. */
const UPSTREAM = 26;
const DOWNSTREAM = 30;
const MAX_IMPACT = 22;
const PARTICLES = 2200;
/** Each particle is drawn as a head plus fading trail points behind it. */
const TRAIL = [0, 0.45, 0.9, 1.4];
const TRAIL_ALPHA = [0.95, 0.55, 0.3, 0.14];
/** Animation runs about this many times faster than the real solar wind. */
export const SOLAR_WIND_TIME_LAPSE = 100;
const FRAME_MS = 1000 / 30;

// Fresnel rim glow, fading toward the open tail (st.t runs nose -> tail).
const SHELL_SHADER = `
uniform vec4 color;
uniform float power;

czm_material czm_getMaterial(czm_materialInput materialInput) {
  czm_material material = czm_getDefaultMaterial(materialInput);
  float facing = abs(dot(normalize(materialInput.normalEC), normalize(materialInput.positionToEyeEC)));
  float rim = pow(1.0 - facing, power);
  float fade = pow(1.0 - materialInput.st.t, 1.4);
  material.diffuse = color.rgb;
  material.emission = color.rgb * rim * 0.8;
  material.alpha = clamp((rim * 0.9 + 0.06) * fade * color.a, 0.0, 1.0);
  return material;
}
`;

/** Surface of revolution r(θ) around +X (toward the Sun), in metres. */
function shellGeometry(shape: Magnetopause): Geometry {
  const positions = new Float64Array((THETA_STEPS + 1) * (PHI_STEPS + 1) * 3);
  const st = new Float32Array((THETA_STEPS + 1) * (PHI_STEPS + 1) * 2);
  let p = 0;
  let q = 0;
  for (let i = 0; i <= THETA_STEPS; i++) {
    const theta = (i / THETA_STEPS) * THETA_MAX;
    const r = boundaryRadius(shape, theta) * RE;
    for (let j = 0; j <= PHI_STEPS; j++) {
      const phi = (j / PHI_STEPS) * 2 * Math.PI;
      positions[p++] = r * Math.cos(theta);
      positions[p++] = r * Math.sin(theta) * Math.cos(phi);
      positions[p++] = r * Math.sin(theta) * Math.sin(phi);
      st[q++] = j / PHI_STEPS;
      st[q++] = i / THETA_STEPS;
    }
  }
  const indices = new Uint32Array(THETA_STEPS * PHI_STEPS * 6);
  let k = 0;
  for (let i = 0; i < THETA_STEPS; i++) {
    for (let j = 0; j < PHI_STEPS; j++) {
      const a = i * (PHI_STEPS + 1) + j;
      const b = a + PHI_STEPS + 1;
      indices.set([a, b, a + 1, a + 1, b, b + 1], k);
      k += 6;
    }
  }
  const geometry = new Geometry({
    attributes: {
      position: new GeometryAttribute({ componentDatatype: ComponentDatatype.DOUBLE, componentsPerAttribute: 3, values: positions }),
      st: new GeometryAttribute({ componentDatatype: ComponentDatatype.FLOAT, componentsPerAttribute: 2, values: st }),
    } as never,
    indices,
    primitiveType: PrimitiveType.TRIANGLES,
    boundingSphere: BoundingSphere.fromVertices(Array.from(positions)),
  });
  return GeometryPipeline.computeNormal(geometry);
}

/** Cylindrical radius of a boundary at axial position x (Earth radii), or 0 upstream of its nose. */
function profile(shape: Magnetopause): (x: number) => number {
  const xs: number[] = [];
  const rhos: number[] = [];
  for (let i = 0; i <= 200; i++) {
    const theta = (i / 200) * 0.97 * Math.PI;
    const r = boundaryRadius(shape, theta);
    xs.push(r * Math.cos(theta));
    rhos.push(r * Math.sin(theta));
  }
  return (x: number) => {
    if (x >= xs[0]) return 0;
    for (let i = 1; i < xs.length; i++) {
      if (x >= xs[i]) {
        const f = (x - xs[i]) / (xs[i - 1] - xs[i]);
        return rhos[i] + (rhos[i - 1] - rhos[i]) * f;
      }
    }
    return rhos[rhos.length - 1];
  };
}

/** Deterministic pseudo-random in [0, 1) per particle and channel. */
function hash(i: number, channel: number): number {
  const x = Math.sin(i * 12.9898 + channel * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

export interface SolarWindVisual {
  shape: Magnetopause;
  /** km/s, drives the particle speed and colour. */
  speed: number;
  /** cm^-3, drives how many particles are shown. */
  density: number;
  /** nT; strongly southward tints the magnetopause. */
  bz: number | null;
}

let fixedEffectsTime: number | null = null;
const overlays = new Set<SolarWindOverlay>();

/** Recording mode: seconds of animation to show (deterministic), or null for real time. */
export function setSolarWindEffectsTime(seconds: number | null): void {
  fixedEffectsTime = seconds;
  for (const overlay of overlays) overlay.renderFrame();
}

function speedColor(speed: number): Color {
  const calm = Color.fromCssColorString("#ffd27a");
  const fast = Color.fromCssColorString("#ff8a4c");
  const extreme = Color.fromCssColorString("#ff4f7a");
  const t = Math.min(1, Math.max(0, (speed - 350) / 400));
  return t < 0.5 ? Color.lerp(calm, fast, t * 2, new Color()) : Color.lerp(fast, extreme, (t - 0.5) * 2, new Color());
}

/**
 * Magnetopause (Shue 1998, from measured solar wind) and approximate bow
 * shock as glowing shells, with solar-wind particles streaming from the Sun
 * and deflected around them. Everything is built along +X and rotated so +X
 * points at the Sun for the scene time.
 */
export class SolarWindOverlay {
  private readonly viewer: Viewer;
  private readonly points = new PointPrimitiveCollection();
  /** particles[i * TRAIL.length + k]: trail point k of particle i. */
  private readonly particles: PointPrimitive[] = [];
  private shells: Primitive[] = [];
  private visual: SolarWindVisual | null = null;
  private mpProfile: (x: number) => number = () => 0;
  private bsProfile: (x: number) => number = () => 0;
  private modelMatrix = Matrix4.clone(Matrix4.IDENTITY);
  private distance = 0;
  private lastFrame = 0;
  private frameHandle: number | null = null;
  private visible = true;
  private readonly scratch = new Cartesian3();

  constructor(viewer: Viewer) {
    this.viewer = viewer;
    for (let i = 0; i < PARTICLES; i++) {
      for (let k = 0; k < TRAIL.length; k++) {
        this.particles.push(this.points.add({ pixelSize: k === 0 ? 3.2 : 2.6, show: false, scaleByDistance: new NearFarScalar(2e7, 1.5, 6e8, 0.9) }));
      }
    }
    viewer.scene.primitives.add(this.points);
    overlays.add(this);
    this.frameHandle = requestAnimationFrame(this.onFrame);
  }

  /** Point +X at the Sun (unit vector in Earth-fixed coordinates). */
  setSunDirection(sun: Cartesian3): void {
    const x = Cartesian3.normalize(sun, new Cartesian3());
    const helper = Math.abs(x.z) < 0.9 ? Cartesian3.UNIT_Z : Cartesian3.UNIT_X;
    const y = Cartesian3.normalize(Cartesian3.cross(helper, x, new Cartesian3()), new Cartesian3());
    const z = Cartesian3.cross(x, y, new Cartesian3());
    const rotation = new Matrix3(x.x, y.x, z.x, x.y, y.y, z.y, x.z, y.z, z.z);
    this.modelMatrix = Matrix4.fromRotationTranslation(rotation, Cartesian3.ZERO, this.modelMatrix);
    this.points.modelMatrix = this.modelMatrix;
    for (const shell of this.shells) shell.modelMatrix = this.modelMatrix;
    this.viewer.scene.requestRender();
  }

  /** New measurements (or null: no data, nothing drawn). */
  setSolarWind(visual: SolarWindVisual | null): void {
    const previous = this.visual;
    this.visual = visual;
    if (!visual) { this.clearShells(); this.hideParticles(); this.viewer.scene.requestRender(); return; }
    const shapeChanged = !previous || Math.abs(previous.shape.r0 - visual.shape.r0) > 0.02 || Math.abs(previous.shape.alpha - visual.shape.alpha) > 0.005;
    const southChanged = !previous || (previous.bz ?? 0) <= -5 !== (visual.bz ?? 0) <= -5;
    if (shapeChanged || southChanged) this.buildShells(visual);
    this.mpProfile = profile(visual.shape);
    this.bsProfile = profile(bowShock(visual.shape));
    const color = speedColor(visual.speed);
    this.particles.forEach((particle, index) => { particle.color = color.withAlpha(TRAIL_ALPHA[index % TRAIL.length]); });
    this.renderFrame();
  }

  private buildShells(visual: SolarWindVisual): void {
    this.clearShells();
    const south = (visual.bz ?? 0) <= -5;
    const layers = [
      { shape: visual.shape, color: south ? "#ff7ad9" : "#6fd3ff", alpha: 0.75, power: 2.6 },
      { shape: bowShock(visual.shape), color: "#ffb36b", alpha: 0.32, power: 3.2 },
    ];
    layers.forEach((layer, index) => {
      const primitive = new Primitive({
        geometryInstances: new GeometryInstance({ geometry: shellGeometry(layer.shape) }),
        appearance: new MaterialAppearance({
          material: new Material({
            fabric: { type: "TerraScopeMagnetosphere" + index, uniforms: { color: Color.fromCssColorString(layer.color).withAlpha(layer.alpha), power: layer.power }, source: SHELL_SHADER },
            translucent: true,
          }),
          translucent: true,
          flat: true,
          faceForward: true,
          closed: false,
        }),
        modelMatrix: this.modelMatrix,
        allowPicking: false,
        asynchronous: false,
        show: this.visible,
      });
      this.viewer.scene.primitives.add(primitive);
      this.shells.push(primitive);
    });
  }

  private readonly onFrame = (frameMs: number): void => {
    if (this.viewer.isDestroyed()) return;
    this.frameHandle = requestAnimationFrame(this.onFrame);
    if (fixedEffectsTime !== null || !this.visible || !this.visual || document.visibilityState !== "visible") { this.lastFrame = frameMs; return; }
    if (frameMs - this.lastFrame < FRAME_MS) return;
    const dt = Math.min(0.1, (frameMs - this.lastFrame) / 1000);
    this.lastFrame = frameMs;
    this.distance += this.unitsPerSecond() * dt;
    this.placeParticles();
  };

  /** Earth radii per animation second at the measured speed. */
  private unitsPerSecond(): number {
    return ((this.visual?.speed ?? 400) * SOLAR_WIND_TIME_LAPSE) / EARTH_RADIUS_KM;
  }

  /** Draws the current state; with a fixed effects time the position is a pure function of it. */
  renderFrame(): void {
    if (!this.visual) return;
    if (fixedEffectsTime !== null) this.distance = fixedEffectsTime * this.unitsPerSecond();
    this.placeParticles();
  }

  private placeParticles(): void {
    const visual = this.visual;
    if (!visual || this.viewer.isDestroyed()) return;
    const span = UPSTREAM + DOWNSTREAM;
    const active = Math.round(PARTICLES * Math.min(1, Math.max(0.25, Math.sqrt(visual.density / 12))));
    for (let i = 0; i < PARTICLES; i++) {
      const b = MAX_IMPACT * Math.sqrt(hash(i, 1));
      const phi = 2 * Math.PI * hash(i, 2);
      // Distance travelled along the stream, wrapped to the box.
      const travelled = (this.distance + hash(i, 3) * span) % span;
      for (let k = 0; k < TRAIL.length; k++) {
        const point = this.particles[i * TRAIL.length + k];
        const x = UPSTREAM - travelled + TRAIL[k];
        if (i >= active || x > UPSTREAM) { point.show = false; continue; }
        const rhoBs = this.bsProfile(x);
        let rho = b;
        // Inside the bow shock the flow is squeezed between the shock and the
        // magnetopause, so no particle crosses into the magnetosphere.
        if (b < rhoBs) {
          const rhoMp = this.mpProfile(x);
          rho = rhoMp + (rhoBs - rhoMp) * (b / rhoBs);
        }
        point.show = true;
        point.position = Cartesian3.fromElements(x * RE, rho * Math.cos(phi) * RE, rho * Math.sin(phi) * RE, this.scratch);
      }
    }
    this.viewer.scene.requestRender();
  }

  private hideParticles(): void {
    for (const particle of this.particles) particle.show = false;
  }

  private clearShells(): void {
    if (!this.viewer.isDestroyed()) for (const shell of this.shells) this.viewer.scene.primitives.remove(shell);
    this.shells = [];
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.points.show = visible;
    for (const shell of this.shells) shell.show = visible;
    if (!this.viewer.isDestroyed()) this.viewer.scene.requestRender();
  }

  dispose(): void {
    overlays.delete(this);
    if (this.frameHandle !== null) cancelAnimationFrame(this.frameHandle);
    if (this.viewer.isDestroyed()) return;
    this.clearShells();
    this.viewer.scene.primitives.remove(this.points);
    this.viewer.scene.requestRender();
  }
}
