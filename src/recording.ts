/**
 * Recording mode, for frame-by-frame video capture (video/ in the repo).
 * Only active with `?record` in the URL; ordinary visitors never get it.
 *
 * Exposes `window.__terrascope` so a Playwright script can set the camera,
 * the scene time and the layers for each frame, wait until every tile has
 * loaded, and then take a screenshot. Software-rendered WebGL is slow, but
 * because nothing moves on its own the frames come out smooth and
 * reproducible. See video/README.md for the protocol.
 */
import { Cartesian3, HeadingPitchRange, Math as CesiumMath, Matrix4, type Viewer } from "cesium";
import { setAuroraEffectsTime } from "./aurora";
import { hasPendingWork } from "./pendingWork";
import { setSolarWindEffectsTime } from "./solarWindOverlay";
import { TIME_SPANS, spanFor, type TimeController } from "./timeline";
import type { LayerOptions, LayerToggles } from "./hooks/useLayerSettings";
import type { Telemetry } from "./satelliteTelemetry";

export const RECORDING = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("record");

/** full: the app as users see it; clean: globe only; timebar: globe + time bar. */
export type RecordUi = "full" | "clean" | "timebar";

export interface CameraPose {
  longitude: number;
  latitude: number;
  /** Metres above the ellipsoid. */
  height: number;
  /** Degrees. Default 0 (north). */
  heading?: number;
  /** Degrees. Default -90 (straight down). */
  pitch?: number;
  roll?: number;
}

export interface LookAtPose {
  longitude: number;
  latitude: number;
  /** Target height, metres. */
  height: number;
  /** Degrees: direction the camera faces, from north. */
  heading: number;
  /** Degrees below the horizontal (negative looks down). */
  pitch: number;
  /** Camera distance from the target, metres. */
  range: number;
}

export interface RecordingApi {
  version: 1;
  /** Resolves when the viewer exists and the first tiles have loaded. */
  ready(): Promise<void>;
  setCamera(pose: CameraPose): void;
  lookAt(pose: LookAtPose): void;
  /** Scene time in ms since epoch, or null for live. */
  setTime(time: number | null): void;
  setLayers(layers: Partial<LayerToggles>): void;
  setOptions(options: Partial<LayerOptions>): void;
  setUi(mode: RecordUi): void;
  /** Show the tracking card for a satellite (camera stays under script control). */
  showTrackCard(id: string | null): void;
  /** Where a satellite is at the scene time (null if not loaded or unreliable). */
  satellite(id: string): Pick<Telemetry, "latitude" | "longitude" | "altitudeKm" | "headingDeg"> | null;
  /** Seconds of aurora shimmer to show (deterministic animation). */
  setEffectsTime(seconds: number): void;
  /** Renders until all tiles are loaded (true) or the timeout passes (false). */
  idle(timeoutMs?: number): Promise<boolean>;
  render(): void;
}

interface Dependencies {
  viewer: Viewer;
  timeline: TimeController;
  setLayers: (layers: Partial<LayerToggles>) => void;
  setOptions: (options: Partial<LayerOptions>) => void;
  setUi: (mode: RecordUi) => void;
  setTrackCard: (id: string | null) => void;
  satelliteTelemetry: (id: string) => Telemetry | null;
}

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

export function installRecordingApi(deps: Dependencies): () => void {
  const { viewer, timeline } = deps;
  const scene = viewer.scene;
  setAuroraEffectsTime(0);
  setSolarWindEffectsTime(0);

  const idle = async (timeoutMs = 30_000): Promise<boolean> => {
    const start = performance.now();
    let stable = 0;
    while (performance.now() - start < timeoutMs) {
      scene.requestRender();
      await nextFrame();
      // A few consecutive loaded frames: state changes made through React
      // land a frame or two after the call that requested them.
      stable = scene.globe.tilesLoaded && !hasPendingWork() ? stable + 1 : 0;
      if (stable >= 4) return true;
    }
    return false;
  };

  const api: RecordingApi = {
    version: 1,
    ready: async () => {
      await idle(60_000);
    },
    setCamera: ({ longitude, latitude, height, heading = 0, pitch = -90, roll = 0 }) => {
      viewer.camera.setView({
        destination: Cartesian3.fromDegrees(longitude, latitude, height),
        orientation: { heading: CesiumMath.toRadians(heading), pitch: CesiumMath.toRadians(pitch), roll: CesiumMath.toRadians(roll) },
      });
      scene.requestRender();
    },
    lookAt: ({ longitude, latitude, height, heading, pitch, range }) => {
      viewer.camera.lookAt(Cartesian3.fromDegrees(longitude, latitude, height), new HeadingPitchRange(CesiumMath.toRadians(heading), CesiumMath.toRadians(pitch), range));
      // Release the camera again, keeping its position.
      viewer.camera.lookAtTransform(Matrix4.IDENTITY);
      scene.requestRender();
    },
    setTime: (time) => {
      if (time === null) { timeline.goLive(); return; }
      // Widen the timeline range if the moment lies further back.
      const needed = spanFor(time, Date.now());
      if (TIME_SPANS.indexOf(needed) > TIME_SPANS.indexOf(timeline.getState().span)) timeline.setSpan(needed);
      timeline.setTime(time);
    },
    setLayers: deps.setLayers,
    setOptions: deps.setOptions,
    setUi: deps.setUi,
    showTrackCard: deps.setTrackCard,
    satellite: (id) => {
      const t = deps.satelliteTelemetry(id);
      return t ? { latitude: t.latitude, longitude: t.longitude, altitudeKm: t.altitudeKm, headingDeg: t.headingDeg } : null;
    },
    setEffectsTime: (seconds) => { setAuroraEffectsTime(seconds); setSolarWindEffectsTime(seconds); },
    idle,
    render: () => scene.render(),
  };
  (window as unknown as { __terrascope?: RecordingApi }).__terrascope = api;
  return () => {
    delete (window as unknown as { __terrascope?: RecordingApi }).__terrascope;
    setAuroraEffectsTime(null);
    setSolarWindEffectsTime(null);
  };
}
