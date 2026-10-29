/**
 * Anonymous usage statistics (see worker/stats.ts and /admin).
 *
 * Sent: a random visitor ID kept in this browser, a per-tab session ID, the UI
 * language, a device class and which features are used (e.g. "layer:clouds").
 * Never sent: names, accounts, coordinates, search text or the page URL.
 * Off on the production site when the browser asks not to be tracked (Do Not
 * Track / Global Privacy Control), when the visitor switches it off in
 * Settings, while recording (?record), and everywhere except the live site.
 */
import { getLocale } from "./i18n.ts";

export type FeatureEvent = "layer" | "show" | "share" | "tour" | "live_photo" | "search";
type EventName = "view" | "ping" | FeatureEvent;

const ENDPOINT = "/api/stats/collect";
const OPT_OUT_KEY = "terrascope.analytics";
const VISITOR_KEY = "terrascope.visitor";
const SESSION_KEY = "terrascope.session";
const PING_MS = 60_000;
const FLUSH_MS = 10_000;
const MAX_PINGS = 240; // four hours of foreground time per tab
const MAX_QUEUE = 20;

export interface PrivacySignals { doNotTrack: boolean; globalPrivacyControl: boolean; optedOut: boolean; production: boolean; host: string; recording: boolean }
/** Whether statistics may be sent at all. */
export function analyticsAllowed(s: PrivacySignals): boolean {
  if (!s.production || s.recording || s.doNotTrack || s.globalPrivacyControl || s.optedOut) return false;
  return s.host !== "localhost" && s.host !== "127.0.0.1" && !s.host.endsWith(".local");
}

/** Phone, tablet or desktop from the viewport and pointer, without the user agent. */
export function deviceClass(width: number, height: number, coarsePointer: boolean): "phone" | "tablet" | "desktop" {
  const short = Math.min(width, height);
  if (coarsePointer && short < 600) return "phone";
  if (coarsePointer) return "tablet";
  return short < 500 ? "phone" : "desktop";
}

/** Event details are short identifiers ("clouds", "rocket"), never free text. */
export function safeDetail(detail: string): string {
  return detail.replace(/[^A-Za-z0-9_.:-]/g, "").slice(0, 40);
}

function storage(kind: "localStorage" | "sessionStorage"): Storage | null {
  try { return window[kind]; } catch { return null; }
}
function randomId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function analyticsOptedOut(): boolean {
  return storage("localStorage")?.getItem(OPT_OUT_KEY) === "off";
}

let enabled = false;
let visitor = "";
let session = "";
let isNew = false;
let queue: { name: EventName; detail: string }[] = [];
let pings = 0;
let pingTimer = 0;
let flushTimer = 0;

function flush(beacon = false) {
  if (!enabled || queue.length === 0) return;
  const events = queue.splice(0, MAX_QUEUE);
  const width = window.innerWidth, height = window.innerHeight;
  const body = JSON.stringify({
    visitor, session, isNew, lang: getLocale(), events,
    device: deviceClass(width, height, window.matchMedia?.("(pointer: coarse)").matches ?? false),
    referrer: document.referrer,
  });
  isNew = false;
  try {
    if (beacon && navigator.sendBeacon?.(ENDPOINT, new Blob([body], { type: "application/json" }))) return;
    void fetch(ENDPOINT, { method: "POST", body, headers: { "Content-Type": "application/json" }, keepalive: true }).catch(() => {});
  } catch { /* statistics must never break the page */ }
  if (queue.length) flush(beacon);
}

function push(name: EventName, detail = "") {
  if (!enabled) return;
  queue.push({ name, detail: safeDetail(detail) });
  if (queue.length >= MAX_QUEUE) flush();
  else if (!flushTimer) flushTimer = window.setTimeout(() => { flushTimer = 0; flush(); }, FLUSH_MS);
}

/** Record a feature use, e.g. track("layer", "clouds"). No-op when statistics are off. */
export function track(name: FeatureEvent, detail = "") { push(name, detail); }

function schedulePing() {
  window.clearInterval(pingTimer);
  pingTimer = document.visibilityState === "visible" ? window.setInterval(() => {
    if (++pings > MAX_PINGS) { window.clearInterval(pingTimer); return; }
    push("ping");
  }, PING_MS) : 0;
}

/** Start once, after the first paint of the app. */
export function startAnalytics(recording: boolean) {
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  enabled = analyticsAllowed({
    production: import.meta.env.PROD, recording, host: location.hostname, optedOut: analyticsOptedOut(),
    doNotTrack: nav.doNotTrack === "1", globalPrivacyControl: nav.globalPrivacyControl === true,
  });
  if (!enabled) return;
  const local = storage("localStorage"), tab = storage("sessionStorage");
  visitor = local?.getItem(VISITOR_KEY) ?? "";
  if (!visitor) { visitor = randomId(); isNew = true; local?.setItem(VISITOR_KEY, visitor); }
  session = tab?.getItem(SESSION_KEY) ?? "";
  if (!session) { session = randomId(); tab?.setItem(SESSION_KEY, session); }
  push("view");
  flush();
  schedulePing();
  document.addEventListener("visibilitychange", () => {
    schedulePing();
    if (document.visibilityState === "hidden") flush(true);
  });
  window.addEventListener("pagehide", () => flush(true));
}

/** The Settings switch: off stops sending at once and forgets the visitor ID. */
export function setAnalyticsEnabled(on: boolean) {
  const local = storage("localStorage");
  if (on) {
    local?.removeItem(OPT_OUT_KEY);
    return;
  }
  local?.setItem(OPT_OUT_KEY, "off");
  local?.removeItem(VISITOR_KEY);
  queue = [];
  enabled = false;
  window.clearInterval(pingTimer);
}
