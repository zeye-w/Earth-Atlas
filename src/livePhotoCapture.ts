import type { Viewer } from "cesium";

export interface SceneClip { blob: Blob; frames: number; elapsed: number; width: number; height: number }
export function recordingMime(): string | null {
  if (typeof MediaRecorder === "undefined" || !HTMLCanvasElement.prototype.captureStream) return null;
  return ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/mp4"].find(type => MediaRecorder.isTypeSupported(type)) ?? null;
}

/** Copy pixels in postRender, before WebGL clears its drawing buffer. No
 * preserveDrawingBuffer cost is imposed on ordinary browsing. */
export function captureScene(viewer: Viewer, orbit: boolean, signal: AbortSignal, progress: (value: number) => void): Promise<SceneClip> {
  return new Promise((resolve, reject) => {
    const mimeType = recordingMime();
    if (!mimeType) { reject(Error("当前浏览器不支持画面录制，请使用支持 Canvas 录制的桌面浏览器")); return; }
    if (viewer.isDestroyed() || !viewer.scene.globe.tilesLoaded) { reject(Error("地球画面仍在加载，请等画面稳定后再录制")); return; }
    const source = viewer.canvas;
    const scale = Math.min(1, 1280 / Math.max(source.width, source.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(2, Math.floor(source.width * scale / 2) * 2);
    const pictureHeight = Math.max(2, Math.floor(source.height * scale / 2) * 2);
    const fontSize = Math.max(10, Math.round(canvas.width / 100));
    const attribution = Array.from(document.querySelectorAll(".globe-attribution, .cesium-credit-textContainer, .cesium-credit-logoContainer")).map(e => e.textContent?.trim()).filter(Boolean).join(" · ");
    if (!attribution) { reject(Error("未读取到数据署名，请待地球加载完成后重试")); return; }
    const context = canvas.getContext("2d")!;
    context.font = `${fontSize}px sans-serif`;
    const lines: string[] = []; let line = "";
    for (const word of ("TerraScope · Cesium · " + attribution).split(/\s+/)) {
      const next = line ? line + " " + word : word;
      if (context.measureText(next).width > canvas.width - 20 && line) { lines.push(line); line = word; } else line = next;
    }
    if (line) lines.push(line);
    canvas.height = pictureHeight + (lines.length + 1) * (fontSize + 3);
    const camera = viewer.camera;
    const original = { destination: camera.positionWC.clone(), orientation: { direction: camera.directionWC.clone(), up: camera.upWC.clone() } };
    const controller = viewer.scene.screenSpaceCameraController;
    const inputs = controller.enableInputs;
    let stream: MediaStream | undefined, recorder: MediaRecorder | undefined;
    let removePostRender: (() => void) | undefined;
    let raf = 0, timer = 0, frames = 0, started = 0, previous = 0, lastProgress = 0, settled = false;
    const chunks: Blob[] = [];
    const cleanup = () => {
      cancelAnimationFrame(raf); clearTimeout(timer); removePostRender?.();
      signal.removeEventListener("abort", abort); document.removeEventListener("visibilitychange", visibility);
      if (recorder && recorder.state !== "inactive") recorder.stop();
      stream?.getTracks().forEach(track => track.stop());
      if (!viewer.isDestroyed()) {controller.enableInputs = inputs; if (orbit) camera.setView(original); viewer.scene.requestRender();}
    };
    const fail = (error: Error) => { if (settled) return; settled = true; cleanup(); reject(error); };
    const abort = () => fail(Error("已取消录制"));
    const visibility = () => { if (document.hidden) fail(Error("页面进入后台，录制已取消，请保持页面可见后重录")); };
    try {
      if (signal.aborted) { reject(Error("已取消录制")); return; }
      signal.addEventListener("abort", abort, {once: true});
      document.addEventListener("visibilitychange", visibility);
      camera.cancelFlight(); if (orbit) controller.enableInputs = false;
      removePostRender = viewer.scene.postRender.addEventListener(() => {
        try {
          context.fillStyle = "#05070b"; context.fillRect(0, 0, canvas.width, canvas.height);
          context.drawImage(source, 0, 0, canvas.width, pictureHeight);
          context.font = `${fontSize}px sans-serif`; context.fillStyle = "#d5d9e2";
          lines.forEach((text, i) => context.fillText(text, 10, pictureHeight + (i + 1) * (fontSize + 3)));
          if (!recorder) {
            stream = canvas.captureStream(30);
            recorder = new MediaRecorder(stream, {mimeType, videoBitsPerSecond: 8_000_000});
            recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
            recorder.onerror = () => fail(Error("浏览器录制失败，请降低画质后重试"));
            recorder.onstop = () => {
              if (settled) return;
              const elapsed = (performance.now() - started) / 1000;
              const blob = new Blob(chunks, {type: recorder!.mimeType});
              if (frames < 15 || blob.size < 1000) {fail(Error("录制画面不足，请降低画质后重试")); return;}
              settled = true; cleanup(); resolve({blob, frames, elapsed, width: canvas.width, height: canvas.height});
            };
            started = previous = performance.now(); recorder.start(200);
            clearTimeout(timer);
            timer = window.setTimeout(() => recorder?.state === "recording" && recorder.stop(), 3000);
          }
          frames++;
        } catch { fail(Error("画面无法录制，可能有跨域图层或浏览器限制，请关闭相关图层后重试")); }
      });
      const tick = (now: number) => {
        if (settled || viewer.isDestroyed()) {if (!settled) fail(Error("地球视图已关闭")); return;}
        if (started) {
          const elapsed = Math.min(3, (now - started) / 1000);
          if (now - lastProgress > 100) {progress(elapsed / 3); lastProgress = now;}
          if (orbit) camera.rotateRight(Math.min((now - previous) / 1000, .1) * Math.PI / 180 * 2);
          previous = now;
        }
        viewer.scene.requestRender(); raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      // Also bound the wait for the first postRender callback.
      timer = window.setTimeout(() => fail(Error("等待地球画面超时，请重试")), 15_000);
    } catch (error) { fail(error instanceof Error ? error : Error(String(error))); }
  });
}

export function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob), link = document.createElement("a");
  link.href = url; link.download = name; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
