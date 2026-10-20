import { useEffect, useRef } from "react";
import { Color, Credit, ImageryLayer, UrlTemplateImageryProvider, type Viewer } from "cesium";
import { TRUE_COLOR_MAX_LEVEL, TRUE_COLOR_SOURCE, trueColorDate, trueColorUrl } from "../trueColorData";
import { useTimeSelector } from "../hooks/useTimeline";
import type { TimeController } from "../timeline";

function createLayer(date: string, show: boolean): ImageryLayer {
  const layer = new ImageryLayer(new UrlTemplateImageryProvider({
    url: trueColorUrl(date),
    maximumLevel: TRUE_COLOR_MAX_LEVEL,
    credit: new Credit('<a href="https://earthdata.nasa.gov/gibs" target="_blank" rel="noopener noreferrer">Daily imagery: NASA GIBS, ' + TRUE_COLOR_SOURCE + ' corrected reflectance</a>'),
  }), {
    // Gaps between orbital swaths and the unlit polar night are black in
    // the mosaic; let the base imagery show through there instead.
    colorToAlpha: Color.BLACK,
    colorToAlphaThreshold: 0.03,
  });
  // A daytime picture: the night side keeps the base imagery and lights.
  layer.nightAlpha = 0;
  layer.show = show;
  return layer;
}

/** Index just above the Blue Marble day layer (or the bundled base globe). */
function insertIndex(viewer: Viewer): number {
  for (let i = 0; i < viewer.imageryLayers.length; i++) {
    const provider = viewer.imageryLayers.get(i).imageryProvider;
    if (provider instanceof UrlTemplateImageryProvider && String(provider.url).includes("BlueMarble") && viewer.imageryLayers.get(i).dayAlpha === 1) return i + 1;
  }
  return Math.min(1, viewer.imageryLayers.length);
}

/**
 * NASA GIBS daily true colour for the timeline's UTC day (yesterday when
 * live, since today's mosaic is still filling in). While replaying the day
 * is held until the replay pauses, so tiles are not refetched every second.
 */
export function useTrueColor(viewer: Viewer | null, visible: boolean, timeline: TimeController) {
  const playing = useTimeSelector(timeline, (state) => state.playing);
  const followed = useTimeSelector(timeline, (state) => trueColorDate(new Date(state.time)));
  const heldRef = useRef(followed);
  if (!playing) heldRef.current = followed;
  const date = heldRef.current;
  const layerRef = useRef<ImageryLayer | null>(null);

  useEffect(() => {
    if (!viewer || !visible) return;
    const layer = createLayer(date, true);
    viewer.imageryLayers.add(layer, insertIndex(viewer));
    layerRef.current = layer;
    viewer.scene.requestRender();
    return () => {
      layerRef.current = null;
      if (!viewer.isDestroyed()) {
        viewer.imageryLayers.remove(layer, true);
        viewer.scene.requestRender();
      }
    };
  }, [viewer, visible, date]);

  return { date, source: TRUE_COLOR_SOURCE };
}
