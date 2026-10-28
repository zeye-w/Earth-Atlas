import { MapPin, Rocket, Sparkles, Square } from "lucide-react";
import { useSyncExternalStore } from "react";
import { canLoadCity, getCityStatus, subscribeCityStatus } from "../fireworks/cityContext";
import { LayerGroup, Segmented } from "../ui/controls";
import type { FireworkSite } from "../fireworks/FireworksOverlay";
import { FIREWORK_STYLES, type FireworkStyle } from "../fireworks/physics";
import { getExperience, subscribeExperience, updateExperience, type ExperienceMode } from "../fireworks/experience";
import "./fireworks.css";
import { SpaceShowControls } from "./SpaceShowControls";
import { requestShowWarmup } from "../fireworks/shaderWarmup";

const PRESETS: FireworkSite[] = [
  { label: "北京", latitude: 39.9042, longitude: 116.4074 },
  { label: "上海", latitude: 31.2304, longitude: 121.4737 },
  { label: "东京", latitude: 35.6762, longitude: 139.6503 },
  { label: "巴黎", latitude: 48.8566, longitude: 2.3522 },
];

const STYLE_LABELS: Record<FireworkStyle, string> = { bloom: "球形", ring: "环形", willow: "金柳" };

interface Props {
  site: FireworkSite;
  style: FireworkStyle;
  picking: boolean;
  running: boolean;
  ready: boolean;
  onChooseSite: (site: FireworkSite) => void;
  onChooseStyle: (style: FireworkStyle) => void;
  onTogglePick: () => void;
  onLaunch: () => void;
  onStop: () => void;
}

export function FireworksGroup({ site, style, picking, running, ready, onChooseSite, onChooseStyle, onTogglePick, onLaunch, onStop }: Props) {
  const cityStatus = useSyncExternalStore(subscribeCityStatus, getCityStatus, getCityStatus);
  const experience = useSyncExternalStore(subscribeExperience, getExperience, getExperience);
  const rocket = experience.mode === "rocket";
  const space = experience.mode === "space";
  const phase = { idle: "准备就绪", countdown: `发射倒计时 ${experience.countdown}`, liftoff: "点火 · 垂直升空", ascent: "转向 · 持续爬升", complete: "发射表演结束" }[experience.phase];
  return (
    <LayerGroup title="EXPERIENCES" subtitle="互动体验 · 烟花与火箭">
      <div className="fireworks-controls" onPointerEnter={requestShowWarmup} onFocus={requestShowWarmup}>
        <Segmented label="互动体验" options={["fireworks", "rocket", "space"] as const} value={experience.mode}
          onChange={(mode: ExperienceMode) => { onStop(); updateExperience({ mode, phase: "idle", altitude: 0, speed: 0, countdown: 3 }); }}
          format={mode => mode === "space" ? "太空观演" : mode === "rocket" ? "虚拟火箭" : "虚拟烟花"} />
        {space ? <SpaceShowControls site={site} picking={picking} running={running} ready={ready} onTogglePick={onTogglePick} onLaunch={onLaunch} onStop={onStop} /> : <>
        <div className="fireworks-heading">{rocket ? <Rocket size={16} aria-hidden="true" /> : <Sparkles size={16} aria-hidden="true" />}<span>{rocket ? "ROCKET LAUNCH" : "FIREWORKS"} <small>{rocket ? "火箭发射表演" : "烟花表演"}</small></span></div>
        <p className="fireworks-note">{rocket ? "3 秒倒计时后升空，自动转向并爬升至约 52 km，全程约 45 秒。轨迹、速度与尾焰均为艺术模拟，不代表真实发射或精确轨道。" : "在地球上选择城市，进入近景观看三维烟花。效果为艺术模拟，不代表真实事件。"}</p>
        <div className="fireworks-cities" aria-label={rocket ? "火箭发射地点" : "烟花表演地点"}>
          {PRESETS.map((preset) => (
            <button key={preset.label} type="button" className={site.label === preset.label ? "selected" : ""}
              aria-pressed={site.label === preset.label} onClick={() => onChooseSite(preset)}>{preset.label}</button>
          ))}
        </div>
        <button type="button" className={"fireworks-pick" + (picking ? " active" : "")} onClick={onTogglePick} disabled={!ready} aria-pressed={picking}>
          <MapPin size={13} aria-hidden="true" /> {picking ? "点击地球表面选择位置（Esc 取消）" : "在地球上选取其他位置"}
        </button>
        <p className="fireworks-site" role="status">地点：{site.label} · {site.latitude.toFixed(2)}°, {site.longitude.toFixed(2)}°</p>
        {!rocket && <Segmented label="烟花样式" options={FIREWORK_STYLES} value={style} onChange={onChooseStyle} format={(value) => STYLE_LABELS[value]} />}
        {rocket && <>
          <label className="rocket-follow"><input type="checkbox" checked={experience.follow} onChange={event => updateExperience({ follow: event.target.checked })} />跟随火箭镜头（关闭后可自由浏览）</label>
          <p className="fireworks-site" role="status" aria-live="polite">{running ? experience.phase === "idle" ? "镜头就位中…" : phase : experience.phase === "complete" ? phase : "准备就绪"}</p>
          <div className="rocket-telemetry" aria-label="模拟飞行数据" aria-live="off"><span>模拟高度 <strong>{(experience.altitude / 1000).toFixed(1)} km</strong></span><span>模拟速度 <strong>{Math.round(experience.speed)} m/s</strong></span></div>
        </>}
        <div className="fireworks-actions">
          <button type="button" className="fireworks-launch" onClick={onLaunch} disabled={!ready || picking}>
            {rocket ? <Rocket size={14} aria-hidden="true" /> : <Sparkles size={14} aria-hidden="true" />} {running ? "重新播放" : rocket ? "发射虚拟火箭" : "开始烟花表演"}
          </button>
          <button type="button" className="fireworks-stop" onClick={onStop} disabled={!running} aria-label={rocket ? "停止火箭表演" : "停止烟花表演"}><Square size={13} aria-hidden="true" /> 停止</button>
        </div>
        <p className="fireworks-note">{rocket ? "可随时停止或重新发射 · 结束后自动清理火箭和尾迹" : "近景效果最佳 · 自动播放三轮 · 切换或结束后自动清理粒子"}</p>
        {canLoadCity(import.meta.env.VITE_CESIUM_ION_TOKEN) && <p className="fireworks-note">夜间窗灯为艺术示意，不代表真实亮灯情况</p>}
        {(!canLoadCity(import.meta.env.VITE_CESIUM_ION_TOKEN) || cityStatus === "disabled" || cityStatus === "failed") && (
          <p className="fireworks-note" role="status">{cityStatus === "failed" ? "城市模型加载失败" : "城市模型未启用"} · {rocket ? "火箭" : "烟花"}仍可正常播放</p>
        )}
        </>}
      </div>
    </LayerGroup>
  );
}
