import { useEffect, useRef, useState } from "react";
import { Credit, UrlTemplateImageryProvider, type ImageryLayer, type Viewer } from "cesium";
import { CLOUD_MAX_AGE_MS, CLOUD_REFRESH_MS, cloudTileUrl, fetchCloudObservation } from "../cloudData";
import { usePolledData } from "../hooks/usePolledData";

/**
 * SSEC infrared cloud composite. Every tile is pinned to the same observed
 * hour; latest tiles are never mixed across hours.
 */
export function useClouds(viewer: Viewer | null, visible: boolean, opacity: number) {
  const layerRef = useRef<ImageryLayer | null>(null);
  const shownRef = useRef(0);
  const opacityRef = useRef(opacity);
  opacityRef.current = opacity;
  const [tileError, setTileError] = useState(false);
  const poll = usePolledData(fetchCloudObservation, { enabled: visible && viewer !== null, intervalMs: CLOUD_REFRESH_MS, refreshOnVisible: true, keepDataOnError: true });

  useEffect(() => {
    if (!viewer) return;
    const clear = () => {
      if (layerRef.current && !viewer.isDestroyed()) viewer.imageryLayers.remove(layerRef.current, true);
      layerRef.current = null;
      shownRef.current = 0;
      if (!viewer.isDestroyed()) viewer.scene.requestRender();
    };
    const observation = poll.data;
    if (!visible || !observation) {
      if (!visible) clear();
      return;
    }
    if (poll.status === "error" && Date.now() - observation.getTime() > CLOUD_MAX_AGE_MS) {
      clear();
      return;
    }
    if (observation.getTime() === shownRef.current && layerRef.current) return;
    const provider = new UrlTemplateImageryProvider({
      url: cloudTileUrl(observation), maximumLevel: 5,
      credit: new Credit('<a href="https://www.ssec.wisc.edu/realearth/" target="_blank" rel="noopener noreferrer">Cloud imagery: SSEC / UW–Madison RealEarth</a>'),
    });
    // Fail visibly on tile errors instead of claiming an empty map is clear sky.
    provider.errorEvent.addEventListener(() => {
      if (viewer.isDestroyed() || layerRef.current?.imageryProvider !== provider) return;
      clear();
      setTileError(true);
    });
    clear();
    const layer = viewer.imageryLayers.addImageryProvider(provider);
    layer.alpha = opacityRef.current / 100;
    layerRef.current = layer;
    shownRef.current = observation.getTime();
    setTileError(false);
    viewer.scene.requestRender();
  }, [viewer, visible, poll.data, poll.status]);

  useEffect(() => () => {
    if (viewer && layerRef.current && !viewer.isDestroyed()) viewer.imageryLayers.remove(layerRef.current, true);
    layerRef.current = null;
  }, [viewer]);

  useEffect(() => {
    if (layerRef.current) layerRef.current.alpha = opacity / 100;
    viewer?.scene.requestRender();
  }, [viewer, opacity]);

  const status = tileError ? "error" : poll.status;
  const time = poll.data ? poll.data.toISOString().slice(0, 16).replace("T", " ") + " UTC" : null;
  return { status, time };
}
