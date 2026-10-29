import { t, localeTag, useLocale } from "../i18n";
import { Flame, Tornado } from "lucide-react";
import type { LayerToggles } from "../hooks/useLayerSettings";
import { intensityScale, type HazardState } from "../layers/useHazards";
import { CMA_LEVELS, EVENT_CATEGORIES, SAFFIR_SIMPSON_LEVELS, knotsToKmh, stormAt, type EventCategory, type NaturalEvent, type Storm } from "../hazardData";
import { EVENT_STYLE } from "../hazardOverlay";
import { stormDisplayName } from "../typhoonNames";
import { relativeTime, type TimeController } from "../timeline";
import { useTimeSelector } from "../hooks/useTimeline";
import { now } from "../clock";
import { ICON, LayerGroup, ToggleRow } from "../ui/controls";
import "./hazards.css";

export const CATEGORY_LABELS: Record<EventCategory, string> = {
  wildfires: "山火", volcanoes: "火山", seaLakeIce: "海冰与冰山", dustHaze: "沙尘与霾", floods: "洪水", landslides: "滑坡",
  drought: "干旱", snow: "暴雪", tempExtremes: "极端温度", waterColor: "水色异常", manmade: "人为事件",
};
const ALERT_LABELS = { green: "绿色预警", orange: "橙色预警", red: "红色预警" } as const;
const MAX_LISTED = 12;

interface Props {
  layers: LayerToggles;
  setLayer: (key: keyof LayerToggles, value: boolean) => void;
  hazards: HazardState;
  timeline: TimeController;
  categories: ReadonlySet<EventCategory>;
  onToggleCategory: (category: EventCategory) => void;
  /** Changes when a hazard is picked on the globe, to open this group. */
  reveal: unknown;
  selectedId: string | null;
  onSelectEvent: (event: NaturalEvent) => void;
  onSelectStorm: (storm: Storm) => void;
}

export function HazardsGroup({ layers, setLayer, hazards, timeline, categories, onToggleCategory, reveal, selectedId, onSelectEvent, onSelectStorm }: Props) {
  const locale = useLocale();
  // The panel follows the timeline in ten-minute steps; the globe follows it exactly.
  const step = useTimeSelector(timeline, (state) => Math.floor((state.live ? now() : state.time) / 600_000));
  const at = step * 600_000;
  const snapshot = hazards.snapshot;
  const status = !snapshot ? t(hazards.status === "error" ? "灾害数据暂不可用，未显示；不会显示虚构的事件。" : "正在读取灾害数据…") : null;
  const events = (snapshot?.events ?? []).filter((e) => e.time <= at + 3_600_000);
  const counts = new Map<EventCategory, number>();
  for (const e of events) counts.set(e.category, (counts.get(e.category) ?? 0) + 1);
  const listed = events.filter((e) => categories.has(e.category)).slice(0, MAX_LISTED);
  const level = intensityScale(locale);
  const storms = (snapshot?.storms ?? []).map((storm) => ({ storm, fix: stormAt(storm, at) }));
  const scale = locale === "zh" ? CMA_LEVELS : SAFFIR_SIMPSON_LEVELS;
  return (
    <LayerGroup title="HAZARDS" subtitle={t("自然灾害 · 事件与台风")} reveal={reveal}>
      <ToggleRow icon={<Flame {...ICON} />} title={t("全球自然事件")} caption={t("NASA EONET · 近 30 天仍在进行的事件 · 每 30 分钟更新")}
        checked={layers.naturalEvents} onChange={(v) => setLayer("naturalEvents", v)} />
      {layers.naturalEvents && (
        <div className="layer-extra hazard-section">
          <p className="layer-status" role="status">{status ?? t("{0} 个进行中的事件（不含热带气旋）", events.length)}</p>
          {snapshot && counts.size > 0 && (
            <div className="hazard-chips" role="group" aria-label={t("事件类别")}>
              {EVENT_CATEGORIES.filter((c) => counts.has(c)).map((category) => (
                <button key={category} type="button" aria-pressed={categories.has(category)} onClick={() => onToggleCategory(category)}>
                  <i style={{ background: EVENT_STYLE[category].color }} />{t(CATEGORY_LABELS[category])}<b>{counts.get(category)}</b>
                </button>
              ))}
            </div>
          )}
          {listed.length > 0 && (
            <ul className="hazard-list">
              {listed.map((event) => (
                <li key={event.id}>
                  <button type="button" className={selectedId === "event:" + event.id ? "selected" : ""} onClick={() => onSelectEvent(event)}>
                    <i style={{ background: EVENT_STYLE[event.category].color }} />
                    <span><strong>{event.title}</strong><small>{t(CATEGORY_LABELS[event.category])} · {relativeTime(event.time, at, locale)}</small></span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="layer-note">{t("来源：NASA 地球观测站自然事件追踪（EONET）。每个事件标在最近一次观测的位置；山火多来自美国和加拿大的火情系统，其他地区覆盖较少。")}</p>
        </div>
      )}
      <ToggleRow icon={<Tornado {...ICON} />} title={t("台风路径")} caption={t("GDACS · JTWC · NHC · 实况路径与预报")}
        checked={layers.storms} onChange={(v) => setLayer("storms", v)} />
      {layers.storms && (
        <div className="layer-extra hazard-section">
          <p className="layer-status" role="status">{status ?? (storms.length ? t("{0} 个热带气旋", storms.length) : t("目前全球没有活跃的热带气旋。"))}</p>
          {storms.length > 0 && (
            <ul className="hazard-list">
              {storms.map(({ storm, fix }) => {
                const grade = level(fix?.windKt ?? storm.track.at(-1)?.windKt ?? null);
                const wind = fix?.windKt ?? null;
                return (
                  <li key={storm.id}>
                    <button type="button" className={selectedId === "storm:" + storm.id ? "selected" : ""} onClick={() => onSelectStorm(storm)}>
                      <i style={{ background: grade.color }} />
                      <span>
                        <strong>{stormDisplayName(storm.name, locale)}{storm.alert && <em className={"hazard-alert " + storm.alert}>{t(ALERT_LABELS[storm.alert])}</em>}</strong>
                        <small>{t(grade.label)}{wind !== null && " · " + Math.round(knotsToKmh(wind)).toLocaleString(localeTag()) + " km/h"}{!fix && " · " + t("不在当前时间范围内")}</small>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="thematic-legend hazard-legend">
            {scale.map((l) => <span key={l.key}><i style={{ background: l.color }} />{t(l.label)}</span>)}
          </div>
          <p className="layer-note">{t(locale === "zh"
            ? "实线为已走过的路径（每 6 小时一个点），按强度着色；虚线为预报路径，白色区域为预报不确定范围；绿、橙、红区域为风速超过 60、90、120 km/h 的大风扫过的范围（GDACS）。中国气象局按 2 分钟平均风速定级，这里用的是 1 分钟平均风速，等级可能偏高一级，以官方发布为准。"
            : "实线为已走过的路径（每 6 小时一个点），按萨菲尔-辛普森等级着色；虚线为预报路径，白色区域为预报不确定范围；绿、橙、红区域为风速超过 60、90、120 km/h 的大风扫过的范围（GDACS）。以各地气象部门的官方发布为准。")}</p>
        </div>
      )}
    </LayerGroup>
  );
}
