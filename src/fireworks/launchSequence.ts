import { IGNITION_LEAD, ROCKET_COUNTDOWN, ROCKET_DURATION, rocketFrame } from "./rocketFlight.ts";
import { hash, type Puff } from "./rocketSmoke.ts";

/**
 * The ground show's lead-in before rocketFrame's own clock starts: the rocket
 * stands on the pad venting liquid-oxygen vapour, the service arms swing
 * away, then the engines light and liftoff follows (see rocketFlight.ts).
 * Pure and deterministic, like the smoke, so it can be tested and replayed.
 *
 * Show time `elapsed` runs from 0 (camera arrives, T−10) to SHOW_DURATION.
 */
export const PRELAUNCH_SECONDS = 7;
export const COUNTDOWN_SECONDS = PRELAUNCH_SECONDS + ROCKET_COUNTDOWN;
export const SHOW_DURATION = PRELAUNCH_SECONDS + ROCKET_DURATION;
/** Show time at which the engines light. */
export const IGNITION_TIME = COUNTDOWN_SECONDS - IGNITION_LEAD;
/** Service arms swing away between these show times (T−6 to T−3.5). */
const ARMS_START = COUNTDOWN_SECONDS - 6, ARMS_END = COUNTDOWN_SECONDS - 3.5;
/** Venting stops shortly before ignition. */
const VENT_END = IGNITION_TIME - 0.6;
export const VENT_SECONDS = 3.2;

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** The flight state at show time `elapsed`; during the prelude the rocket waits on the pad. */
export function showFrame(elapsed: number) {
  const safe = Number.isFinite(elapsed) ? Math.max(0, elapsed) : 0;
  const flight = rocketFrame(safe - PRELAUNCH_SECONDS);
  return { ...flight, countdown: Math.max(0, Math.ceil(COUNTDOWN_SECONDS - safe)) };
}

export interface Prelaunch {
  /** 0 with the arms against the rocket, 1 swung clear. */
  arms: number;
  /** Venting strength, 0–1. */
  vent: number;
  /** Follow-camera offset from the rocket: heading (rad), pitch (rad) and range (m). */
  heading: number;
  pitch: number;
  range: number;
}

/**
 * Arms, venting and the camera's slow orbit before liftoff. The orbit ends
 * exactly on the flight camera (heading 0, pitch −0.025, 650 m) at liftoff,
 * so the hand-over does not jump.
 */
export function prelaunch(elapsed: number): Prelaunch {
  const safe = Number.isFinite(elapsed) ? Math.max(0, elapsed) : 0;
  const orbit = smoothstep(0, COUNTDOWN_SECONDS, safe);
  return {
    arms: smoothstep(ARMS_START, ARMS_END, safe),
    vent: 1 - smoothstep(VENT_END - 0.8, VENT_END, safe),
    heading: -1.05 * (1 - orbit),
    pitch: -0.13 + 0.105 * orbit,
    range: 470 + 180 * orbit,
  };
}

/** Where the vapour leaves the rocket (pad east-north-up metres): two vents on the core stage, above the boosters. */
const VENTS = [{ up: 72, radius: 6.2 }, { up: 58, radius: 6.2 }] as const;
const VENT_WIND = 2.2; // m/s towards the east

/**
 * Vent vapour puff `index` of `count` at show time `elapsed`. Cold vapour
 * leaves the side of the rocket, is pushed out a few metres, then sinks and
 * drifts with the wind while it spreads and fades.
 */
export function ventPuff(index: number, count: number, elapsed: number): Puff | null {
  if (!Number.isFinite(elapsed) || count <= 0) return null;
  const age = ((elapsed - index * VENT_SECONDS / count) % VENT_SECONDS + VENT_SECONDS) % VENT_SECONDS;
  const emitted = elapsed - age;
  if (emitted < 0) return null;
  const strength = prelaunch(emitted).vent;
  if (strength <= 0.02) return null;
  const vent = VENTS[index % VENTS.length];
  // Mostly from the side away from the tower (east), with some spread.
  const angle = (hash(index, 21) - 0.5) * 2.6;
  const out = vent.radius + 7 * (1 - Math.exp(-1.8 * age));
  const size = (4.5 + 14 * Math.sqrt(age)) * (0.8 + 0.4 * hash(index, 22));
  return {
    east: Math.cos(angle) * out + VENT_WIND * age,
    north: Math.sin(angle) * out,
    up: Math.max(size * 0.42, vent.up - 1.6 * age * age),
    size,
    alpha: 0.45 * strength * Math.min(1, age / 0.15) * Math.pow(1 - age / VENT_SECONDS, 1.4),
    heat: 0,
    rotation: hash(index, 23) * 6.283 + age * 0.3 * (hash(index, 24) - 0.5),
  };
}
