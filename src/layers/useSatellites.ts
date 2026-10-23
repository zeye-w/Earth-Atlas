import { useEffect, useMemo, useRef, useState } from "react";
import { Cartesian3, type Viewer } from "cesium";
// satellite.js and the overlay are imported on demand when the layer is enabled.
import type { OrbitRecord, SatelliteChoice } from "../satelliteOrbits";
import type { SatelliteOverlay, SatelliteSpeed } from "../satelliteOverlay";
import type { TimeController } from "../timeline";
import { SATELLITE_MODELS, type SatelliteModelStatus } from "../satelliteModels";
import type { Observer } from "../satelliteTelemetry";

export type SatelliteStatus = "idle" | "loading" | "ready" | "error";

// Away from "live" the satellites sit where SGP4 puts them at the timeline
// moment (moving only while it replays); live uses the overlay's own clock
// with the 1×/60×/300× preview speeds.
function followTimeline(overlay: SatelliteOverlay, timeline: TimeController) {
  const { live } = timeline.getState();
  if (live) { if (overlay.followsTimeline) overlay.setClock(null); }
  else if (overlay.followsTimeline) overlay.update();
  else overlay.setClock(() => new Date(timeline.getState().time));
}

/** Curated satellites from public GP elements (two-hour cache); no network when off. */
export function useSatellites(viewer: Viewer | null, options: { visible: boolean; paths: boolean; speed: SatelliteSpeed; selectedId: string | null; trackedId: string | null; followCamera?: boolean; timeline: TimeController }) {
  const { visible, paths, speed, selectedId, trackedId, followCamera = true, timeline } = options;
  const overlayRef = useRef<SatelliteOverlay | null>(null);
  const latest = useRef(options);
  latest.current = options;
  const [modelStatus,setModelStatus]=useState<SatelliteModelStatus>("unavailable");
  const minimumZoom=useRef(15_000);
  const [status, setStatus] = useState<SatelliteStatus>("idle");
  const [catalog, setCatalog] = useState<Array<{ choice: SatelliteChoice; epochLabel: string }>>([]);
  const [records, setRecords] = useState<OrbitRecord[]>([]);

  useEffect(() => {
    if (!viewer) return;
    if (!visible) {
      setStatus("idle");
      return;
    }
    let active = true;
    setStatus("loading");
    void Promise.all([import("../satelliteOrbits"), import("../satelliteOverlay")]).then(async ([orbits, overlayModule]) => {
      const { satellites } = await orbits.fetchSatelliteCatalog();
      if (!active || viewer.isDestroyed()) return;
      overlayRef.current?.dispose();
      const overlay = new overlayModule.SatelliteOverlay(viewer, satellites, latest.current.paths, followCamera?setModelStatus:undefined);
      overlayRef.current = overlay;
      overlay.setSelected(latest.current.selectedId);
      overlay.setModelTarget(followCamera?latest.current.trackedId:null);
      overlay.setSpeed(latest.current.speed);
      followTimeline(overlay, timeline);
      setCatalog(satellites.map(({ choice, epoch }) => ({ choice, epochLabel: orbits.formatEpoch(epoch) })));
      setRecords(satellites);
      setStatus(overlay.count > 0 ? "ready" : "error");
    }).catch((error: unknown) => {
      if (!active) return;
      console.warn("Satellite elements unavailable; no fabricated orbit rendered.", error);
      setStatus("error");
      setCatalog([]);
      setRecords([]);
    });
    return () => {
      active = false;
      overlayRef.current?.dispose();
      overlayRef.current = null;
    };
  }, [viewer, visible]);

  useEffect(() => { overlayRef.current?.setSpeed(speed); }, [speed]);
  useEffect(() => timeline.subscribe(() => { if (overlayRef.current) followTimeline(overlayRef.current, timeline); }), [timeline]);
  useEffect(() => { overlayRef.current?.setSelected(selectedId); }, [selectedId]);
  useEffect(() => { overlayRef.current?.togglePaths(paths); }, [paths]);
  useEffect(()=>{overlayRef.current?.setModelTarget(followCamera?trackedId:null);},[trackedId,followCamera]);

  // Resynchronize positions when the tab becomes visible again.
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") overlayRef.current?.update(true); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  // Tracking: the camera follows the marker from behind and above (east,
  // north, up offset in metres); the user can still orbit around it.
  useEffect(() => {
    const entity = followCamera && trackedId && status === "ready" ? overlayRef.current?.markerEntity(trackedId) : undefined;
    if (!viewer || !entity) return;
    minimumZoom.current=viewer.scene.screenSpaceCameraController.minimumZoomDistance;
    const model=trackedId?SATELLITE_MODELS[trackedId]:undefined;
    if(model)viewer.scene.screenSpaceCameraController.minimumZoomDistance=model.span*1.2;
    entity.viewFrom=model?new Cartesian3(0,-model.span*5,model.span*2):new Cartesian3(0,-2_400_000,1_600_000);
    viewer.trackedEntity = entity;
    return () => {
      if (!viewer.isDestroyed()) {
        if(viewer.trackedEntity === entity)viewer.trackedEntity = undefined;
        viewer.scene.screenSpaceCameraController.minimumZoomDistance=minimumZoom.current;
      }
    };
  }, [viewer, trackedId, status, followCamera]);

  // Read on demand (the tracking card polls), so updates do not re-render React.
  const tracking = useMemo(() => ({
    telemetry: (observer: Observer | null) => (trackedId ? overlayRef.current?.telemetry(trackedId, observer) ?? null : null),
    derivation: (observer: Observer | null) => (trackedId ? overlayRef.current?.derivation(trackedId, observer) ?? null : null),
    position: () => (trackedId ? overlayRef.current?.markerPosition(trackedId) : undefined),
  }), [trackedId]);

  const viewModel=(close: boolean)=>{
    const entity=trackedId?overlayRef.current?.markerEntity(trackedId):undefined;
    const info=trackedId?SATELLITE_MODELS[trackedId]:undefined;
    if(!viewer || !entity || !followCamera || !info)return;
    viewer.scene.screenSpaceCameraController.minimumZoomDistance=close?info.span*1.2:minimumZoom.current;
    entity.viewFrom=close?new Cartesian3(0,-info.span*5,info.span*2):new Cartesian3(0,-2_400_000,1_600_000);
    viewer.trackedEntity=undefined;viewer.trackedEntity=entity;
    overlayRef.current?.retryModel();viewer.scene.requestRender();
  };
  const telemetryOf = (id: string) => overlayRef.current?.telemetry(id, null) ?? null;
  return { status, catalog, records, tracking, telemetryOf, modelStatus, viewModel };
}
