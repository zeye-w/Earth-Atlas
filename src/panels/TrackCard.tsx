import { t, localeTag } from "../i18n";
import { useEffect, useRef, useState } from "react";
import type { Cartesian3, Viewer } from "cesium";
import { Satellite, Sigma, X } from "lucide-react";
import { compassName } from "../compass";
import type { Observer, Telemetry } from "../satelliteTelemetry";
import { SATELLITE_MODELS, type SatelliteModelStatus } from "../satelliteModels";
import type { UserLocation } from "../hooks/useUserLocation";

const REFRESH_MS = 250;
const CARD_OFFSET = { x: 26, y: -24 };

interface Props {
  viewer: Viewer;
  title: string;
  satelliteId: string;
  modelStatus: SatelliteModelStatus;
  onViewModel: (close: boolean) => void;
  live: boolean;
  tracking: { telemetry: (observer: Observer | null) => Telemetry | null; position: () => Cartesian3 | undefined };
  location: UserLocation | null;
  onLocate: () => void;
  onStop: () => void;
  formulasOpen: boolean;
  onToggleFormulas: () => void;
}

const lat = (v: number) => Math.abs(v).toFixed(2) + "°" + (v >= 0 ? "N" : "S");
const lon = (v: number) => Math.abs(v).toFixed(2) + "°" + (v >= 0 ? "E" : "W");
const number = { format: (value: number) => new Intl.NumberFormat(localeTag(), { maximumFractionDigits: 0 }).format(value) };

/**
 * Live readouts beside the tracked satellite: refreshed four times a second
 * and repositioned after every render so it stays next to the marker.
 */
export function TrackCard({ viewer, title, satelliteId, modelStatus, onViewModel, live, tracking, location, onLocate, onStop, formulasOpen, onToggleFormulas }: Props) {
  const model=SATELLITE_MODELS[satelliteId];
  const cardRef = useRef<HTMLElement>(null);
  const [data, setData] = useState<Telemetry | null>(() => tracking.telemetry(location));

  useEffect(() => {
    const update = () => setData(tracking.telemetry(location));
    update();
    const timer = window.setInterval(update, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [tracking, location]);

  useEffect(() => {
    const scene = viewer.scene;
    const place = () => {
      const card = cardRef.current;
      if (!card) return;
      const position = tracking.position();
      const screen = position ? scene.cartesianToCanvasCoordinates(position) : undefined;
      // Narrow screens dock the card instead of following the marker (CSS).
      if (!screen || window.innerWidth < 760) { card.style.removeProperty("transform"); card.classList.toggle("is-floating", false); return; }
      const width = scene.canvas.clientWidth;
      const height = scene.canvas.clientHeight;
      // Keep clear of the formula panel docked on the right.
      const panel = formulasOpen ? document.querySelector(".formula-panel")?.getBoundingClientRect() : undefined;
      const right = panel ? Math.min(width, panel.left - scene.canvas.getBoundingClientRect().left) : width;
      const x = Math.min(Math.max(12, screen.x + (modelStatus === "ready" ? 120 : CARD_OFFSET.x)), right - card.offsetWidth - 12);
      const y = Math.min(Math.max(80, screen.y + CARD_OFFSET.y), height - card.offsetHeight - 12);
      card.style.transform = "translate(" + Math.round(x) + "px, " + Math.round(y) + "px)";
      card.classList.toggle("is-floating", true);
    };
    place();
    return scene.postRender.addEventListener(place);
  }, [viewer, tracking, modelStatus, formulasOpen]);

  return (
    <section ref={cardRef} className="track-card glass-panel" aria-label={t("正在跟踪 " + title)} aria-live="off">
      <header>
        <Satellite size={14} strokeWidth={1.7} aria-hidden="true" />
        <strong>{t(title)}</strong>
        <span className="track-badge">{t("跟踪中")}</span>
        <button type="button" onClick={onStop} aria-label={t("停止跟踪")}><X size={13} aria-hidden="true" /></button>
      </header>
      {!data ? <p className="track-empty">{t("这一时刻离轨道根数历元太远，没有可靠的位置。")}</p> : (
        <>
          <dl>
            <dt>{t("时间")}</dt><dd>{t(data.time.toISOString().slice(0, 19).replace("T", " "))} UTC{t(live ? "" : " · 时间轴")}</dd>
            <dt>{t("星下点")}</dt><dd>{t(lat(data.latitude))} {t(lon(data.longitude))}</dd>
            <dt>{t("高度")}</dt><dd>{t(data.altitudeKm.toFixed(1))} km</dd>
            <dt>{t("速度")}</dt><dd>{t(data.speedKmS.toFixed(2))} km/s</dd>
            <dt>{t("航向")}</dt><dd>{t(compassName(data.headingDeg))} {Math.round(data.headingDeg)}°</dd>
            <dt>{t("光照")}</dt><dd>{t(data.sunlit ? "日照中" : "地球阴影中")}</dd>
            <dt>{t("轨道周期")}</dt><dd>{t("{0}分钟", t(data.periodMin.toFixed(1)))}</dd>
          </dl>
          {data.look ? (
            <div className="track-look">
              <span>{t("从我的位置看")}</span>
              {data.look.elevation >= 0
                ? <p>{t("方位{0}{1}° · 仰角{2}° · 距离{3}km", t(compassName(data.look.azimuth)), Math.round(data.look.azimuth), t(data.look.elevation.toFixed(1)), t(number.format(data.look.rangeKm)))}</p>
                : <p>{t("在地平线以下（仰角{0}°）· 距离{1}km", t(data.look.elevation.toFixed(0)), t(number.format(data.look.rangeKm)))}</p>}
            </div>
          ) : (
            <button type="button" className="track-locate" onClick={onLocate}>{t("显示从我的位置看的方位和仰角")}</button>
          )}
          <button type="button" className={"track-locate track-formulas" + (formulasOpen ? " active" : "")} onClick={onToggleFormulas} aria-pressed={formulasOpen}>
            <Sigma size={11} strokeWidth={2} aria-hidden="true" /> {t(formulasOpen ? "收起计算公式" : "查看实时计算公式")}
          </button>
        </>
      )}
      {model ? <div className="track-model">
        <div className="track-model-actions">
          <button type="button" className="track-locate" onClick={()=>onViewModel(true)} disabled={!data}>{t(modelStatus==="error"?"重试模型":"模型近景")}</button>
          <button type="button" className="track-locate" onClick={()=>onViewModel(false)}>{t("轨道远景")}</button>
        </div>
        <p className="track-note" role="status">{t("{0}{1}姿态近似、比例仅供展示。", t(modelStatus==="loading"?"正在加载三维模型…":modelStatus==="error"?"模型加载失败，已保留卫星图标。":modelStatus==="ready"?"三维模型已显示。":"拉近后按需加载三维模型。"), t(model.schematic?"构型示意；":"外形模型；"))}</p>
        <a href={model.source} target="_blank" rel="noreferrer">{t("模型来源：{0}", t(model.credit))}</a>
      </div> : <p className="track-note">{t("暂无已核实的对应型号模型，保留轨道图标。")}</p>}
      <p className="track-note">{t("CelesTrak 轨道根数 + SGP4 推算，并非实时遥测。拖动可绕卫星旋转视角。")}</p>
    </section>
  );
}
