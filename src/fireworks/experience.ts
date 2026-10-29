export type ExperienceMode = "fireworks" | "rocket" | "space";
export type RocketPhase = "idle" | "countdown" | "ignition" | "liftoff" | "ascent" | "complete";
// Shared by the existing experience hook and panel, keeping App's wiring intact.
let snapshot: { mode: ExperienceMode; follow: boolean; phase: RocketPhase; altitude: number; speed: number; countdown: number } = {
  mode: "fireworks", follow: true, phase: "idle", altitude: 0, speed: 0, countdown: 10,
};
const listeners = new Set<() => void>();
export const getExperience = () => snapshot;
export function subscribeExperience(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function updateExperience(patch: Partial<typeof snapshot>) {
  snapshot = { ...snapshot, ...patch };
  listeners.forEach(listener => listener());
}
