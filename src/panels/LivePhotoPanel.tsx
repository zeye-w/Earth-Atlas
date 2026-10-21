import {useEffect, useRef, useState} from "react";
import type {Viewer} from "cesium";
import {Circle, Download, RefreshCw, X} from "lucide-react";
import {captureScene, recordingMime, saveBlob, type SceneClip} from "../livePhotoCapture";
import "./livePhoto.css";

interface Props {viewer: Viewer | null; allowOrbit: boolean; getScene: () => Record<string, unknown>; onClose: () => void; onRecordingChange: (recording: boolean) => void}
export default function LivePhotoPanel({viewer, allowOrbit, getScene, onClose, onRecordingChange}: Props) {
  const [phase, setPhase] = useState<"idle" | "recording" | "preview" | "exporting">("idle");
  const [orbit, setOrbit] = useState(true), [progress, setProgress] = useState(0), [cover, setCover] = useState(1.5);
  const [clip, setClip] = useState<SceneClip | null>(null), [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null), [service, setService] = useState<"checking" | "ready" | "offline">("checking");
  const video = useRef<HTMLVideoElement>(null), panel = useRef<HTMLElement>(null);
  const controller = useRef<AbortController | null>(null), scene = useRef<Record<string, unknown>>({});
  const healthController = useRef<AbortController | null>(null);
  const supported = recordingMime() !== null;
  const checkService = async () => {
    healthController.current?.abort(); const abort = new AbortController(); healthController.current = abort; setService("checking");
    try {const response = await fetch("/api/live-photo/health", {signal: AbortSignal.any([abort.signal, AbortSignal.timeout(3000)])}); const info = await response.json(); if (!abort.signal.aborted) setService(response.ok && info.ready ? "ready" : "offline");}
    catch {if (!abort.signal.aborted) setService("offline");}
  };
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null; panel.current?.focus(); void checkService();
    const close = (event: KeyboardEvent) => {if (event.key === "Escape") onClose();};
    document.addEventListener("keydown", close);
    return () => {controller.current?.abort(); healthController.current?.abort(); document.removeEventListener("keydown", close); previous?.focus();};
  }, [onClose]);
  useEffect(() => {if (!clip) {setUrl(null); return;} const value = URL.createObjectURL(clip.blob); setUrl(value); return () => URL.revokeObjectURL(value);}, [clip]);

  const record = async () => {
    if (!viewer) return;
    if (Array.from(document.querySelectorAll(".thematic-note,.layer-status,.satellite-status")).some(e => /加载失败|暂不可用|正在读取/.test(e.textContent ?? ""))) {
      setError("当前有图层尚未就绪，请等待加载完成或关闭失败图层后重试"); return;
    }
    controller.current?.abort(); const abort = new AbortController(); controller.current = abort;
    setError(null); setProgress(0); setPhase("recording");
    onRecordingChange(true);
    scene.current = {capturedAt: new Date().toISOString(), ...getScene(), cameraMotion: orbit && allowOrbit ? "slow-orbit" : "manual-or-fixed"};
    try {
      const result = await captureScene(viewer, orbit && allowOrbit, abort.signal, setProgress);
      if (!abort.signal.aborted) {setClip(result); setCover(Math.min(1.5, Math.max(.1, result.elapsed / 2))); setPhase("preview");}
    } catch (e) {if (!abort.signal.aborted) {setError(String((e as Error).message)); setPhase(clip ? "preview" : "idle");}}
    finally {onRecordingChange(false);}
  };
  const chooseCover = (value: number) => {setCover(value); if (video.current) {video.current.pause(); video.current.currentTime = value;}};
  const exportLive = async () => {
    if (!clip) return;
    setError(null); setPhase("exporting");
    const abort = new AbortController(); controller.current = abort;
    try {
      const response = await fetch("/api/live-photo/export?cover=" + cover.toFixed(3), {method: "POST", headers: {"Content-Type": clip.blob.type, "X-TerraScope-Scene": encodeURIComponent(JSON.stringify({...scene.current, frames: clip.frames, elapsed: clip.elapsed}))}, body: clip.blob, signal: AbortSignal.any([abort.signal, AbortSignal.timeout(150_000)])});
      if (!response.ok || !response.headers.get("content-type")?.includes("application/zip")) {
        const result = await response.json().catch(() => null); throw Error(result?.error || "本地实况图服务未连接，可先下载录制片段");
      }
      const zip = await response.blob(); if (abort.signal.aborted) return;
      saveBlob(zip, "terrascope-live-photo.zip"); setPhase("preview");
    } catch (e) {if (!abort.signal.aborted) {setError(String((e as Error).message)); setPhase("preview");}}
  };
  const recording = phase === "recording";
  return <section className={"live-photo-panel glass-panel" + (recording ? " is-recording" : "")} role="dialog" aria-label="录制 iPhone 实况图" aria-modal="false" tabIndex={-1} ref={panel}>
    <header><div><span className="metric-label">LIVE PHOTO · 实验功能</span><h2>把这一刻，带走</h2></div><button type="button" onClick={onClose} aria-label="关闭实况图录制"><X size={18}/></button></header>
    {recording ? <><p role="status"><Circle size={12} fill="currentColor"/> 正在录制 {Math.min(3, progress * 3).toFixed(1)} / 3.0 秒</p><progress value={progress} max={1}/><p>只录地球画面，界面不会入镜。保持页面可见。</p><button type="button" onClick={() => {controller.current?.abort(); setPhase(clip ? "preview" : "idle");}}>取消录制</button></> : <>
      <p className="live-photo-intro">录下当前地球画面，选一帧作封面。按住照片，就能重看这段风景。</p>
      {!supported && <p role="alert">当前浏览器不支持画面录制，请使用支持 Canvas 录制的桌面浏览器。</p>}
      {url && <><video ref={video} src={url} controls playsInline preload="auto" onLoadedData={() => {if (video.current) video.current.currentTime = cover;}} aria-label="录制片段预览"/><label className="live-photo-cover">封面时刻 <output>{cover.toFixed(1)} 秒</output><input aria-label="封面时刻" type="range" min="0.1" max={Math.min(2.8, Math.max(.2, (clip?.elapsed ?? 3) - .2))} step="0.1" value={cover} disabled={phase === "exporting"} onChange={e => chooseCover(Number(e.target.value))}/></label><p className="live-photo-details">{clip?.width} × {clip?.height} · 约 3 秒 · 无麦克风录音{clip && clip.frames / clip.elapsed < 15 ? " · 帧率偏低，建议降低画质后重录" : ""}</p></>}
      <label className="live-photo-orbit"><input type="checkbox" checked={orbit && allowOrbit} disabled={!allowOrbit || phase === "exporting"} onChange={e => setOrbit(e.target.checked)}/>缓慢环绕地球{!allowOrbit && <small>卫星跟踪中使用当前镜头</small>}</label>
      <div className="live-photo-buttons"><button type="button" disabled={!supported || !viewer || phase === "exporting"} onClick={() => void record()}><Circle size={14}/>{clip ? "重新录制" : "录制当前场景 · 3 秒"}</button>{clip && <button type="button" className="live-photo-primary" disabled={service !== "ready" || phase === "exporting"} onClick={() => void exportLive()}><Download size={15}/>{phase === "exporting" ? "正在封装…" : "导出 iPhone 实况图资源包"}</button>}</div>
      <p role="status" className="live-photo-service">{service === "ready" ? "本地实况图服务已连接" : service === "checking" ? "正在连接本地导出服务…" : "本地导出服务未连接；仍可录制并保存片段。"}{service === "offline" && <button type="button" onClick={() => void checkService()} aria-label="重试连接导出服务"><RefreshCw size={13}/></button>}</p>
      {clip && <div className="live-photo-downloads"><button type="button" onClick={() => saveBlob(clip.blob, "terrascope-capture." + (clip.blob.type.includes("mp4") ? "mp4" : "webm"))}>保存录制片段</button><button type="button" onClick={() => saveBlob(new Blob([JSON.stringify(scene.current, null, 2)], {type: "application/json"}), "terrascope-scene.json")}>保存场景记录</button></div>}
      {error && <p className="live-photo-error" role="alert">{error}</p>}
      <details><summary>如何保存到 iPhone 相册？</summary><p>导出包包含配对的照片与短视频。请在 Mac「照片」中同时导入，再通过 iCloud 照片同步；或使用支持实况照片配对资源的 iOS 导入工具。单独从 Safari 保存两个文件不会自动合并。</p><p>当前版本尚未通过 iPhone 真机相册识别测试，请先确认出现 LIVE 标识、可播放且封面正确。数据署名与原有水印保留。</p></details>
    </>}
  </section>;
}
