/** A deliberately illustrative, metre-scale fireworks show; not observational data. */
export type FireworkStyle = "bloom" | "ring" | "willow";

export const FIREWORK_STYLES = ["bloom", "ring", "willow"] as const;

export interface FireworkParticle {
  /** Index into FireworkShow.bursts (finale shells share a start time). */
  burst: number;
  start: number;
  life: number;
  east: number;
  north: number;
  height: number;
  ve: number;
  vn: number;
  vu: number;
  gravity: number;
  /** Air drag rate, 1/s: stars burst fast, then slow and hang before falling. */
  drag: number;
  size: number;
  rgb: readonly [number, number, number];
  /** Flickers in the second half of its life; phase de-synchronises the flicker. */
  twinkle: boolean;
  phase: number;
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

const TWINKLE_SHARE: Record<FireworkStyle, number> = { bloom: 0.35, ring: 0.25, willow: 0.5 };

/**
 * Three solo shells walk across the sky (left, right, then high centre), then
 * a finale fires three at once, lighter each so the budget stays bounded.
 * Everything ends before 10 s: the space show repeats the show on that cycle.
 */
const LAYOUT = [
  { start: 0.8, east: -120, north: -40, height: 290, share: 1 },
  { start: 2.2, east: 130, north: 40, height: 320, share: 1 },
  { start: 3.6, east: 0, north: -20, height: 370, share: 1 },
  { start: 5.0, east: -175, north: 30, height: 270, share: 2 / 3 },
  { start: 5.0, east: 0, north: 0, height: 410, share: 2 / 3 },
  { start: 5.0, east: 175, north: -30, height: 300, share: 2 / 3 },
] as const;

/** A small fixed particle budget across all three volleys. */
export function createFireworkShow(style: FireworkStyle, seed = 2026): FireworkShow {
  const rand = random(seed);
  const bursts: FireworkBurst[] = [];
  const particles: FireworkParticle[] = [];
  for (const shell of LAYOUT) {
    const { start, east, north } = shell;
    const height = shell.height + (rand() - 0.5) * 40;
    const burst = bursts.push({ start, east, north, height }) - 1;
    const count = Math.round((style === "willow" ? 72 : 84) * shell.share);
    const angle = rand() * Math.PI;
    for (let i = 0; i < count; i++) {
      const azimuth = 2 * Math.PI * (i + rand() * 0.3) / count;
      const z = 2 * rand() - 1;
      const radial = Math.sqrt(1 - z * z);
      // With drag a star travels at most speed / drag: about 90-115 m for bloom
      // and ring, a little less for the slower, drooping willow.
      const speed = style === "willow" ? 95 + rand() * 25 : 170 + rand() * 50;
      const ve = style === "ring" ? Math.cos(azimuth) * speed : Math.cos(azimuth) * radial * speed;
      const vn = style === "ring" ? Math.sin(azimuth) * Math.sin(angle) * speed : Math.sin(azimuth) * radial * speed;
      const vu = style === "ring" ? Math.sin(azimuth) * Math.cos(angle) * speed : z * speed;
      const palette = PALETTES[style];
      particles.push({
        burst, start,
        life: style === "willow" ? 4.0 + rand() * 0.8 : 2.7 + rand() * 0.8,
        east, north, height,
        ve, vn, vu: style === "willow" ? vu + 18 : vu,
        gravity: style === "willow" ? 16 : 19.6,
        drag: style === "willow" ? 1.1 : 1.9,
        size: 2.3 + rand() * 1.8,
        rgb: palette[Math.floor(rand() * palette.length)],
        twinkle: rand() < TWINKLE_SHARE[style],
        phase: rand() * 2 * Math.PI,
      });
    }
  }
  return { bursts, particles, duration: Math.max(...particles.map((p) => p.start + p.life)) };
}

/**
 * Return a local ENU position, opacity and heat (1 = white-hot at the burst,
 * 0 = its own colour), or null outside the particle's life or below ground.
 * Linear drag: v(t) = v0·e^(-kt), falling towards a terminal speed g/k.
 */
export function particleAt(particle: FireworkParticle, seconds: number) {
  const age = seconds - particle.start;
  if (age < 0 || age >= particle.life) return null;
  const k = particle.drag;
  // Distance travelled per unit initial speed; tends to `age` as drag goes to 0.
  const reach = k > 1e-6 ? (1 - Math.exp(-k * age)) / k : age;
  const height = k > 1e-6
    ? particle.height + (particle.vu + particle.gravity / k) * reach - particle.gravity * age / k
    : particle.height + particle.vu * age - 0.5 * particle.gravity * age * age;
  if (height <= 0) return null;
  let opacity = Math.max(0, Math.min(1, (particle.life - age) / (particle.life * 0.36)));
  if (particle.twinkle && age > particle.life * 0.5 && Math.sin(age * 38 + particle.phase) < 0.2) opacity *= 0.25;
  return {
    east: particle.east + particle.ve * reach,
    north: particle.north + particle.vn * reach,
    height,
    opacity,
    heat: Math.max(0, 1 - age / 0.22),
  };
}
