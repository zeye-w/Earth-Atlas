import { Color, Material, PolylineCollection } from "cesium";
import type { FireworkParticle, FireworkShow, FireworkStyle } from "./physics.ts";
import { sparkFade } from "./showVisuals.ts";

/** Cesium owns each polyline's material and otherwise destroys shared ones twice.
 * Keep shared uniforms/draw groups while playing; detach duplicate ownership
 * before any disposal, including disposal initiated by Viewer.destroy(). */
export class RibbonCollection extends PolylineCollection {
  override destroy(): void {
    const owned = new Set<Material>();
    for (let i = 0; i < this.length; i++) {
      const line = this.get(i), material = line.material;
      if (owned.has(material)) line.material = new Material({ fabric: {
        type: "TerraScopeRetiredRibbon", components: { diffuse: "vec3(0.0)", alpha: "0.0" },
      } });
      else owned.add(material);
    }
    super.destroy();
  }
}

type Tint = readonly [number, number, number];
const PALETTES: Record<FireworkStyle, readonly Tint[]> = {
  bloom: [[0.42, 0.76, 1], [1, 0.76, 0.43], [1, 0.38, 0.65]],
  ring: [[0.42, 1, 0.84], [0.7, 0.56, 1], [1, 0.82, 0.54]],
  willow: [[1, 0.78, 0.32], [1, 0.59, 0.19], [1, 0.91, 0.63]],
};
/** One spark ribbon per burst colour; identical source for every instance, so
 * Cesium compiles the program once (see shaderWarmup.ts). */
export function sparkRibbonMaterial(rgb: Tint, fade = 1) {
  return new Material({ fabric: {
    type: "TerraScopeSparkRibbon", uniforms: { color: new Color(...rgb), fade },
    source: `czm_material czm_getMaterial(czm_materialInput materialInput) {
      czm_material m = czm_getDefaultMaterial(materialInput);
      float edge = abs(materialInput.st.t - 0.5) * 2.0;
      float core = exp(-edge * edge * 60.0);
      float halo = pow(max(0.0, 1.0 - edge), 3.0);
      float taper = smoothstep(0.0, 0.85, materialInput.st.s);
      m.emission = mix(color.rgb, vec3(1.0, 0.97, 0.9), core * 0.7) * 1.8;
      m.alpha = (core * 0.92 + halo * 0.3) * taper * fade;
      return m;
    }`,
  } });
}
export function sparkMaterials(show: FireworkShow, style: FireworkStyle) {
  const entries = show.bursts.map((burst, i) => {
    const rgb = PALETTES[style][i % 3];
    const material = sparkRibbonMaterial(rgb);
    return { rgb, material, start: burst.start, life: Math.max(...show.particles.filter(p => p.burst === i).map(p => p.life)) };
  });
  const byParticle = new Map<FireworkParticle, typeof entries[number]>();
  for (const p of show.particles) byParticle.set(p, entries[p.burst]);
  return { entries, byParticle };
}
export function fadeSparks(entries: ReturnType<typeof sparkMaterials>["entries"], time: number) {
  entries.forEach(e => { e.material.uniforms.fade = sparkFade(time - e.start, e.life); });
}
export function cometMaterial() {
  return new Material({ fabric: {
    type: "TerraScopeCometRibbon", uniforms: { fade: 1 },
    source: `czm_material czm_getMaterial(czm_materialInput materialInput) {
      czm_material m = czm_getDefaultMaterial(materialInput);
      float edge = abs(materialInput.st.t - 0.5) * 2.0;
      float core = exp(-edge * edge * 80.0);
      float halo = pow(max(0.0, 1.0 - edge), 2.5);
      float wake = mix(0.04, 1.0, pow(materialInput.st.s, 1.6));
      vec3 tint = mix(vec3(1.0, 0.46, 0.16), vec3(0.48, 0.8, 1.0), materialInput.st.s);
      m.emission = mix(tint, vec3(1.0, 0.97, 0.88), core * 0.85);
      m.alpha = (core + halo * 0.35) * wake * fade;
      return m;
    }`,
  } });
}
export function exhaustMaterial() {
  return new Material({ fabric: { type: "TerraScopeRocketExhaust", uniforms: { time: 0 },
    source: `czm_material czm_getMaterial(czm_materialInput materialInput) {
      czm_material m = czm_getDefaultMaterial(materialInput);
      float axial = materialInput.st.t;
      float ripple = 0.85 + 0.15 * sin(time * 37.0 + axial * 24.0 + materialInput.st.s * 13.0);
      vec3 tint = mix(vec3(1.0, 0.34, 0.07), vec3(0.6, 0.83, 1.0), smoothstep(0.6, 1.0, axial));
      m.emission = tint * (1.1 + axial * 0.8);
      m.alpha = smoothstep(0.0, 0.32, axial) * ripple * 0.68;
      return m;
    }` } });
}
