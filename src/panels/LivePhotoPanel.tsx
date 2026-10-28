import { t } from "../i18n";
import {useEffect, useRef, useState} from "react";
import type {Viewer} from "cesium";
import {Circle, Download, Share, X} from "lucide-react";
import {strToU8, zipSync} from "fflate";
import {buildLivePhoto, captureScene, saveBlob, supportedCodec, type LivePhotoPair, type SceneClip} from "../livePhotoCapture";
import {frameAt, keyPhotoTime} from "../livePhotoFormat";
import "./livePhoto.css";

const GUIDE = `TerraScope 实况图（Live Photo）

TERRASCOPE.JPG + TERRASCOPE.MOV 是同一张实况图的两半，靠相同的内容标识配对。请两个文件一起导入，不要改名后分开转发，也不要经聊天软件压缩。

iPhone：在 Safari 中点「存到照片」，在分享菜单里选「存储 2 项」。如果相册里显示为一张照片加一段视频（没有 LIVE 标识），说明这台设备没有自动配对，请改用下面的方法。
Mac：把两个文件一起拖进「照片」App，会合并为一张实况图，再通过 iCloud 照片同步到 iPhone。

画面是网站当前的渲染，不是相机拍摄；数据署名保留在画面下方，没有写入相机型号或位置。
`;

interface Props {viewer: Viewer | null; allowOrbit: boolean; getScene: () => Record<string, unknown>; onClose: () => void; onRecordingChange: (recording: boolean) => void}
export default function LivePhotoPanel({viewer, allowOrbit, getScene, onClose, onRecordingChange}: Props) {
  const [phase, setPhase] = useState<"idle" | "recording" | "preview" | "exporting">("idle");
  const [orbit, setOrbit] = useState(true), [progress, setProgress] = useState(0), [cover, setCover] = useState(1.5);
  const [clip, setClip] = useState<SceneClip | null>(null), [url, setUrl] = useState<string | null>(null);
  const [pair, setPair] = useState<LivePhotoPair | null>(null);
  const [error, setError] = useState<string | null>(null), [support, setSupport] = useState<"checking" | "yes" | "no">("checking");
  const video = useRef<HTMLVideoElement>(null), panel = useRef<HTMLElement>(null);
  const controller = useRef<AbortController | null>(null), scene = useRef<Record<string, unknown>>({});
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null; panel.current?.focus();
    let active = true;
    void supportedCodec().then(codec => {if (active) setSupport(codec ? "yes" : "no");});
    const close = (event: KeyboardEvent) => {if (event.key === "Escape") onClose();};
    document.addEventListener("keydown", close);
    return () => {active = false; controller.current?.abort(); document.removeEventListener("keydown", close); previous?.focus();};
  }, [onClose]);
  useEffect(() => {if (!clip) {setUrl(null); return;} const value = URL.createObjectURL(clip.preview); setUrl(value); return () => URL.revokeObjectURL(value);}, [clip]);

  const keyFrame = clip ? frameAt(clip.samples, cover) : 0;
  const coverTime = clip ? keyPhotoTime(clip.samples, keyFrame) : cover;

  const record = async () => {
    if (!viewer) return;
    if (Array.from(document.querySelectorAll(".thematic-note,.layer-status,.satellite-status")).some(e => /加载失败|暂不可用|正在读取|Failed to load|unavailable|Loading/i.test(e.textContent ?? ""))) {
      setError("当前有图层尚未就绪，请等待加载完成或关闭失败图层后重试"); return;
    }
    controller.current?.abort(); const abort = new AbortController(); controller.current = abort;
    setError(null); setProgress(0); setPhase("recording"); setPair(null);
    onRecordingChange(true);
    scene.current = {capturedAt: new Date().toISOString(), ...getScene(), cameraMotion: orbit && allowOrbit ? "slow-orbit" : "manual-or-fixed"};
    try {
      const result = await captureScene(viewer, orbit && allowOrbit, abort.signal, setProgress);
      if (!abort.signal.aborted) {setClip(result); setCover(Math.min(1.5, Math.max(.1, result.elapsed / 2))); setPhase("preview");}
    } catch (e) {if (!abort.signal.aborted) {setError(String((e as Error).message)); setPhase(clip ? "preview" : "idle");}}
    finally {onRecordingChange(false);}
  };
  const chooseCover = (value: number) => {
    setCover(value); setPair(null);
    if (video.current && clip) {video.current.pause(); video.current.currentTime = keyPhotoTime(clip.samples, frameAt(clip.samples, value)) + .001;}
  };
  const generate = async () => {
    if (!clip) return;
    setError(null); setPhase("exporting");
    try {setPair(await buildLivePhoto(clip, keyFrame));}
    catch (e) {setError("实况图生成失败：" + String((e as Error).message));}
    finally {setPhase("preview");}
  };
  const files = pair ? [pair.photo, pair.movie] : [];
  const canShare = pair !== null && typeof navigator.canShare === "function" && navigator.canShare({files});
  // Called straight from the tap: Safari only opens the share sheet on a user gesture.
  const share = () => {
    if (!pair) return;
    navigator.share({files}).catch((e: Error) => {if (e.name !== "AbortError") setError("无法打开分享：" + e.message);});
  };
  const manifest = () => ({
    version: 2, identifier: pair?.identifier, coverTime: pair?.coverTime, duration: clip?.elapsed, frames: clip?.frames, codec: clip?.codec,
    source: t("TerraScope 当前场景，浏览器内编码与封装"), scene: scene.current, audio: false,
  });
  const downloadZip = async () => {
    if (!pair) return;
    const zip = zipSync({
      "TERRASCOPE.JPG": new Uint8Array(await pair.photo.arrayBuffer()),
      "TERRASCOPE.MOV": new Uint8Array(await pair.movie.arrayBuffer()),
      "scene.json": strToU8(JSON.stringify(manifest(), null, 2)),
      [t("导入说明.txt")]: strToU8(t(GUIDE)),
    }, {level: 0});
    saveBlob(new Blob([zip as BlobPart], {type: "application/zip"}), "terrascope-live-photo.zip");
  };

  const recording = phase === "recording";
  const busy = phase === "exporting";
  return <section className={"live-photo-panel glass-panel" + (recording ? " is-recording" : "")} role="dialog" aria-label={t("录制 iPhone 实况图")} aria-modal="false" tabIndex={-1} ref={panel}>
    <header><div><span className="metric-label">{t("LIVE PHOTO · 实验功能")}</span><h2>{t("把这一刻，带走")}</h2></div><button type="button" onClick={onClose} aria-label={t("关闭实况图录制")}><X size={18}/></button></header>
    {recording ? <><p role="status"><Circle size={12} fill="currentColor"/>{t("正在录制")}{t(Math.min(3, progress * 3).toFixed(1))}{t("/ 3.0 秒")}</p><progress value={progress} max={1}/><p>{t("只录地球画面，界面不会入镜。逐帧录制 90 帧，设备较慢时会多花一点时间，成片仍是流畅的 3 秒。保持页面可见。")}</p><button type="button" onClick={() => {controller.current?.abort(); setPhase(clip ? "preview" : "idle");}}>{t("取消录制")}</button></> : <>
      <p className="live-photo-intro">{t("录下当前地球画面，选一帧作封面，直接生成 iPhone 实况图。按住照片，就能重看这段风景。")}</p>
      {support === "no" && <p role="alert">{t("当前浏览器不支持 H.264 视频编码（WebCodecs），无法生成实况图。请使用最新版 Safari（iOS / macOS 16.4 及以上）或 Chrome。")}</p>}
      {url && <><video ref={video} src={url} controls playsInline muted preload="auto" onLoadedData={() => {if (video.current) video.current.currentTime = coverTime + .001;}} aria-label={t("录制片段预览")}/><label className="live-photo-cover">{t("封面时刻")}<output>{t("{0}秒", t(coverTime.toFixed(2)))}</output><input aria-label={t("封面时刻")} type="range" min="0" max={Math.max(.1, (clip?.elapsed ?? 3) - .1).toFixed(2)} step="0.05" value={cover} disabled={busy} onChange={e => chooseCover(Number(e.target.value))}/></label><p className="live-photo-details">{t("{0}×{1}·{2}秒 ·{3}帧 · H.264 · 无声音", clip?.width, clip?.height, t(clip?.elapsed.toFixed(1)), clip?.frames)}</p></>}
      <label className="live-photo-orbit"><input type="checkbox" checked={orbit && allowOrbit} disabled={!allowOrbit || busy} onChange={e => setOrbit(e.target.checked)}/>{t("缓慢环绕地球")}{!allowOrbit && <small>{t("卫星跟踪中使用当前镜头")}</small>}</label>
      <div className="live-photo-buttons">
        <button type="button" disabled={support !== "yes" || !viewer || busy} onClick={() => void record()}><Circle size={14}/>{t(clip ? "重新录制" : "录制当前场景 · 3 秒")}</button>
        {clip && !pair && <button type="button" className="live-photo-primary" disabled={busy} onClick={() => void generate()}><Download size={15}/>{t(busy ? "正在生成…" : "生成实况图")}</button>}
        {pair && canShare && <button type="button" className="live-photo-primary" onClick={share}><Share size={15}/>{t("存到照片（分享）")}</button>}
        {pair && <button type="button" className={canShare ? undefined : "live-photo-primary"} onClick={() => void downloadZip()}><Download size={15}/>{t("下载实况图资源包（ZIP）")}</button>}
      </div>
      {pair && <p role="status" className="live-photo-service">{t("已生成：封面{0}秒 · 标识{1}…", t(pair.coverTime.toFixed(2)), t(pair.identifier.slice(0, 8)))}</p>}
      {clip && <div className="live-photo-downloads"><button type="button" onClick={() => saveBlob(clip.preview, "terrascope-capture.mp4")}>{t("保存录制片段")}</button><button type="button" onClick={() => saveBlob(new Blob([JSON.stringify(scene.current, null, 2)], {type: "application/json"}), "terrascope-scene.json")}>{t("保存场景记录")}</button></div>}
      {error && <p className="live-photo-error" role="alert">{t(error)}</p>}
      <details><summary>{t("如何保存到 iPhone 相册？")}</summary>
        <p>{t("实况图由一张 JPG 和一段 MOV 组成，靠相同的内容标识配对，全部在你的浏览器里生成，不上传。")}</p>
        <p><b>iPhone</b>{t("：点「存到照片」，在分享菜单选「存储 2 项」。网页无法直接写入相册，能否自动合并为实况图取决于 iOS；如果相册里变成一张照片加一段视频，请用 Mac 的方法。")}</p>
        <p><b>Mac</b>{t("：下载资源包并解压，把两个文件一起拖进「照片」，即合并为实况图，再经 iCloud 照片同步到 iPhone。")}</p>
      </details>
    </>}
  </section>;
}
