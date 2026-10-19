import { useEffect, useRef } from "react";
import { Credit, UrlTemplateImageryProvider, type Entity, type ImageryLayer, type Viewer } from "cesium";
import { addWorldCityMarkers } from "../cityMarkers";

// NASA Black Marble 2016 (VIIRS night lights composite, public domain).
const BLACK_MARBLE_URL = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png";

/** Sunlight, sky/ground atmosphere, city markers and night-side city lights. */
export function useEarthView(viewer: Viewer | null, toggles: { dayNight: boolean; atmosphere: boolean; cities: boolean; lights: boolean }) {
  const markersRef = useRef<Entity[]>([]);
  const lightsRef = useRef<ImageryLayer | null>(null);

  useEffect(() => {
    if (!viewer) return;
    markersRef.current = addWorldCityMarkers(viewer);
    // Real city lights on the night side only: Cesium blends a layer by
    // dayAlpha/nightAlpha across the solar terminator when lighting is on
    // (with lighting off everything counts as day, so it disappears).
    const lights = viewer.imageryLayers.addImageryProvider(new UrlTemplateImageryProvider({
      url: BLACK_MARBLE_URL,
      maximumLevel: 8,
      credit: new Credit('<a href="https://earthobservatory.nasa.gov/features/NightLights" target="_blank" rel="noopener noreferrer">Night lights: NASA Black Marble 2016 (VIIRS)</a>'),
    }));
    lights.dayAlpha = 0;
    lights.nightAlpha = 1;
    lightsRef.current = lights;
    return () => {
      if (!viewer.isDestroyed()) {
        for (const marker of markersRef.current) viewer.entities.remove(marker);
        viewer.imageryLayers.remove(lights, true);
      }
      markersRef.current = [];
      lightsRef.current = null;
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
    viewer.scene.requestRender();
  }, [viewer, toggles.lights]);
}
