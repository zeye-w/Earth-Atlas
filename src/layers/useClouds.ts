import { useEffect, useMemo, useRef, useState } from "react";
import { Credit, UrlTemplateImageryProvider, type ImageryLayer, type Viewer } from "cesium";
import { CLOUD_MAX_AGE_MS, CLOUD_REFRESH_MS, cloudBlend, cloudFrameAt, cloudTileUrl, fetchCloudCatalog } from "../cloudData";
import { usePolledData } from "../hooks/usePolledData";
import { useTimeSelector } from "../hooks/useTimeline";
import { beginWork } from "../pendingWork";
import type { TimeController } from "../timeline";

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
  const [displayedTime, setDisplayedTime] = useState<number | null>(null);
  const [tilesLoading, setTilesLoading] = useState(false);
  const poll = usePolledData(fetchCloudCatalog, { enabled: visible && viewer !== null, intervalMs: CLOUD_REFRESH_MS, refreshOnVisible: true, keepDataOnError: true });
  const live = useTimeSelector(timeline, (s) => s.live);
  const playing = useTimeSelector(timeline, (s) => s.playing);
  const selectedTime = useTimeSelector(timeline, (s) => cloudFrameAt(poll.data ?? [], s.time)?.getTime() ?? null);
  const minute = useTimeSelector(timeline, (s) => Math.floor(s.time / 60_000));

  const frameTimestamp = useMemo(() => {
    const times = poll.data;
    if (!times || times.length === 0) return null;
    if (live) {
      const latest = times[times.length - 1];
      return Date.now() - latest.getTime() <= CLOUD_MAX_AGE_MS ? latest.getTime() : null;
    }
    return selectedTime;
  }, [poll.data, live, selectedTime, minute]);
  const frame = useMemo(() => frameTimestamp === null ? null : new Date(frameTimestamp), [frameTimestamp]);

  useEffect(() => {
    if (!viewer) return;
    const clear = () => {
      if (!viewer.isDestroyed()) for (const { layer } of layersRef.current) viewer.imageryLayers.remove(layer, true);
      layersRef.current = [];
      if (!viewer.isDestroyed()) viewer.scene.requestRender();
    };
    if (!visible || !frame) { clear(); setDisplayedTime(null); setTilesLoading(false); setTileError(false); return; }
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
    const layer = viewer.imageryLayers.addImageryProvider(provider);
    // Gentle display contrast only; retain original infrared pixels and alpha.
    layer.contrast = 1.12;
    layer.gamma = 0.95;
    const previous = layersRef.current.at(-1)?.layer;
    const applyOpacity = () => {
      const blend = cloudBlend(opacityRef.current, Boolean(previous));
      layer.alpha = previous ? blend.incoming : blend.shown;
      if (previous && !previous.isDestroyed()) previous.alpha = blend.shown;
    };
    applyOpacity();
    layersRef.current = [...layersRef.current, { layer, key }];
    setTileError(false);
    setTilesLoading(true);
    const done = beginWork();
    let active = true;
    let removeListener = () => {};
    const retire = () => { active = false; removeListener(); window.clearTimeout(timer); done(); };
    const fail = () => {
      if (!active || viewer.isDestroyed()) return;
      retire();
      if (layersRef.current.at(-1)?.layer !== layer) return;
      viewer.imageryLayers.remove(layer, true);
      layersRef.current = layersRef.current.filter(item => item.layer !== layer);
      if (previous && !previous.isDestroyed()) previous.alpha = opacityRef.current / 100;
      setTileError(true);
      setTilesLoading(false);
      viewer.scene.requestRender();
    };
    const removeError = provider.errorEvent.addEventListener(fail);
    const timer = window.setTimeout(fail, 60_000);
    removeListener = viewer.scene.postRender.addEventListener(() => {
      if (!active || !viewer.scene.globe.tilesLoaded) return;
      retire();
      if (layersRef.current.at(-1)?.layer !== layer) return;
      const current = layersRef.current;
      layer.alpha = opacityRef.current / 100;
      for (const old of current.slice(0, -1)) viewer.imageryLayers.remove(old.layer, true);
      layersRef.current = current.slice(-1);
      setDisplayedTime(frame.getTime());
      setTilesLoading(false);
      viewer.scene.requestRender();
    });
    viewer.scene.requestRender();
    return () => { retire(); removeError(); };

  }, [viewer, visible, frame, playing]);

  useEffect(() => () => {
    if (viewer && !viewer.isDestroyed()) for (const { layer } of layersRef.current) viewer.imageryLayers.remove(layer, true);
    layersRef.current = [];
  }, [viewer]);

  useEffect(() => {
    const layers = layersRef.current;
    const blend = cloudBlend(opacity, layers.length > 1);
    layers.forEach(({ layer }, index) => { layer.alpha = index === 0 ? blend.shown : blend.incoming; });
    viewer?.scene.requestRender();
  }, [viewer, opacity]);

  const status: CloudStatus = tileError ? "error" : tilesLoading ? "loading" : poll.status === "ready" && !frame ? "nodata" : poll.status;
  const time = displayedTime !== null ? new Date(displayedTime).toISOString().slice(0, 16).replace("T", " ") + " UTC" : null;
  return { status, time };
}
