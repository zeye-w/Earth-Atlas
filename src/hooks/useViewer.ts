import { useEffect, useRef, useState, type RefObject } from "react";
import {
  Cartesian2,
  Cartesian3,
  Color,
  Credit,
  EllipsoidTerrainProvider,
  ImageryLayer,
  JulianDate,
  ScreenSpaceEventType,
  SkyAtmosphere,
  SkyBox,
  SunLight,
  TileMapServiceImageryProvider,
  UrlTemplateImageryProvider,
  Viewer,
  buildModuleUrl,
} from "cesium";
import type { SceneState } from "../sceneState";
import { HOME_LATITUDE, HOME_LONGITUDE, DESKTOP_HOME_HEIGHT_METRES, homeViewHeight } from "../homeView";

export const HOME_VIEW = Cartesian3.fromDegrees(HOME_LONGITUDE, HOME_LATITUDE, DESKTOP_HOME_HEIGHT_METRES);
export function homeDestination(width: number, height: number): Cartesian3 {
  return Cartesian3.fromDegrees(HOME_LONGITUDE, HOME_LATITUDE, homeViewHeight(width, height));
}

// Fade out the static splash from index.html once the first globe tiles are in.
function dismissSplash() {
  const splash = document.getElementById("splash");
  if (!splash || splash.classList.contains("done")) return;
  splash.classList.add("done");
  window.setTimeout(() => splash.remove(), 700);
}

/**
 * Creates the Cesium viewer with the base scene (sky, sunlight, base
 * imagery), keeps the solar clock in sync, and reports camera motion and
 * tile streaming as classes on the app shell. Overlays are added by the
 * layer hooks once `viewer` is non-null.
 */
export function useViewer(
  mountRef: RefObject<HTMLDivElement | null>,
  shellRef: RefObject<HTMLDivElement | null>,
  initialScene: SceneState | null,
  onLeftClick: (viewer: Viewer, position: Cartesian2) => void,
) {
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [globeError, setGlobeError] = useState<string | null>(null);
  const clickRef = useRef(onLeftClick);
  clickRef.current = onLeftClick;

  useEffect(() => {
    if (!mountRef.current) return;
    let created: Viewer | null = null;
    let splashTimer: number | null = null;
    let detailTimer: number | null = null;
    try {
      created = new Viewer(mountRef.current, {
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
      const v = created;
      const { scene } = v;
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

      // Physically positioned SunLight replaces the camera-following studio
      // light. The viewer clock does not run; the timeline sets it (live:
      // refreshed from UTC every minute) without forcing continuous rendering.
      v.clock.shouldAnimate = false;
      v.clock.currentTime = JulianDate.fromDate(new Date());
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

      // Shared scenes are explicit and must not be altered by responsive defaults.
      // Otherwise adapt home altitude to aspect ratio; the geographic center
      // remains 58E / 19N for every device.
      let untouchedHome = !initialScene;
      if (initialScene) {
        const [lon, lat, height, heading, pitch, roll] = initialScene.camera;
        v.camera.setView({ destination: Cartesian3.fromDegrees(lon, lat, height), orientation: { heading, pitch, roll } });
      } else v.camera.setView({ destination: homeDestination(mountRef.current.clientWidth, mountRef.current.clientHeight) });
      // A phone can rotate before the user touches the globe. Reframe only
      // while the initial home view is untouched; never hijack user navigation.
      const stopAutoReframe = () => { untouchedHome = false; };
      for (const type of ["pointerdown", "wheel", "touchstart"]) {
        v.canvas.addEventListener(type, stopAutoReframe, { passive: true });
      }
      const onResize = () => {
        if (!untouchedHome || v.isDestroyed()) return;
        v.camera.setView({ destination: homeDestination(mountRef.current?.clientWidth ?? window.innerWidth, mountRef.current?.clientHeight ?? window.innerHeight) });
        scene.requestRender();
      };
      window.addEventListener("resize", onResize);
      const removeSplashListener = scene.postRender.addEventListener(() => {
        if (!scene.globe.tilesLoaded) return;
        removeSplashListener();
        dismissSplash();
      });
      splashTimer = window.setTimeout(dismissSplash, 10_000);

      // Re-blurring the glass panels every frame while the globe moves or
      // streams tiles is the main source of jank; a class swaps them to a
      // solid tint meanwhile.
      v.camera.moveStart.addEventListener(() => shellRef.current?.classList.add("is-moving"));
      v.camera.moveEnd.addEventListener(() => shellRef.current?.classList.remove("is-moving"));
      scene.globe.tileLoadProgressEvent.addEventListener((queued: number) => {
        shellRef.current?.classList.toggle("is-loading", queued > 0);
      });

      // Bundled Natural Earth II keeps a recognizable globe even offline; NASA
      // Blue Marble (public domain) adds shaded relief and ocean bathymetry.
      v.imageryLayers.add(
        ImageryLayer.fromProviderAsync(TileMapServiceImageryProvider.fromUrl(buildModuleUrl("Assets/Textures/NaturalEarthII"))),
      );
      // Paint the bundled globe first. Remote imagery must not hold the
      // initial splash open or compete with the first label atlas upload.
      detailTimer = window.setTimeout(() => {
        if (v.isDestroyed()) return;
        v.imageryLayers.add(new ImageryLayer(new UrlTemplateImageryProvider({
          url: "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg",
          // GoogleMapsCompatible_Level8 is published down to level 8 (~500 m).
          maximumLevel: 8,
          credit: new Credit('<a href="https://earthdata.nasa.gov/gibs" target="_blank" rel="noopener noreferrer">Blue Marble imagery: NASA EOSDIS GIBS</a>'),
        })), 1);
        scene.requestRender();
      }, 1500);

      v.screenSpaceEventHandler.setInputAction((event: { position: Cartesian2 }) => {
        if (!v.isDestroyed()) clickRef.current(v, event.position);
      }, ScreenSpaceEventType.LEFT_CLICK);
      setViewer(v);
      scene.requestRender();

      return () => {
        window.removeEventListener("resize", onResize);
        if (!v.isDestroyed()) {
          for (const type of ["pointerdown", "wheel", "touchstart"]) v.canvas.removeEventListener(type, stopAutoReframe);
        }
        if (splashTimer !== null) window.clearTimeout(splashTimer);
        if (detailTimer !== null) window.clearTimeout(detailTimer);
        setViewer(null);
        if (!v.isDestroyed()) v.destroy();
      };
    } catch (error) {
      setGlobeError(error instanceof Error ? error.message : "3D globe initialization failed");
      dismissSplash();
      if (created && !created.isDestroyed()) created.destroy();
      return undefined;
    }
    // The viewer is created once; the initial scene only seeds the camera.
  }, []);

  return { viewer, globeError };
}
