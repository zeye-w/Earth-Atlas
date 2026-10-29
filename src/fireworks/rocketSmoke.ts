import { IGNITION_LEAD, rocketFrame, ROCKET_COUNTDOWN } from "./rocketFlight.ts";

/** Show time at which the engines light (the rocket is still held down). */
const IGNITION = ROCKET_COUNTDOWN - IGNITION_LEAD;

/**
 * Exhaust smoke for the rocket show, in the pad's east-north-up metres. Pure
 * and deterministic (same time, same puff) so it can be tested and replayed.
 *
 * Two layers, both made of soft billboards sized in metres:
 * - the column: puffs leave the nozzle continuously, slow down, widen and
 *   drift, overlapping into one plume instead of a string of beads;
 * - the ground cloud: while the flame still reaches the pad, exhaust is
 *   deflected sideways and billows outward and up around the pad.
 */
export interface Puff { east: number; north: number; up: number; size: number; alpha: number; heat: number; rotation: number }

export const TRAIL_SECONDS = 6;
export const GROUND_SECONDS = 22;
/** The flame keeps feeding the ground cloud while the rocket is this low. */
const GROUND_REACH_M = 70;
const WIND = 3.5; // m/s towards the east

/** Stable pseudo-random value in [0, 1) for puff `index`, channel `salt`. */
export function hash(index: number, salt: number): number {
  const x = Math.sin(index * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/** Column puff `index` of `count` at show time `elapsed` (countdown included). */
export function trailPuff(index: number, count: number, elapsed: number): Puff | null {
  if (!Number.isFinite(elapsed) || count <= 0) return null;
  // Puffs are evenly staggered and recycled: each lives TRAIL_SECONDS.
  const age = ((elapsed - index * TRAIL_SECONDS / count) % TRAIL_SECONDS + TRAIL_SECONDS) % TRAIL_SECONDS;
  const emitted = elapsed - age;
  if (emitted < IGNITION || !rocketFrame(elapsed).thrust) return null;
  const source = rocketFrame(emitted);
  // Gas leaves backwards along the body axis and is stopped by the air.
  const axisEast = Math.sin(source.tilt), axisUp = Math.cos(source.tilt);
  const back = 2 + 30 * (1 - Math.exp(-3 * age));
  const spread = 2 + 13 * Math.sqrt(age);
  const angle = hash(index, 1) * 2 * Math.PI;
  const wide = 0.8 + 0.4 * hash(index, 2);
  // A fast rocket lays puffs further apart: young puffs scale with speed so
  // neighbours still overlap (the plume also widens in thinner air).
  const size = (7 + 2.6 * source.speed * TRAIL_SECONDS / count + 24 * Math.sqrt(age)) * wide;
  const up = source.altitude - axisUp * back + 1.2 * age;
  if (up < 2) return null; // Near the pad the ground cloud takes over.
  return {
    east: source.east - axisEast * back + Math.cos(angle) * spread + WIND * age,
    north: Math.sin(angle) * spread,
    up: Math.max(up, size * 0.42), // rest on the ground rather than cut into it
    size,
    alpha: 0.4 * Math.min(1, age / 0.04) * Math.pow(1 - age / TRAIL_SECONDS, 1.3),
    heat: Math.max(0, 1 - age / 0.3),
    rotation: hash(index, 3) * 6.283 + age * 0.15 * (hash(index, 4) - 0.5),
  };
}

/** Ground-cloud puff `index` of `count`; puffs are emitted once, from ignition. */
export function groundPuff(index: number, count: number, elapsed: number): Puff | null {
  if (!Number.isFinite(elapsed) || count <= 0) return null;
  // Emit while the flame reaches the pad; denser at ignition.
  const fraction = (index + hash(index, 5) * 0.8) / count;
  const emitted = IGNITION + IGNITION_WINDOW * fraction * fraction;
  const age = elapsed - emitted;
  if (age < 0 || age >= GROUND_SECONDS) return null;
  const angle = hash(index, 6) * 2 * Math.PI;
  const drag = 0.32, speed = 30 + 34 * hash(index, 7);
  const reach = speed / drag * (1 - Math.exp(-drag * age));
  const wide = 0.8 + 0.4 * hash(index, 8);
  const size = Math.min(170, (24 + 40 * Math.sqrt(age)) * wide);
  const billow = 34 * (1 - Math.exp(-age / 6)) * (0.6 + 0.8 * hash(index, 9));
  return {
    east: Math.cos(angle) * reach + WIND * age,
    north: Math.sin(angle) * reach,
    // Centres sit at least 0.42 sizes up, so the soft edge rests on the ground.
    up: size * 0.42 + billow,
    size,
    alpha: 0.34 * Math.min(1, age / 0.35) * Math.pow(1 - age / GROUND_SECONDS, 1.5),
    heat: Math.max(0, 1 - age / 1.4),
    rotation: hash(index, 10) * 6.283 + age * 0.04,
  };
}

/** Seconds after ignition during which the flame still reaches the pad. */
export const IGNITION_WINDOW = (() => {
  let t = ROCKET_COUNTDOWN;
  while (rocketFrame(t).altitude < GROUND_REACH_M && t < ROCKET_COUNTDOWN + 20) t += 0.05;
  return t - IGNITION;
})();
