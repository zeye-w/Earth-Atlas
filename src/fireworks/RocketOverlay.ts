import {
  BillboardCollection, BlendOption, BoundingSphere, Cartesian3, Color, ColorGeometryInstanceAttribute,
  ComponentDatatype, CylinderGeometry, Geometry, GeometryAttribute, GeometryAttributes, GeometryInstance, GeometryPipeline,
  HeadingPitchRange, Material, MaterialAppearance, Matrix3, Matrix4, PerInstanceColorAppearance,
  Primitive, PrimitiveType, Transforms, type Billboard, type Viewer,
} from "cesium";
import { getExperience, updateExperience } from "./experience.ts";
import { rocketFrame, ROCKET_DURATION } from "./rocketFlight.ts";
import { effectTexture } from "./visualTextures.ts";

interface Site { longitude: number; latitude: number }
interface Part { primitive: Primitive; matrix: Matrix4; offset: Cartesian3; exhaust?: boolean }
const SMOKE_COUNT = 72;

/** Locally generated geometry and bounded particles; no model downloads. */
export class RocketOverlay {
  private viewer: Viewer;
  private onComplete: () => void;
  private parts: Part[] = [];
  private staticParts: Primitive[] = [];
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
    const part = (geometry: Geometry | CylinderGeometry, offset: Cartesian3, color: Color, anchored = false) => {
      const matrix = Matrix4.multiplyByTranslation(this.origin, offset, new Matrix4());
      // Build geometry once. Entity cylinder positions would rebuild geometry
      // on every change; only these small primitive model matrices move.
      const primitive = this.viewer.scene.primitives.add(new Primitive({
        geometryInstances: new GeometryInstance({ geometry, attributes: { color: ColorGeometryInstanceAttribute.fromColor(color) } }),
        appearance: new PerInstanceColorAppearance({ closed: true, translucent: color.alpha < 1 }),
        asynchronous: false, modelMatrix: matrix, allowPicking: false,
      }));
      if (anchored) this.staticParts.push(primitive);
      else this.parts.push({ primitive, matrix, offset });
      return primitive;
    };
    const cylinder = (offset: Cartesian3, length: number, topRadius: number, bottomRadius: number, color: Color, anchored = false) => part(new CylinderGeometry({
      length, topRadius, bottomRadius, slices: 32, vertexFormat: PerInstanceColorAppearance.VERTEX_FORMAT,
    }), offset, color, anchored);
    cylinder(new Cartesian3(0, 0, 0.5), 1, 29, 29, Color.fromCssColorString("#71808b"), true);
    cylinder(new Cartesian3(0, 0, 1.1), 1.2, 26, 26, Color.fromCssColorString("#25343e"), true);
    for (const x of [-9, 9]) cylinder(new Cartesian3(x, 0, 3.8), 4.2, 1.5, 2, Color.fromCssColorString("#687887"), true);
    cylinder(new Cartesian3(0, 0, 44), 60, 6, 6, Color.fromCssColorString("#e9edf4"));
    cylinder(new Cartesian3(0, 0, 84), 20, 0, 6, Color.fromCssColorString("#f0f4ff"));
    cylinder(new Cartesian3(0, 0, 25), 4, 6.1, 6.1, Color.fromCssColorString("#20354a"));
    cylinder(new Cartesian3(0, 0, 70), 1, 6.05, 6.05, Color.fromCssColorString("#8596a6"));
    cylinder(new Cartesian3(0, 0, 17), 1, 6.1, 6.1, Color.fromCssColorString("#cda56a"));
    cylinder(new Cartesian3(0, 0, 9), 10, 4.2, 5.5, Color.fromCssColorString("#202932"));
    // Thin triangular fins, with real volume and normals rather than flat decals.
    for (let fin = 0; fin < 4; fin++) {
      const angle = fin * Math.PI / 2, values: number[] = [];
      for (const y of [-0.55, 0.55]) for (const [x, z] of [[5.8, 12], [14, 8], [5.8, 34]]) {
        values.push(x * Math.cos(angle) - y * Math.sin(angle), x * Math.sin(angle) + y * Math.cos(angle), z);
      }
      const positions = new Float64Array(values);
      const attributes = new GeometryAttributes();
      attributes.position = new GeometryAttribute({ componentDatatype: ComponentDatatype.DOUBLE, componentsPerAttribute: 3, values: positions });
      const geometry = GeometryPipeline.computeNormal(new Geometry({
        attributes,
        indices: new Uint16Array([0, 1, 2, 3, 5, 4, 0, 4, 1, 0, 3, 4, 1, 5, 2, 1, 4, 5, 2, 3, 0, 2, 5, 3]),
        primitiveType: PrimitiveType.TRIANGLES, boundingSphere: BoundingSphere.fromVertices(positions),
      }));
      part(geometry, Cartesian3.ZERO, Color.fromCssColorString("#45556b"));
    }
    // Two slim boosters give the silhouette depth from the side camera.
    for (const east of [-9, 9]) {
      cylinder(new Cartesian3(east, 0, 27), 42, 3, 3, Color.fromCssColorString("#b5c1ce"));
      cylinder(new Cartesian3(east, 0, 51), 6, 0, 3, Color.WHITE);
    }
    this.exhaustMaterial = new Material({ fabric: { type: "TerraScopeRocketExhaust", uniforms: { time: 0 },
      source: `czm_material czm_getMaterial(czm_materialInput materialInput) {
        czm_material m = czm_getDefaultMaterial(materialInput);
        float axial = materialInput.st.t;
        float ripple = 0.85 + 0.15 * sin(time * 37.0 + axial * 24.0 + materialInput.st.s * 13.0);
        vec3 tint = mix(vec3(1.0, 0.34, 0.07), vec3(0.6, 0.83, 1.0), smoothstep(0.6, 1.0, axial));
        m.emission = tint * (1.1 + axial * 0.8);
        m.alpha = smoothstep(0.0, 0.32, axial) * ripple * 0.68;
        return m;
      }` } });
    const exhaustOffset = new Cartesian3(0, 0, -22), exhaustMatrix = Matrix4.multiplyByTranslation(this.origin, exhaustOffset, new Matrix4());
    this.flame = this.viewer.scene.primitives.add(new Primitive({
      geometryInstances: new GeometryInstance({ geometry: new CylinderGeometry({ length: 52, topRadius: 3.3, bottomRadius: 0.05,
        slices: 32, vertexFormat: MaterialAppearance.MaterialSupport.TEXTURED.vertexFormat }) }),
      appearance: new MaterialAppearance({ material: this.exhaustMaterial, flat: true, faceForward: true, translucent: true, closed: false }),
      asynchronous: false, modelMatrix: exhaustMatrix, allowPicking: false,
    }));
    this.parts.push({ primitive: this.flame!, matrix: exhaustMatrix, offset: exhaustOffset, exhaust: true });
    this.flame.show = false;
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
    for (const part of this.parts) {
      if (part.exhaust) {
        this.plumeScale.z = Math.min(1, (state.altitude + 4) / 52) * (0.94 + Math.sin(this.elapsed * 31) * 0.06);
        part.offset.z = 4 - 26 * this.plumeScale.z;
      }
      Matrix4.multiplyByTranslation(this.transform, part.offset, part.matrix);
      if (part.exhaust) {
        Matrix4.multiplyByScale(part.matrix, this.plumeScale, part.matrix);
      }
      part.primitive.modelMatrix = part.matrix;
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
      this.parts.forEach(part => this.viewer.scene.primitives.remove(part.primitive));
      this.staticParts.forEach(part => this.viewer.scene.primitives.remove(part));
      if (this.particles) this.viewer.scene.primitives.remove(this.particles);
      this.viewer.scene.requestRender();
    }
    this.parts = [];
    this.staticParts = [];
    this.particles = null;
    this.flame = null;
    this.engineGlow = null;
    this.exhaustMaterial = null;
    if (getExperience().phase !== "complete") updateExperience({ phase: "idle" });
  }
}
