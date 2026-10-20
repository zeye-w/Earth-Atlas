import { useEffect, useMemo, useRef, useState } from "react";
import { Credit, UrlTemplateImageryProvider, type ImageryLayer, type Viewer } from "cesium";
import { CLOUD_MAX_AGE_MS, CLOUD_REFRESH_MS, cloudFrameAt, cloudTileUrl, fetchCloudCatalog } from "../cloudData";
import { usePolledData } from "../hooks/usePolledData";
import { useTimeSelector } from "../hooks/useTimeline";
import type { TimeController } from "../timeline";

const HOUR = 3_600_000;
// Coarser tiles while the timeline replays: a new frame every second would
// otherwise pull a full set of detailed tiles each time.
const MAX_LEVEL = 5;
const PLAYING_MAX_LEVEL = 3;

export type CloudStatus = "idle" | "loading" | "ready" | "error" | "nodata";

/**
 * SSEC infrared cloud composite, following the timeline: live shows the
 * latest hour, any other moment the hourly frame for it (about 30 days are
 * kept). Every tile of a frame is pinned to the same observed hour. A new
 * frame loads above the old one, which is removed once the globe has
 * finished loading, so replay does not flash.
 */
export function useClouds(viewer: Viewer | null, visible: boolean, opacity: number, timeline: TimeController) {
  const layersRef = useRef<{ layer: ImageryLayer; key: string }[]>([]);
  const opacityRef = useRef(opacity);
  opacityRef.current = opacity;
  const [tileError, setTileError] = useState(false);
  const poll = usePolledData(fetchCloudCatalog, { enabled: visible && viewer !== null, intervalMs: CLOUD_REFRESH_MS, refreshOnVisible: true, keepDataOnError: true });
  const live = useTimeSelector(timeline, (s) => s.live);
  const playing = useTimeSelector(timeline, (s) => s.playing);
  const hour = useTimeSelector(timeline, (s) => Math.floor(s.time / HOUR));

  const frame = useMemo(() => {
    const times = poll.data;
    if (!times || times.length === 0) return null;
    if (live) {
      const latest = times[times.length - 1];
      return Date.now() - latest.getTime() <= CLOUD_MAX_AGE_MS ? latest : null;
    }
    return cloudFrameAt(times, hour * HOUR + HOUR - 1);
  }, [poll.data, live, hour]);

  useEffect(() => {
    if (!viewer) return;
    const clear = () => {
      if (!viewer.isDestroyed()) for (const { layer } of layersRef.current) viewer.imageryLayers.remove(layer, true);
      layersRef.current = [];
      if (!viewer.isDestroyed()) viewer.scene.requestRender();
    };
    if (!visible || !frame) { clear(); return; }
    const maxLevel = playing ? PLAYING_MAX_LEVEL : MAX_LEVEL;
    const key = frame.getTime() + "@" + maxLevel;
    const layers = layersRef.current;
    if (layers.at(-1)?.key === key) return;
    // Keep at most the shown frame plus one loading: replace a frame that
    // has not finished loading yet.
    if (layers.length > 1) {
      const pending = layers.pop()!;
      viewer.imageryLayers.remove(pending.layer, true);
    }
    const provider = new UrlTemplateImageryProvider({
      url: cloudTileUrl(frame), maximumLevel: maxLevel,
      credit: new Credit('<a href="https://www.ssec.wisc.edu/realearth/" target="_blank" rel="noopener noreferrer">Cloud imagery: SSEC / UW–Madison RealEarth</a>'),
    });
    // Fail visibly on tile errors instead of claiming an empty map is clear sky.
    provider.errorEvent.addEventListener(() => {
      if (viewer.isDestroyed() || layersRef.current.at(-1)?.layer.imageryProvider !== provider) return;
      clear();
      setTileError(true);
    });
    const layer = viewer.imageryLayers.addImageryProvider(provider);
    layer.alpha = opacityRef.current / 100;
    layersRef.current = [...layersRef.current, { layer, key }];
    setTileError(false);
    viewer.scene.requestRender();
    if (layersRef.current.length === 1) return;
    // Retire the previous frame once the new one has loaded.
    const removeListener = viewer.scene.postRender.addEventListener(() => {
      if (!viewer.scene.globe.tilesLoaded) return;
      removeListener();
      const current = layersRef.current;
      if (current.at(-1)?.layer !== layer) return;
      for (const old of current.slice(0, -1)) viewer.imageryLayers.remove(old.layer, true);
      layersRef.current = current.slice(-1);
      viewer.scene.requestRender();
    });
    return removeListener;
  }, [viewer, visible, frame, playing]);

  useEffect(() => () => {
    if (viewer && !viewer.isDestroyed()) for (const { layer } of layersRef.current) viewer.imageryLayers.remove(layer, true);
    layersRef.current = [];
  }, [viewer]);

  useEffect(() => {
    for (const { layer } of layersRef.current) layer.alpha = opacity / 100;
    viewer?.scene.requestRender();
  }, [viewer, opacity]);

  const status: CloudStatus = tileError ? "error" : poll.status === "ready" && !frame ? "nodata" : poll.status;
  const time = frame ? frame.toISOString().slice(0, 16).replace("T", " ") + " UTC" : null;
  return { status, time };
}
