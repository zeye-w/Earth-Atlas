import { t, localeTag, useLocale } from "../i18n";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { knotsToKmh, stormAt, stormMotion, type NaturalEvent, type Storm } from "../hazardData";
import { intensityScale } from "../layers/useHazards";
import { CATEGORY_LABELS } from "./HazardsGroup";
import { stormDisplayName } from "../typhoonNames";
import { compassName } from "../compass";
import { coordinateLabel } from "../ui/controls";
import { useTimeSelector } from "../hooks/useTimeline";
import type { TimeController } from "../timeline";
import { now } from "../clock";
import "./internet.css";

export type HazardSelection = { kind: "event"; event: NaturalEvent } | { kind: "storm"; storm: Storm };

const ALERTS = { green: "绿色（影响较小）", orange: "橙色（中等影响）", red: "红色（严重影响）" } as const;
const SOURCES: Record<string, string> = { JTWC: "美国联合台风警报中心（JTWC）", NOAA: "美国国家飓风中心（NHC）", NOAA_NHC: "美国国家飓风中心（NHC）" };

const date = (time: number) => new Intl.DateTimeFormat(localeTag(), { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(time);

/** Details of a natural event, or of a tropical cyclone at the timeline moment (minute steps). */
export function HazardCard({ selection, timeline, onClose }: { selection: HazardSelection; timeline: TimeController; onClose: () => void }) {
  const locale = useLocale();
  const time = useTimeSelector(timeline, (state) => (state.live ? Math.floor(now() / 60_000) * 60_000 : state.time));
  let kind: string, title: string, link: [string, string] | null = null;
  const items: [string, string][] = [];
  if (selection.kind === "event") {
    const e = selection.event;
    kind = CATEGORY_LABELS[e.category];
    title = e.title;
    items.push([t("最近观测"), date(e.time)]);
    items.push([t("位置"), coordinateLabel(e.latitude, "N", "S") + " · " + coordinateLabel(e.longitude, "E", "W")]);
    if (e.source) items.push([t("数据来源"), e.source]);
    if (e.url) link = [t("查看来源"), e.url];
  } else {
    const s = selection.storm;
    const fix = stormAt(s, time), motion = stormMotion(s, time);
    const grade = intensityScale(locale)(fix?.windKt ?? null);
    kind = "热带气旋";
    title = stormDisplayName(s.name, locale);
    items.push([t("强度"), t(grade.label) + (fix?.forecast ? " · " + t("预报") : "")]);
    if (fix?.windKt != null) items.push([t("最大风速"), Math.round(knotsToKmh(fix.windKt)) + " km/h（" + Math.round(fix.windKt) + " kt）"]);
    if (s.maxWindKmh !== null) items.push([t("过程最强"), Math.round(s.maxWindKmh) + " km/h"]);
    if (motion && fix) items.push([t("移动"), t(compassName(motion.heading)) + " · " + Math.round(motion.speedKmh) + " km/h"]);
    if (fix) items.push([t("中心位置"), coordinateLabel(fix.latitude, "N", "S") + " · " + coordinateLabel(fix.longitude, "E", "W")]);
    else items.push([t("时间"), t("所选时间不在这个气旋的路径范围内")]);
    if (s.alert) items.push([t("GDACS 预警"), t(ALERTS[s.alert])]);
    if (s.countries.length) items.push([t("可能影响"), s.countries.join("、")]);
    if (s.advisory) items.push([t("最近一次预报"), date(s.advisory)]);
    if (s.source) items.push([t("数据来源"), t(SOURCES[s.source] ?? s.source)]);
    if (s.report) link = [t("GDACS 灾害报告"), s.report];
  }
  return createPortal(
    <section className="internet-card hazard-card glass-panel" aria-label={t(kind) + " " + title}>
      <header>
        <div><span>{t(kind)}</span><strong>{title}</strong></div>
        <button type="button" onClick={onClose} aria-label={t("关闭")}><X size={13} aria-hidden="true" /></button>
      </header>
      <dl>{items.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
      {link && <a className="internet-card-link" href={link[1]} target="_blank" rel="noopener noreferrer">{link[0]}</a>}
    </section>,
    document.querySelector<HTMLElement>(".workspace") ?? document.body,
  );
}
