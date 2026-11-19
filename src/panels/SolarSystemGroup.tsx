import { t, localeTag, useLocale } from "../i18n";
import { useMemo } from "react";
import { FastForward, Orbit, Pause, Play, Sun, Telescope, Undo2 } from "lucide-react";
import type { LayerToggles } from "../hooks/useLayerSettings";
import type { AstronomyModule } from "../layers/useAstronomy";
import type { SolarBody } from "../layers/useSolarSystem";
import { distanceLabel, lightTimeLabel } from "../spaceData";
import { ICON, LayerGroup, ToggleRow } from "../ui/controls";
import { now } from "../clock";
import "./solarsystem.css";

export interface SolarLapse { time: number; playing: boolean; daysPerSecond: 1 | 10 | 100 }
const SPEEDS = [1, 10, 100] as const;
const VISIBILITY = { morning: "黎明前在东方", evening: "日落后在西方", night: "整夜可见", hidden: "太靠近太阳，看不到" } as const;

const dayLabel = (time: number) => new Intl.DateTimeFormat(localeTag(), { year: "numeric", month: "short", day: "numeric" }).format(time);

interface Props {
  layers: LayerToggles;
  setLayer: (key: keyof LayerToggles, value: boolean) => void;
  module: AstronomyModule | null;
  failed: boolean;
  lapse: SolarLapse | null;
  onLapse: (lapse: SolarLapse | null) => void;
  onView: (scale: "inner" | "outer") => void;
  selected: SolarBody | null;
  onSelectPlanet: (key: SolarBody) => void;
  reveal?: unknown;
}

/** The planets and their orbits around the globe, with a fast-forward clock. */
export function SolarSystemGroup({ layers, setLayer, module, failed, lapse, onLapse, onView, selected, onSelectPlanet, reveal }: Props) {
  const locale = useLocale();
  const at = lapse?.time ?? now();
  // Ten-minute steps are plenty for the list.
  const step = Math.floor(at / 600_000);
  const planets = useMemo(() => (module && layers.solarSystem ? module.planetsNow(step * 600_000) : []), [module, layers.solarSystem, step]);
  return (
    <LayerGroup title="SOLAR SYSTEM" subtitle={t("太阳系 · 行星与轨道")} reveal={reveal}>
      <ToggleRow icon={<Sun {...ICON} />} title={t("太阳系")} caption={t("八大行星与冥王星的位置和轨道 · 小行星带与柯伊伯带")}
        checked={layers.solarSystem} onChange={(v) => setLayer("solarSystem", v)} />
      {layers.solarSystem && (
        <div className="layer-extra solar-system">
          {!module && <p className="layer-status">{t(failed ? "天文计算模块加载失败，请刷新页面重试。" : "正在加载天文计算…")}</p>}
          <div className="solar-views">
            <button type="button" className="cislunar-button" onClick={() => onView("inner")}><Telescope size={14} aria-hidden="true" />{t("内太阳系")}</button>
            <button type="button" className="cislunar-button" onClick={() => onView("outer")}><Orbit size={14} aria-hidden="true" />{t("外太阳系")}</button>
          </div>
          <div className="solar-clock" role="group" aria-label={t("太阳系时间快进")}>
            <button type="button" aria-label={t(lapse?.playing ? "暂停" : "快进")} onClick={() => onLapse({ time: lapse?.time ?? now(), daysPerSecond: lapse?.daysPerSecond ?? 10, playing: !lapse?.playing })}>
              {lapse?.playing ? <Pause size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}
            </button>
            <div className="solar-speeds" role="radiogroup" aria-label={t("快进速度")}>
              {SPEEDS.map((s) => (
                <button key={s} type="button" role="radio" aria-checked={(lapse?.daysPerSecond ?? 10) === s}
                  onClick={() => onLapse({ time: lapse?.time ?? now(), playing: lapse?.playing ?? false, daysPerSecond: s })}>{t("{0} 天/秒", s)}</button>
              ))}
            </div>
            <output>{dayLabel(at)}</output>
            {lapse && <button type="button" aria-label={t("回到现在")} title={t("回到现在")} onClick={() => onLapse(null)}><Undo2 size={14} aria-hidden="true" /></button>}
          </div>
          {lapse && <p className="layer-note"><FastForward size={11} aria-hidden="true" /> {t("快进只移动行星和探测器；地球的昼夜和其他图层仍按时间轴显示。")}</p>}
          <ul className="space-list planets">
            {planets.map((p) => {
              const info = module!.SOLAR_PLANETS.find((x) => x.key === p.key)!;
              return (
                <li key={p.key}>
                  <button type="button" className={selected === p.key ? "selected" : ""} onClick={() => onSelectPlanet(p.key)}>
                    <i style={{ background: info.color }} />
                    <span>
                      <strong>{t(info.name)}</strong>
                      <small>{t("离太阳 {0}", distanceLabel(p.sunKm, locale))} · {t("离地球 {0}", distanceLabel(p.earthKm, locale))} · {t("信号单程 {0}", lightTimeLabel(p.earthKm, locale))}</small>
                      <small>{t(VISIBILITY[p.visibility])}{p.visibility !== "hidden" && " · " + t("亮度 {0} 等", p.magnitude.toFixed(1))}</small>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="layer-note">{t("轨道和距离按真实比例；行星本身太小，在这个尺度下画成发光的点。拉远到内太阳系或外太阳系视角可以看到全貌；点一颗行星，镜头飞到它附近。位置由 astronomy-engine 计算。")}</p>
        </div>
      )}
    </LayerGroup>
  );
}
