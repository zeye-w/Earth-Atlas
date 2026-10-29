/** A compressed artistic trajectory, not a propulsion/orbital simulation. */
export const ROCKET_COUNTDOWN = 3;
/** The engines light this long before liftoff while clamps hold the rocket down. */
export const IGNITION_LEAD = 1.5;
export const ROCKET_FLIGHT_SECONDS = 42;
export const ROCKET_DURATION = ROCKET_COUNTDOWN + ROCKET_FLIGHT_SECONDS;
export function rocketFrame(elapsed: number) {
  const safeTime = Number.isFinite(elapsed) ? Math.max(0, elapsed) : 0;
  const t = Math.max(0, Math.min(ROCKET_FLIGHT_SECONDS, safeTime - ROCKET_COUNTDOWN));
  const turn = Math.max(0, t - 6);
  const east = 0.18 * turn ** 3;
  const altitude = 2.4 * t ** 2 + 0.65 * t ** 3;
  const eastSpeed = 0.54 * turn ** 2;
  const verticalSpeed = 4.8 * t + 1.95 * t ** 2;
  const phase: "countdown" | "ignition" | "complete" | "liftoff" | "ascent" = safeTime < ROCKET_COUNTDOWN - IGNITION_LEAD ? "countdown"
    : safeTime < ROCKET_COUNTDOWN ? "ignition" : safeTime >= ROCKET_DURATION ? "complete" : t < 6 ? "liftoff" : "ascent";
  return { east, altitude, speed: Math.hypot(eastSpeed, verticalSpeed),
    tilt: Math.atan2(eastSpeed, verticalSpeed || 1), phase,
    countdown: Math.max(0, Math.ceil(ROCKET_COUNTDOWN - safeTime)),
    thrust: safeTime >= ROCKET_COUNTDOWN - IGNITION_LEAD && safeTime < ROCKET_DURATION,
  };
}
