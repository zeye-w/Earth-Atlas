import { useEffect, useRef, useState, type ReactNode } from "react";
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
import {
  ArrowUpRight, ChevronDown, Code, Crosshair, Globe, Info, Layers, LocateFixed, MapPin, Maximize, Minimize,
  Mountain, MousePointerClick, Move3d, Orbit, RotateCcw, Satellite, SlidersHorizontal, SunMoon, X,
} from "lucide-react";
import { queryGeology, type GeologicalUnit } from "./geology";
import { fetchLithologyDictionary, classifyLithologies, type LithologyDictionary } from "./lithology";
import { classifyGeologicEra, ERA_GUIDE } from "./geologicTime";
import { makeThematicStyle, AGE_OPTIONS, ROCK_OPTIONS, THEMATIC_MAX_ZOOM, type ThematicMode, type AgeFilter, type RockFilter } from "./mapThematic";
import { RENDER_PROFILES, RENDER_QUALITY_LABELS, RENDER_QUALITY_ORDER, initialRenderQuality, type RenderQuality } from "./performance";
import { addWorldCityMarkers } from "./cityMarkers";
// satellite.js and the overlay are imported on demand when the layer is enabled.
import type { SatelliteChoice } from "./satelliteOrbits";
import type { SatelliteOverlay } from "./satelliteOverlay";
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

// Fade out the static splash from index.html once the first globe tiles are in.
function dismissSplash() {
  const splash = document.getElementById("splash");
  if (!splash || splash.classList.contains("done")) return;
  splash.classList.add("done");
  window.setTimeout(() => splash.remove(), 700);
}

function coordinateLabel(value: number, positive: string, negative: string): string {
  return Math.abs(value).toFixed(4) + "° " + (value >= 0 ? positive : negative);
}

const ICON = { size: 17, strokeWidth: 1.7 } as const;

interface ToggleRowProps {
  icon: ReactNode;
  title: string;
  caption: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

function ToggleRow({ icon, title, caption, checked, onChange }: ToggleRowProps) {
  return (
    <label className="toggle-row">
      <span className="layer-icon" aria-hidden="true">{icon}</span>
      <span className="toggle-copy"><strong>{title}</strong><small>{caption}</small></span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} aria-label={title} />
      <span className="switch" aria-hidden="true" />
    </label>
  );
}

function App() {
  const shellRef = useRef<HTMLDivElement>(null);
  const mountRef = useRef<HTMLDivElement>(null);
  const settingsRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const geologicalLayerRef = useRef<ImageryLayer | null>(null);
  const cityMarkersRef = useRef<Entity[]>([]);
  const satelliteOverlayRef = useRef<SatelliteOverlay | null>(null);
  const vectorLayerRef = useRef<MVTDataProvider | null>(null);
  const vectorLoadingRef = useRef<Promise<MVTDataProvider> | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const [renderQuality, setRenderQuality] = useState<RenderQuality>(() => typeof window === "undefined" ? "balanced" : initialRenderQuality(window.innerWidth, window.matchMedia("(prefers-reduced-motion: reduce)").matches, navigator.hardwareConcurrency));
  const [controlsOpen, setControlsOpen] = useState(() => typeof window === "undefined" || window.innerWidth >= 760);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [fullscreenActive, setFullscreenActive] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [geologyVisible, setGeologyVisible] = useState(false);
  const [dayNightEnabled, setDayNightEnabled] = useState(true);
  const [cityLabelsVisible, setCityLabelsVisible] = useState(true);
  const [atmosphereVisible, setAtmosphereVisible] = useState(true);
  const [satellitesVisible, setSatellitesVisible] = useState(() => typeof window !== "undefined" && window.innerWidth >= 760);
  const [satellitePathsVisible, setSatellitePathsVisible] = useState(true);
  const [satelliteStatus, setSatelliteStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [satelliteCatalog, setSatelliteCatalog] = useState<Array<{ choice: SatelliteChoice; epochLabel: string }>>([]);
  const [selectedSatelliteId, setSelectedSatelliteId] = useState<string | null>(null);
  const selectedSatelliteIdRef = useRef<string | null>(null);
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

  // Resynchronize the solar clock and satellites when the tab becomes visible.
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible" && viewerRef.current && !viewerRef.current.isDestroyed()) {
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

  // Close the settings popover on outside click or Escape.
  useEffect(() => {
    if (!settingsOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!settingsRef.current?.contains(event.target as Node)) setSettingsOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSettingsOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [settingsOpen]);

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
    let splashTimer: number | null = null;
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
      const removeSplashListener = scene.postRender.addEventListener(() => {
        if (!scene.globe.tilesLoaded) return;
        removeSplashListener();
        dismissSplash();
      });
      splashTimer = window.setTimeout(dismissSplash, 10_000);

      // Re-blurring the glass panels every frame while the globe moves is the
      // main source of drag jank; a class swaps them to a solid tint meanwhile.
      viewer.camera.moveStart.addEventListener(() => shellRef.current?.classList.add("is-moving"));
      viewer.camera.moveEnd.addEventListener(() => shellRef.current?.classList.remove("is-moving"));

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
      dismissSplash();
      if (viewer && !viewer.isDestroyed()) viewer.destroy();
      viewerRef.current = null;
    }

    return () => {
      if (solarClockTimer !== null) window.clearInterval(solarClockTimer);
      if (splashTimer !== null) window.clearTimeout(splashTimer);
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
    setSatelliteStatus("loading");
    void Promise.all([import("./satelliteOrbits"), import("./satelliteOverlay")]).then(async ([orbits, overlayModule]) => {
      const { satellites } = await orbits.fetchSatelliteCatalog();
      if (!active || viewer.isDestroyed()) return;
      satelliteOverlayRef.current?.dispose();
      const overlay = new overlayModule.SatelliteOverlay(viewer, satellites, satellitePathsVisible);
      satelliteOverlayRef.current = overlay;
      overlay.setSelected(selectedSatelliteIdRef.current);
      setSatelliteCatalog(satellites.map(({ choice, epoch }) => ({ choice, epochLabel: orbits.formatEpoch(epoch) })));
      setSatelliteStatus(overlay.count > 0 ? "ready" : "error");
      interval = window.setInterval(() => {
        if (document.visibilityState === "visible") overlay.update(new Date());
      }, overlayModule.SATELLITE_UPDATE_MS);
    }).catch((error: unknown) => {
      if (!active) return;
      console.warn("Satellite elements unavailable; no fabricated orbit rendered.", error);
      setSatelliteStatus("error");
      setSatelliteCatalog([]);
    });
    return () => {
      active = false;
      if (interval !== null) window.clearInterval(interval);
      satelliteOverlayRef.current?.dispose();
      satelliteOverlayRef.current = null;
    };
  }, [satellitesVisible]);

  useEffect(() => {
    selectedSatelliteIdRef.current = selectedSatelliteId;
    satelliteOverlayRef.current?.setSelected(selectedSatelliteId);
  }, [selectedSatelliteId]);

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
    <div ref={shellRef} className={"app-shell quality-" + renderQuality}>
      <header className="topbar">
        <a className="brand" href="/" aria-label="TerraScope 首页">
          <span className="brand-symbol" aria-hidden="true"><Orbit size={18} strokeWidth={1.6} /></span>
          <span className="brand-name">TERRA<strong>SCOPE</strong></span>
          <span className="brand-divider" />
          <span className="brand-caption">数字地球</span>
        </a>
        <div className="header-right">
          <span className="online-indicator"><span /> LIVE · {utcTime} UTC</span>
          <div className="header-actions" role="group" aria-label="页面视图控制">
            <button type="button" className={"header-action" + (controlsOpen ? " active" : "")} onClick={toggleControls} aria-label="图层" aria-expanded={controlsOpen} aria-controls="earth-layer-panel">
              <Layers {...ICON} aria-hidden="true" /><span className="action-caption">图层</span>
            </button>
            <button type="button" className={"header-action" + (detailsOpen ? " active" : "")} onClick={toggleDetails} aria-label="地点" aria-expanded={detailsOpen} aria-controls="earth-inspector-panel">
              <Crosshair {...ICON} aria-hidden="true" /><span className="action-caption">地点</span>
            </button>
            <div className="settings-anchor" ref={settingsRef}>
              <button type="button" className={"header-action" + (settingsOpen ? " active" : "")} onClick={() => setSettingsOpen((open) => !open)} aria-expanded={settingsOpen} aria-controls="view-settings" aria-label="显示设置">
                <SlidersHorizontal {...ICON} aria-hidden="true" /><span className="action-caption">设置</span>
              </button>
              {settingsOpen && (
                <div id="view-settings" className="settings-popover" role="dialog" aria-label="显示设置">
                  <div className="metric-label">RENDER QUALITY · 画质</div>
                  <div className="segmented" role="radiogroup" aria-label="渲染画质">
                    {RENDER_QUALITY_ORDER.map((quality) => (
                      <button key={quality} type="button" role="radio" aria-checked={renderQuality === quality} className={renderQuality === quality ? "selected" : ""} onClick={() => setRenderQuality(quality)}>
                        {RENDER_QUALITY_LABELS[quality]}
                      </button>
                    ))}
                  </div>
                  <p className="settings-hint">省电模式降低分辨率并关闭玻璃模糊，适合笔记本和手机。</p>
                  <button type="button" className="settings-row" onClick={toggleFullscreen}>
                    {fullscreenActive ? <Minimize {...ICON} aria-hidden="true" /> : <Maximize {...ICON} aria-hidden="true" />}
                    <span>{fullscreenActive ? "退出全屏" : "全屏浏览"}</span>
                  </button>
                  <a className="settings-row" href="https://github.com/zeye-w/Earth-Atlas" target="_blank" rel="noreferrer">
                    <Code {...ICON} aria-hidden="true" /><span>GitHub 源代码</span><ArrowUpRight size={14} aria-hidden="true" />
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="workspace">
        <aside id="earth-layer-panel" aria-label="地球图层" aria-hidden={!controlsOpen} inert={!controlsOpen} className={"sidebar glass-panel" + (!controlsOpen ? " is-collapsed" : "")}>
          <button type="button" className="panel-dismiss" onClick={() => setControlsOpen(false)} aria-label="收起图层面板"><X size={15} aria-hidden="true" /></button>
          <div className="side-content">
            <div className="eyebrow"><span className="serial">01</span> DIGITAL EARTH EXPLORER</div>
            <h1>观察一颗<br /><em>实时运转的地球。</em></h1>
            <p className="lead">真实的昼夜交替、在轨卫星、全球城市与地表地质，汇聚在同一颗可交互的三维地球上。</p>

            <details className="layer-group" open>
              <summary><span>EARTH VIEW<small>地球视图</small></span><ChevronDown size={15} aria-hidden="true" /></summary>
              <ToggleRow icon={<SunMoon {...ICON} />} title="实时昼夜光照" caption="按当前 UTC 时间计算太阳位置" checked={dayNightEnabled} onChange={setDayNightEnabled} />
              <ToggleRow icon={<Globe {...ICON} />} title="大气散射" caption="地球边缘的蓝色大气辉光" checked={atmosphereVisible} onChange={setAtmosphereVisible} />
              <ToggleRow icon={<MapPin {...ICON} />} title="全球主要城市" caption="远景自动隐藏次要城市" checked={cityLabelsVisible} onChange={setCityLabelsVisible} />
            </details>

            <details className="layer-group" open>
              <summary><span>SATELLITES<small>在轨卫星</small></span><ChevronDown size={15} aria-hidden="true" /></summary>
              <ToggleRow icon={<Satellite {...ICON} />} title="真实卫星轨道" caption="公开 GP 根数 · SGP4 轨道预测" checked={satellitesVisible} onChange={setSatellitesVisible} />
              {satellitesVisible && (
                <div className="satellite-controls">
                  <label className="satellite-path-toggle">
                    <input type="checkbox" checked={satellitePathsVisible} onChange={(event) => setSatellitePathsVisible(event.target.checked)} />
                    <span>显示前后约 45 分钟预测轨迹</span>
                  </label>
                  <p className="satellite-status" role="status">
                    {satelliteStatus === "loading" ? "正在读取 CelesTrak 最新公开轨道根数…" :
                     satelliteStatus === "error" ? "轨道数据暂不可用，已隐藏卫星；不会绘制虚构轨道。" :
                     satelliteStatus === "ready" ? "已加载 " + satelliteCatalog.length + " 颗卫星 · 每 5 秒更新预测位置" :
                     "打开图层后读取轨道根数"}
                  </p>
                  {satelliteCatalog.length > 0 && satelliteStatus === "ready" && (
                    <div className="satellite-catalog">
                      {satelliteCatalog.map(({ choice, epochLabel }) => (
                        <div className={"satellite-entry" + (selectedSatelliteId === choice.id ? " selected" : "")} key={choice.id}>
                          <Satellite size={13} strokeWidth={1.7} className="satellite-glyph" aria-hidden="true" />
                          <span><strong>{choice.title}</strong><small>轨道历元：{epochLabel}</small></span>
                        </div>
                      ))}
                    </div>
                  )}
                  <p className="satellite-disclaimer">数据：CelesTrak GP / SGP4。位置为轨道推算，并非实时遥测；轨迹表示地固坐标系下的预测路径。</p>
                </div>
              )}
            </details>

            <details className="layer-group" open={geologyVisible || undefined}>
              <summary><span>GEOLOGY<small>地表地质</small></span><ChevronDown size={15} aria-hidden="true" /></summary>
              <ToggleRow icon={<Mountain {...ICON} />} title="全球地质图" caption="Macrostrat 地表地质单元" checked={geologyVisible} onChange={setGeologyVisible} />
              <div className="thematic-controls">
                <label htmlFor="geology-style" className="metric-label">MAP STYLE · 显示方式</label>
                <select id="geology-style" disabled={!geologyVisible} value={mapMode} onChange={(event) => setMapMode(event.target.value as ThematicMode)}>
                  <option value="raster">原始地质图 · Raster</option>
                  <option value="age">地质年代专题图 · Age</option>
                  <option value="lithology">岩性专题图 · Lithology（试验）</option>
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
            </details>

            <details className="layer-group" open>
              <summary><span>EXPLORE<small>快速定位</small></span><ChevronDown size={15} aria-hidden="true" /></summary>
              <div className="regions">
                {REGIONS.map((region) => (
                  <button key={region.label} className="region-btn" onClick={() => flyTo(region)}>
                    <LocateFixed size={16} strokeWidth={1.7} className="region-mark" aria-hidden="true" />
                    <span><strong>{region.label}</strong><small>{region.subtitle}</small></span>
                    <ArrowUpRight size={14} className="region-arrow" aria-hidden="true" />
                  </button>
                ))}
              </div>
            </details>

            <div className="sidebar-note">
              <Info size={14} className="note-icon" aria-hidden="true" />
              <p>影像来自 NASA GIBS 与 Natural Earth，卫星轨道来自 CelesTrak，地质数据来自 Macrostrat。卫星位置为轨道推算；地质图反映地表单元，不代表地下岩层。</p>
            </div>
          </div>
          <div className="sidebar-bottom">TERRASCOPE <span>—</span> MVP 0.2</div>
        </aside>

        <section className="globe-panel" aria-label="可交互三维数字地球">
          <div className="globe-mount" ref={mountRef} />
          <div className="globe-top-left">
            <span className="map-tag"><span className="tag-dot" /> 3D DIGITAL EARTH</span>
            <span className="map-subtitle">{dayNightEnabled ? "REAL-TIME SUNLIGHT" : "EARTH OBSERVATION"} · {utcTime} UTC</span>
          </div>
          <button className="reset-button" type="button" onClick={resetCamera} title="返回全球视角" aria-label="返回全球视角"><RotateCcw size={14} aria-hidden="true" /><span>重置视角</span></button>
          <div className="globe-guide"><span className="guide-orbit"><Move3d size={14} aria-hidden="true" /></span><span>拖动旋转 · 滚轮缩放 · 点击地表查询地质</span></div>
          <div className="globe-attribution">Satellite orbits: <a href="https://celestrak.org/" target="_blank" rel="noreferrer">CelesTrak</a> · Basemap: <a href="https://earthdata.nasa.gov/gibs" target="_blank" rel="noreferrer">NASA Blue Marble</a> · Natural Earth · Geology: <a href="https://macrostrat.org/" target="_blank" rel="noreferrer">Macrostrat</a> · CC BY 4.0</div>
          {globeError && <div className="globe-error" role="alert">三维地球启动失败：{globeError}<p>请检查 WebGL 支持和浏览器环境。</p></div>}
        </section>

        <aside id="earth-inspector-panel" aria-label="地点信息" aria-hidden={!detailsOpen} inert={!detailsOpen} className={"details-panel glass-panel" + (!detailsOpen ? " is-collapsed" : "")} aria-live="polite">
          <button type="button" className="panel-dismiss" onClick={() => setDetailsOpen(false)} aria-label="收起地点信息面板"><X size={15} aria-hidden="true" /></button>
          <div className="details-head">
            <div className="section-caption">LOCATION INSPECTOR <span>地点信息</span></div>
            <span className="inspect-status">{status === "loading" ? "QUERYING" : status === "success" ? "RECORD FOUND" : "AWAITING POINT"}</span>
          </div>

          {status === "idle" && (
            <div className="empty-inspector">
              <div className="empty-emblem"><MousePointerClick size={34} strokeWidth={1.4} aria-hidden="true" /></div>
              <h2>点击地球上的<br />任意位置</h2>
              <p>查看该点的经纬度，以及已编绘的地表地质年代与岩石类型。</p>
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
