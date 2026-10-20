import type { KeyboardEvent } from "react";
import { ChevronLeft, ChevronRight, Clock, Pause, Play, RotateCcw, X } from "lucide-react";
import { useTimeSelector } from "../hooks/useTimeline";
import { FUTURE_MS, SPAN_LABELS, SPAN_MS, TIME_SPANS, formatTime, relativeTime, timeRange, type TimeController } from "../timeline";
import { ICON, Segmented } from "../ui/controls";

const hhmm = (time: number) => new Date(time).toISOString().slice(11, 16);
const mmddhhmm = (time: number) => new Date(time).toISOString().slice(5, 16).replace("T", " ");

/** Header badge: "LIVE · 05:40 UTC", or a button back to live while viewing another moment. */
export function TimeIndicator({ timeline }: { timeline: TimeController }) {
  const label = useTimeSelector(timeline, (s) => (s.live ? "LIVE · " + hhmm(s.time) : (s.playing ? "回放 · " : "回看 · ") + mmddhhmm(s.time)) + " UTC");
  const live = label.startsWith("LIVE");
  if (live) return <span className="online-indicator"><span /> {label}</span>;
  return (
    <button type="button" className="online-indicator replay" onClick={() => timeline.goLive()} title="回到实时" aria-label={label + "，点击回到实时"}>
      <span /> {label}
    </button>
  );
}

/** "REAL-TIME SUNLIGHT · 05:40 UTC" above the globe. */
export function SceneSubtitle({ timeline, dayNight }: { timeline: TimeController; dayNight: boolean }) {
  const label = useTimeSelector(timeline, (s) => (s.live ? (dayNight ? "REAL-TIME SUNLIGHT" : "EARTH OBSERVATION") + " · " + hhmm(s.time) : (dayNight ? "SUNLIGHT AT" : "VIEWING") + " · " + mmddhhmm(s.time)) + " UTC");
  return <span className="map-subtitle">{label}</span>;
}

interface DockProps {
  timeline: TimeController;
  open: boolean;
  onToggle: () => void;
  onReset: () => void;
}

/** Bottom dock: reset view, the time-bar toggle and, when open, the time bar. */
export function GlobeDock({ timeline, open, onToggle, onReset }: DockProps) {
  return (
    <div className={"globe-dock" + (open ? " timebar-open" : "")}>
      {open && <TimeBar timeline={timeline} onClose={onToggle} />}
      <div className="dock-row">
        <button className="dock-button" type="button" onClick={onReset} title="返回全球视角" aria-label="返回全球视角"><RotateCcw size={14} aria-hidden="true" /><span>重置视角</span></button>
        {!open && <button className="dock-button" type="button" onClick={onToggle} aria-label="打开时间轴" aria-expanded={false}><Clock size={14} aria-hidden="true" /><span>时间轴</span></button>}
      </div>
    </div>
  );
}

function TimeBar({ timeline, onClose }: { timeline: TimeController; onClose: () => void }) {
  const state = useTimeSelector(timeline, (s) => s);
  const now = state.live ? state.time : Date.now();
  const { start, end } = timeRange(state.span, now);
  const nowPercent = (SPAN_MS[state.span] / (SPAN_MS[state.span] + FUTURE_MS)) * 100;
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    timeline.step(event.key === "ArrowRight" ? 1 : -1);
  };
  return (
    <section className="timebar glass-panel" aria-label="时间轴">
      <div className="timebar-head">
        <span className={"timebar-mode" + (state.live ? " live" : "")}>{state.live ? "实时" : state.playing ? "回放中" : "回看"}</span>
        <span className="timebar-time">{formatTime(state.time)}</span>
        <span className="timebar-relative">{state.live ? "" : relativeTime(state.time, now)}</span>
        {!state.live && <button type="button" className="timebar-live" onClick={() => timeline.goLive()}>回到实时</button>}
        <button type="button" className="timebar-close" onClick={onClose} aria-label="收起时间轴"><X size={14} aria-hidden="true" /></button>
      </div>
      <div className="timebar-track">
        <button type="button" className="timebar-step" onClick={() => timeline.step(-1)} aria-label="向前一步"><ChevronLeft {...ICON} /></button>
        <button type="button" className="timebar-play" onClick={() => (state.playing ? timeline.pause() : timeline.play())} aria-label={state.playing ? "暂停回放" : "回放"}>
          {state.playing ? <Pause {...ICON} /> : <Play {...ICON} />}
        </button>
        <div className="timebar-slider">
          <input type="range" min={start} max={end} step={60_000} value={Math.min(end, Math.max(start, state.time))} aria-label="选择时间" aria-valuetext={formatTime(state.time)}
            onChange={(event) => timeline.setTime(Number(event.target.value))} onKeyDown={onKeyDown} />
          <i className="timebar-now" style={{ left: nowPercent + "%" }} aria-hidden="true" />
          <div className="timebar-scale" aria-hidden="true"><span>{mmddhhmm(start).slice(0, 5)}</span><span className="timebar-scale-now" style={{ left: nowPercent + "%" }}>现在</span></div>
        </div>
        <button type="button" className="timebar-step" onClick={() => timeline.step(1)} aria-label="向后一步"><ChevronRight {...ICON} /></button>
      </div>
      <div className="timebar-foot">
        <Segmented label="时间轴范围" options={TIME_SPANS} value={state.span} onChange={(span) => timeline.setSpan(span)} format={(span) => SPAN_LABELS[span]} />
        <span className="timebar-hint">日照、地震、卫星和每日影像跟随时间轴；极光与云图只有实时数据。</span>
      </div>
    </section>
  );
}
