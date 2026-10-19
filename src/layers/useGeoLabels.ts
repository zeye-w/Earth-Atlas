import type { Viewer } from "cesium";
import { loadGeoLabels } from "../geoLabelData";
import { useLazyOverlay } from "./useLazyOverlay";

/** Bundled ocean, sea, strait and mountain-range names, loaded on first use. */
export function useGeoLabels(viewer: Viewer | null, visible: boolean) {
  return useLazyOverlay(viewer, visible, async (v) => {
    const [labels, module] = await Promise.all([loadGeoLabels(), import("../geoLabels")]);
    return { overlay: new module.GeoLabelOverlay(v, labels), result: labels.length };
  }, "Geographic labels").status;
}
