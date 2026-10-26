import { MapPin, Sparkles, Square } from "lucide-react";
import { LayerGroup, Segmented } from "../ui/controls";
import type { FireworkSite } from "../fireworks/FireworksOverlay";
import { FIREWORK_STYLES, type FireworkStyle } from "../fireworks/physics";
import "./fireworks.css";

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
  return (
    <LayerGroup title="EXPERIENCES" subtitle="互动体验 · 虚拟烟花">
      <div className="fireworks-controls">
        <div className="fireworks-heading"><Sparkles size={16} aria-hidden="true" /><span>FIREWORKS <small>烟花表演</small></span></div>
        <p className="fireworks-note">在地球上选择城市，进入近景观看三维烟花。效果为艺术模拟，不代表真实事件。</p>
        <div className="fireworks-cities" aria-label="烟花表演地点">
          {PRESETS.map((preset) => (
            <button key={preset.label} type="button" className={site.label === preset.label ? "selected" : ""}
              aria-pressed={site.label === preset.label} onClick={() => onChooseSite(preset)}>{preset.label}</button>
          ))}
        </div>
        <button type="button" className={"fireworks-pick" + (picking ? " active" : "")} onClick={onTogglePick} disabled={!ready} aria-pressed={picking}>
          <MapPin size={13} aria-hidden="true" /> {picking ? "点击地球表面选择位置（Esc 取消）" : "在地球上选取其他位置"}
        </button>
        <p className="fireworks-site" role="status">地点：{site.label} · {site.latitude.toFixed(2)}°, {site.longitude.toFixed(2)}°</p>
        <Segmented label="烟花样式" options={FIREWORK_STYLES} value={style} onChange={onChooseStyle} format={(value) => STYLE_LABELS[value]} />
        <div className="fireworks-actions">
          <button type="button" className="fireworks-launch" onClick={onLaunch} disabled={!ready || picking}>
            <Sparkles size={14} aria-hidden="true" /> {running ? "重新播放" : "开始烟花表演"}
          </button>
          <button type="button" className="fireworks-stop" onClick={onStop} disabled={!running} aria-label="停止烟花表演"><Square size={13} aria-hidden="true" /> 停止</button>
        </div>
        <p className="fireworks-note">近景效果最佳 · 自动播放三轮 · 切换或结束后自动清理粒子</p>
      </div>
    </LayerGroup>
  );
}
