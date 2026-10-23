import { Color, Material } from "cesium";

/**
 * Polyline material for "something travels along this line": a soft glow
 * across the width, a dim core, and bright pulses sliding along st.s (0 to 1
 * from the first point to the last). `time` (seconds) is advanced by the
 * overlay; `repeat` is the number of pulses along one line and `speed` how
 * many pulse spacings they move per second.
 */
// The uniforms are declared by Cesium from fabric.uniforms.
const SOURCE = `
czm_material czm_getMaterial(czm_materialInput materialInput) {
  czm_material material = czm_getDefaultMaterial(materialInput);
  vec2 st = materialInput.st;
  float across = 1.0 - abs(st.t - 0.5) * 2.0;
  float glow = pow(across, 2.2);
  float core = smoothstep(0.55, 1.0, across);
  float t = fract(st.s * repeat - time * speed);
  // Pulses move towards +s: a bright head with a fading tail behind it.
  float head = smoothstep(0.62, 0.96, t) * (1.0 - smoothstep(0.96, 1.0, t));
  head *= head;
  float h = pulse * head;
  // A dim line with a soft halo; pulses brighten towards white so they read
  // even where the line colour is already saturated.
  vec3 rgb = mix(color.rgb, vec3(1.0), h * 0.75);
  material.diffuse = rgb;
  material.emission = rgb * (0.4 + h);
  material.alpha = clamp(color.a * (0.22 * glow + 0.5 * core) + h * (0.35 * glow + 0.65 * core), 0.0, 1.0);
  return material;
}`;

export interface FlowMaterialOptions {
  color: Color;
  /** Pulses along one line. */
  repeat?: number;
  /** Pulse travel, in pulse spacings per second; a multiple of 0.001 keeps the period seamless. */
  speed?: number;
  /** 0 for a steady line without pulses (planned cables, reduced motion). */
  pulse?: number;
}

let materials = 0;

export function flowMaterial({ color, repeat = 4, speed = 0.35, pulse = 1 }: FlowMaterialOptions): Material {
  return new Material({
    fabric: { type: "InternetFlow" + ++materials, uniforms: { color, time: 0, speed, repeat, pulse }, source: SOURCE },
    translucent: true,
  });
}

// GPU floats are 32-bit: seconds since 1970 (~1.8e9) keep no fraction at
// all. The shader gets the time modulo a period after which every pulse
// pattern repeats exactly (speed x period is a whole number of spacings).
export const FLOW_PERIOD_S = 1_000;

/** Advance every flow material to `seconds` (shared clock keeps pulses in step). */
export function setFlowTime(materials: Iterable<Material>, seconds: number): void {
  const time = ((seconds % FLOW_PERIOD_S) + FLOW_PERIOD_S) % FLOW_PERIOD_S;
  for (const material of materials) material.uniforms.time = time;
}
