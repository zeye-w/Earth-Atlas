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
import type { AuroraProfile } from "./auroraData.ts";

/**
 * Northern aurora drawn from NOAA OVATION nowcast data: translucent animated
 * curtains follow the probability-weighted latitude of the auroral oval at
 * each longitude, with brightness from the forecast probability there.
 */

// Main curtain at the oval centre and a fainter one slightly poleward.
const LAYERS = [
  { poleward: 0, minHeight: 95_000, maxHeight: 330_000, seed: 0.0, strength: 1.0 },
  { poleward: 1.8, minHeight: 100_000, maxHeight: 260_000, seed: 7.3, strength: 0.65 },
] as const;
const INTENSITY_TEXELS = 512;
// Curtains shimmer, so animate at a modest fixed rate while visible.
export const AURORA_FPS = 20;

/** Closed [lon, lat, ...] ring (361 points) from a 360-longitude profile. */
export function profileRing(profile: AuroraProfile, polewardDeg = 0): number[] {
  const coords: number[] = [];
  for (let lon = 0; lon <= 360; lon++) {
    const lat = Math.min(89, profile.latitudes[lon % 360] + polewardDeg);
    coords.push(lon > 180 ? lon - 360 : lon, lat);
  }
  return coords;
}

/**
 * Brightness sampled by fraction of distance along the ring, matching how
 * WallGeometry assigns its s texture coordinate.
 */
export function intensityAlongRing(positions: readonly Cartesian3[], profile: AuroraProfile, texels = INTENSITY_TEXELS): Float32Array {
  const cumulative = [0];
  for (let i = 1; i < positions.length; i++) {
    cumulative.push(cumulative[i - 1] + Cartesian3.distance(positions[i - 1], positions[i]));
  }
  const total = cumulative[cumulative.length - 1] || 1;
  const out = new Float32Array(texels);
  let segment = 0;
  for (let t = 0; t < texels; t++) {
    const distance = (t / (texels - 1)) * total;
    while (segment < cumulative.length - 2 && cumulative[segment + 1] < distance) segment++;
    const span = cumulative[segment + 1] - cumulative[segment] || 1;
    const f = Math.min(1, Math.max(0, (distance - cumulative[segment]) / span));
    const a = profile.intensities[segment % 360];
    const b = profile.intensities[(segment + 1) % 360];
    out[t] = a + (b - a) * f;
  }
  return out;
}

// Cesium deep-clones fabric uniforms, so the texture is passed as a data URL
// rather than a canvas element.
function intensityImage(values: Float32Array): string {
  const canvas = document.createElement("canvas");
  canvas.width = values.length;
  canvas.height = 1;
  const context = canvas.getContext("2d")!;
  const image = context.createImageData(values.length, 1);
  values.forEach((value, i) => {
    const v = Math.round(Math.min(1, Math.max(0, value)) * 255);
    image.data.set([v, v, v, 255], i * 4);
  });
  context.putImageData(image, 0, 0);
  return canvas.toDataURL("image/png");
}

// Green (557.7 nm oxygen) at the base fading to violet higher up, with
// drifting vertical rays; brightness from NOAA probability along the ring.
// Faded out on the sunlit side of the globe.
const AURORA_SHADER = `
uniform float time;
uniform float seed;
uniform float strength;
uniform sampler2D intensityMap;

czm_material czm_getMaterial(czm_materialInput materialInput) {
  czm_material material = czm_getDefaultMaterial(materialInput);
  vec2 st = materialInput.st;
  float s = st.s * 140.0 + seed;
  float t = time + seed;
  float observed = texture(intensityMap, vec2(st.s, 0.5)).r;

  float rays = 0.55
    + 0.25 * sin(s * 1.0 + t * 0.7)
    + 0.15 * sin(s * 2.7 - t * 1.1)
    + 0.10 * sin(s * 6.1 + t * 2.3 + sin(s * 0.3 + t) * 2.0);
  float fold = 0.65 + 0.35 * sin(st.s * 6.2831 * 9.0 - t * 0.35 + sin(t * 0.2) * 2.0);

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

  float alpha = observed * base * fadeTop * rays * fold * strength * mix(0.12, 1.0, night);
  material.diffuse = color;
  material.emission = color * alpha * 2.0;
  material.alpha = clamp(alpha * 1.25, 0.0, 1.0);
  return material;
}
`;

export class AuroraOverlay {
  private readonly viewer: Viewer;
  private primitives: Primitive[] = [];
  private materials: Material[] = [];
  private frameHandle: number | null = null;
  private lastFrameMs = 0;
  private visible = true;

  constructor(viewer: Viewer) {
    this.viewer = viewer;
    this.frameHandle = requestAnimationFrame(this.onFrame);
  }

  /** Replace the curtains with a new NOAA profile, or clear them with null. */
  setProfile(profile: AuroraProfile | null): void {
    this.clear();
    if (!profile || this.viewer.isDestroyed()) return;
    for (const layer of LAYERS) {
      const positions = Cartesian3.fromDegreesArray(profileRing(profile, layer.poleward));
      const material = new Material({
        fabric: {
          type: "TerraScopeAurora",
          uniforms: {
            time: 0,
            seed: layer.seed,
            strength: layer.strength,
            intensityMap: intensityImage(intensityAlongRing(positions, profile)),
          },
          source: AURORA_SHADER,
        },
        translucent: true,
      });
      const primitive = new Primitive({
        geometryInstances: new GeometryInstance({
          geometry: WallGeometry.fromConstantHeights({
            positions,
            minimumHeight: layer.minHeight,
            maximumHeight: layer.maxHeight,
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
        show: this.visible,
        asynchronous: true,
      });
      this.viewer.scene.primitives.add(primitive);
      this.primitives.push(primitive);
      this.materials.push(material);
    }
    this.viewer.scene.requestRender();
  }

  private readonly onFrame = (frameMs: number): void => {
    if (this.viewer.isDestroyed()) return;
    this.frameHandle = requestAnimationFrame(this.onFrame);
    if (!this.visible || this.materials.length === 0 || document.visibilityState !== "visible") return;
    if (frameMs - this.lastFrameMs < 1000 / AURORA_FPS) return;
    // Skip work while the northern polar region faces away from the camera.
    const cameraDirection = Cartesian3.normalize(this.viewer.camera.positionWC, new Cartesian3());
    if (Cartesian3.dot(cameraDirection, Cartesian3.UNIT_Z) < -0.35) return;
    this.lastFrameMs = frameMs;
    for (const material of this.materials) material.uniforms.time = frameMs / 1000;
    this.viewer.scene.requestRender();
  };

  setVisible(visible: boolean): void {
    this.visible = visible;
    for (const primitive of this.primitives) primitive.show = visible;
    if (!this.viewer.isDestroyed()) this.viewer.scene.requestRender();
  }

  private clear(): void {
    if (!this.viewer.isDestroyed()) {
      for (const primitive of this.primitives) this.viewer.scene.primitives.remove(primitive);
    }
    this.primitives = [];
    this.materials = [];
  }

  dispose(): void {
    if (this.frameHandle !== null) cancelAnimationFrame(this.frameHandle);
    this.frameHandle = null;
    this.clear();
    if (!this.viewer.isDestroyed()) this.viewer.scene.requestRender();
  }
}
