import type { Viewer } from "cesium";
import { buildMovie, keyPhotoTime, newContentIdentifier, pairJpeg, type EncodedSample, type EncodedVideo } from "./livePhotoFormat";

export interface SceneClip extends EncodedVideo {
  codec: string;
  frames: number;
  /** Seconds covered by the frames. */
  elapsed: number;
  /** MP4 of the clip, for the preview and "save clip". */
  preview: Blob;
}

const CLIP_SECONDS = 3;
const FPS = 30;
const BITRATE = 8_000_000;
// Baseline has no B-frames, so decode order is presentation order (what the
// movie writer expects); level 4.0 covers the 1280-pixel capture.
const CODECS = ["avc1.420028", "avc1.4d0028", "avc1.640028"];

function encoderConfig(codec: string, width: number, height: number): VideoEncoderConfig {
  return { codec, width, height, bitrate: BITRATE, framerate: FPS, avc: { format: "avc" }, latencyMode: "realtime" };
}

function copyBytes(source: AllowSharedBufferSource): Uint8Array {
  return ArrayBuffer.isView(source)
    ? new Uint8Array(source.buffer, source.byteOffset, source.byteLength).slice()
    : new Uint8Array(source).slice();
}

/** First H.264 configuration this browser can encode and decode, or null (no WebCodecs / no H.264). */
export async function supportedCodec(width = 1280, height = 720): Promise<string | null> {
  if (typeof VideoEncoder === "undefined" || typeof VideoDecoder === "undefined" || typeof VideoFrame === "undefined") return null;
  for (const codec of CODECS) {
    try {
      const encode = await VideoEncoder.isConfigSupported(encoderConfig(codec, width, height));
      const decode = await VideoDecoder.isConfigSupported({ codec, codedWidth: width, codedHeight: height });
      if (encode.supported && decode.supported) return codec;
    } catch { /* try the next profile */ }
  }
  return null;
}

/**
 * Record ~3 s of the globe straight into H.264 (WebCodecs). Pixels are copied
 * in postRender, before WebGL clears its buffer, so ordinary browsing keeps
 * preserveDrawingBuffer off. The data attribution is drawn under the picture.
 */
export function captureScene(viewer: Viewer, orbit: boolean, signal: AbortSignal, progress: (value: number) => void): Promise<SceneClip> {
  return new Promise((resolve, reject) => {
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
    canvas.height = Math.ceil((pictureHeight + (lines.length + 1) * (fontSize + 3)) / 2) * 2;
    const camera = viewer.camera;
    const original = { destination: camera.positionWC.clone(), orientation: { direction: camera.directionWC.clone(), up: camera.upWC.clone() } };
    const controller = viewer.scene.screenSpaceCameraController;
    const inputs = controller.enableInputs;
    let encoder: VideoEncoder | undefined;
    let removePostRender: (() => void) | undefined;
    let raf = 0, timer = 0, encoded = 0, started = 0, previous = 0, lastProgress = 0, lastFrame = -Infinity, settled = false, stopping = false;
    let codec = "";
    let description: Uint8Array | null = null;
    const samples: EncodedSample[] = [];
    const cleanup = () => {
      cancelAnimationFrame(raf); clearTimeout(timer); removePostRender?.();
      signal.removeEventListener("abort", abort); document.removeEventListener("visibilitychange", visibility);
      if (encoder && encoder.state !== "closed") encoder.close();
      if (!viewer.isDestroyed()) { controller.enableInputs = inputs; if (orbit) camera.setView(original); viewer.scene.requestRender(); }
    };
    const fail = (error: Error) => { if (settled) return; settled = true; cleanup(); reject(error); };
    const abort = () => fail(Error("已取消录制"));
    const visibility = () => { if (document.hidden) fail(Error("页面进入后台，录制已取消，请保持页面可见后重录")); };
    const finish = async () => {
      if (stopping || settled) return;
      stopping = true;
      removePostRender?.(); removePostRender = undefined;
      try {
        await encoder!.flush();
        if (settled) return;
        if (samples.length < 15 || !description) { fail(Error("录制画面不足，请降低画质后重录")); return; }
        const video: EncodedVideo = { width: canvas.width, height: canvas.height, description, samples };
        const preview = new Blob([buildMovie(video, { container: "mp4" }) as BlobPart], { type: "video/mp4" });
        const elapsed = (samples[samples.length - 1].time - samples[0].time) / 1_000_000 + 1 / FPS;
        settled = true; cleanup();
        resolve({ ...video, codec, frames: samples.length, elapsed, preview });
      } catch (error) { fail(error instanceof Error ? error : Error(String(error))); }
    };
    void (async () => {
      try {
        if (signal.aborted) { fail(Error("已取消录制")); return; }
        signal.addEventListener("abort", abort, { once: true });
        document.addEventListener("visibilitychange", visibility);
        codec = (await supportedCodec(canvas.width, canvas.height)) ?? "";
        if (settled) return;
        if (!codec) { fail(Error("当前浏览器不支持 H.264 视频编码（WebCodecs），请使用最新版 Safari 或 Chrome")); return; }
        encoder = new VideoEncoder({
          output: (chunk, metadata) => {
            const config = metadata?.decoderConfig?.description;
            if (config && !description) description = copyBytes(config);
            const data = new Uint8Array(chunk.byteLength);
            chunk.copyTo(data);
            samples.push({ data, time: chunk.timestamp, key: chunk.type === "key" });
          },
          error: (error) => fail(Error("视频编码失败：" + error.message)),
        });
        encoder.configure(encoderConfig(codec, canvas.width, canvas.height));
        camera.cancelFlight(); if (orbit) controller.enableInputs = false;
        removePostRender = viewer.scene.postRender.addEventListener(() => {
          if (settled || stopping || !encoder) return;
          const now = performance.now();
          if (!started) { started = previous = now; clearTimeout(timer); }
          // At most 30 frames per second; skip frames while the encoder is behind.
          if (now - lastFrame < 1000 / FPS - 2 || encoder.encodeQueueSize > 4) return;
          try {
            context.fillStyle = "#05070b"; context.fillRect(0, 0, canvas.width, canvas.height);
            context.drawImage(source, 0, 0, canvas.width, pictureHeight);
            context.font = `${fontSize}px sans-serif`; context.fillStyle = "#d5d9e2";
            lines.forEach((text, i) => context.fillText(text, 10, pictureHeight + (i + 1) * (fontSize + 3)));
            const frame = new VideoFrame(canvas, { timestamp: Math.round((now - started) * 1000) });
            encoder.encode(frame, { keyFrame: encoded++ % 15 === 0 });
            frame.close();
            lastFrame = now;
          } catch { fail(Error("画面无法录制，可能有跨域图层或浏览器限制，请关闭相关图层后重试")); }
        });
        const tick = (now: number) => {
          if (settled || viewer.isDestroyed()) { if (!settled) fail(Error("地球视图已关闭")); return; }
          if (started) {
            const elapsed = (now - started) / 1000;
            if (now - lastProgress > 100) { progress(Math.min(1, elapsed / CLIP_SECONDS)); lastProgress = now; }
            if (orbit) camera.rotateRight(Math.min((now - previous) / 1000, .1) * Math.PI / 180 * 2);
            previous = now;
            if (elapsed >= CLIP_SECONDS) { void finish(); return; }
          }
          viewer.scene.requestRender(); raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        // Bound the wait for the first postRender callback.
        timer = window.setTimeout(() => fail(Error("等待地球画面超时，请重试")), 15_000);
      } catch (error) { fail(error instanceof Error ? error : Error(String(error))); }
    })();
  });
}

/** Decode the clip up to `index` and return that frame as a JPEG. */
export async function frameJpeg(clip: SceneClip, index: number): Promise<Uint8Array> {
  const target = clip.samples[index];
  let start = index;
  while (start > 0 && !clip.samples[start].key) start--;
  const canvas = document.createElement("canvas");
  canvas.width = clip.width; canvas.height = clip.height;
  let drawn = false;
  let failure: Error | null = null;
  const decoder = new VideoDecoder({
    output: (frame) => {
      if (frame.timestamp === target.time) { canvas.getContext("2d")!.drawImage(frame, 0, 0, clip.width, clip.height); drawn = true; }
      frame.close();
    },
    error: (error) => { failure = Error("封面解码失败：" + error.message); },
  });
  try {
    decoder.configure({ codec: clip.codec, codedWidth: clip.width, codedHeight: clip.height, description: clip.description });
    for (let i = start; i <= index; i++) {
      const sample = clip.samples[i];
      decoder.decode(new EncodedVideoChunk({ type: sample.key ? "key" : "delta", timestamp: sample.time, data: sample.data }));
    }
    await decoder.flush();
  } finally {
    if (decoder.state !== "closed") decoder.close();
  }
  if (failure) throw failure;
  if (!drawn) throw Error("未能取得封面帧，请重新选择封面");
  const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, "image/jpeg", 0.92));
  if (!blob) throw Error("封面编码失败");
  return new Uint8Array(await blob.arrayBuffer());
}

export interface LivePhotoPair {
  identifier: string;
  coverTime: number;
  photo: File;
  movie: File;
}

/** The paired key photo and movie for the frame chosen as cover. */
export async function buildLivePhoto(clip: SceneClip, keyFrame: number): Promise<LivePhotoPair> {
  const identifier = newContentIdentifier();
  const jpeg = pairJpeg(await frameJpeg(clip, keyFrame), identifier);
  const movie = buildMovie(clip, { container: "mov", live: { identifier, keyFrame } });
  return {
    identifier,
    coverTime: keyPhotoTime(clip.samples, keyFrame),
    photo: new File([jpeg as BlobPart], "TERRASCOPE.JPG", { type: "image/jpeg" }),
    movie: new File([movie as BlobPart], "TERRASCOPE.MOV", { type: "video/quicktime" }),
  };
}

export function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob), link = document.createElement("a");
  link.href = url; link.download = name; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
