import { particleAt, type FireworkParticle } from "./physics.ts";

/** Oldest to newest, so shader tapering points towards the live star. */
export function sparkWake(particle: FireworkParticle, seconds: number, count: number, span: number) {
  if (!Number.isFinite(seconds) || !Number.isFinite(count) || !Number.isFinite(span) || span <= 0) return [];
  if (!particleAt(particle, seconds) || seconds - particle.start < 0.015) return [];
  const age = Math.min(span, seconds - particle.start);
  const samples = Math.max(2, Math.min(10, Math.floor(count)));
  return Array.from({ length: samples }, (_, i) =>
    particleAt(particle, seconds - age * (1 - i / (samples - 1)))!,
  ).filter(Boolean);
}
export function sparkFade(age: number, life: number): number {
  if (!Number.isFinite(age) || !Number.isFinite(life) || life <= 0) return 0;
  return Math.max(0, Math.min(1, (life - age) / (life * 0.38)));
}
