import { useSyncExternalStore } from "react";
import { resolveLocale, translate, type Locale } from "./i18n/core.ts";
export type { Locale } from "./i18n/core.ts";

const STORAGE_KEY = "terrascope.language";
function initialLocale(): Locale {
  if (typeof window === "undefined") return "en";
  let saved = null;
  try { saved = window.localStorage.getItem(STORAGE_KEY); } catch { /* Storage may be blocked. */ }
  return resolveLocale(window.location.search, saved);
}
let locale = initialLocale();
const listeners = new Set<() => void>();
export const getLocale = () => locale;
export const localeTag = () => locale === "en" ? "en-US" : "zh-CN";
export const t = (value: unknown, ...values: unknown[]) => translate(value, locale, ...values);
export function subscribeLocale(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function useLocale() { return useSyncExternalStore(subscribeLocale, getLocale, () => "en" as Locale); }
function updateDocument() {
  if (typeof document === "undefined") return;
  document.documentElement.lang = locale === "en" ? "en" : "zh-CN";
  document.title = locale === "en" ? "TerraScope | Digital Earth" : "TerraScope | 数字地球";
  const description = document.querySelector('meta[name="description"]');
  description?.setAttribute("content", locale === "en" ? "Explore real-time day and night, satellite orbits, weather and surface geology on an interactive 3D Earth." : "TerraScope 数字地球 — 在三维地球上探索实时昼夜、卫星轨道与全球地质年代、岩性和地表地质单元。");
  // The loading screen (index.html, see src/splash.ts) is English in both languages.
}
export function setLocale(next: Locale) {
  if (next !== "en" && next !== "zh") return;
  locale = next;
  if (typeof window !== "undefined") {
    try { localStorage.setItem(STORAGE_KEY, next); } catch { /* In-memory switching still works. */ }
    const url = new URL(window.location.href);
    url.searchParams.set("lang", next);
    try { history.replaceState(history.state, "", url); } catch { /* Embedded browsers may forbid history changes. */ }
  }
  updateDocument(); listeners.forEach(listener => listener());
}
updateDocument();
