import {
  BlendingState,
  Cartesian3,
  GeometryInstance,
  Material,
  MaterialAppearance,
  Primitive,
  WallGeometry,
  type Viewer,
} from "cesium";

/**
 * Decorative northern aurora: translucent animated curtains drawn around the
 * geomagnetic north pole at typical auroral-oval latitudes and altitudes.
 * This is an artistic illustration, not an observation or forecast.
 */

// IGRF-14 geomagnetic north pole, ~2025.
export const GEOMAGNETIC_POLE = { latitude: 80.8, longitude: -72.7 } as const;
// Aurora usually sits ~20-23 deg from the geomagnetic pole (65-70 deg magnetic latitude).
const RINGS = [
  { radiusDeg: 20.5, minHeight: 95_000, maxHeight: 330_000, seed: 0.0, strength: 1.0 },
  { radiusDeg: 23.0, minHeight: 100_000, maxHeight: 260_000, seed: 7.3, strength: 0.8 },
] as const;
const RING_SAMPLES = 180;
// Curtains shimmer, so animate at a modest fixed rate while visible.
export const AURORA_FPS = 20;

/** Point at an angular distance (deg) and bearing (deg) from an origin. */
export function destination(latDeg: number, lonDeg: number, distanceDeg: number, bearingDeg: number): { latitude: number; longitude: number } {
  const toRad = Math.PI / 180;
  const lat1 = latDeg * toRad;
  const lon1 = lonDeg * toRad;
  const d = distanceDeg * toRad;
  const b = bearingDeg * toRad;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(b));
  const lon2 = lon1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  const longitude = ((lon2 / toRad + 540) % 360) - 180;
  return { latitude: lat2 / toRad, longitude };
}

/** Closed ring of [lon, lat, ...] degrees around the geomagnetic pole. */
export function auroralRing(radiusDeg: number, samples = RING_SAMPLES): number[] {
  const coords: number[] = [];
  for (let i = 0; i <= samples; i++) {
    const bearing = (i / samples) * 360;
    // Gentle irregularity so the oval is not a perfect circle; integer
    // harmonics keep the ring seamless where it closes at 360 deg.
    const angle = bearing * Math.PI / 180;
    const wobble = 1.2 * Math.sin(3 * angle) + 0.8 * Math.sin(8 * angle + 1.3);
    const point = destination(GEOMAGNETIC_POLE.latitude, GEOMAGNETIC_POLE.longitude, radiusDeg + wobble, bearing);
    coords.push(point.longitude, point.latitude);
  }
  return coords;
}

// Green (557.7 nm oxygen) at the base fading to violet/red higher up, with
// drifting vertical rays. Faded out on the sunlit side of the globe.
const AURORA_SHADER = `
uniform float time;
uniform float seed;
uniform float strength;

czm_material czm_getMaterial(czm_materialInput materialInput) {
  czm_material material = czm_getDefaultMaterial(materialInput);
  vec2 st = materialInput.st;
  float s = st.s * 140.0 + seed;
  float t = time + seed;

  float broad = 0.5 + 0.5 * sin(st.s * 6.2831 * 3.0 + t * 0.15);
  float rays = 0.55
    + 0.25 * sin(s * 1.0 + t * 0.7)
    + 0.15 * sin(s * 2.7 - t * 1.1)
    + 0.10 * sin(s * 6.1 + t * 2.3 + sin(s * 0.3 + t) * 2.0);
  float fold = 0.6 + 0.4 * sin(st.s * 6.2831 * 9.0 - t * 0.35 + sin(t * 0.2) * 2.0);

  float base = smoothstep(0.0, 0.06, st.t);
  float fadeTop = 1.0 - smoothstep(0.25, 1.0, st.t);
  vec3 green = vec3(0.30, 1.00, 0.58);
  vec3 violet = vec3(0.62, 0.36, 0.95);
  vec3 color = mix(green, violet, smoothstep(0.35, 0.95, st.t));

  // Night-side only: compare the local vertical with the sun direction.
  vec3 positionEC = -materialInput.positionToEyeEC;
  vec3 centerEC = (czm_view * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vec3 upEC = normalize(positionEC - centerEC);
  float night = 1.0 - smoothstep(-0.15, 0.2, dot(upEC, czm_sunDirectionEC));

  float alpha = base * fadeTop * rays * fold * (0.55 + 0.45 * broad) * strength * mix(0.12, 1.0, night);
  material.diffuse = color;
  material.emission = color * alpha * 2.0;
  material.alpha = clamp(alpha * 1.25, 0.0, 1.0);
  return material;
}
`;

export class AuroraOverlay {
  private readonly viewer: Viewer;
  private readonly primitives: Primitive[] = [];
  private readonly materials: Material[] = [];
  private readonly poleDirection: Cartesian3;
  private frameHandle: number | null = null;
  private lastFrameMs = 0;
  private visible = true;

  constructor(viewer: Viewer) {
    this.viewer = viewer;
    this.poleDirection = Cartesian3.normalize(Cartesian3.fromDegrees(GEOMAGNETIC_POLE.longitude, GEOMAGNETIC_POLE.latitude), new Cartesian3());
    for (const ring of RINGS) {
      const material = new Material({
        fabric: {
          type: "TerraScopeAurora",
          uniforms: { time: 0, seed: ring.seed, strength: ring.strength },
          source: AURORA_SHADER,
        },
        translucent: true,
      });
      const primitive = new Primitive({
        geometryInstances: new GeometryInstance({
          geometry: WallGeometry.fromConstantHeights({
            positions: Cartesian3.fromDegreesArray(auroralRing(ring.radiusDeg)),
            minimumHeight: ring.minHeight,
            maximumHeight: ring.maxHeight,
          }),
        }),
        appearance: new MaterialAppearance({
          material,
          translucent: true,
          flat: true,
          faceForward: true,
          closed: false,
          renderState: {
            blending: BlendingState.ADDITIVE_BLEND,
            depthMask: false,
            depthTest: { enabled: true },
            cull: { enabled: false },
          },
        }),
        asynchronous: true,
      });
      viewer.scene.primitives.add(primitive);
      this.primitives.push(primitive);
      this.materials.push(material);
    }
    this.frameHandle = requestAnimationFrame(this.onFrame);
  }

  private readonly onFrame = (frameMs: number): void => {
    if (this.viewer.isDestroyed()) return;
    this.frameHandle = requestAnimationFrame(this.onFrame);
    if (!this.visible || document.visibilityState !== "visible") return;
    if (frameMs - this.lastFrameMs < 1000 / AURORA_FPS) return;
    // Skip work while the polar region faces away from the camera.
    const cameraDirection = Cartesian3.normalize(this.viewer.camera.positionWC, new Cartesian3());
    if (Cartesian3.dot(cameraDirection, this.poleDirection) < -0.2) return;
    this.lastFrameMs = frameMs;
    for (const material of this.materials) material.uniforms.time = frameMs / 1000;
    this.viewer.scene.requestRender();
  };

  setVisible(visible: boolean): void {
    this.visible = visible;
    for (const primitive of this.primitives) primitive.show = visible;
    if (!this.viewer.isDestroyed()) this.viewer.scene.requestRender();
  }

  dispose(): void {
    if (this.frameHandle !== null) cancelAnimationFrame(this.frameHandle);
    this.frameHandle = null;
    if (this.viewer.isDestroyed()) return;
    for (const primitive of this.primitives) this.viewer.scene.primitives.remove(primitive);
    this.primitives.length = 0;
    this.materials.length = 0;
    this.viewer.scene.requestRender();
  }
}
