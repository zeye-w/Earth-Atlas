import { ENGLISH } from "../locales/en.ts";
export type Locale = "zh" | "en";
export function resolveLocale(search: string, saved: string | null): Locale {
  const requested = new URLSearchParams(search).get("lang");
  if (requested === "en" || requested === "zh") return requested;
  // English by default; Chinese for visitors who chose it (saved by the switch).
  return saved === "zh" ? "zh" : "en";
}
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Data labels and assembled status messages keep their canonical source values.
// Translate only known catalog fragments; never change dataset identifiers.
const fragments = new RegExp(Object.keys(ENGLISH).filter(key => key.length >= 2 && !/\{\d+\}/.test(key)).sort((a, b) => b.length - a.length).map(escape).join("|"), "g");
export function translate(value: unknown, locale: Locale, ...values: unknown[]): string {
  if (value === null || value === undefined || typeof value === "boolean") return "";
  let text = String(value);
  if (locale === "en") {
    if (Object.hasOwn(ENGLISH, text)) text = ENGLISH[text];
    else if (/\p{Script=Han}/u.test(text)) {
      text = text.replace(/公元前\s*(\d+)\s*年/g, "$1 BCE");
      text = text.replace(fragments, (key, offset, original) => {
        let en = ENGLISH[key];
        if (/[\dA-Za-z]/.test(original[offset - 1] || "") && /^[A-Za-z]/.test(en)) en = " " + en;
        if (/[\dA-Za-z]/.test(original[offset + key.length] || "") && /[A-Za-z]$/.test(en)) en += " ";
        return en;
      });
      text = text.replace(/[，。；：、（）「」“”]/g, ch => ({ "，": ", ", "。": ". ", "；": "; ", "：": ": ", "、": ", ", "（": " (", "）": ")", "「": "\"", "」": "\"", "“": "\"", "”": "\"" })[ch]!);
    }
  }
  return text.replace(/\{(\d+)\}/g, (match, index) => index < values.length ? translate(values[index], locale) : match);
}
