import { t, localeTag } from "../i18n";
import { createPortal } from "react-dom";
import { useEffect, useMemo, useState } from "react";
import { Pause, Play, X } from "lucide-react";
import type { AstronomyModule } from "../layers/useAstronomy";
import type { EclipseView } from "../astronomy/index";
import { coordinateLabel } from "../ui/controls";
import { dayFormat, eclipseLabel } from "./AstronomyGroup";
import "./internet.css";

const MINUTE = 60_000;
/** A whole solar eclipse (about five hours) plays in this long. */
const PLAY_SECONDS = 25;
const TICK_MS = 100;

const localTime = (time: number) => new Intl.DateTimeFormat(localeTag(), { hour: "2-digit", minute: "2-digit", hour12: false }).format(time);
const utc = (time: number) => new Date(time).toISOString().slice(11, 16) + " UTC";

interface Props {
  module: AstronomyModule;
  view: EclipseView;
  onTime: (time: number) => void;
  /** The place picked on the globe, to say how much of the Sun is covered there. */
  point: { latitude: number; longitude: number } | null;
  onClose: () => void;
}

/** A selected eclipse: what and where, and (solar) a clock to run the Moon's shadow across the Earth. */
export function EclipseCard({ module, view, onTime, point, onClose }: Props) {
  const { eclipse, time } = view;
  const solar = eclipse.type === "solar" ? eclipse : null;
  const track = useMemo(() => (solar ? module.solarEclipseTrack(solar) : null), [module, solar]);
  const [playing, setPlaying] = useState(false);
  const start = track ? track.partialStart : eclipse.peak, end = track ? track.partialEnd : eclipse.peak;
  // The deepest moment at the picked place, in two-minute steps.
  const local = useMemo(() => {
    if (!track || !point) return null;
    let best = 0, time = eclipse.peak;
    for (let at = start; at <= end; at += 2 * MINUTE) {
      const value = module.obscurationAt(at, point.latitude, point.longitude);
      if (value > best) { best = value; time = at; }
    }
    return { best, time };
  }, [module, track, point, start, end, eclipse.peak]);

  useEffect(() => {
    if (!playing || !track) return;
    const step = ((end - start) / PLAY_SECONDS) * (TICK_MS / 1000);
    let at = time >= end ? start : time;
    const timer = window.setInterval(() => {
      at = Math.min(end, at + step);
      onTime(at);
      if (at >= end) setPlaying(false);
    }, TICK_MS);
    return () => window.clearInterval(timer);
    // Restarts only on play/pause; the running clock is local to the effect.
  }, [playing]);

  const items: [string, string][] = [];
  items.push([t("食甚"), localTime(eclipse.peak) + "（" + utc(eclipse.peak) + "）"]);
  if (solar) {
    if (solar.latitude !== null && solar.longitude !== null) items.push([t("食甚地点"), coordinateLabel(solar.latitude, "N", "S") + " · " + coordinateLabel(solar.longitude, "E", "W")]);
    if (track && track.center.length > 1) {
      // Path width where the shadow is at greatest eclipse.
      const i = Math.round(((eclipse.peak - track.centralStart!) / (track.centralEnd! - track.centralStart!)) * (track.center.length - 1));
      const north = track.northLimit[Math.min(i, track.northLimit.length - 1)], south = track.southLimit[Math.min(i, track.southLimit.length - 1)];
      if (north && south) items.push([t(solar.kind === "annular" ? "环食带宽度" : "全食带宽度"), Math.round(module.distanceKm(north, south)) + " km"]);
    }
    if (track) items.push([t("偏食全程"), localTime(track.partialStart) + " – " + localTime(track.partialEnd) + t("（地球上任一处）")]);
    if (local) items.push([t("所选地点"), local.best > 0 ? t("最多遮住太阳的 {0}%，{1}", Math.round(local.best * 100), localTime(local.time)) : t("看不到这次日食")]);
  } else if (eclipse.type === "lunar") {
    const sd = eclipse.semiDuration;
    items.push([t("半影食"), localTime(eclipse.peak - sd.penumbral * MINUTE) + " – " + localTime(eclipse.peak + sd.penumbral * MINUTE)]);
    if (sd.partial > 0) items.push([t("偏食"), localTime(eclipse.peak - sd.partial * MINUTE) + " – " + localTime(eclipse.peak + sd.partial * MINUTE)]);
    if (sd.total > 0) items.push([t("全食"), localTime(eclipse.peak - sd.total * MINUTE) + " – " + localTime(eclipse.peak + sd.total * MINUTE)]);
    items.push([t("哪里能看到"), t("橙色圈内的半个地球（食甚时月亮在地平线上）")]);
  }

  return createPortal(
    <section className="internet-card eclipse-card glass-panel" aria-label={t(eclipseLabel(eclipse)) + " " + dayFormat(eclipse.peak)}>
      <header>
        <div><span>{t(eclipseLabel(eclipse))}</span><strong>{dayFormat(eclipse.peak)}</strong></div>
        <button type="button" onClick={onClose} aria-label={t("关闭")}><X size={13} aria-hidden="true" /></button>
      </header>
      {track && (
        <div className="eclipse-clock">
          <button type="button" onClick={() => setPlaying((p) => !p)} aria-label={t(playing ? "暂停" : "播放月影")}>
            {playing ? <Pause size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}
          </button>
          <input type="range" min={start} max={end} step={MINUTE} value={Math.min(end, Math.max(start, time))}
            onChange={(e) => { setPlaying(false); onTime(Number(e.target.value)); }} aria-label={t("日食进程")} />
          <output>{localTime(time)}</output>
        </div>
      )}
      <dl>{items.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
      <p className="eclipse-note">{t("地球的光照切换到了这次日月食的时刻；关闭卡片即回到时间轴。时间按本地时区显示。")}</p>
    </section>,
    document.querySelector<HTMLElement>(".workspace") ?? document.body,
  );
}
