import type { Viewer } from "cesium";
import { isRecentlyActive, loadVolcanoCatalog, type Volcano } from "../volcanoData";
import { useLazyOverlay } from "./useLazyOverlay";

/** Bundled PB2002 plate boundaries, loaded on first use. */
export function usePlateBoundaries(viewer: Viewer | null, visible: boolean) {
  const state = useLazyOverlay(viewer, visible, async (v) => {
    const module = await import("../plateBoundaries");
    const boundaries = await module.loadPlateBoundaries();
    return { overlay: new module.PlateBoundaryOverlay(v, boundaries), result: null };
  }, "Plate boundaries");
  return state.status;
}

export interface VolcanoInfo {
  total: number;
  recent: number;
  retrieved: string;
  byId: Map<string, Volcano>;
}

/** Bundled Smithsonian GVP Holocene volcano list, loaded on first use. */
export function useVolcanoes(viewer: Viewer | null, visible: boolean) {
  return useLazyOverlay<import("../volcanoes").VolcanoOverlay, VolcanoInfo>(viewer, visible, async (v) => {
    const [catalog, module] = await Promise.all([loadVolcanoCatalog(), import("../volcanoes")]);
    return {
      overlay: new module.VolcanoOverlay(v, catalog.volcanoes),
      result: {
        total: catalog.volcanoes.length,
        recent: catalog.volcanoes.filter((volcano) => isRecentlyActive(volcano)).length,
        retrieved: catalog.retrieved,
        byId: new Map(catalog.volcanoes.map((volcano) => [String(volcano.id ?? volcano.name), volcano])),
      },
    };
  }, "Volcano catalogue");
}
