import {
  BoundingSphere, Cartesian3, ComponentDatatype, Geometry, GeometryAttribute, GeometryAttributes, GeometryInstance, Material, MaterialAppearance,
  Matrix3, Matrix4, Primitive, PrimitiveType, type Viewer,
} from "cesium";
import { PLANET_FACTS, type Mat3, type SphereKey } from "./astronomy/planetBodies.ts";

/**
 * Textured planets for the close views. A sphere is only built (and its map
 * only fetched) the first time the camera comes close enough for it to be
 * more than a pixel across; it is lit by the Sun from its own position, not
 * by the scene's light (which is set for the Earth).
 */

const KM = 1000;

/** A UV sphere (or spheroid), body-fixed: z to the north pole, x to the prime meridian, s = 0.5 there. */
function sphereGeometry(radius: number, polar: number, slices = 128, stacks = 64): Geometry {
  const positions: number[] = [], normals: number[] = [], st: number[] = [], indices: number[] = [];
  for (let i = 0; i <= stacks; i++) {
    const lat = -Math.PI / 2 + (Math.PI * i) / stacks;
    for (let j = 0; j <= slices; j++) {
      const lon = -Math.PI + (2 * Math.PI * j) / slices;
      const x = radius * Math.cos(lat) * Math.cos(lon), y = radius * Math.cos(lat) * Math.sin(lon), z = polar * Math.sin(lat);
      positions.push(x, y, z);
      const n = new Cartesian3(x / (radius * radius), y / (radius * radius), z / (polar * polar));
      Cartesian3.normalize(n, n);
      normals.push(n.x, n.y, n.z);
      st.push(j / slices, i / stacks);
    }
  }
  const row = slices + 1;
  for (let i = 0; i < stacks; i++) for (let j = 0; j < slices; j++) {
    const a = i * row + j, b = a + 1, c = a + row, d = c + 1;
    indices.push(a, b, d, a, d, c);
  }
  return geometry(positions, normals, st, indices, Math.max(radius, polar));
}

/** A flat ring in the equator: s from the inner edge (0) to the outer (1). */
function ringGeometry(inner: number, outer: number, segments = 256): Geometry {
  const positions: number[] = [], normals: number[] = [], st: number[] = [], indices: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const a = (2 * Math.PI * i) / segments;
    for (const [r, s] of [[inner, 0], [outer, 1]] as const) {
      positions.push(r * Math.cos(a), r * Math.sin(a), 0);
      normals.push(0, 0, 1);
      st.push(s, 0.5);
    }
    if (i < segments) { const k = i * 2; indices.push(k, k + 1, k + 3, k, k + 3, k + 2); }
  }
  return geometry(positions, normals, st, indices, outer);
}

function geometry(positions: number[], normals: number[], st: number[], indices: number[], radius: number): Geometry {
  const attributes = new GeometryAttributes();
  attributes.position = new GeometryAttribute({ componentDatatype: ComponentDatatype.DOUBLE, componentsPerAttribute: 3, values: new Float64Array(positions) });
  attributes.normal = new GeometryAttribute({ componentDatatype: ComponentDatatype.FLOAT, componentsPerAttribute: 3, values: new Float32Array(normals) });
  attributes.st = new GeometryAttribute({ componentDatatype: ComponentDatatype.FLOAT, componentsPerAttribute: 2, values: new Float32Array(st) });
  return new Geometry({ attributes, indices: new Uint32Array(indices), primitiveType: PrimitiveType.TRIANGLES, boundingSphere: new BoundingSphere(Cartesian3.ZERO, radius) });
}

/** Day side by the Sun's real direction (world), a faint night side. */
const PLANET_SHADER = `
czm_material czm_getMaterial(czm_materialInput m) {
  czm_material mat = czm_getDefaultMaterial(m);
  vec3 c = texture(image, m.st).rgb;
  vec3 l = normalize(mat3(czm_view) * sun);
  float d = max(dot(normalize(m.normalEC), l), 0.0);
  mat.diffuse = c * (0.035 + 0.965 * d);
  mat.alpha = 1.0;
  return mat;
}`;
const RING_SHADER = `
czm_material czm_getMaterial(czm_materialInput m) {
  czm_material mat = czm_getDefaultMaterial(m);
  vec4 c = texture(image, vec2(m.st.s, 0.5));
  // The face away from the Sun only glows with light through the ring: dimmer.
  vec3 n = normalize(m.normalEC);
  vec3 l = normalize(mat3(czm_view) * sun);
  bool lit = (dot(n, l) > 0.0) == (dot(n, m.positionToEyeEC) > 0.0);
  mat.diffuse = c.rgb * (lit ? 0.95 : 0.4);
  mat.alpha = c.a;
  return mat;
}`;

interface Sphere { planet: Primitive; ring?: Primitive; material: Material; ringMaterial?: Material }

export class PlanetSpheres {
  private spheres = new Map<SphereKey, Sphere>();

  constructor(private viewer: Viewer) {}

  /** Built on first need. */
  private ensure(key: SphereKey): Sphere {
    let s = this.spheres.get(key);
    if (s) return s;
    const facts = PLANET_FACTS[key];
    const material = new Material({ fabric: { uniforms: { image: `/planets/${facts.texture}.jpg`, sun: new Cartesian3(1, 0, 0) }, source: PLANET_SHADER }, translucent: false });
    const planet = this.viewer.scene.primitives.add(new Primitive({
      geometryInstances: new GeometryInstance({ geometry: sphereGeometry(facts.radius * KM, facts.polarRadius * KM) }),
      appearance: new MaterialAppearance({ material, flat: true, translucent: false, materialSupport: MaterialAppearance.MaterialSupport.TEXTURED, closed: true }),
      asynchronous: false, show: false,
    })) as Primitive;
    let ring: Primitive | undefined;
    let ringMaterial: Material | undefined;
    if (facts.ring) {
      ringMaterial = new Material({ fabric: { uniforms: { image: "/planets/saturn-ring.png", sun: new Cartesian3(1, 0, 0) }, source: RING_SHADER }, translucent: true });
      ring = this.viewer.scene.primitives.add(new Primitive({
        geometryInstances: new GeometryInstance({ geometry: ringGeometry(facts.ring.inner * KM, facts.ring.outer * KM) }),
        appearance: new MaterialAppearance({ material: ringMaterial, flat: true, translucent: true, closed: false, materialSupport: MaterialAppearance.MaterialSupport.TEXTURED }),
        asynchronous: false, show: false,
      })) as Primitive;
    }
    s = { planet, ring, material, ringMaterial };
    this.spheres.set(key, s);
    // The map arrives a moment later; the scene only redraws when asked.
    for (let i = 1; i <= 10; i++) window.setTimeout(() => { if (!this.viewer.isDestroyed()) this.viewer.scene.requestRender(); }, i * 400);
    return s;
  }

  private poses = new Map<SphereKey, { center: Cartesian3; body: Matrix4; equator: Matrix4; toSun: Cartesian3 }>();
  private shown = new Set<SphereKey>();

  /**
   * Where a planet is and how it is turned: `center` (fixed frame, m),
   * `toFixed` (J2000 → fixed), its body and equator frames (J2000), and the
   * direction to the Sun (fixed).
   */
  setPose(key: SphereKey, center: Cartesian3, toFixed: Matrix3, body: Mat3, equator: Mat3, toSun: Cartesian3): void {
    const m = (frame: Mat3) => Matrix4.fromRotationTranslation(Matrix3.multiply(toFixed, Matrix3.fromRowMajorArray(frame), new Matrix3()), center);
    this.poses.set(key, { center, body: m(body), equator: m(equator), toSun });
    if (this.shown.has(key)) this.apply(key);
  }

  center(key: SphereKey): Cartesian3 | undefined { return this.poses.get(key)?.center; }

  /** Shows or hides a planet's sphere (built, and its map fetched, the first time it is shown). */
  setVisible(key: SphereKey, visible: boolean): void {
    if (visible === this.shown.has(key)) return;
    if (visible) { this.shown.add(key); this.apply(key); return; }
    this.shown.delete(key);
    const s = this.spheres.get(key);
    if (s) { s.planet.show = false; if (s.ring) s.ring.show = false; }
  }

  private apply(key: SphereKey): void {
    const pose = this.poses.get(key);
    if (!pose) return;
    const s = this.ensure(key);
    s.planet.modelMatrix = pose.body;
    s.planet.show = true;
    if (s.ring) { s.ring.modelMatrix = pose.equator; s.ring.show = true; }
    s.material.uniforms.sun = pose.toSun;
    if (s.ringMaterial) s.ringMaterial.uniforms.sun = pose.toSun;
  }

  dispose(): void {
    const primitives = this.viewer.scene.primitives;
    for (const s of this.spheres.values()) { primitives.remove(s.planet); if (s.ring) primitives.remove(s.ring); }
    this.spheres.clear();
  }
}
