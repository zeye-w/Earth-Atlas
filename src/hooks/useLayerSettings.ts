import { useCallback, useState } from "react";
import { LAYER_KEYS, type LayerKey, type SceneState } from "../sceneState";
import type { AtmosphereScale } from "../atmosphereLayers";
import type { QuakeRange } from "../earthquakeData";
import type { AgeFilter, RockFilter, ThematicMode } from "../mapThematic";
import type { SatelliteSpeed } from "../satelliteOverlay";

/** Every layer toggle: the shareable scene keys plus geographic labels and the atmosphere shells. */
export type LayerToggles = Record<LayerKey, boolean> & { geoLabels: boolean; trueColor: boolean; starlink: boolean; solarWind: boolean; flights: boolean; temperature: boolean; shells: boolean };

export interface LayerOptions {
  cloudOpacity: number;
  opacity: number;
  mapMode: ThematicMode;
  ageFilter: AgeFilter;
  rockFilter: RockFilter;
  quakeRange: QuakeRange;
  shellScale: AtmosphereScale;
  satelliteSpeed: SatelliteSpeed;
}

function initialToggles(scene: SceneState | null): LayerToggles {
  const defaults: Record<LayerKey, boolean> = {
    clouds: false, geology: false, dayNight: true, cities: true, atmosphere: true, aurora: true, lights: true,
    quakes: false, plates: false, volcanoes: false,
    satellites: typeof window !== "undefined" && window.innerWidth >= 760, paths: false,
  };
  // Links shared before geographic labels existed keep showing none.
  return { ...(scene ? scene.layers : defaults), geoLabels: scene ? Boolean(scene.layers.geoLabels) : true, trueColor: Boolean(scene?.layers.trueColor), starlink: Boolean(scene?.layers.starlink), solarWind: Boolean(scene?.layers.solarWind), flights: Boolean(scene?.layers.flights), temperature: Boolean(scene?.layers.temperature), shells: Boolean(scene?.options.atmosphereShells) };
}

function initialOptions(scene: SceneState | null): LayerOptions {
  const o = scene?.options;
  return {
    cloudOpacity: o?.cloudOpacity ?? 65,
    opacity: o?.opacity ?? 90,
    mapMode: o?.mapMode ?? "raster",
    ageFilter: o?.ageFilter ?? "all",
    rockFilter: o?.rockFilter ?? "all",
    quakeRange: o?.quakeRange ?? "week",
    shellScale: o?.atmosphereShells || 1,
    satelliteSpeed: 1,
  };
}

export function useLayerSettings(scene: SceneState | null) {
  const [layers, setLayers] = useState(() => initialToggles(scene));
  const [options, setOptions] = useState(() => initialOptions(scene));
  const setLayer = useCallback((key: keyof LayerToggles, value: boolean) => setLayers((current) => ({ ...current, [key]: value })), []);
  const setOption = useCallback(<K extends keyof LayerOptions>(key: K, value: LayerOptions[K]) => setOptions((current) => ({ ...current, [key]: value })), []);
  return { layers, setLayer, options, setOption };
}

/** The shareable subset of the layer toggles. */
export function sceneLayers(layers: LayerToggles): SceneState["layers"] {
  return { ...Object.fromEntries(LAYER_KEYS.map((key) => [key, layers[key]])), geoLabels: layers.geoLabels, trueColor: layers.trueColor, starlink: layers.starlink, solarWind: layers.solarWind, flights: layers.flights, temperature: layers.temperature } as SceneState["layers"];
}
