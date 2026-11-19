import { t, useLocale } from "../i18n";
import { Atom, Disc3, Orbit, Ruler, Satellite, ScanEye } from "lucide-react";
import type { LayerToggles } from "../hooks/useLayerSettings";
import type { ConstellationStatus } from "../layers/useConstellation";
import { altitudeLabel, BELTS, lShellAltitudeKm, RULER, rulerPosition, type RulerItem } from "../nearEarth";
import { ICON, LayerGroup, ToggleRow } from "../ui/controls";
import "./nearearth.css";

const GROUP_COLORS: Record<RulerItem["group"], string> = { orbit: "#8fe3ff", belt: "#ffb347", moon: "#c9c6bd", far: "#ff9bd2" };

interface Props {
  layers: LayerToggles;
  setLayer: (key: keyof LayerToggles, value: boolean) => void;
  geoStatus: ConstellationStatus;
  onSideView: () => void;
  onRulerItem: (item: RulerItem) => void;
  reveal?: unknown;
}

/** The structure of near-Earth space and the altitude ruler. */
export function NearEarthGroup({ layers, setLayer, geoStatus, onSideView, onRulerItem, reveal }: Props) {
  const locale = useLocale();
  const geoCount = geoStatus.state === "ready" ? geoStatus.shown ?? geoStatus.total ?? null : null;
  return (
    <LayerGroup title="NEAR-EARTH SPACE" subtitle={t("近地空间结构")} reveal={reveal}>
      <ToggleRow icon={<Orbit {...ICON} />} title={t("卫星轨道带")} caption={t("近地、中圆、同步轨道与几条代表性轨道")}
        checked={layers.orbitBands} onChange={(v) => setLayer("orbitBands", v)} />
      {layers.orbitBands && <p className="layer-note layer-extra">{t("各轨道的高度和倾角是真实的，绕地轴的朝向只是示意，方便区分；金色的地球同步轨道和灰色虚线的「坟场轨道」位置是真实的。")}</p>}
      <ToggleRow icon={<Satellite {...ICON} />} title={t("同步轨道卫星")} caption={t("CelesTrak · 赤道上空 3.6 万公里的「卫星项链」")}
        checked={layers.geoSats} onChange={(v) => setLayer("geoSats", v)} />
      {layers.geoSats && <p className="layer-status layer-extra" role="status">{geoCount !== null ? t("{0} 颗地球同步卫星", geoCount) : geoStatus.state === "error" ? t("卫星数据暂不可用") : t("正在读取卫星轨道…")}</p>}
      <ToggleRow icon={<Atom {...ICON} />} title={t("范艾伦辐射带")} caption={t("沿地磁场线分布的高能粒子带 · 南大西洋异常区")}
        checked={layers.radiationBelts} onChange={(v) => setLayer("radiationBelts", v)} />
      {layers.radiationBelts && (
        <div className="layer-extra near-earth-belts">
          {BELTS.map((b) => (
            <p key={b.key}><i style={{ background: b.color }} /><strong>{t(b.name)}</strong> {altitudeLabel(lShellAltitudeKm(b.lRange[0]), locale)}–{altitudeLabel(lShellAltitudeKm(b.lRange[1]), locale)} · {t(b.particles)}</p>
          ))}
          <p className="layer-note">{t("辐射带随地磁轴倾斜约 9°。南大西洋上空内带离地面最近，卫星和空间站经过时辐射最强、电子设备最容易出错。形状按偶极磁场绘制，真实的辐射带会被太阳风压扁拉长。")}</p>
        </div>
      )}
      <ToggleRow icon={<Disc3 {...ICON} />} title={t("地月拉格朗日点")} caption={t("L1–L5 · 随月球一起转动")}
        checked={layers.lagrange} onChange={(v) => setLayer("lagrange", v)} />
      <button type="button" className="cislunar-button side-view" onClick={onSideView}><ScanEye size={14} aria-hidden="true" />{t("侧视剖面")}</button>

      <div className="altitude-ruler" aria-label={t("高度标尺")}>
        <div className="pass-head"><span><Ruler size={13} aria-hidden="true" /> {t("高度标尺 · 对数刻度")}</span></div>
        <ol>
          {[...RULER].sort((a, b) => a.altitudeKm - b.altitudeKm).map((item) => (
            <li key={item.key}>
              <button type="button" onClick={() => onRulerItem(item)} title={t(item.note)}>
                <span className="ruler-bar"><i style={{ left: rulerPosition(item.altitudeKm) * 100 + "%", width: item.toKm ? (rulerPosition(item.toKm) - rulerPosition(item.altitudeKm)) * 100 + "%" : undefined, background: GROUP_COLORS[item.group] }} className={item.toKm ? "range" : ""} /></span>
                <span className="ruler-name">{t(item.name)}</span>
                <span className="ruler-alt">{altitudeLabel(item.altitudeKm, locale)}{item.toKm ? "–" + altitudeLabel(item.toKm, locale) : ""}</span>
              </button>
            </li>
          ))}
        </ol>
        <p className="layer-note">{t("横条表示高度（对数刻度：100 公里到 200 万公里）。点一项，镜头会飞到能看清它的距离。")}</p>
      </div>
    </LayerGroup>
  );
}
