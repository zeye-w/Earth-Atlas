import { t, localeTag, useLocale } from "../i18n";
import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Sparkles } from "lucide-react";
import type { Highlight } from "../highlights";
import { knotsToKmh } from "../hazardData";
import { countdown } from "../launchData";
import { intensityScale } from "../layers/useHazards";
import { stormDisplayName } from "../typhoonNames";
import { relativeTime } from "../timeline";
import { now } from "../clock";
import "./highlights.css";

const STORAGE_KEY = "terrascope.highlights";
const KIND_LABELS: Record<Highlight["kind"], string> = {
  storm: "热带气旋", launch: "火箭发射", quake: "地震", aurora: "极光", volcano: "火山", terminator: "昼夜", iss: "空间站",
};
const KIND_COLORS: Record<Highlight["kind"], string> = {
  storm: "#d65cff", launch: "#ffb347", quake: "#ff6b5a", aurora: "#5ee08a", volcano: "#e5483b", terminator: "#ffd166", iss: "#8fe3ff",
};

/** First visit: open on wide screens, closed on phones; afterwards whatever the visitor chose. */
function initialOpen(): boolean {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "open" || saved === "closed") return saved === "open";
  } catch { /* storage blocked */ }
  return typeof window === "undefined" || window.innerWidth >= 760;
}

/** Ticks once a second while a countdown is shown. */
function useClockTick(active: boolean): number {
  const [time, setTime] = useState(now);
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") setTime(now()); }, 1_000);
    return () => window.clearInterval(timer);
  }, [active]);
  return time;
}

function useWords(item: Highlight, at: number): { headline: string; detail: string } {
  const locale = useLocale();
  switch (item.kind) {
    case "storm": {
      const grade = intensityScale(locale)(item.windKt);
      const wind = item.windKt !== null ? " · " + Math.round(knotsToKmh(item.windKt)).toLocaleString(localeTag()) + " km/h" : "";
      const where = item.storm.countries.length ? " · " + t("可能影响 {0}", item.storm.countries.slice(0, 2).join(locale === "zh" ? "、" : ", ")) : "";
      return { headline: t(grade.label) + " " + stormDisplayName(item.storm.name, locale), detail: (item.storm.alert ? t({ red: "红色预警", orange: "橙色预警", green: "绿色预警" }[item.storm.alert]) : "") + wind + where };
    }
    case "launch": {
      const l = item.launch;
      return { headline: l.mission, detail: [l.rocket, countdown(l, at), l.location || l.pad].filter(Boolean).join(" · ") };
    }
    case "quake":
      return { headline: "M" + item.quake.magnitude.toFixed(1) + " · " + (item.quake.place ?? t("未知地点")), detail: relativeTime(item.quake.time.getTime(), at, locale) + (item.quake.tsunami ? " · " + t("有海啸信息") : "") };
    case "aurora":
      return { headline: t("地磁暴 · Kp {0}", item.kp.toFixed(1)), detail: t("今晚高纬度地区很可能看到极光") };
    case "volcano":
      return { headline: item.event.title, detail: relativeTime(item.event.time, at, locale) };
    case "terminator":
      return { headline: t("此刻的晨昏线"), detail: t("看太阳正从哪里升起、在哪里落下") };
    case "iss":
      return { headline: t("国际空间站此刻在哪"), detail: t("跟随它绕地球飞行，约 90 分钟一圈") };
  }
}

function Item({ item, at, onSelect }: { item: Highlight; at: number; onSelect: (item: Highlight) => void }) {
  const { headline, detail } = useWords(item, at);
  return (
    <li>
      <button type="button" onClick={() => onSelect(item)}>
        <i style={{ background: KIND_COLORS[item.kind] }} aria-hidden="true" />
        <span>
          <small style={{ color: KIND_COLORS[item.kind] }}>{t(KIND_LABELS[item.kind])}</small>
          <strong>{headline}</strong>
          {detail && <em>{detail}</em>}
        </span>
      </button>
    </li>
  );
}

/** "Today's highlights" over the globe: a few live things worth a look, one click each. */
export function HighlightsCard({ highlights, ready, onSelect }: { highlights: Highlight[]; ready: boolean; onSelect: (item: Highlight) => void }) {
  const [open, setOpen] = useState(initialOpen);
  const toggle = () => {
    setOpen((value) => {
      try { localStorage.setItem(STORAGE_KEY, value ? "closed" : "open"); } catch { /* storage blocked */ }
      return !value;
    });
  };
  const at = useClockTick(open && highlights.some((h) => h.kind === "launch"));
  if (!ready || !highlights.length) return null;
  return (
    <section className={"highlights glass-panel" + (open ? " open" : "")} aria-label={t("今日看点")}>
      <button type="button" className="highlights-head" onClick={toggle} aria-expanded={open}>
        <Sparkles size={13} aria-hidden="true" />
        <span>{t("今日看点")}</span>
        {!open && <b>{highlights.length}</b>}
        {open ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
      </button>
      {open && <ul>{highlights.map((item) => <Item key={item.id} item={item} at={at} onSelect={onSelect} />)}</ul>}
    </section>
  );
}
