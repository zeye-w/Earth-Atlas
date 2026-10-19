import { useEffect, useRef, useState } from "react";
import { Cesium3DTileStyle, Credit, MVTDataProvider, UrlTemplateImageryProvider, type ImageryLayer, type Viewer } from "cesium";
import { THEMATIC_MAX_ZOOM, makeThematicStyle, type AgeFilter, type RockFilter, type ThematicMode } from "../mapThematic";

export type VectorState = "idle" | "loading" | "ready" | "error";

/**
 * Macrostrat geology: the carto raster (created on first use) plus the
 * experimental global vector thematic map. The raster stays visible during
 * vector initialization and is the fallback if MVT rendering fails.
 */
export function useGeologyMap(viewer: Viewer | null, options: { visible: boolean; opacity: number; mapMode: ThematicMode; ageFilter: AgeFilter; rockFilter: RockFilter }) {
  const { visible, opacity, mapMode, ageFilter, rockFilter } = options;
  const rasterRef = useRef<ImageryLayer | null>(null);
  const vectorRef = useRef<MVTDataProvider | null>(null);
  const vectorLoadingRef = useRef<Promise<MVTDataProvider> | null>(null);
  const [vectorState, setVectorState] = useState<VectorState>("idle");

  useEffect(() => {
    if (!viewer) return;
    if (visible && !rasterRef.current) {
      rasterRef.current = viewer.imageryLayers.addImageryProvider(new UrlTemplateImageryProvider({
        url: "https://tiles.macrostrat.org/carto/{z}/{x}/{y}.png",
        minimumLevel: 0,
        maximumLevel: 12,
        credit: new Credit('<a href="https://macrostrat.org" target="_blank" rel="noopener noreferrer">Geologic map © Macrostrat / source geological surveys · CC BY 4.0</a>'),
      }));
    }
    if (rasterRef.current) {
      rasterRef.current.show = visible && (mapMode === "raster" || vectorState !== "ready");
      rasterRef.current.alpha = opacity / 100;
    }
    if (vectorRef.current) {
      const active = visible && mapMode !== "raster" && vectorState === "ready";
      vectorRef.current.show = active;
      if (active && vectorRef.current.tileset) {
        vectorRef.current.tileset.style = new Cesium3DTileStyle(makeThematicStyle(mapMode, ageFilter, rockFilter, opacity / 100));
      }
    }
    viewer.scene.requestRender();
  }, [viewer, visible, opacity, mapMode, ageFilter, rockFilter, vectorState]);

  // Cesium's current MVTDataProvider creates its whole tile hierarchy eagerly:
  // keep the global tree at z0..z5 (1,365 nodes). Higher regional detail stays in raster imagery.
  useEffect(() => {
    if (!visible || mapMode === "raster" || !viewer || vectorRef.current) return;
    setVectorState("loading");
    const promise = vectorLoadingRef.current ?? MVTDataProvider.fromUrl("https://tiles.macrostrat.org/carto/{z}/{x}/{y}", {
      minZoom: 0,
      maxZoom: THEMATIC_MAX_ZOOM,
      featureIdProperty: "map_id",
    });
    vectorLoadingRef.current = promise;
    void promise.then((provider) => {
      if (viewer.isDestroyed()) return;
      if (!vectorRef.current) {
        viewer.scene.primitives.add(provider);
        vectorRef.current = provider;
      }
      setVectorState("ready"); // also synchronize if mode changed during async initialization
    }).catch((error: unknown) => {
      vectorLoadingRef.current = null;
      console.warn("Vector thematic map unavailable; keeping raster fallback.", error);
      if (!viewer.isDestroyed()) setVectorState("error");
    });
  }, [viewer, mapMode, visible]);

  useEffect(() => () => {
    rasterRef.current = null;
    vectorRef.current = null;
    vectorLoadingRef.current = null;
  }, [viewer]);

  return vectorState;
}
