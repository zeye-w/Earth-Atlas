/**
 * The loading screen lives in index.html so it paints before the app bundle
 * arrives. These helpers report real progress on it and hand over to the
 * globe. Stages: the engine (bundle download; no measurable progress, so the
 * bar sweeps), the globe starting, then the first imagery tiles streaming in.
 * The text is English in both UI languages.
 */
export type SplashStage = "engine" | "globe" | "imagery";

const CAPTIONS: Record<SplashStage, string> = {
  engine: "Loading the 3D engine…",
  globe: "Starting the globe…",
  imagery: "Streaming Earth imagery…",
};
// Share of the bar each stage starts at; imagery fills the rest.
const START: Record<SplashStage, number> = { engine: 0, globe: 0.55, imagery: 0.65 };

/** Bar position (0-1) for a stage and its own progress (0-1). */
export function splashProgress(stage: SplashStage, fraction = 0): number {
  if (stage !== "imagery") return START[stage];
  const f = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0;
  return START.imagery + (1 - START.imagery) * f;
}

/** Imagery progress from the tile queue: queued now against the most seen. */
export class TileProgress {
  private most = 0;
  update(queued: number): number {
    if (!Number.isFinite(queued) || queued < 0) return 0;
    this.most = Math.max(this.most, queued);
    return this.most === 0 ? 0 : 1 - queued / this.most;
  }
}

let shown = 0;
export function setSplashStage(stage: SplashStage, fraction = 0) {
  if (typeof document === "undefined") return;
  const splash = document.getElementById("splash");
  if (!splash || splash.classList.contains("done")) return;
  // Never move the bar backwards (the tile queue can grow again).
  shown = Math.max(shown, splashProgress(stage, fraction));
  splash.dataset.stage = stage;
  splash.style.setProperty("--progress", (shown * 100).toFixed(1) + "%");
  const caption = splash.querySelector(".splash-caption");
  const text = stage === "imagery" && fraction > 0 ? `${CAPTIONS.imagery} ${Math.round(shown * 100)}%` : CAPTIONS[stage];
  if (caption && caption.textContent !== text) caption.textContent = text;
}

/** Fade the loading screen out over the globe it was drawn to match. */
export function finishSplash() {
  if (typeof document === "undefined") return;
  const splash = document.getElementById("splash");
  if (!splash || splash.classList.contains("done")) return;
  splash.style.setProperty("--progress", "100%");
  splash.classList.add("done");
  window.setTimeout(() => splash.remove(), 950);
}
