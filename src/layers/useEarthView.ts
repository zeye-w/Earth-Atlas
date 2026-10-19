import { useEffect, useRef } from "react";
import { Credit, ImageryLayer, UrlTemplateImageryProvider, type Entity, type Viewer } from "cesium";
import { addWorldCityMarkers, declutterCityLabels } from "../cityMarkers";
import { NIGHT_LIGHTS_REFRESH_MS, NightLightsImageryProvider } from "../nightLights";

// NASA Black Marble 2016 (VIIRS night lights composite, public domain).
const BLACK_MARBLE_URL = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png";

// Same tiles as the day base layer (already in the HTTP cache).
const BLUE_MARBLE_URL = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg";

// The lights layer carries only the lights, so the night side needs its own
// ground: the day imagery, darkened and desaturated, faded in across the
// terminator like the lights. Cesium's own shading alone leaves the night
// side too bright for the lights to read as glowing.
function createNightBaseLayer(show: boolean): ImageryLayer {
  const layer = new ImageryLayer(new UrlTemplateImageryProvider({ url: BLUE_MARBLE_URL, maximumLevel: 8 }));
  layer.dayAlpha = 0;
  layer.nightAlpha = 1;
  layer.brightness = 0.34;
  layer.contrast = 1.1;
  layer.saturation = 0.35;
  layer.show = show;
  return layer;
}

// Real city lights on the night side only: Cesium blends a layer by
// dayAlpha/nightAlpha across the solar terminator when lighting is on (with
// lighting off everything counts as day, so it disappears). Tiles lying
// entirely in daylight are never downloaded (NightLightsImageryProvider).
function createLightsLayer(show: boolean): ImageryLayer {
  const layer = new ImageryLayer(new NightLightsImageryProvider({
    url: BLACK_MARBLE_URL,
    maximumLevel: 6,
    credit: new Credit('<a href="https://earthobservatory.nasa.gov/features/NightLights" target="_blank" rel="noopener noreferrer">Night lights: NASA Black Marble 2016 (VIIRS)</a>'),
  }));
  layer.dayAlpha = 0;
  layer.nightAlpha = 1;
  layer.show = show;
  return layer;
}

/** Sunlight, sky/ground atmosphere, city markers and night-side city lights. */
export function useEarthView(viewer: Viewer | null, toggles: { dayNight: boolean; atmosphere: boolean; cities: boolean; lights: boolean }) {
  const markersRef = useRef<Entity[]>([]);
  const lightsRef = useRef<ImageryLayer | null>(null);
  const nightBaseRef = useRef<ImageryLayer | null>(null);
  const lightsVisibleRef = useRef(toggles.lights);
  lightsVisibleRef.current = toggles.lights;

  useEffect(() => {
    if (!viewer) return;
    markersRef.current = addWorldCityMarkers(viewer);
    const removeDeclutter = declutterCityLabels(viewer,markersRef.current);
    // Let the base globe and controls paint before decoding/extracting lights.
    const initializeLights = () => {
      if (viewer.isDestroyed()) return;
      nightBaseRef.current = createNightBaseLayer(lightsVisibleRef.current);
      viewer.imageryLayers.add(nightBaseRef.current);
      lightsRef.current = createLightsLayer(lightsVisibleRef.current);
      viewer.imageryLayers.add(lightsRef.current);
      viewer.scene.requestRender();
    };
    const startupTimer = window.setTimeout(initializeLights, 1800);
    // Skipped daylit tiles stay cached as blank, so rebuild the layer as the
    // terminator moves. The new layer is added above the old one, which is
    // removed once the replacement has had time to load (no blink).
    let removeOldTimer: number | null = null;
    const refreshTimer = window.setInterval(() => {
      const old = lightsRef.current;
      if (!old || viewer.isDestroyed() || !lightsVisibleRef.current || document.visibilityState !== "visible") return;
      const next = createLightsLayer(true);
      viewer.imageryLayers.add(next, viewer.imageryLayers.indexOf(old) + 1);
      lightsRef.current = next;
      removeOldTimer = window.setTimeout(() => {
        if (!viewer.isDestroyed() && viewer.imageryLayers.contains(old)) viewer.imageryLayers.remove(old, true);
      }, 15_000);
    }, NIGHT_LIGHTS_REFRESH_MS);
    return () => {
      removeDeclutter();
      window.clearTimeout(startupTimer);
      window.clearInterval(refreshTimer);
      if (removeOldTimer !== null) window.clearTimeout(removeOldTimer);
      if (!viewer.isDestroyed()) {
        for (const marker of markersRef.current) viewer.entities.remove(marker);
        if (nightBaseRef.current) viewer.imageryLayers.remove(nightBaseRef.current, true);
        for (let i = viewer.imageryLayers.length - 1; i >= 0; i--) {
          const layer = viewer.imageryLayers.get(i);
          if (layer.imageryProvider instanceof NightLightsImageryProvider) viewer.imageryLayers.remove(layer, true);
        }
      }
      markersRef.current = [];
      lightsRef.current = null;
      nightBaseRef.current = null;
    };
  }, [viewer]);

  useEffect(() => {
    if (!viewer) return;
    viewer.scene.globe.enableLighting = toggles.dayNight;
    viewer.scene.globe.dynamicAtmosphereLighting = toggles.dayNight;
    viewer.scene.requestRender();
  }, [viewer, toggles.dayNight]);

  // Native sky and ground scattering without a decorative mesh.
  useEffect(() => {
    if (!viewer) return;
    if (viewer.scene.skyAtmosphere) viewer.scene.skyAtmosphere.show = toggles.atmosphere;
    viewer.scene.globe.showGroundAtmosphere = toggles.atmosphere;
    viewer.scene.requestRender();
  }, [viewer, toggles.atmosphere]);

  useEffect(() => {
    if (!viewer) return;
    for (const marker of markersRef.current) marker.show = toggles.cities;
    viewer.scene.requestRender();
  }, [viewer, toggles.cities]);

  useEffect(() => {
    if (!viewer || !lightsRef.current) return;
    lightsRef.current.show = toggles.lights;
    if (nightBaseRef.current) nightBaseRef.current.show = toggles.lights;
    viewer.scene.requestRender();
  }, [viewer, toggles.lights]);
}
