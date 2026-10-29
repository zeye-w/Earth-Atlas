import {
  Cartesian3, Cartographic, Cesium3DTileset, Cesium3DTileStyle, CesiumTerrainProvider, CustomShader,
  Ellipsoid, ImageryLayer, IonImageryProvider, IonResource, Math as CesiumMath, Matrix3, Matrix4,
  Rectangle, Simon1994PlanetaryPositions, Transforms, UniformType, VaryingType,
  sampleTerrainMostDetailed, type Viewer,
} from "cesium";
import { RENDER_PROFILES } from "../performance.ts";

interface Site { longitude: number; latitude: number }
export type CityStatus = "disabled" | "idle" | "loading" | "ready" | "failed";
// One viewer/overlay owns this store. It bridges the panel without changing App props.
let status: CityStatus = "idle";
const listeners = new Set<() => void>();
export const getCityStatus = () => status;
export function subscribeCityStatus(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
function publish(next: CityStatus) {
  status = next;
  listeners.forEach(listener => listener());
}

export function canLoadCity(token: string | undefined): boolean {
  return Boolean(token?.trim());
}
export function retainCity(height: number, running: boolean): boolean {
  return running || !Number.isFinite(height) || height <= 15_000;
}
/** ECEF translation along the site's ellipsoid normal, not the global Z axis. */
export function terrainShift(site: Site, height: number): Matrix4 {
  if (!Number.isFinite(height)) return Matrix4.clone(Matrix4.IDENTITY);
  const normal = Ellipsoid.WGS84.geodeticSurfaceNormalCartographic(
    Cartographic.fromDegrees(site.longitude, site.latitude), new Cartesian3(),
  );
  return Matrix4.fromTranslation(Cartesian3.multiplyByScalar(normal, -height, normal));
}

function windowsShader(up: Cartesian3): CustomShader {
  return new CustomShader({
    uniforms: {
      u_siteUp: { type: UniformType.VEC3, value: up },
      u_night: { type: UniformType.FLOAT, value: 0 },
    },
    varyings: { v_wall: VaryingType.FLOAT, v_windowPosition: VaryingType.VEC3 },
    // Tile model axes are not guaranteed to be Z-up. Project model positions
    // into a basis whose up vector is the site's geodetic normal in model space.
    vertexShaderText: `void vertexMain(VertexInput vsInput, inout czm_modelVertexOutput vsOutput) {
      vec3 upMC = normalize((czm_inverseModel * vec4(u_siteUp, 0.0)).xyz);
      vec3 reference = abs(upMC.x) < 0.9 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
      vec3 eastMC = normalize(cross(reference, upMC));
      vec3 northMC = cross(upMC, eastMC);
      vec3 p = vsInput.attributes.positionMC;
      v_windowPosition = vec3(dot(p, eastMC), dot(p, northMC), dot(p, upMC));
      v_wall = 1.0 - step(0.45, abs(dot(normalize(vsInput.attributes.normalMC), upMC)));
    }`,
    fragmentShaderText: `void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
      vec3 p = v_windowPosition;
      vec2 cell = fract(vec2(p.x + p.y, p.z) / vec2(2.5, 3.0));
      float windowMask = step(0.22, cell.x) * step(cell.x, 0.72) * step(0.28, cell.y) * step(cell.y, 0.75);
      vec2 block = floor(vec2(p.x + p.y, p.z) / vec2(2.5, 3.0));
      float occupied = step(0.35, fract(sin(dot(block, vec2(12.9898, 78.233))) * 43758.5453));
      material.diffuse = vec3(0.82);
      material.emissive += vec3(1.0, 0.58, 0.20) * windowMask * occupied * v_wall * u_night;
    }`,
  });
}

/**
 * Hide OSM buildings within `radius` metres of the site, using each
 * building's own centre (the cesium#latitude/longitude feature properties).
 */
export function clearingStyle(site: Site, radius: number): Cesium3DTileStyle {
  // Degrees of latitude and (scaled) longitude are about 111.32 km anywhere.
  const scale = Math.cos(CesiumMath.toRadians(site.latitude));
  const degrees = radius / 111_320;
  return new Cesium3DTileStyle({
    show: `distance(vec2(\${feature['cesium#longitude']} * ${scale.toFixed(6)}, \${feature['cesium#latitude']}), vec2(${(site.longitude * scale).toFixed(6)}, ${site.latitude.toFixed(6)})) > ${degrees.toFixed(7)}`,
  });
}

/** Optional local backdrop. Never changes the viewer's terrain or global ion token. */
export class CityContext {
  private viewer: Viewer;
  private generation = 0;
  private disposed = false;
  private tileset: Cesium3DTileset | null = null;
  private imagery: ImageryLayer | null = null;
  private shader: CustomShader | null = null;
  private removers: Array<() => void> = [];

  constructor(viewer: Viewer) {
    this.viewer = viewer;
    publish(canLoadCity(import.meta.env?.VITE_CESIUM_ION_TOKEN) ? "idle" : "disabled");
  }

  /** `clearRadius` (metres) hides buildings around the site, e.g. where a launch complex stands. */
  async show(site: Site, clearRadius = 0): Promise<void> {
    this.hide();
    const accessToken = import.meta.env?.VITE_CESIUM_ION_TOKEN?.trim();
    if (this.disposed || this.viewer.isDestroyed() || !canLoadCity(accessToken)) return;
    const generation = this.generation;
    const active = () => !this.disposed && !this.viewer.isDestroyed() && generation === this.generation;
    publish("loading");
    // Keep soft terrain failure separate from imagery/building load failure.
    const sampleHeight = async () => {
      try {
        const terrainResource = await IonResource.fromAssetId(1, { accessToken });
        if (!active()) return 0;
        const terrain = await CesiumTerrainProvider.fromUrl(terrainResource);
        if (!active()) return 0;
        const [position] = await sampleTerrainMostDetailed(terrain, [Cartographic.fromDegrees(site.longitude, site.latitude)]);
        if (!Number.isFinite(position.height)) throw new Error("No height");
        return position.height;
      } catch {
        // Do not log resource errors: their URLs can contain the access token.
        if (active()) console.warn("City terrain sampling failed; buildings retain their source altitude.");
        return 0;
      }
    };
    const loadBuildings = async () => {
      const resource = await IonResource.fromAssetId(96188, { accessToken });
      if (!active()) return null;
      return Cesium3DTileset.fromUrl(resource, {
        maximumScreenSpaceError: this.screenError(), cacheBytes: 256 * 1024 * 1024,
        maximumCacheOverflowBytes: 0, preloadFlightDestinations: false,
        preloadWhenHidden: false, showCreditsOnScreen: true,
      });
    };
    const [buildings, imagery, terrain] = await Promise.allSettled([
      loadBuildings(), IonImageryProvider.fromAssetId(2, { accessToken }), sampleHeight(),
    ]);
    const tileset = buildings.status === "fulfilled" ? buildings.value : null;
    if (!active() || !tileset || imagery.status !== "fulfilled") {
      if (tileset && !tileset.isDestroyed()) tileset.destroy();
      if (active()) publish("failed");
      return;
    }
    try {
      tileset.modelMatrix = terrainShift(site, terrain.status === "fulfilled" ? terrain.value : 0);
      const up = Ellipsoid.WGS84.geodeticSurfaceNormalCartographic(Cartographic.fromDegrees(site.longitude, site.latitude), new Cartesian3());
      this.shader = windowsShader(up);
      tileset.customShader = this.shader;
      if (clearRadius > 0) tileset.style = clearingStyle(site, clearRadius);
      this.tileset = this.viewer.scene.primitives.add(tileset);
      // Keep the provider's actual ion/Bing attribution, but display it in
      // Cesium's on-screen credit row rather than only the credits popup.
      const provider = imagery.value;
      if (provider.credit) provider.credit.showOnScreen = true;
      const getTileCredits = provider.getTileCredits.bind(provider);
      provider.getTileCredits = (x, y, level) => {
        const credits = getTileCredits(x, y, level);
        credits?.forEach(credit => { credit.showOnScreen = true; });
        return credits;
      };
      // Limit high-resolution imagery to the neighbourhood; leave global layers alone.
      this.imagery = new ImageryLayer(provider, {
        rectangle: Rectangle.fromDegrees(site.longitude - 0.04, Math.max(-90, site.latitude - 0.04), site.longitude + 0.04, Math.min(90, site.latitude + 0.04)),
      });
      this.viewer.imageryLayers.add(this.imagery);
      const failed = () => { if (active()) publish("failed"); };
      this.removers.push(tileset.tileFailed.addEventListener(failed), imagery.value.errorEvent.addEventListener(failed));
      const update = () => {
        if (!active()) return;
        tileset.maximumScreenSpaceError = this.screenError();
        const time = this.viewer.clock.currentTime;
        const sun = Simon1994PlanetaryPositions.computeSunPositionInEarthInertialFrame(time);
        const rotation = Transforms.computeIcrfToFixedMatrix(time) ?? Transforms.computeTemeToPseudoFixedMatrix(time);
        Matrix3.multiplyByVector(rotation, sun, sun);
        Cartesian3.normalize(sun, sun);
        this.shader?.setUniform("u_night", Cartesian3.dot(sun, up) < 0 ? 1 : 0);
      };
      this.removers.push(this.viewer.scene.preRender.addEventListener(update));
      update();
      publish("ready");
      this.viewer.scene.requestRender();
    } catch {
      this.hide();
      if (!tileset.isDestroyed()) tileset.destroy();
      publish("failed");
    }
  }

  private screenError(): number {
    // useRenderQuality applies this stable frame budget from performance.ts;
    // unlike globe SSE it does not change temporarily during camera movement.
    return this.viewer.targetFrameRate <= RENDER_PROFILES.eco.targetFrameRate ? 32 : 16;
  }

  hide(): void {
    this.generation++;
    this.removers.splice(0).forEach(remove => remove());
    if (!this.viewer.isDestroyed()) {
      if (this.tileset) this.viewer.scene.primitives.remove(this.tileset);
      if (this.imagery) this.viewer.imageryLayers.remove(this.imagery, true);
      this.viewer.scene.requestRender();
    }
    this.tileset = null;
    this.imagery = null;
    if (this.shader && !this.shader.isDestroyed()) this.shader.destroy();
    this.shader = null;
  }

  dispose(): void {
    this.disposed = true;
    this.hide();
  }
}
