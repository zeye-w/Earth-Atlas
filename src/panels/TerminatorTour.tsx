import { t } from "../i18n";
import { useEffect, useRef, useState } from "react";
import { Cartesian3, type Viewer } from "cesium";
import type { TimeController } from "../timeline";
import { now } from "../clock";
import { nearbyCity } from "../locationData";
import {
  terminatorPosition,
  localSolarTime,
  type TerminatorSide,
} from "../terminatorTour";

export default function TerminatorTour({
  viewer,
  timeline,
  onClose,
  timebarOpen,
}: {
  viewer: Viewer;
  timeline: TimeController;
  onClose: () => void;
  timebarOpen: boolean;
}) {
  const [side, setSide] = useState<TerminatorSide>("sunrise");
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState(1);
  const phase = useRef(0);
  const [position, setPosition] = useState(() =>
    terminatorPosition(now(), 0, "sunrise"),
  );
  const [time, setTime] = useState(now);
  useEffect(() => {
    const pause = () => setPaused(true);
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    viewer.scene.canvas.addEventListener("pointerdown", pause);
    viewer.scene.canvas.addEventListener("wheel", pause, { passive: true });
    document.addEventListener("keydown", escape);
    return () => {
      viewer.scene.canvas.removeEventListener("pointerdown", pause);
      viewer.scene.canvas.removeEventListener("wheel", pause);
      document.removeEventListener("keydown", escape);
    };
  }, [viewer, onClose]);
  useEffect(() => {
    if (paused) return;
    let frame = 0,
      last = performance.now(),
      draw = 0,
      label = 0;
    const step = (stamp: number) => {
      if (viewer.isDestroyed()) return;
      const dt = Math.min(100, stamp - last);
      last = stamp;
      if (document.visibilityState === "visible") {
        phase.current += (dt / 180_000) * Math.PI * 2 * speed;
        if (stamp - draw >= 1000 / 24) {
          draw = stamp;
          const state = timeline.getState(),
            time = state.live ? now() : state.time;
          const point = terminatorPosition(time, phase.current, side);
          viewer.camera.setView({
            destination: Cartesian3.fromDegrees(
              point.longitude,
              point.latitude,
              9_000_000,
            ),
            orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 },
          });
          viewer.scene.requestRender();
          if (stamp - label >= 500) {
            label = stamp;
            setPosition(point);
            setTime(time);
          }
        }
      }
      frame = requestAnimationFrame(step);
    };
    viewer.camera.cancelFlight();
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [viewer, timeline, side, paused, speed]);
  const city = nearbyCity(position.latitude, position.longitude);
  return (
    <section
      className="terminator-tour glass-panel"
      style={timebarOpen ? { bottom: 280 } : undefined}
      aria-label={t("晨昏线旅行")}
    >
      <div className="tour-heading">
        <strong>{t("晨昏线旅行")}</strong>
        <button type="button" onClick={onClose}>{t("退出旅行")}</button>
      </div>
      <p>
        {t(side === "sunrise" ? "追逐日出" : "追逐日落")} ·{t(" ")}
        {t(paused ? "镜头已暂停" : "沿晨昏线往返巡游")}
      </p>
      <div className="tour-controls">
        <button
          type="button"
          aria-pressed={side === "sunrise"}
          onClick={() => setSide("sunrise")}
        >{t("日出侧")}</button>
        <button
          type="button"
          aria-pressed={side === "sunset"}
          onClick={() => setSide("sunset")}
        >{t("日落侧")}</button>
        <button type="button" onClick={() => setPaused((v) => !v)}>
          {t(paused ? "继续旅行" : "暂停旅行")}
        </button>
        <label>{t("速度")}{t(" ")}
          <select
            aria-label={t("旅行速度")}
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
          >
            <option value={0.5}>0.5×</option>
            <option value={1}>1×</option>
            <option value={2}>2×</option>
          </select>
        </label>
      </div>
      <p>{t("{0}° /{1}° · 当地太阳时{2}{3}", t(position.latitude.toFixed(1)), t(position.longitude.toFixed(1)), t(localSolarTime(time, position.longitude)), t(city ? ` · 附近：${city.name}（${Math.round(city.distance)} km）` : ""))}</p>
      <details>
        <summary>{t("时间与计算说明")}</summary>
        <p>{t("场景时间{0}{1}UTC。依据太阳几何位置计算，不包含大气折射和地形遮挡；太阳时按经度估算，未计均时差，不是行政时区时间。速度只改变镜头巡游速度。拖动或缩放地球会暂停旅行，Esc 退出。", t(new Date(time).toISOString().slice(0, 19).replace("T", " ")), t(" "))}</p>
      </details>
    </section>
  );
}
