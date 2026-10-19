import { useCallback, useState } from "react";
import { LAYER_KEYS, type LayerKey, type SceneState } from "../sceneState";
import type { AtmosphereScale } from "../atmosphereLayers";
import type { QuakeRange } from "../earthquakeData";
import type { AgeFilter, RockFilter, ThematicMode } from "../mapThematic";
import type { SatelliteSpeed } from "../satelliteOverlay";

/** Every layer toggle: the shareable scene keys plus the atmosphere shells. */
export type LayerToggles = Record<LayerKey, boolean> & { shells: boolean };

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
    satellites: typeof window !== "undefined" && window.innerWidth >= 760, paths: true,
  };
  return { ...(scene ? scene.layers : defaults), shells: Boolean(scene?.options.atmosphereShells) };
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
  return Object.fromEntries(LAYER_KEYS.map((key) => [key, layers[key]])) as SceneState["layers"];
}
