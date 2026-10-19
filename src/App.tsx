import { useEffect, useRef, useState } from "react";
import {
  Cartesian2,
  Cartesian3,
  Cartographic,
  Color,
  Credit,
  Cesium3DTileStyle,
  MVTDataProvider,
  JulianDate,
  SunLight,
  type Entity,
  Ellipsoid,
  EllipsoidTerrainProvider,
  ImageryLayer,
  Math as CesiumMath,
  ScreenSpaceEventType,
  SkyAtmosphere,
  SkyBox,
  TileMapServiceImageryProvider,
  UrlTemplateImageryProvider,
  Viewer,
  buildModuleUrl,
} from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";
import { queryGeology, type GeologicalUnit } from "./geology";
import { fetchLithologyDictionary, classifyLithologies, type LithologyDictionary } from "./lithology";
import { classifyGeologicEra, ERA_GUIDE } from "./geologicTime";
import { makeThematicStyle, AGE_OPTIONS, ROCK_OPTIONS, THEMATIC_MAX_ZOOM, type ThematicMode, type AgeFilter, type RockFilter } from "./mapThematic";
import { RENDER_PROFILES, RENDER_QUALITY_LABELS, initialRenderQuality, initialSpaceMotion, nextRenderQuality, type RenderQuality } from "./performance";
import { addWorldCityMarkers } from "./cityMarkers";
import { SATELLITE_CHOICES, fetchSatelliteCatalog, formatEpoch, type SatelliteChoice } from "./satelliteOrbits";
import { SatelliteOverlay, SATELLITE_UPDATE_MS } from "./satelliteOverlay";
import "./styles.css";

type QueryStatus = "idle" | "loading" | "success" | "empty" | "error";
type Coordinates = { latitude: number; longitude: number };
type Region = { label: string; subtitle: string; lat: number; lon: number };

const HOME_VIEW = Cartesian3.fromDegrees(58, 19, 17000000);

const REGIONS: Region[] = [
  { label: "日本列岛", subtitle: "Japan", lat: 36.2, lon: 138.3 },
  { label: "青藏高原", subtitle: "Tibetan Plateau", lat: 31.8, lon: 88.8 },
  { label: "阿尔卑斯", subtitle: "Alps", lat: 46.6, lon: 10.1 },
  { label: "北美西部", subtitle: "Western US", lat: 39.5, lon: -113.6 },
];

function coordinateLabel(value: number, positive: string, negative: string): string {
  return Math.abs(value).toFixed(4) + "° " + (value >= 0 ? positive : negative);
}

function App() {
  const mountRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const geologicalLayerRef = useRef<ImageryLayer | null>(null);
  const cityMarkersRef = useRef<Entity[]>([]);
  const satelliteOverlayRef = useRef<SatelliteOverlay | null>(null);
  const vectorLayerRef = useRef<MVTDataProvider | null>(null);
  const vectorLoadingRef = useRef<Promise<MVTDataProvider> | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const [renderQuality, setRenderQuality] = useState<RenderQuality>(() => typeof window === "undefined" ? "balanced" : initialRenderQuality(window.innerWidth, window.matchMedia("(prefers-reduced-motion: reduce)").matches, navigator.hardwareConcurrency));
  const [pageVisible, setPageVisible] = useState(() => typeof document === "undefined" || document.visibilityState === "visible");
  const [controlsOpen, setControlsOpen] = useState(() => typeof window === "undefined" || window.innerWidth >= 760);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [motionEnabled, setMotionEnabled] = useState(() => typeof window !== "undefined" && initialSpaceMotion(window.innerWidth, window.matchMedia("(prefers-reduced-motion: reduce)").matches));
  const [fullscreenActive, setFullscreenActive] = useState(false);
  const [geologyVisible, setGeologyVisible] = useState(false);
  const [dayNightEnabled, setDayNightEnabled] = useState(true);
  const [cityLabelsVisible, setCityLabelsVisible] = useState(true);
  const [atmosphereVisible, setAtmosphereVisible] = useState(true);
  const [satellitesVisible, setSatellitesVisible] = useState(() => typeof window !== "undefined" && window.innerWidth >= 760);
  const [satellitePathsVisible, setSatellitePathsVisible] = useState(true);
  const [satelliteStatus, setSatelliteStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [satelliteCatalog, setSatelliteCatalog] = useState<Array<{ choice: SatelliteChoice; epoch: Date }>>([]);
  const [selectedSatelliteId, setSelectedSatelliteId] = useState<string | null>(null);
  const [utcTime, setUtcTime] = useState(() => new Date().toISOString().slice(11, 16));
  const [opacity, setOpacity] = useState(90);
  const [mapMode, setMapMode] = useState<ThematicMode>("raster");
  const [ageFilter, setAgeFilter] = useState<AgeFilter>("all");
  const [rockFilter, setRockFilter] = useState<RockFilter>("all");
  const [vectorState, setVectorState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [coordinates, setCoordinates] = useState<Coordinates | null>(null);
  const [geologicalUnits, setGeologicalUnits] = useState<GeologicalUnit[]>([]);
  const [selectedUnitIndex, setSelectedUnitIndex] = useState(0);
  const geologicalUnit = geologicalUnits[selectedUnitIndex] ?? null;
  const [status, setStatus] = useState<QueryStatus>("idle");
  const [globeError, setGlobeError] = useState<string | null>(null);
  const [lithologyDictionary, setLithologyDictionary] = useState<LithologyDictionary | null>(null);
  const [lexiconStatus, setLexiconStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const rockInfo = classifyLithologies(geologicalUnit?.lithIds ?? [], lithologyDictionary);
  const eraInfo = classifyGeologicEra(geologicalUnit?.youngAgeMa ?? null, geologicalUnit?.oldAgeMa ?? null);

  // Pause decorative animation when the browser tab is hidden.
  useEffect(() => {
    const onVisibilityChange = () => {
      const visible = document.visibilityState === "visible";
      setPageVisible(visible);
      if (visible && viewerRef.current && !viewerRef.current.isDestroyed()) {
        viewerRef.current.clock.currentTime = JulianDate.fromDate(new Date());
        setUtcTime(new Date().toISOString().slice(11, 16));
        satelliteOverlayRef.current?.update(new Date());
        viewerRef.current.scene.requestRender();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  // Change render budget without recreating the WebGL context.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;
    const profile = RENDER_PROFILES[renderQuality];
    viewer.resolutionScale = profile.resolutionScale;
    viewer.targetFrameRate = profile.targetFrameRate;
    viewer.scene.globe.maximumScreenSpaceError = profile.maximumScreenSpaceError;
    viewer.scene.postProcessStages.fxaa.enabled = profile.fxaa;
    viewer.scene.requestRender();
  }, [renderQuality]);

  useEffect(() => {
    const update = () => setFullscreenActive(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", update);
    return () => document.removeEventListener("fullscreenchange", update);
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void document.documentElement.requestFullscreen?.().catch(() => {});
  };

  const toggleControls = () => {
    setControlsOpen((open) => !open);
    if (window.innerWidth < 760) setDetailsOpen(false);
  };

  const toggleDetails = () => {
    setDetailsOpen((open) => !open);
    if (window.innerWidth < 760) setControlsOpen(false);
  };

  useEffect(() => {
    if (!mountRef.current) return;

    let viewer: Viewer | null = null;
    let solarClockTimer: number | null = null;
    try {
      viewer = new Viewer(mountRef.current, {
        baseLayer: false,
        baseLayerPicker: false,
        terrainProvider: new EllipsoidTerrainProvider(),
        animation: false,
        timeline: false,
        geocoder: false,
        homeButton: false,
        fullscreenButton: false,
        infoBox: false,
        selectionIndicator: false,
        sceneModePicker: false,
        navigationHelpButton: false,
        skyBox: SkyBox.createEarthSkyBox(),
        skyAtmosphere: new SkyAtmosphere(),
        shouldAnimate: false,
        requestRenderMode: true,
        maximumRenderTimeChange: Number.POSITIVE_INFINITY,
        msaaSamples: 1,
      });

      viewerRef.current = viewer;
      const { scene } = viewer;
      scene.backgroundColor = Color.fromCssColorString("#02040a");
      scene.globe.baseColor = Color.fromCssColorString("#0d2a44");
      scene.globe.show = true;
      scene.globe.translucency.enabled = false;
      scene.globe.depthTestAgainstTerrain = false;
      scene.fog.enabled = false;
      if (scene.sun) scene.sun.show = false;
      if (scene.moon) scene.moon.show = false;
      scene.screenSpaceCameraController.minimumZoomDistance = 15000;
      scene.screenSpaceCameraController.maximumZoomDistance = 65000000;
      const profile = RENDER_PROFILES[renderQuality];
      viewer.resolutionScale = profile.resolutionScale;
      viewer.targetFrameRate = profile.targetFrameRate;
      scene.globe.maximumScreenSpaceError = profile.maximumScreenSpaceError;
      scene.postProcessStages.fxaa.enabled = profile.fxaa;

      // Physically positioned SunLight replaces the camera-following studio
      // light. A fixed viewer clock is refreshed from UTC every minute, keeping
      // the true solar terminator without forcing continuous WebGL rendering.
      viewer.clock.shouldAnimate = false;
      viewer.clock.currentTime = JulianDate.fromDate(new Date());
      scene.light = new SunLight({ intensity: 2.0 });
      scene.globe.enableLighting = true;
      scene.globe.showGroundAtmosphere = true;
      scene.globe.dynamicAtmosphereLighting = true;
      scene.globe.dynamicAtmosphereLightingFromSun = true;
      // Cesium's default distance fade would flatten the day/night terminator
      // when zooming into a region. Keep solar lighting at all zoom levels.
      scene.globe.lightingFadeOutDistance = 0;
      scene.globe.lightingFadeInDistance = 0;
      scene.globe.atmosphereLightIntensity = 14;
      scene.globe.atmosphereMieAnisotropy = 0.88;
      scene.globe.atmosphereRayleighScaleHeight = 10_000;
      scene.globe.atmosphereMieScaleHeight = 3_200;
      if (scene.skyAtmosphere) {
        scene.skyAtmosphere.hueShift = -0.02;
        scene.skyAtmosphere.saturationShift = 0.1;
        scene.skyAtmosphere.brightnessShift = 0;
        scene.skyAtmosphere.atmosphereLightIntensity = 14;
      }
      solarClockTimer = window.setInterval(() => {
        if (!viewer || viewer.isDestroyed() || document.visibilityState !== "visible") return;
        const now = new Date();
        viewer.clock.currentTime = JulianDate.fromDate(now);
        setUtcTime(now.toISOString().slice(11, 16));
        viewer.scene.requestRender();
      }, 60_000);
      viewer.camera.setView({ destination: HOME_VIEW });

      // Bundled Natural Earth II keeps a recognizable globe even offline; NASA
      // Blue Marble (public domain) adds shaded relief and ocean bathymetry.
      viewer.imageryLayers.add(
        ImageryLayer.fromProviderAsync(TileMapServiceImageryProvider.fromUrl(buildModuleUrl("Assets/Textures/NaturalEarthII"))),
      );
      viewer.imageryLayers.addImageryProvider(new UrlTemplateImageryProvider({
        url: "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg",
        maximumLevel: 6,
        credit: new Credit('<a href="https://earthdata.nasa.gov/gibs" target="_blank" rel="noopener noreferrer">Blue Marble imagery: NASA EOSDIS GIBS</a>'),
      }));

      // Defer Macrostrat raster provider creation until the user enables it;
      // the default Earth view downloads no global geology imagery.
      cityMarkersRef.current = addWorldCityMarkers(viewer);
      viewer.scene.requestRender();

      viewer.screenSpaceEventHandler.setInputAction((event: { position: Cartesian2 }) => {
        if (!viewer || viewer.isDestroyed()) return;
        const picked = viewer.scene.pick(event.position);
        const maybeEntity = picked && typeof picked === "object" && "id" in picked
          ? (picked as { id?: Entity }).id
          : undefined;
        if (typeof maybeEntity?.id === "string" && maybeEntity.id.startsWith("satellite:")) {
          setSelectedSatelliteId(maybeEntity.id.slice("satellite:".length));
          setControlsOpen(true);
          if (window.innerWidth < 760) setDetailsOpen(false);
          return;
        }
        const position = viewer.camera.pickEllipsoid(event.position, Ellipsoid.WGS84);
        if (!position) return;
        const cartographic = Cartographic.fromCartesian(position);
        const latitude = CesiumMath.toDegrees(cartographic.latitude);
        const longitude = CesiumMath.toDegrees(cartographic.longitude);
        setCoordinates({ latitude, longitude });
        setDetailsOpen(true);
        if (window.innerWidth < 760) setControlsOpen(false);
        setGeologicalUnits([]);
        setSelectedUnitIndex(0);
        setStatus("loading");
        controllerRef.current?.abort();
        const controller = new AbortController();
        controllerRef.current = controller;
        void queryGeology(latitude, longitude, controller.signal)
          .then((units) => {
            if (controller.signal.aborted) return;
            setGeologicalUnits(units);
            setStatus(units.length ? "success" : "empty");
          })
          .catch(() => {
            if (!controller.signal.aborted) setStatus("error");
          });
      }, ScreenSpaceEventType.LEFT_CLICK);
    } catch (error) {
      setGlobeError(error instanceof Error ? error.message : "3D globe initialization failed");
      if (viewer && !viewer.isDestroyed()) viewer.destroy();
      viewerRef.current = null;
    }

    return () => {
      if (solarClockTimer !== null) window.clearInterval(solarClockTimer);
      controllerRef.current?.abort();
      controllerRef.current = null;
      geologicalLayerRef.current = null;
      cityMarkersRef.current = [];
      satelliteOverlayRef.current?.dispose();
      satelliteOverlayRef.current = null;
      vectorLayerRef.current = null;
      vectorLoadingRef.current = null;
      viewerRef.current = null;
      if (viewer && !viewer.isDestroyed()) viewer.destroy();
    };
  }, []);

  // The carto raster remains visible during vector initialization and is
  // retained as a safe fallback if experimental MVT rendering fails.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;
    if (geologyVisible && !geologicalLayerRef.current) {
      const provider = new UrlTemplateImageryProvider({
        url: "https://tiles.macrostrat.org/carto/{z}/{x}/{y}.png",
        minimumLevel: 0,
        maximumLevel: 12,
        credit: new Credit('<a href="https://macrostrat.org" target="_blank" rel="noopener noreferrer">Geologic map © Macrostrat / source geological surveys · CC BY 4.0</a>'),
      });
      geologicalLayerRef.current = viewer.imageryLayers.addImageryProvider(provider);
    }
    if (geologicalLayerRef.current) {
      geologicalLayerRef.current.show = geologyVisible && (mapMode === "raster" || vectorState !== "ready");
      geologicalLayerRef.current.alpha = opacity / 100;
    }
    if (vectorLayerRef.current) {
      const active = geologyVisible && mapMode !== "raster" && vectorState === "ready";
      vectorLayerRef.current.show = active;
      if (active && vectorLayerRef.current.tileset) {
        vectorLayerRef.current.tileset.style = new Cesium3DTileStyle(makeThematicStyle(mapMode, ageFilter, rockFilter, opacity / 100));
      }
    }
    viewer.scene.requestRender();
  }, [geologyVisible, opacity, mapMode, ageFilter, rockFilter, vectorState]);

  // Independent overlays: no network request to show city markers.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;
    for (const marker of cityMarkersRef.current) marker.show = cityLabelsVisible;
    viewer.scene.requestRender();
  }, [cityLabelsVisible]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;
    viewer.scene.globe.enableLighting = dayNightEnabled;
    viewer.scene.globe.dynamicAtmosphereLighting = dayNightEnabled;
    viewer.scene.requestRender();
  }, [dayNightEnabled]);

  // Native sky and ground scattering without a decorative mesh.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;
    if (viewer.scene.skyAtmosphere) viewer.scene.skyAtmosphere.show = atmosphereVisible;
    viewer.scene.globe.showGroundAtmosphere = atmosphereVisible;
    viewer.scene.requestRender();
  }, [atmosphereVisible]);

  // Lazy loading and two-hour orbital-data cache; no network when disabled.
  // Six satellites, updates every five seconds, not every WebGL frame.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;
    if (!satellitesVisible) {
      satelliteOverlayRef.current?.dispose();
      satelliteOverlayRef.current = null;
      setSatelliteStatus("idle");
      return;
    }
    let active = true;
    let interval: number | null = null;
    const controller = new AbortController();
    setSatelliteStatus("loading");
    void fetchSatelliteCatalog(controller.signal).then(({ satellites }) => {
      if (!active || viewer.isDestroyed()) return;
      satelliteOverlayRef.current?.dispose();
      const overlay = new SatelliteOverlay(viewer, satellites, satellitePathsVisible);
      satelliteOverlayRef.current = overlay;
      setSatelliteCatalog(satellites.map(({ choice, epoch }) => ({ choice, epoch })));
      setSatelliteStatus(overlay.count > 0 ? "ready" : "error");
      interval = window.setInterval(() => {
        if (document.visibilityState === "visible") overlay.update(new Date());
      }, SATELLITE_UPDATE_MS);
    }).catch((error: unknown) => {
      if (!active || controller.signal.aborted) return;
      console.warn("Satellite elements unavailable; no fabricated orbit rendered.", error);
      setSatelliteStatus("error");
      setSatelliteCatalog([]);
    });
    return () => {
      active = false;
      controller.abort();
      if (interval !== null) window.clearInterval(interval);
      satelliteOverlayRef.current?.dispose();
      satelliteOverlayRef.current = null;
    };
  }, [satellitesVisible]);

  useEffect(() => {
    satelliteOverlayRef.current?.togglePaths(satellitePathsVisible);
  }, [satellitePathsVisible]);

  // Cesium's current MVTDataProvider creates its whole tile hierarchy eagerly:
  // Keep the global tree at z0..z5 (1,365 nodes). Higher regional detail stays in raster imagery.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!geologyVisible || mapMode === "raster" || !viewer || viewer.isDestroyed()) return;
    if (vectorLayerRef.current) return;
    setVectorState("loading");
    const promise = vectorLoadingRef.current ?? MVTDataProvider.fromUrl(
      "https://tiles.macrostrat.org/carto/{z}/{x}/{y}", {
        minZoom: 0,
        maxZoom: THEMATIC_MAX_ZOOM,
        featureIdProperty: "map_id",
      },
    );
    vectorLoadingRef.current = promise;
    void promise.then((provider) => {
      if (viewerRef.current !== viewer || viewer.isDestroyed()) return;
      if (!vectorLayerRef.current) {
        viewer.scene.primitives.add(provider);
        vectorLayerRef.current = provider;
      }
      setVectorState("ready"); // also synchronize if mode changed during async initialization
    }).catch((error: unknown) => {
      vectorLoadingRef.current = null;
      console.warn("Vector thematic map unavailable; keeping raster fallback.", error);
      if (viewerRef.current === viewer && !viewer.isDestroyed()) setVectorState("error");
    });
  }, [mapMode, geologyVisible]);

  // An unavailable lexicon must never hide valid map-unit data.
  // Fetch once and cache; no automatic classification from free-text guesses.
  useEffect(() => {
    if (status !== "success" || lithologyDictionary ||
        !geologicalUnits.some((unit) => unit.lithIds.length > 0)) return;
    let active = true;
    setLexiconStatus("loading");
    void fetchLithologyDictionary()
      .then((dict) => {
        if (!active) return;
        setLithologyDictionary(dict);
        setLexiconStatus("ready");
      })
      .catch(() => {
        if (active) setLexiconStatus("error");
      });
    return () => { active = false; };
  }, [status, geologicalUnits, lithologyDictionary]);

  const flyTo = (region: Region) => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;
    viewer.camera.flyTo({
      destination: Cartesian3.fromDegrees(region.lon, region.lat, 3500000),
      duration: 1.8,
    });
  };

  const resetCamera = () => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;
    viewer.camera.flyTo({
      destination: HOME_VIEW,
      duration: 1.6,
    });
  };

  return (
    <div className={"app-shell quality-" + renderQuality + (motionEnabled && pageVisible ? " motion-on" : " motion-off")}>
      <header className="topbar">
        <a className="brand" href="/" aria-label="Earth Atlas home">
          <span className="brand-symbol" aria-hidden="true">◎</span>
          <span className="brand-name">EARTH <strong>ATLAS</strong></span>
          <span className="brand-divider" />
          <span className="brand-caption">地球科学图集</span>
        </a>
        <div className="header-right">
          <span className="online-indicator"><span /> GLOBAL GEOLOGY EXPLORER</span>
          <div className="header-actions" role="group" aria-label="页面视图控制">
            <button type="button" className={"header-action" + (controlsOpen ? " active" : "")} onClick={toggleControls} aria-expanded={controlsOpen} aria-controls="earth-layer-panel">
              <span aria-hidden="true">▤</span><span className="action-caption">图层</span>
            </button>
            <button type="button" className={"header-action" + (detailsOpen ? " active" : "")} onClick={toggleDetails} aria-expanded={detailsOpen} aria-controls="earth-inspector-panel">
              <span aria-hidden="true">⌖</span><span className="action-caption">信息</span>
            </button>
            <button type="button" className={"header-action" + (motionEnabled ? " active" : "")} onClick={() => setMotionEnabled((enabled) => !enabled)} aria-pressed={motionEnabled} title="开启或暂停宇宙背景星光动效（地球不会自动旋转）">
              <span aria-hidden="true">✦</span><span className="action-caption">{motionEnabled ? "动效开" : "动效关"}</span>
            </button>
            <button type="button" className="header-action" onClick={() => setRenderQuality(nextRenderQuality)} aria-label={"切换画质，当前：" + RENDER_QUALITY_LABELS[renderQuality]} title={"渲染画质：" + RENDER_QUALITY_LABELS[renderQuality] + "，点击切换"}>
              <span aria-hidden="true">◇</span><span className="action-caption">{RENDER_QUALITY_LABELS[renderQuality]}</span>
            </button>
            <button type="button" className="header-action" onClick={toggleFullscreen} aria-label={fullscreenActive ? "退出浏览器全屏" : "进入浏览器全屏"} title={fullscreenActive ? "退出全屏" : "浏览器全屏"}>
              <span aria-hidden="true">{fullscreenActive ? "⊟" : "⛶"}</span><span className="action-caption">{fullscreenActive ? "退出全屏" : "全屏"}</span>
            </button>
          </div>
          <a href="https://github.com/zeye-w/Earth-Atlas" target="_blank" rel="noreferrer" className="source-link">GitHub ↗</a>
        </div>
      </header>

      <main className="workspace">
        <aside id="earth-layer-panel" aria-label="地质图层控制" aria-hidden={!controlsOpen} inert={!controlsOpen} className={"sidebar glass-panel" + (!controlsOpen ? " is-collapsed" : "")}>
          <button type="button" className="panel-dismiss" onClick={() => setControlsOpen(false)} aria-label="收起地质图层面板">×</button>
          <div className="side-content">
            <div className="eyebrow"><span className="serial">01</span> GLOBAL GEOLOGICAL EXPLORER</div>
            <h1>阅读地球的<br /><em>岩石记忆。</em></h1>
            <p className="lead">旋转地球，探索不同地区的地质年代、岩性与出露地质单元。</p>

            <div className="section-divider" />
            <div className="section-caption">MAP LAYERS <span>图层控制</span></div>
            <label className="toggle-row">
              <span className="layer-icon">▧</span>
              <span className="toggle-copy"><strong>全球地质图</strong><small>Macrostrat · 默认关闭</small></span>
              <input type="checkbox" checked={geologyVisible} onChange={(event) => setGeologyVisible(event.target.checked)} aria-label="显示全球地质图" />
              <span className="switch" aria-hidden="true" />
            </label>
            <label className="toggle-row">
              <span className="layer-icon" aria-hidden="true">◐</span>
              <span className="toggle-copy"><strong>实时昼夜光照</strong><small>太阳位置 · 当前 UTC 时间</small></span>
              <input type="checkbox" checked={dayNightEnabled} onChange={(event) => setDayNightEnabled(event.target.checked)} aria-label="启用真实昼夜光照" />
              <span className="switch" aria-hidden="true" />
            </label>
            <label className="toggle-row">
              <span className="layer-icon" aria-hidden="true">⌖</span>
              <span className="toggle-copy"><strong>全球主要城市</strong><small>城市中心近似位置 · 自动避让远景</small></span>
              <input type="checkbox" checked={cityLabelsVisible} onChange={(event) => setCityLabelsVisible(event.target.checked)} aria-label="显示全球主要城市" />
              <span className="switch" aria-hidden="true" />
            </label>
            <div className="thematic-controls">
              <label htmlFor="geology-style" className="metric-label">MAP STYLE · 地质图显示方式</label>
              <select id="geology-style" disabled={!geologyVisible} value={mapMode} onChange={(event) => setMapMode(event.target.value as ThematicMode)}>
                <option value="raster">原始地质图 · Raster</option>
                <option value="age">地质年代专题图 · Age</option>
                <option value="lithology">岩性专题图 · Lithology</option>
              </select>
              {mapMode === "age" && <label className="thematic-filter"><span>年代筛选</span><select value={ageFilter} disabled={!geologyVisible} onChange={(event) => setAgeFilter(event.target.value as AgeFilter)}>
                {AGE_OPTIONS.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
              </select></label>}
              {mapMode === "lithology" && <label className="thematic-filter"><span>岩性筛选</span><select value={rockFilter} disabled={!geologyVisible} onChange={(event) => setRockFilter(event.target.value as RockFilter)}>
                {ROCK_OPTIONS.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
              </select></label>}
              {mapMode !== "raster" && <p className="thematic-note" role="status">
                {vectorState === "loading" ? "正在初始化全球矢量专题图，暂时保留原始地图…" :
                 vectorState === "error" ? "矢量图层加载失败，已回退到原始地质图。" :
                 mapMode === "age" ? "依据地质图编绘的数值年龄着色；跨代或未知年代显示灰色。全球专题图使用低至中分辨率瓦片。" :
                 "试验性岩性专题图：仅根据原始英文岩性描述中的明确术语匹配，不等同于官方标准岩性分类。"}
              </p>}
              {mapMode === "age" && <div className="thematic-legend">{ERA_GUIDE.map((era) => <span key={era.key}><i style={{backgroundColor:era.color}} />{era.label.split(" / ")[0]}</span>)}<span><i style={{backgroundColor:"#ADB9B2"}} />不确定</span></div>}
              {mapMode === "lithology" && <div className="thematic-legend"><span><i style={{backgroundColor:"#C6A460"}} />沉积岩</span><span><i style={{backgroundColor:"#CF8F81"}} />火成岩</span><span><i style={{backgroundColor:"#9B8CB7"}} />变质岩</span><span><i style={{backgroundColor:"#A6B2AE"}} />未分类</span></div>}
            </div>
            <div className={"opacity-control" + (!geologyVisible ? " muted" : "")}>
              <div className="opacity-head"><span>图层不透明度</span><span>{opacity}%</span></div>
              <input type="range" min="15" max="100" step="5" value={opacity} disabled={!geologyVisible} onChange={(event) => setOpacity(Number(event.target.value))} aria-label="地质图不透明度" />
            </div>

            <div className="section-divider" />
            <div className="section-caption">EXPLORE REGIONS <span>快速定位</span></div>
            <div className="regions">
              {REGIONS.map((region) => (
                <button key={region.label} className="region-btn" onClick={() => flyTo(region)}>
                  <span className="region-mark">⌖</span>
                  <span><strong>{region.label}</strong><small>{region.subtitle}</small></span>
                  <span className="region-arrow">↗</span>
                </button>
              ))}
            </div>

            <div className="sidebar-note">
              <span className="note-icon">i</span>
              <p>地质图反映地表地质单元，不代表地下岩层。年代与岩性取自原始地质图编绘数据。</p>
            </div>
          </div>
          <div className="sidebar-bottom">EARTH ATLAS <span>—</span> MVP 0.1</div>
        </aside>

        <section className="globe-panel" aria-label="可交互三维地质地球">
          <div className="globe-mount" ref={mountRef} />
          <div className="space-effects" aria-hidden="true">
            <div className="nebula-field" />
            <div className="stars-far" />
            <div className="stars-near" />
            <div className="orbital-glow" />
          </div>
          <div className="globe-top-left">
            <span className="map-tag"><span className="tag-dot" /> 3D GLOBAL VIEW</span>
            <span className="map-subtitle">{dayNightEnabled ? "REAL-TIME SUNLIGHT" : "EARTH OBSERVATION"} · {utcTime} UTC</span>
          </div>
          <button className="reset-button" type="button" onClick={resetCamera} title="返回全球视角" aria-label="返回全球视角">◎ <span>重置视角</span></button>
          <div className="globe-guide"><span className="guide-orbit">↔</span><span>拖动旋转 · 滚轮缩放 · 点击查询</span></div>
          <div className="globe-attribution">Basemap: <a href="https://earthdata.nasa.gov/gibs" target="_blank" rel="noreferrer">NASA Blue Marble</a> · Natural Earth · Geology: <a href="https://macrostrat.org/" target="_blank" rel="noreferrer">Macrostrat</a> · CC BY 4.0</div>
          {globeError && <div className="globe-error" role="alert">三维地球启动失败：{globeError}<p>请检查 WebGL 支持和浏览器环境。</p></div>}
        </section>

        <aside id="earth-inspector-panel" aria-label="地质查询信息" aria-hidden={!detailsOpen} inert={!detailsOpen} className={"details-panel glass-panel" + (!detailsOpen ? " is-collapsed" : "")} aria-live="polite">
          <button type="button" className="panel-dismiss" onClick={() => setDetailsOpen(false)} aria-label="收起地质信息面板">×</button>
          <div className="details-head">
            <div className="section-caption">GEOLOGICAL INSPECTOR <span>地质信息</span></div>
            <span className="inspect-status">{status === "loading" ? "QUERYING" : status === "success" ? "RECORD FOUND" : "AWAITING POINT"}</span>
          </div>

          {status === "idle" && (
            <div className="empty-inspector">
              <div className="empty-emblem">⌖</div>
              <h2>选择地球上的<br />任意位置</h2>
              <p>点击球体上的一个地点，即可查看已编绘的地质年代与岩石类型。</p>
              <span className="empty-hint">CLICK THE GLOBE TO BEGIN</span>
            </div>
          )}

          {coordinates && status !== "idle" && (
            <div className="inspector-body">
              <div className="coordinates-block">
                <div className="metric-label">SELECTED COORDINATES</div>
                <div className="coordinate-values"><span>{coordinateLabel(coordinates.latitude, "N", "S")}</span><span>{coordinateLabel(coordinates.longitude, "E", "W")}</span></div>
              </div>

              {status === "loading" && <div className="query-message"><span className="loading-ring" />正在查询 Macrostrat 地质数据库…</div>}
              {status === "error" && <div className="message-card error" role="alert"><strong>地质查询暂时不可用</strong><p>请检查网络连接或稍后重试。不会使用模拟数据替代查询结果。</p></div>}
              {status === "empty" && <div className="message-card"><strong>当前位置暂无地质单元数据</strong><p>这可能是海域、未编绘区域或数据源暂时没有匹配记录。请尝试其他陆地区域。</p></div>}
              {status === "success" && geologicalUnit && (
                <>
                  {geologicalUnits.length > 1 && (
                    <div className="info-field">
                      <label className="metric-label" htmlFor="geologic-candidate">MATCHING MAP UNITS · 候选地质单元 ({geologicalUnits.length})</label>
                      <select id="geologic-candidate" className="geology-select" value={selectedUnitIndex} onChange={(event) => setSelectedUnitIndex(Number(event.target.value))}>
                        {geologicalUnits.map((unit, index) => (
                          <option key={`${unit.sourceId ?? "s"}-${unit.mapId ?? "m"}-${index}`} value={index}>{index + 1}. {unit.name}{unit.mapId !== null ? ` · #${unit.mapId}` : ""}</option>
                        ))}
                      </select>
                      <p>同一坐标可能有来自不同地质图或不同比例尺的记录，请核对地图来源。</p>
                    </div>
                  )}
                  <div className="unit-heading"><div className="metric-label">MAP UNIT / 地质单元</div><h2>{geologicalUnit.name}</h2></div>
                  <div className="info-field"><span className="metric-label">GEOLOGICAL AGE · 地质年代</span><strong>{geologicalUnit.age ?? "未提供"}</strong></div>
                  <div className="info-field"><span className="metric-label">LITHOLOGY · 原始岩性描述</span><strong>{geologicalUnit.lithology ?? "未提供原图岩性文本"}</strong></div>
                  <div className="info-field">
                    <span className="metric-label">ROCK CLASS · 岩石大类</span>
                    <div className="scientific-tag">
                      <span className={"rock-swatch rock-" + rockInfo.rockClass} />
                      <strong>{rockInfo.classLabel}</strong>
                    </div>
                    {rockInfo.names.length > 0 && <p>Macrostrat 标准岩性：{rockInfo.names.join("、")}</p>}
                    {lexiconStatus === "loading" && geologicalUnit.lithIds.length > 0 && <p>正在匹配官方岩性词典…</p>}
                    {lexiconStatus === "error" && geologicalUnit.lithIds.length > 0 && <p>词典暂不可用，已保留原始岩性；不进行推测分类。</p>}
                    {rockInfo.rockClass === "unclassified" && lexiconStatus !== "loading" && lexiconStatus !== "error" && <p>缺少完整的标准分类依据，不从地层名称或自由文本推断。</p>}
                  </div>
                  <div className="info-field"><span className="metric-label">ESTIMATED AGE · 推算数值年龄</span><strong>{geologicalUnit.ageRangeMa ?? "未提供完整年龄范围"}</strong><p>{geologicalUnit.ageNote}</p></div>
                  <div className="info-field">
                    <span className="metric-label">ERA GUIDE · 地质年代概览</span>
                    <div className="scientific-tag">
                      <span className="era-swatch" style={{ backgroundColor: eraInfo.color }} />
                      <strong>{eraInfo.label}</strong>
                    </div>
                    <p>仅当完整年龄范围属于同一地质代时标注；概览颜色不是当前地质图的图斑颜色。</p>
                    <div className="era-legend">
                      {ERA_GUIDE.map((era) => <span key={era.key} title={era.label}><i style={{ backgroundColor: era.color }} />{era.label.split(" / ")[0]}</span>)}
                    </div>
                  </div>
                  {geologicalUnit.description && <div className="info-field"><span className="metric-label">DESCRIPTION · 原图描述</span><p>{geologicalUnit.description}</p></div>}
                  <div className="source-card"><div className="metric-label">SOURCE / 数据来源</div><strong>{geologicalUnit.sourceName ?? "Macrostrat integrated geologic map"}</strong>{geologicalUnit.sourceId !== null && <span>Source ID: {geologicalUnit.sourceId}</span>}{geologicalUnit.mapId !== null && <span>Map polygon ID: {geologicalUnit.mapId}</span>}<a href={geologicalUnit.sourceId !== null ? "https://macrostrat.org/api/v2/defs/sources?source_id=" + geologicalUnit.sourceId : "https://macrostrat.org/map/"} target="_blank" rel="noreferrer">核对原始地图来源 ↗</a><p>全球地质瓦片为多尺度拼接图；候选查询与可见图斑未必严格一一对应。</p></div>
                </>
              )}
            </div>
          )}
          <div className="details-footer">
            <span className="details-footer-dot" />
            <span>科学数据来自 Macrostrat。岩性与地质年代取自地表地质图，并非直接地下测量；不同地区的比例尺和数据完整性不同。</span>
          </div>
        </aside>
      </main>
    </div>
  );
}

export default App;
