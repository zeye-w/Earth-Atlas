import { useEffect, useRef, useState } from "react";
import type { Viewer } from "cesium";
import { AUTO_QUALITY_MIN_FPS, FrameRateMonitor, initialRenderQuality, lowerRenderQuality, renderSettings, type RenderQuality } from "../performance";

function applyRenderQuality(viewer: Viewer, quality: RenderQuality, moving = false) {
  const settings = renderSettings(quality, window.devicePixelRatio, moving);
  viewer.resolutionScale = settings.resolutionScale;
  viewer.targetFrameRate = settings.targetFrameRate;
  viewer.scene.globe.maximumScreenSpaceError = settings.maximumScreenSpaceError;
  viewer.scene.postProcessStages.fxaa.enabled = settings.fxaa;
  viewer.scene.requestRender();
}

/**
 * Render quality (resolution / frame budget) plus automatic downgrade: while
 * the camera moves Cesium renders every frame up to its target rate, so a
 * sustained low rate there means the device is struggling; step down one
 * level, at most every 6 s.
 */
/**
 * `holdQuality` keeps the automatic downgrade from acting (frame-rate dips
 * during a show, e.g. a one-off shader compile, must not lower the quality
 * for the rest of the session) without changing the render settings.
 */
export function useRenderQuality(viewer: Viewer | null, onAutoDowngrade: (quality: RenderQuality, fps: number) => void, suspendAuto = false, holdQuality = false) {
  const [quality, setQuality] = useState<RenderQuality>(() => typeof window === "undefined" ? "balanced" : initialRenderQuality(window.innerWidth, window.matchMedia("(prefers-reduced-motion: reduce)").matches, navigator.hardwareConcurrency));
  const [autoQuality, setAutoQuality] = useState(true);
  const qualityRef = useRef(quality);
  const autoRef = useRef(autoQuality);
  const notifyRef = useRef(onAutoDowngrade);
  const suspendRef = useRef(suspendAuto);
  suspendRef.current = suspendAuto || holdQuality;
  qualityRef.current = quality;
  autoRef.current = autoQuality;
  notifyRef.current = onAutoDowngrade;

  // Change render budget without recreating the WebGL context; re-apply on
  // resize, which also fires when the window moves to a screen with a
  // different pixel ratio or the page is zoomed.
  useEffect(() => {
    if (!viewer) return;
    let moving = false;
    let settleTimer = 0;
    let resizeFrame = 0;
    const apply = () => {
      if (!viewer.isDestroyed()) applyRenderQuality(viewer, quality, moving && autoQuality && !suspendAuto);
    };
    apply();
    const removeStart = viewer.camera.moveStart.addEventListener(() => {
      window.clearTimeout(settleTimer); moving = true; apply();
    });
    const removeEnd = viewer.camera.moveEnd.addEventListener(() => {
      window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(() => { moving = false; apply(); }, 180);
    });
    const onResize = () => {
      if (resizeFrame) return;
      resizeFrame = requestAnimationFrame(() => { resizeFrame = 0; apply(); });
    };
    window.addEventListener("resize", onResize);
    return () => {
      removeStart(); removeEnd(); window.clearTimeout(settleTimer);
      cancelAnimationFrame(resizeFrame); window.removeEventListener("resize", onResize);
    };
  }, [viewer, quality, autoQuality, suspendAuto]);

  // Stop Cesium's update loop as well as rendering when this tab is hidden.
  // Recording/capture keeps its own fixed clock and rendering requirements.
  useEffect(() => {
    if (!viewer || suspendAuto) return;
    const original = viewer.useDefaultRenderLoop;
    const update = () => {
      if (viewer.isDestroyed()) return;
      viewer.useDefaultRenderLoop = document.visibilityState === "visible" && original;
      if (viewer.useDefaultRenderLoop) viewer.scene.requestRender();
    };
    document.addEventListener("visibilitychange", update); update();
    return () => {
      document.removeEventListener("visibilitychange", update);
      if (!viewer.isDestroyed()) { viewer.useDefaultRenderLoop = original; viewer.scene.requestRender(); }
    };
  }, [viewer, suspendAuto]);

  useEffect(() => {
    if (!viewer) return;
    const monitor = new FrameRateMonitor();
    let moving = false;
    let lastChange = 0;
    const removers = [
      viewer.camera.moveStart.addEventListener(() => { moving = true; monitor.reset(); }),
      viewer.camera.moveEnd.addEventListener(() => { moving = false; }),
      viewer.scene.postRender.addEventListener(() => {
        if (suspendRef.current) {monitor.reset(); return;}
        if (!moving || !autoRef.current) return;
        const now = performance.now();
        const fps = monitor.addFrame(now);
        if (fps === null || fps >= AUTO_QUALITY_MIN_FPS || now - lastChange < 6_000) return;
        const lower = lowerRenderQuality(qualityRef.current);
        if (!lower) return;
        lastChange = now;
        monitor.reset();
        setQuality(lower);
        notifyRef.current(lower, fps);
      }),
    ];
    return () => removers.forEach((remove) => remove());
  }, [viewer]);

  /** A manual choice turns automatic adjustment off. */
  const chooseQuality = (next: RenderQuality) => {
    setQuality(next);
    setAutoQuality(false);
  };

  return { quality, chooseQuality, autoQuality, setAutoQuality };
}
