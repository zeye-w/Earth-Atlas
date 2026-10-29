import { t } from "../i18n";
import { MapPin, Sparkles, Square } from "lucide-react";
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
  const space = experience.mode === "space";
  // A virtual launch started from LAUNCHES is not this panel's show.
  const showing = running && experience.mode === "fireworks";
  return (
    <LayerGroup title="EXPERIENCES" subtitle={t("互动体验 · 烟花与太空观演")}>
      <div className="fireworks-controls" onPointerEnter={requestShowWarmup} onFocus={requestShowWarmup}>
        <Segmented label={t("互动体验")} options={["fireworks", "space"] as const} value={space ? "space" : "fireworks"}
          onChange={(mode: ExperienceMode) => { onStop(); updateExperience({ mode, phase: "idle", altitude: 0, speed: 0 }); }}
          format={mode => mode === "space" ? t("太空观演") : t("虚拟烟花")} />
        {space ? <SpaceShowControls site={site} picking={picking} running={running} ready={ready} onTogglePick={onTogglePick} onLaunch={onLaunch} onStop={onStop} /> : <>
        <div className="fireworks-heading"><Sparkles size={16} aria-hidden="true" /><span>{t("FIREWORKS")} <small>{t("烟花表演")}</small></span></div>
        <p className="fireworks-note">{t("在地球上选择城市，进入近景观看三维烟花。效果为艺术模拟，不代表真实事件。")}</p>
        <div className="fireworks-cities" aria-label={t("烟花表演地点")}>
          {PRESETS.map((preset) => (
            <button key={preset.label} type="button" className={site.label === preset.label ? "selected" : ""}
              aria-pressed={site.label === preset.label} onClick={() => onChooseSite(preset)}>{t(preset.label)}</button>
          ))}
        </div>
        <button type="button" className={"fireworks-pick" + (picking ? " active" : "")} onClick={onTogglePick} disabled={!ready} aria-pressed={picking}>
          <MapPin size={13} aria-hidden="true" /> {t(picking ? "点击地球表面选择位置（Esc 取消）" : "在地球上选取其他位置")}
        </button>
        <p className="fireworks-site" role="status">{t("地点：{0}·{1}°,{2}°", t(site.label), t(site.latitude.toFixed(2)), t(site.longitude.toFixed(2)))}</p>
        <Segmented label={t("烟花样式")} options={FIREWORK_STYLES} value={style} onChange={onChooseStyle} format={(value) => STYLE_LABELS[value]} />
        <div className="fireworks-actions">
          <button type="button" className="fireworks-launch" onClick={onLaunch} disabled={!ready || picking}>
            <Sparkles size={14} aria-hidden="true" /> {t(showing ? "重新播放" : "开始烟花表演")}
          </button>
          <button type="button" className="fireworks-stop" onClick={onStop} disabled={!showing} aria-label={t("停止烟花表演")}><Square size={13} aria-hidden="true" />{t("停止")}</button>
        </div>
        <p className="fireworks-note">{t("近景效果最佳 · 自动播放三轮 · 切换或结束后自动清理粒子")}</p>
        <p className="fireworks-note">{t("想看火箭发射？在「LAUNCHES · 火箭发射」里选择真实发射场。")}</p>
        {canLoadCity(import.meta.env.VITE_CESIUM_ION_TOKEN) && <p className="fireworks-note">{t("夜间窗灯为艺术示意，不代表真实亮灯情况")}</p>}
        {(!canLoadCity(import.meta.env.VITE_CESIUM_ION_TOKEN) || cityStatus === "disabled" || cityStatus === "failed") && (
          <p className="fireworks-note" role="status">{t("{0}·{1}仍可正常播放", t(cityStatus === "failed" ? "城市模型加载失败" : "城市模型未启用"), t("烟花"))}</p>
        )}
        </>}
      </div>
    </LayerGroup>
  );
}
