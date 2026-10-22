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
import { Cartesian3, Color, EllipsoidalOccluder, HeadingPitchRange, Math as CesiumMath, Matrix3, Matrix4, Model, PerspectiveFrustum, SceneTransforms, type Viewer } from "cesium";
import { isVirtualClock, now, setVirtualNow } from "./clock";
import { positionAt, type OrbitRecord } from "./satelliteOrbits";
import type { Flight } from "./flightData";
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

type Vec3 = [number, number, number];

export interface RecordingApi {
  version: 2;
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
  /**
   * Pin "now" to a virtual instant (ms since epoch) for the live layers, or
   * null to return to the real clock. The timeline stays live.
   */
  setVirtualNow(time: number | null): void;
  /** Camera by Earth-fixed position, view direction and up (metres, unit vectors), field of view in degrees. */
  setCameraPose(pose: { position: Vec3; direction: Vec3; up: Vec3; fov?: number }): void;
  /** Screen position (CSS pixels) of Earth-fixed points; visible is false behind the Earth or the camera. */
  project(points: Vec3[]): { x: number; y: number; visible: boolean }[];
  /** A satellite's Earth-fixed position (metres) at the scene's now, from its SGP4 elements. */
  satellitePosition(id: string, offsetMs?: number): Vec3 | null;
  /** An aircraft's estimated Earth-fixed position and readings at the scene's now. */
  flight(hex: string): { position: Vec3; flight: Flight } | null;
  /** Fade a point layer (0–1). */
  setLayerAlpha(layer: "flights" | "starlink", alpha: number): void;
  /**
   * Show a 3D model at a satellite's SGP4 position, its forward axis along the
   * velocity and up away from the Earth (an approximation of the attitude).
   * rotation: extra heading/pitch/roll in degrees to align the model's own axes.
   */
  satelliteModel(options: { id: string; url: string; rotation?: [number, number, number] } | null): Promise<void>;
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
  satelliteRecord: (id: string) => OrbitRecord | null;
  locateFlight: (hex: string) => { flight: Flight; position: Cartesian3 } | null;
  setLayerAlpha: (layer: "flights" | "starlink", alpha: number) => void;
}

const toVec = (c: Cartesian3): Vec3 => [c.x, c.y, c.z];
const toCartesian = (v: Vec3) => new Cartesian3(v[0], v[1], v[2]);

function satelliteCartesian(record: OrbitRecord, time: number): Cartesian3 | null {
  const p = positionAt(record, new Date(time));
  return p ? Cartesian3.fromRadians(p.longitudeRad, p.latitudeRad, p.altitudeKm * 1000) : null;
}

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

export function installRecordingApi(deps: Dependencies): () => void {
  const { viewer, timeline } = deps;
  const scene = viewer.scene;
  setAuroraEffectsTime(0);
  setSolarWindEffectsTime(0);

  let model: Model | null = null;
  let removeModelUpdate: (() => void) | null = null;
  const idle = async (timeoutMs = 30_000): Promise<boolean> => {
    const start = performance.now();
    let stable = 0;
    while (performance.now() - start < timeoutMs) {
      scene.requestRender();
      await nextFrame();
      // A few consecutive loaded frames: state changes made through React
      // land a frame or two after the call that requested them.
      stable = scene.globe.tilesLoaded && !hasPendingWork() && (!model || model.ready) ? stable + 1 : 0;
      if (stable >= 4) return true;
    }
    return false;
  };

  const dropModel = () => {
    removeModelUpdate?.(); removeModelUpdate = null;
    if (model && !viewer.isDestroyed()) scene.primitives.remove(model);
    model = null;
  };

  const api: RecordingApi = {
    version: 2,
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
    setVirtualNow: (time) => {
      setVirtualNow(time);
      // Re-read "now" everywhere that follows the live timeline.
      if (timeline.getState().live) timeline.goLive();
      scene.requestRender();
    },
    setCameraPose: ({ position, direction, up, fov }) => {
      if (![...position, ...direction, ...up].every(Number.isFinite)) throw new Error("Invalid camera pose");
      if (fov !== undefined && viewer.camera.frustum instanceof PerspectiveFrustum) viewer.camera.frustum.fov = CesiumMath.toRadians(fov);
      viewer.camera.setView({ destination: toCartesian(position), orientation: { direction: toCartesian(direction), up: toCartesian(up) } });
      scene.requestRender();
    },
    project: (points) => {
      const occluder = new EllipsoidalOccluder(scene.globe.ellipsoid, viewer.camera.positionWC);
      return points.map((point) => {
        const position = toCartesian(point);
        const toPoint = Cartesian3.subtract(position, viewer.camera.positionWC, new Cartesian3());
        const inFront = Cartesian3.dot(toPoint, viewer.camera.directionWC) > 0;
        const screen = inFront ? SceneTransforms.worldToWindowCoordinates(scene, position) : undefined;
        return screen ? { x: screen.x, y: screen.y, visible: occluder.isPointVisible(position) } : { x: NaN, y: NaN, visible: false };
      });
    },
    satellitePosition: (id, offsetMs = 0) => {
      const record = deps.satelliteRecord(id);
      const position = record ? satelliteCartesian(record, now() + offsetMs) : null;
      return position ? toVec(position) : null;
    },
    flight: (hex) => {
      const found = deps.locateFlight(hex);
      return found ? { position: toVec(found.position), flight: found.flight } : null;
    },
    setLayerAlpha: (layer, alpha) => { deps.setLayerAlpha(layer, alpha); scene.requestRender(); },
    satelliteModel: async (options) => {
      dropModel();
      if (!options) return;
      const record = deps.satelliteRecord(options.id);
      if (!record) throw new Error("Satellite not loaded: " + options.id);
      const loaded = await Model.fromGltfAsync({ url: options.url, color: Color.WHITE });
      if (viewer.isDestroyed()) return;
      model = scene.primitives.add(loaded);
      const [h, p, r] = (options.rotation ?? [0, 0, 0]).map(CesiumMath.toRadians);
      const offset = Matrix3.multiply(Matrix3.multiply(Matrix3.fromRotationZ(h), Matrix3.fromRotationY(p), new Matrix3()), Matrix3.fromRotationX(r), new Matrix3());
      const place = () => {
        const time = now();
        const here = satelliteCartesian(record, time);
        const ahead = satelliteCartesian(record, time + 1000);
        if (!here || !ahead || !model) { if (model) model.show = false; return; }
        // x forward (velocity), z away from the Earth, y completing the frame.
        const z = Cartesian3.normalize(here, new Cartesian3());
        const v = Cartesian3.subtract(ahead, here, new Cartesian3());
        const x = Cartesian3.normalize(Cartesian3.subtract(v, Cartesian3.multiplyByScalar(z, Cartesian3.dot(v, z), new Cartesian3()), new Cartesian3()), new Cartesian3());
        const y = Cartesian3.cross(z, x, new Cartesian3());
        const frame = new Matrix3(x.x, y.x, z.x, x.y, y.y, z.y, x.z, y.z, z.z);
        model.modelMatrix = Matrix4.fromRotationTranslation(Matrix3.multiply(frame, offset, new Matrix3()), here);
        model.show = true;
      };
      place();
      removeModelUpdate = scene.preRender.addEventListener(place);
      // The marker icon would sit on top of the model.
      const marker = viewer.entities.getById("satellite:" + options.id);
      if (marker?.billboard) marker.billboard.show = false as never;
      if (marker?.label) marker.label.show = false as never;
    },
    idle,
    render: () => scene.render(),
  };
  (window as unknown as { __terrascope?: RecordingApi }).__terrascope = api;
  return () => {
    delete (window as unknown as { __terrascope?: RecordingApi }).__terrascope;
    dropModel();
    if (isVirtualClock()) setVirtualNow(null);
    setAuroraEffectsTime(null);
    setSolarWindEffectsTime(null);
  };
}
