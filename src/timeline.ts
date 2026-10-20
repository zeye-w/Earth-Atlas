/**
 * The scene's clock. "Live" follows real UTC; otherwise the user has moved
 * the timeline to a fixed moment, or is replaying forward from one. Layers
 * subscribe and redraw for that moment (sunlight, earthquakes, satellites,
 * daily imagery); feeds that only exist for "now" say so instead.
 * Cesium-free so it can be unit tested.
 */
export type TimeSpan = "day" | "week" | "month";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export const TIME_SPANS: readonly TimeSpan[] = ["day", "week", "month"];
export const SPAN_MS: Readonly<Record<TimeSpan, number>> = { day: DAY, week: 7 * DAY, month: 30 * DAY };
export const SPAN_LABELS: Readonly<Record<TimeSpan, string>> = { day: "24 小时", week: "7 天", month: "30 天" };
/** The timeline also reaches this far ahead (sunlight and orbits only). */
export const FUTURE_MS = DAY;
/** Simulated milliseconds per real millisecond while replaying. */
export const PLAY_RATE: Readonly<Record<TimeSpan, number>> = { day: HOUR / 1000, week: 6 * HOUR / 1000, month: DAY / 1000 };
/** Step buttons and arrow keys. */
export const STEP_MS: Readonly<Record<TimeSpan, number>> = { day: HOUR, week: 6 * HOUR, month: DAY };
const LIVE_REFRESH_MS = 60_000;
const PLAY_TICK_MS = 50;

export interface TimeState {
  live: boolean;
  playing: boolean;
  /** Scene time, ms since epoch. */
  time: number;
  span: TimeSpan;
}

export function timeRange(span: TimeSpan, now: number): { start: number; end: number } {
  return { start: now - SPAN_MS[span], end: now + FUTURE_MS };
}

export function clampTime(time: number, span: TimeSpan, now: number): number {
  const { start, end } = timeRange(span, now);
  return Math.min(end, Math.max(start, time));
}

/** "2026-10-18 14:05 UTC" */
export function formatTime(time: number): string {
  return new Date(time).toISOString().slice(0, 16).replace("T", " ") + " UTC";
}

/** "现在", "1 天 6 小时前", "3 小时后", "25 分钟前". */
export function relativeTime(time: number, now: number): string {
  const delta = time - now;
  const abs = Math.abs(delta);
  if (abs < 60_000) return "现在";
  const days = Math.floor(abs / DAY);
  const hours = Math.floor((abs % DAY) / HOUR);
  const minutes = Math.floor((abs % HOUR) / 60_000);
  const text = days > 0 ? days + " 天" + (hours ? " " + hours + " 小时" : "") : hours > 0 ? hours + " 小时" + (minutes ? " " + minutes + " 分" : "") : minutes + " 分钟";
  return text + (delta < 0 ? "前" : "后");
}

type Listener = (state: TimeState) => void;

export class TimeController {
  private state: TimeState;
  private readonly listeners = new Set<Listener>();
  private liveTimer: ReturnType<typeof setInterval> | null = null;
  private playTimer: ReturnType<typeof setInterval> | null = null;
  private lastTick = 0;
  private readonly clock: () => number;

  constructor(initial: { time?: number; span?: TimeSpan } = {}, clock: () => number = Date.now) {
    this.clock = clock;
    const span = initial.span ?? "week";
    const now = clock();
    this.state = initial.time === undefined
      ? { live: true, playing: false, time: now, span }
      : { live: false, playing: false, time: clampTime(initial.time, span, now), span };
  }

  /** Starts the live refresh; returns a cleanup function. */
  start(): () => void {
    this.liveTimer = setInterval(() => this.refreshLive(), LIVE_REFRESH_MS);
    const onVisible = () => { if (typeof document === "undefined" || document.visibilityState === "visible") this.refreshLive(); };
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisible);
    return () => {
      if (this.liveTimer !== null) clearInterval(this.liveTimer);
      this.liveTimer = null;
      this.stopPlayTimer();
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisible);
    };
  }

  getState = (): TimeState => this.state;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  private update(next: Partial<TimeState>): void {
    this.state = { ...this.state, ...next };
    for (const listener of this.listeners) listener(this.state);
  }

  refreshLive(): void {
    if (this.state.live) this.update({ time: this.clock() });
  }

  goLive(): void {
    this.stopPlayTimer();
    this.update({ live: true, playing: false, time: this.clock() });
  }

  /** Moves to a fixed moment (clamped to the visible range). */
  setTime(time: number): void {
    const now = this.clock();
    const clamped = clampTime(time, this.state.span, now);
    // Dragging back onto the present returns to live.
    if (!this.state.playing && Math.abs(clamped - now) < 60_000) { this.goLive(); return; }
    this.update({ live: false, time: clamped });
  }

  step(direction: 1 | -1): void {
    this.setTime(this.state.time + direction * STEP_MS[this.state.span]);
  }

  setSpan(span: TimeSpan): void {
    const time = this.state.live ? this.clock() : clampTime(this.state.time, span, this.clock());
    this.update({ span, time });
  }

  /**
   * Replays forward from the current moment; from the start of the range
   * when live or so close to the present that the replay would end at once.
   */
  play(): void {
    const now = this.clock();
    const nearPresent = now - this.state.time < SPAN_MS[this.state.span] / 10;
    const start = this.state.live || nearPresent ? timeRange(this.state.span, now).start : this.state.time;
    this.update({ live: false, playing: true, time: start });
    this.stopPlayTimer();
    this.lastTick = this.clock();
    this.playTimer = setInterval(() => this.advance(), PLAY_TICK_MS);
  }

  pause(): void {
    this.stopPlayTimer();
    this.update({ playing: false });
  }

  /** One replay step; reaching the present switches back to live. */
  advance(): void {
    const realNow = this.clock();
    const elapsed = Math.min(realNow - this.lastTick, 250);
    this.lastTick = realNow;
    const time = this.state.time + elapsed * PLAY_RATE[this.state.span];
    if (time >= realNow) this.goLive();
    else this.update({ time });
  }

  private stopPlayTimer(): void {
    if (this.playTimer !== null) clearInterval(this.playTimer);
    this.playTimer = null;
  }
}
