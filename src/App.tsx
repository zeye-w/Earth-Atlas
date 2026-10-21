import { useEffect, useRef, useState } from "react";
import { Cartesian2, Cartesian3, Cartographic, Ellipsoid, Math as CesiumMath, type Entity, type Viewer } from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";
import { Move3d, X } from "lucide-react";
import { QUAKE_ID_PREFIX, type Earthquake } from "./earthquakeData";
import { VOLCANO_ID_PREFIX, type Volcano } from "./volcanoData";
import type { Observer, SatellitePass } from "./satellitePasses";
import { RENDER_QUALITY_LABELS } from "./performance";
import { readScene, sceneHash, type SceneState } from "./sceneState";
import { HOME_VIEW, useViewer } from "./hooks/useViewer";
import { useRenderQuality } from "./hooks/useRenderQuality";
import { sceneLayers, useLayerSettings } from "./hooks/useLayerSettings";
import { useSceneClock, useTimeSelector, useTimeline } from "./hooks/useTimeline";
import { useUserLocation, useUserLocationMarker } from "./hooks/useUserLocation";
import { SPAN_MS, type TimeSpan } from "./timeline";
import { useEarthView } from "./layers/useEarthView";
import { useClouds } from "./layers/useClouds";
import { useAurora } from "./layers/useAurora";
import { useAtmosphereShells } from "./layers/useAtmosphereShells";
import { useEarthquakes } from "./layers/useEarthquakes";
import { useGeoLabels } from "./layers/useGeoLabels";
import { useTrueColor } from "./layers/useTrueColor";
import { useConstellation } from "./layers/useConstellation";
import { STARLINK } from "./constellationData";
import { CONSTELLATION_ID_PREFIX } from "./constellationOverlay";
import { usePlateBoundaries, useVolcanoes } from "./layers/useTectonics";
import { useSatellites } from "./layers/useSatellites";
import { useGeologyMap } from "./layers/useGeologyMap";
import { useGeologyQuery } from "./layers/useGeologyQuery";
import { TopBar } from "./panels/TopBar";
import { LayerPanel, type Region } from "./panels/LayerPanel";
import { EarthViewGroup } from "./panels/EarthViewGroup";
import { TectonicsGroup } from "./panels/TectonicsGroup";
import { SatellitesGroup } from "./panels/SatellitesGroup";
import { GeologyGroup } from "./panels/GeologyGroup";
import { Inspector } from "./panels/Inspector";
import { SearchPanel, SharePanel } from "./panels/SceneTools";
import { GlobeDock, SceneSubtitle, TimeIndicator } from "./panels/TimeBar";
import { TrackCard } from "./panels/TrackCard";
import { RECORDING, installRecordingApi, type RecordUi } from "./recording";
import type { LayerOptions, LayerToggles } from "./hooks/useLayerSettings";
import "./styles.css";

const isNarrow = () => window.innerWidth < 760;

function App() {
  const [initialScene] = useState(() => readScene(window.location.hash));
  const { layers, setLayer, options, setOption } = useLayerSettings(initialScene);
  // A shared moment older than the timeline reaches opens live instead.
  const timeline = useTimeline({
    span: options.quakeRange,
    time: initialScene?.time !== undefined && initialScene.time > Date.now() - SPAN_MS.month ? initialScene.time : undefined,
  });
  const live = useTimeSelector(timeline, (state) => state.live);
  const [timebarOpen, setTimebarOpen] = useState(() => !live);
  const shellRef = useRef<HTMLDivElement>(null);
  const mountRef = useRef<HTMLDivElement>(null);

  const [searchOpen, setSearchOpen] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [controlsOpen, setControlsOpen] = useState(() => typeof window === "undefined" || window.innerWidth >= 760);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [selectedQuake, setSelectedQuake] = useState<Earthquake | null>(null);
  const [selectedVolcano, setSelectedVolcano] = useState<Volcano | null>(null);
  const [selectedSatelliteId, setSelectedSatelliteId] = useState<string | null>(null);
  const [trackedSatelliteId, setTrackedSatelliteId] = useState<string | null>(null);
  const userLocation = useUserLocation();
  const [recordUi, setRecordUi] = useState<RecordUi>("full");
  const geology = useGeologyQuery();

  const openDetails = () => {
    setDetailsOpen(true);
    if (isNarrow()) setControlsOpen(false);
  };

  const selectLocation = (latitude: number, longitude: number) => {
    setSelectedQuake(null);
    setSelectedVolcano(null);
    openDetails();
    geology.query(latitude, longitude);
  };

  // Clicks pick, in order: volcanoes, earthquakes, satellites, then the ground.
  const handleClick = (viewer: Viewer, position: Cartesian2) => {
    const picked = viewer.scene.pick(position);
    const pickedId: unknown = picked && typeof picked === "object" && "id" in picked ? (picked as { id?: unknown }).id : undefined;
    if (typeof pickedId === "string" && pickedId.startsWith(VOLCANO_ID_PREFIX)) {
      const volcano = volcanoes.result?.byId.get(pickedId.slice(VOLCANO_ID_PREFIX.length));
      if (volcano) {
        setSelectedQuake(null);
        setSelectedVolcano(volcano);
        openDetails();
        return;
      }
    }
    if (typeof pickedId === "string" && pickedId.startsWith(QUAKE_ID_PREFIX)) {
      const quake = quakes.byId.get(pickedId.slice(QUAKE_ID_PREFIX.length));
      if (quake) {
        setSelectedVolcano(null);
        setSelectedQuake(quake);
        openDetails();
        return;
      }
    }
    if (typeof pickedId === "string" && pickedId.startsWith(CONSTELLATION_ID_PREFIX)) {
      const satellite = starlink.describe(Number(pickedId.split(":").at(-1)));
      if (satellite) setToast(satellite.name + " · 高度 " + Math.round(satellite.altitudeKm) + " km · " + (satellite.sunlit ? "日照中" : "地球阴影中"));
      return;
    }
    const entityId = (pickedId as Entity | undefined)?.id;
    if (typeof entityId === "string" && entityId.startsWith("satellite:")) {
      // Clicking a satellite starts tracking it.
      const id = entityId.slice("satellite:".length);
      setSelectedSatelliteId(id);
      setTrackedSatelliteId(id);
      return;
    }
    const ground = viewer.camera.pickEllipsoid(position, Ellipsoid.WGS84);
    if (!ground) return;
    const cartographic = Cartographic.fromCartesian(ground);
    selectLocation(CesiumMath.toDegrees(cartographic.latitude), CesiumMath.toDegrees(cartographic.longitude));
  };

  const { viewer, globeError } = useViewer(mountRef, shellRef, initialScene, handleClick);
  useSceneClock(viewer, timeline);
  const render = useRenderQuality(viewer, (quality, fps) =>
    setToast("画面帧率较低（约 " + Math.round(fps) + " fps），已自动切换为「" + RENDER_QUALITY_LABELS[quality] + "」画质"));
  useEarthView(viewer, layers, timeline);
  const trueColor = useTrueColor(viewer, layers.trueColor, timeline);
  const clouds = useClouds(viewer, layers.clouds, options.cloudOpacity, timeline);
  // The aurora forecast only exists for "now": hidden while viewing another moment.
  const aurora = useAurora(viewer, layers.aurora && live);
  useAtmosphereShells(viewer, layers.shells, options.shellScale);
  const quakes = useEarthquakes(viewer, layers.quakes, options.quakeRange, timeline);
  useGeoLabels(viewer, layers.geoLabels);
  const plateStatus = usePlateBoundaries(viewer, layers.plates);
  const volcanoes = useVolcanoes(viewer, layers.volcanoes);
  const satellites = useSatellites(viewer, { visible: layers.satellites, paths: layers.paths, speed: options.satelliteSpeed, selectedId: selectedSatelliteId, trackedId: layers.satellites ? trackedSatelliteId : null, followCamera: !RECORDING, timeline });
  useUserLocationMarker(viewer, userLocation.location);
  const starlink = useConstellation(viewer, layers.starlink, STARLINK, timeline);
  const trackedSatellite = satellites.catalog.find(({ choice }) => choice.id === trackedSatelliteId)?.choice ?? null;
  const vectorState = useGeologyMap(viewer, { visible: layers.geology, opacity: options.opacity, mapMode: options.mapMode, ageFilter: options.ageFilter, rockFilter: options.rockFilter });

  // The time-bar range also picks the matching USGS feed, so replay has data.
  useEffect(() => {
    let span: TimeSpan = timeline.getState().span;
    return timeline.subscribe((state) => {
      if (state.span === span) return;
      span = state.span;
      setOption("quakeRange", state.span);
    });
  }, [timeline, setOption]);

  useEffect(() => {
    if (initialScene?.point) selectLocation(initialScene.point.latitude, initialScene.point.longitude);
    // Only the scene from the initial URL selects a point.
  }, [initialScene]);

  useEffect(() => {
    if (!searchOpen && !shareUrl) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") { setSearchOpen(false); setShareUrl(null); } };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [searchOpen, shareUrl]);

  // Recording mode (?record): a scripted capture API, see src/recording.ts.
  const telemetryOf = useRef(satellites.telemetryOf);
  telemetryOf.current = satellites.telemetryOf;
  useEffect(() => {
    if (!RECORDING || !viewer) return;
    return installRecordingApi({
      viewer,
      timeline,
      setLayers: (next: Partial<LayerToggles>) => { for (const [key, value] of Object.entries(next)) setLayer(key as keyof LayerToggles, Boolean(value)); },
      setOptions: (next: Partial<LayerOptions>) => { for (const [key, value] of Object.entries(next)) setOption(key as keyof LayerOptions, value as never); },
      setUi: (mode) => { setRecordUi(mode); setTimebarOpen(mode === "timebar"); },
      setTrackCard: setTrackedSatelliteId,
      satelliteTelemetry: (id) => telemetryOf.current(id),
    });
  }, [viewer, timeline, setLayer, setOption]);

  const locationError = userLocation.state.status === "error" ? userLocation.state.message : null;
  useEffect(() => { if (locationError) setToast(locationError); }, [locationError]);

  // A camera flight cannot run while the camera is locked to a satellite.
  useEffect(() => { if (!layers.satellites) setTrackedSatelliteId(null); }, [layers.satellites]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 6_000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const shareScene = async () => {
    if (!viewer || viewer.isDestroyed()) { setToast("地球尚未就绪"); return; }
    const camera = viewer.camera;
    const position = camera.positionCartographic;
    const point = selectedVolcano ? { latitude: selectedVolcano.lat, longitude: selectedVolcano.lon } : selectedQuake ? { latitude: selectedQuake.latitude, longitude: selectedQuake.longitude } : geology.coordinates;
    const scene: SceneState = {
      v: 1,
      camera: [CesiumMath.toDegrees(position.longitude), CesiumMath.toDegrees(position.latitude), Math.max(15000, Math.min(65000000, position.height)), camera.heading, camera.pitch, camera.roll],
      layers: sceneLayers(layers),
      point: point ?? undefined,
      time: live ? undefined : timeline.getState().time,
      options: { cloudOpacity: options.cloudOpacity, opacity: options.opacity, mapMode: options.mapMode, ageFilter: options.ageFilter, rockFilter: options.rockFilter, quakeRange: options.quakeRange, atmosphereShells: layers.shells ? options.shellScale : 0 },
    };
    const url = new URL(window.location.href);
    try { url.hash = sceneHash(scene); } catch { setToast("当前视角无法分享，请调整视角后重试"); return; }
    setShareUrl(url.toString());
    try { await navigator.clipboard.writeText(url.toString()); setToast("场景链接已复制"); }
    catch { setToast("请在分享框中手动复制链接"); }
  };

  // A predicted pass: highlight that satellite, move the timeline to its
  // highest point and look down on the observer.
  const showPass = (pass: SatellitePass, observer: Observer) => {
    setSelectedSatelliteId(pass.id);
    setTrackedSatelliteId(null);
    timeline.setTime(pass.peak.getTime());
    setTimebarOpen(true);
    viewer?.camera.flyTo({ destination: Cartesian3.fromDegrees(observer.longitude, observer.latitude, 4_000_000), duration: 1.6 });
  };

  // Show (asking for permission the first time) and fly to the user's position.
  const locateMe = async () => {
    setTrackedSatelliteId(null);
    const location = userLocation.location ?? await userLocation.locate();
    if (!location) return;
    viewer?.camera.flyTo({ destination: Cartesian3.fromDegrees(location.longitude, location.latitude, 2_500_000), duration: 1.6 });
  };

  const flyTo = (region: Region) => {
    setTrackedSatelliteId(null);
    viewer?.camera.flyTo({ destination: Cartesian3.fromDegrees(region.lon, region.lat, 3500000), duration: 1.8 });
  };

  const resetCamera = () => {
    setTrackedSatelliteId(null);
    viewer?.camera.flyTo({ destination: HOME_VIEW, duration: 1.6 });
  };

  const groupProps = { layers, setLayer, options, setOption };

  return (
    <div ref={shellRef} className={"app-shell quality-" + render.quality + (RECORDING ? " recording record-ui-" + recordUi : "")}>
      {searchOpen && <SearchPanel onClose={() => setSearchOpen(false)} onSelect={(place) => {
        if (!viewer || viewer.isDestroyed()) { setToast("地球尚未就绪"); return; }
        setTrackedSatelliteId(null);
        viewer.camera.flyTo({ destination: Cartesian3.fromDegrees(place.longitude, place.latitude, place.height), duration: 1.5 });
        selectLocation(place.latitude, place.longitude);
        setSearchOpen(false);
      }} />}
      {shareUrl && <SharePanel url={shareUrl} onClose={() => setShareUrl(null)} />}
      <TopBar
        clock={<TimeIndicator timeline={timeline} />}
        searchOpen={searchOpen}
        onToggleSearch={() => setSearchOpen((open) => !open)}
        onShare={() => void shareScene()}
        controlsOpen={controlsOpen}
        onToggleControls={() => { setControlsOpen((open) => !open); if (isNarrow()) setDetailsOpen(false); }}
        detailsOpen={detailsOpen}
        onToggleDetails={() => { setDetailsOpen((open) => !open); if (isNarrow()) setControlsOpen(false); }}
        quality={render.quality}
        onChooseQuality={render.chooseQuality}
        autoQuality={render.autoQuality}
        onAutoQuality={render.setAutoQuality}
      />

      <main className="workspace">
        <LayerPanel open={controlsOpen} onClose={() => setControlsOpen(false)} onFlyTo={flyTo}>
          <EarthViewGroup {...groupProps} clouds={clouds} aurora={aurora.status} geomagnetic={aurora.geomagnetic} live={live} trueColor={trueColor} />
          <TectonicsGroup {...groupProps} quakes={quakes.status} quakeList={quakes.list} timeline={timeline} volcanoes={volcanoes} plateStatus={plateStatus} />
          <SatellitesGroup {...groupProps} status={satellites.status} catalog={satellites.catalog} selectedId={selectedSatelliteId} timeline={timeline}
            records={satellites.records} selectedPoint={geology.coordinates} onSelectPass={showPass} starlink={starlink.status}
            trackedId={trackedSatelliteId} onTrack={(id) => { setSelectedSatelliteId(id); setTrackedSatelliteId(id); }} onStopTracking={() => setTrackedSatelliteId(null)}
            location={userLocation.state} onLocate={userLocation.locate} />
          <GeologyGroup {...groupProps} vectorState={vectorState} />
        </LayerPanel>

        <section className="globe-panel" aria-label="可交互三维数字地球">
          <div className="globe-mount" ref={mountRef} />
          <div className="globe-top-left">
            <span className="map-tag"><span className="tag-dot" /> 3D DIGITAL EARTH</span>
            <SceneSubtitle timeline={timeline} dayNight={layers.dayNight} />
          </div>
          {toast && <div className="toast" role="status">{toast}<button type="button" onClick={() => setToast(null)} aria-label="关闭提示"><X size={13} aria-hidden="true" /></button></div>}
          {viewer && trackedSatellite && satellites.status === "ready" && (
            <TrackCard viewer={viewer} title={trackedSatellite.title} live={live} tracking={satellites.tracking}
              location={userLocation.location} onLocate={() => void userLocation.locate()} onStop={() => setTrackedSatelliteId(null)} />
          )}
          <GlobeDock timeline={timeline} open={timebarOpen} onToggle={() => setTimebarOpen((open) => !open)} onReset={resetCamera}
            onLocateMe={() => void locateMe()} locating={userLocation.state.status === "locating"} />
          {!timebarOpen && <div className="globe-guide"><span className="guide-orbit"><Move3d size={14} aria-hidden="true" /></span><span>拖动旋转 · 滚轮缩放 · 点击地表查询地质</span></div>}
          <div className="globe-attribution">Earthquakes: <a href="https://earthquake.usgs.gov/" target="_blank" rel="noreferrer">USGS</a> · Plates: Bird (2003) PB2002 / Nordpil, ODC-BY · Volcanoes: <a href="https://volcano.si.edu/" target="_blank" rel="noreferrer">Smithsonian GVP</a> · Satellite orbits: <a href="https://celestrak.org/" target="_blank" rel="noreferrer">CelesTrak</a> · Aurora: <a href="https://www.swpc.noaa.gov/products/aurora-30-minute-forecast" target="_blank" rel="noreferrer">NOAA SWPC</a> · Basemap: <a href="https://earthdata.nasa.gov/gibs" target="_blank" rel="noreferrer">NASA Blue Marble / Black Marble</a> · Natural Earth · Geology: <a href="https://macrostrat.org/" target="_blank" rel="noreferrer">Macrostrat</a> · CC BY 4.0</div>
          {globeError && <div className="globe-error" role="alert">三维地球启动失败：{globeError}<p>请检查 WebGL 支持和浏览器环境。</p></div>}
        </section>

        <Inspector open={detailsOpen} onClose={() => setDetailsOpen(false)} quake={selectedQuake} volcano={selectedVolcano} geology={geology} />
      </main>
    </div>
  );
}

export default App;
