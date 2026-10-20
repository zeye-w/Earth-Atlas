import { useEffect, useRef, useState } from "react";
import type { Cartesian3, Viewer } from "cesium";
import { Satellite, X } from "lucide-react";
import { compassName } from "../compass";
import type { Observer, Telemetry } from "../satelliteTelemetry";
import type { UserLocation } from "../hooks/useUserLocation";

const REFRESH_MS = 250;
const CARD_OFFSET = { x: 26, y: -24 };

interface Props {
  viewer: Viewer;
  title: string;
  live: boolean;
  tracking: { telemetry: (observer: Observer | null) => Telemetry | null; position: () => Cartesian3 | undefined };
  location: UserLocation | null;
  onLocate: () => void;
  onStop: () => void;
}

const lat = (v: number) => Math.abs(v).toFixed(2) + "°" + (v >= 0 ? "N" : "S");
const lon = (v: number) => Math.abs(v).toFixed(2) + "°" + (v >= 0 ? "E" : "W");
const number = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 });

/**
 * Live readouts beside the tracked satellite: refreshed four times a second
 * and repositioned after every render so it stays next to the marker.
 */
export function TrackCard({ viewer, title, live, tracking, location, onLocate, onStop }: Props) {
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
      const x = Math.min(Math.max(12, screen.x + CARD_OFFSET.x), width - card.offsetWidth - 12);
      const y = Math.min(Math.max(80, screen.y + CARD_OFFSET.y), height - card.offsetHeight - 12);
      card.style.transform = "translate(" + Math.round(x) + "px, " + Math.round(y) + "px)";
      card.classList.toggle("is-floating", true);
    };
    place();
    return scene.postRender.addEventListener(place);
  }, [viewer, tracking]);

  return (
    <section ref={cardRef} className="track-card glass-panel" aria-label={"正在跟踪 " + title} aria-live="off">
      <header>
        <Satellite size={14} strokeWidth={1.7} aria-hidden="true" />
        <strong>{title}</strong>
        <span className="track-badge">跟踪中</span>
        <button type="button" onClick={onStop} aria-label="停止跟踪"><X size={13} aria-hidden="true" /></button>
      </header>
      {!data ? <p className="track-empty">这一时刻离轨道根数历元太远，没有可靠的位置。</p> : (
        <>
          <dl>
            <dt>时间</dt><dd>{data.time.toISOString().slice(0, 19).replace("T", " ")} UTC{live ? "" : " · 时间轴"}</dd>
            <dt>星下点</dt><dd>{lat(data.latitude)} {lon(data.longitude)}</dd>
            <dt>高度</dt><dd>{data.altitudeKm.toFixed(1)} km</dd>
            <dt>速度</dt><dd>{data.speedKmS.toFixed(2)} km/s</dd>
            <dt>航向</dt><dd>{compassName(data.headingDeg)} {Math.round(data.headingDeg)}°</dd>
            <dt>光照</dt><dd>{data.sunlit ? "日照中" : "地球阴影中"}</dd>
            <dt>轨道周期</dt><dd>{data.periodMin.toFixed(1)} 分钟</dd>
          </dl>
          {data.look ? (
            <div className="track-look">
              <span>从我的位置看</span>
              {data.look.elevation >= 0
                ? <p>方位 {compassName(data.look.azimuth)} {Math.round(data.look.azimuth)}° · 仰角 {data.look.elevation.toFixed(1)}° · 距离 {number.format(data.look.rangeKm)} km</p>
                : <p>在地平线以下（仰角 {data.look.elevation.toFixed(0)}°）· 距离 {number.format(data.look.rangeKm)} km</p>}
            </div>
          ) : (
            <button type="button" className="track-locate" onClick={onLocate}>显示从我的位置看的方位和仰角</button>
          )}
        </>
      )}
      <p className="track-note">CelesTrak 轨道根数 + SGP4 推算，并非实时遥测。拖动可绕卫星旋转视角。</p>
    </section>
  );
}
