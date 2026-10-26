/** A deliberately illustrative, metre-scale fireworks show; not observational data. */
export type FireworkStyle = "bloom" | "ring" | "willow";

export const FIREWORK_STYLES = ["bloom", "ring", "willow"] as const;

export interface FireworkParticle {
  start: number;
  life: number;
  east: number;
  north: number;
  height: number;
  ve: number;
  vn: number;
  vu: number;
  gravity: number;
  size: number;
  rgb: readonly [number, number, number];
}

export interface FireworkBurst {
  start: number;
  east: number;
  north: number;
  height: number;
}

export interface FireworkShow {
  bursts: FireworkBurst[];
  particles: FireworkParticle[];
  duration: number;
}

/** Reproducible random values mean the same style can be tested and replayed. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

const PALETTES: Record<FireworkStyle, readonly (readonly [number, number, number])[]> = {
  bloom: [[0.52, 0.76, 1], [1, 0.57, 0.72], [0.95, 0.95, 1]],
  ring: [[0.47, 0.95, 0.86], [0.72, 0.68, 1], [1, 0.80, 0.62]],
  willow: [[1, 0.78, 0.37], [1, 0.57, 0.24], [1, 0.91, 0.65]],
};

/** A small fixed particle budget across all three volleys. */
export function createFireworkShow(style: FireworkStyle, seed = 2026): FireworkShow {
  const rand = random(seed);
  const bursts: FireworkBurst[] = [];
  const particles: FireworkParticle[] = [];
  const count = style === "willow" ? 72 : 84;
  for (let volley = 0; volley < 3; volley++) {
    const start = 0.8 + volley * 1.65;
    const east = (volley - 1) * 95;
    const north = (volley % 2 === 0 ? -1 : 1) * 35;
    const height = 200 + rand() * 55;
    bursts.push({ start, east, north, height });
    const angle = rand() * Math.PI;
    for (let i = 0; i < count; i++) {
      const azimuth = 2 * Math.PI * (i + rand() * 0.3) / count;
      const z = 2 * rand() - 1;
      const radial = Math.sqrt(1 - z * z);
      const speed = style === "willow" ? 30 + rand() * 15 : 52 + rand() * 24;
      const ve = style === "ring" ? Math.cos(azimuth) * speed : Math.cos(azimuth) * radial * speed;
      const vn = style === "ring" ? Math.sin(azimuth) * Math.sin(angle) * speed : Math.sin(azimuth) * radial * speed;
      const vu = style === "ring" ? Math.sin(azimuth) * Math.cos(angle) * speed : z * speed;
      const palette = PALETTES[style];
      particles.push({
        start,
        life: style === "willow" ? 4.0 + rand() * 0.8 : 2.7 + rand() * 0.8,
        east, north, height,
        ve, vn, vu: style === "willow" ? vu + 18 : vu,
        gravity: style === "willow" ? 16 : 19.6,
        size: 2.3 + rand() * 1.8,
        rgb: palette[Math.floor(rand() * palette.length)],
      });
    }
  }
  return { bursts, particles, duration: Math.max(...particles.map((p) => p.start + p.life)) };
}

/** Return a local ENU position and opacity, or null outside the particle's life. */
export function particleAt(particle: FireworkParticle, seconds: number) {
  const age = seconds - particle.start;
  if (age < 0 || age >= particle.life) return null;
  const height = particle.height + particle.vu * age - 0.5 * particle.gravity * age * age;
  if (height <= 0) return null;
  const fade = Math.min(1, (particle.life - age) / (particle.life * 0.36));
  return {
    east: particle.east + particle.ve * age,
    north: particle.north + particle.vn * age,
    height,
    opacity: Math.max(0, fade),
  };
}
