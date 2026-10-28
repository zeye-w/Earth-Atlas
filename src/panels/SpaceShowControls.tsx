import { t } from "../i18n";
import { useSyncExternalStore } from "react";
import { MapPin, RotateCcw, Sparkles, Square } from "lucide-react";
import { Segmented } from "../ui/controls";
import { addSpaceSite, getSpaceState, subscribeSpace, updateSpace } from "../fireworks/spaceState";
import { planDuration, planError, siteKey, type SpaceSite } from "../fireworks/spacePlan";
import type { FireworkSite } from "../fireworks/FireworksOverlay";

const PRESETS: Omit<SpaceSite, "kind">[] = [
  { label: "北京", longitude: 116.4074, latitude: 39.9042 },
  { label: "上海", longitude: 121.4737, latitude: 31.2304 },
  { label: "东京", longitude: 139.6503, latitude: 35.6762 },
  { label: "首尔", longitude: 126.978, latitude: 37.5665 },
  { label: "香港", longitude: 114.1694, latitude: 22.3193 },
  { label: "巴黎", longitude: 2.3522, latitude: 48.8566 },
];
interface Props { site: FireworkSite; picking: boolean; running: boolean; ready: boolean; onTogglePick: () => void; onLaunch: () => void; onStop: () => void }
export function SpaceShowControls({ site, picking, running, ready, onTogglePick, onLaunch, onStop }: Props) {
  const state = useSyncExternalStore(subscribeSpace, getSpaceState, getSpaceState);
  const invalid = planError(state.sites);
  const duration = planDuration(state.sites.length, state.relay);
  const remove = (key: string) => updateSpace({ sites: state.sites.filter(s => siteKey(s) !== key), message: "" });
  const phase = state.phase === "flying" ? t("镜头前往观演位置…") : state.phase === "playing" ? t("多点表演进行中") : state.phase === "complete" ? t("太空表演结束") : t("准备观演");
  return <>
    <p className="fireworks-note">{t("从地球地平线上方观看多点表演。巨型烟花直径可达数十至数百公里，火箭轨迹放大 5 倍，光点标示火箭；均为幻想尺度的艺术示意，不代表真实事件或轨道。")}</p>
    <fieldset className="space-sites" disabled={running}>
      <legend>{t("表演地点（{0}/6）", state.sites.length)}</legend>
      <div className="fireworks-cities space-presets">
        {PRESETS.map(preset => <button key={preset.label} type="button" disabled={state.sites.some(s => siteKey(s) === siteKey(preset)) || state.sites.length >= 6}
          onClick={() => addSpaceSite({ ...preset, kind: "fireworks" })}>{t(preset.label)}</button>)}
      </div>
      <p className="fireworks-note">{t("选择同一区域，地点间距不超过 4000 km。更换区域可先移除现有地点。")}</p>
      <button type="button" className={"fireworks-pick" + (picking ? " active" : "")} onClick={onTogglePick} disabled={!ready} aria-pressed={picking}><MapPin size={13} aria-hidden="true" />{t(picking ? "点击地球选点（Esc 取消）" : "在地球上选取地点")}</button>
      <button type="button" className="fireworks-pick" disabled={picking || state.sites.length >= 6} onClick={() => addSpaceSite({ ...site, kind: "fireworks" })}>{t("加入当前选点：{0}", t(site.label))}</button>
      <ul className="space-site-list">
        {state.sites.map((s, index) => <li key={siteKey(s)}>
          <span className="space-site-name">{t(s.label)}<small>{t(state.relay ? `接力 +${index * 3} 秒` : "同步开始")}</small></span>
          <select aria-label={t("{0}表演类型", t(s.label))} value={s.kind} onChange={event => updateSpace({ sites: state.sites.map((item, i) => i === index ? { ...item, kind: event.target.value as SpaceSite["kind"] } : item) })}>
            <option value="fireworks">{t("巨型烟花")}</option><option value="rocket">{t("火箭")}</option>
          </select>
          <button type="button" className="space-remove" aria-label={t("移除{0}", t(s.label))} onClick={() => remove(siteKey(s))}>×</button>
        </li>)}
      </ul>
      <Segmented label={t("多点播放方式")} options={["sync", "relay"] as const} value={state.relay ? "relay" : "sync"} onChange={value => updateSpace({ relay: value === "relay" })} format={value => value === "relay" ? t("接力 · 间隔 3 秒") : t("同时开始")} />
    </fieldset>
    {(state.message || invalid) && <p className="space-message" role="status">{t(state.message || invalid)}</p>}
    <div className="space-camera" aria-label={t("太空观演镜头")}>
      <label>{t("俯视 ↔ 地平线")}<output>{state.tilt}°</output><input type="range" min="8" max="90" step="1" value={state.tilt} aria-label={t("观演俯角")} onChange={event => updateSpace({ tilt: Number(event.target.value) })} /></label>
      <p className="fireworks-note">{t("8° 接近地表切线，90° 为垂直俯视；滑动镜头不会跟随单枚火箭。")}</p>
      <label>{t("画面放大")}<output>{t(state.zoom.toFixed(2))}×</output><input type="range" min="0.75" max="1.8" step="0.05" value={state.zoom} aria-label={t("观演放大倍率")} onChange={event => updateSpace({ zoom: Number(event.target.value) })} /></label>
      <label>{t("绕行方位")}<output>{state.heading}°</output><input type="range" min="-180" max="180" step="5" value={state.heading} aria-label={t("观演方位")} onChange={event => updateSpace({ heading: Number(event.target.value) })} /></label>
      <button type="button" className="fireworks-pick" onClick={() => updateSpace({ tilt: 20, zoom: 1.15, heading: 0, reset: state.reset + 1 })}><RotateCcw size={13} aria-hidden="true" />{t("恢复观演视角")}</button>
    </div>
    <p className="fireworks-site" role="status">{t(phase)}</p>
    <p className="fireworks-note">{t("{0}个地点 ·{1}·{2}/{3}秒 · 背面表演会被地球遮挡", state.sites.length, t(state.relay ? "接力" : "同步"), Math.floor(state.elapsed), duration)}</p>
    <div className="fireworks-actions">
      <button type="button" className="fireworks-launch" disabled={!ready || picking || Boolean(invalid)} onClick={onLaunch}><Sparkles size={14} aria-hidden="true" />{t(running ? "重新播放太空表演" : "开始太空表演")}</button>
      <button type="button" className="fireworks-stop" disabled={!running} aria-label={t("停止太空表演")} onClick={onStop}><Square size={13} aria-hidden="true" />{t("停止")}</button>
    </div>
    <p className="fireworks-note">{t("放大或贴近地平线可能使部分地点移出画面；可调小倍率、旋转方位或恢复视角。本模式不加载城市建筑或高清航拍。")}</p>
  </>;
}
