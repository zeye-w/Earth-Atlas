import { t, localeTag } from "../i18n";
import { useState } from "react";
import { MousePointerClick, X } from "lucide-react";
import { DEPTH_CLASSES, type Earthquake } from "../earthquakeData";
import { ERA_GUIDE } from "../geologicTime";
import {
  formatEruptionYear,
  gvpUrl,
  isRecentlyActive,
  type Volcano,
} from "../volcanoData";
import type { useGeologyQuery } from "../layers/useGeologyQuery";
import { LocationOverview } from "./LocationOverview";
import { coordinateLabel } from "../ui/controls";

interface Props {
  open: boolean;
  live: boolean;
  onClose: () => void;
  onCenter: () => void;
  onCopy: () => void;
  onShare: () => void;
  quake: Earthquake | null;
  volcano: Volcano | null;
  geology: ReturnType<typeof useGeologyQuery>;
}

export function Inspector({
  open,
  live,
  onClose,
  onCenter,
  onCopy,
  onShare,
  quake,
  volcano,
  geology,
}: Props) {
  const { status } = geology;
  const footer = volcano
    ? t("火山数据来自 Smithsonian GVP《Volcanoes of the World》全新世火山名录。")
    : quake
      ? t("地震数据来自 USGS 实时目录，震级、深度与位置可能在复核后修订。")
      : t("环境数据：Open-Meteo；地质：Macrostrat。各项来源、时间与覆盖范围见对应分类。");
  return (
    <aside
      id="earth-inspector-panel"
      aria-label={t("地点信息")}
      aria-hidden={!open}
      inert={!open}
      className={"details-panel glass-panel" + (!open ? " is-collapsed" : "")}
      aria-live="polite"
    >
      <button
        type="button"
        className="panel-dismiss"
        onClick={onClose}
        aria-label={t("收起地点信息面板")}
      >
        <X size={15} aria-hidden="true" />
      </button>
      <div className="details-head">
        <div className="section-caption">
          LOCATION INSPECTOR <span>{t("地点信息")}</span>
        </div>
        <span className="inspect-status">
          {t(volcano
            ? "VOLCANO"
            : quake
              ? "EARTHQUAKE"
              : status === "loading"
                ? "QUERYING"
                : status === "success"
                  ? "RECORD FOUND"
                  : "AWAITING POINT")}
        </span>
      </div>
      {volcano ? (
        <VolcanoDetails volcano={volcano} />
      ) : quake ? (
        <QuakeDetails quake={quake} />
      ) : (
        <GeologyDetails
          key={`${geology.coordinates?.latitude},${geology.coordinates?.longitude}`}
          geology={geology}
          live={live}
          active={open}
          onCenter={onCenter}
          onCopy={onCopy}
          onShare={onShare}
        />
      )}
      <div className="details-footer">
        <span className="details-footer-dot" />
        <span>{t(footer)}</span>
      </div>
    </aside>
  );
}

function QuakeDetails({ quake }: { quake: Earthquake }) {
  return (
    <div className="inspector-body">
      <div className="unit-heading">
        <div className="metric-label">{t("EARTHQUAKE · 地震")}</div>
        <h2>M{t(quake.magnitude.toFixed(1))} {t(quake.place ?? "未命名地点")}</h2>
      </div>
      <div className="info-field"><span className="metric-label">{t("TIME · 发震时间")}</span><strong>{t(quake.time.toISOString().replace("T", " ").slice(0, 19))} UTC</strong><p>{t("本地时间：{0}", t(quake.time.toLocaleString(localeTag())))}</p></div>
      <div className="info-field"><span className="metric-label">{t("MAGNITUDE · 震级")}</span><strong>{t(quake.magnitude.toFixed(1))}{t(quake.magnitudeType ? " (" + quake.magnitudeType + ")" : "")}</strong></div>
      <div className="info-field"><span className="metric-label">{t("DEPTH · 震源深度")}</span><strong>{t(quake.depthKm.toFixed(1))} km</strong><p>{t(DEPTH_CLASSES.find((item) => quake.depthKm < item.maxKm)?.label)}</p></div>
      <div className="info-field"><span className="metric-label">{t("EPICENTER · 震中")}</span><strong>{t(coordinateLabel(quake.latitude, "N", "S"))} · {t(coordinateLabel(quake.longitude, "E", "W"))}</strong></div>
      {quake.tsunami && <div className="message-card"><strong>{t("USGS 标记了海啸相关信息")}</strong><p>{t("这只表示该事件位于海域且震级较大，不代表发生了海啸；请以当地海啸预警机构为准。")}</p></div>}
      <div className="source-card"><div className="metric-label">{t("SOURCE / 数据来源")}</div><strong>USGS Earthquake Hazards Program</strong><span>Event ID: {t(quake.id)}</span>{quake.url && <a href={quake.url} target="_blank" rel="noreferrer">{t("在 USGS 查看事件详情 ↗")}</a>}<p>{t("实时目录中的震级和位置可能在后续复核中修订。")}</p></div>
    </div>
  );
}

function VolcanoDetails({ volcano }: { volcano: Volcano }) {
  return (
    <div className="inspector-body">
      <div className="unit-heading">
        <div className="metric-label">{t("VOLCANO · 火山")}</div>
        <h2>{t(volcano.name)}</h2>
      </div>
      <div className="info-field"><span className="metric-label">{t("COUNTRY · 国家/地区")}</span><strong>{t(volcano.country || "未提供")}</strong></div>
      <div className="info-field"><span className="metric-label">{t("TYPE · 火山类型")}</span><strong>{t(volcano.type || "未提供")}</strong></div>
      <div className="info-field"><span className="metric-label">{t("LAST ERUPTION · 最近喷发")}</span><strong>{t(formatEruptionYear(volcano.lastEruption))}</strong><p>{t(isRecentlyActive(volcano) ? "近 5 年内有喷发记录。" : "取自 GVP 名录；不代表当前活动状态。")}</p></div>
      <div className="info-field"><span className="metric-label">{t("ELEVATION · 海拔")}</span><strong>{t(volcano.elevation !== null ? volcano.elevation + " m" : "未提供")}</strong></div>
      <div className="info-field"><span className="metric-label">{t("LOCATION · 位置")}</span><strong>{t(coordinateLabel(volcano.lat, "N", "S"))} · {t(coordinateLabel(volcano.lon, "E", "W"))}</strong></div>
      <div className="source-card"><div className="metric-label">{t("SOURCE / 数据来源")}</div><strong>Smithsonian Global Volcanism Program</strong>{volcano.id !== null && <span>Volcano Number: {volcano.id}</span>}<a href={gvpUrl(volcano)} target="_blank" rel="noreferrer">{t("在 GVP 查看火山档案 ↗")}</a><p>{t("Volcanoes of the World 全新世火山名录。当前喷发与警戒级别请以各国火山观测机构为准。")}</p></div>
    </div>
  );
}

function GeologyDetails({
  geology,
  live,
  active,
  onCenter,
  onCopy,
  onShare,
}: {
  geology: ReturnType<typeof useGeologyQuery>;
  live: boolean;
  active: boolean;
  onCenter: () => void;
  onCopy: () => void;
  onShare: () => void;
}) {
  const [tab, setTab] = useState<"overview" | "weather" | "geology">(
    "overview",
  );
  const tabs = [
    { id: "overview", label: "概览" },
    { id: "weather", label: "天气" },
    { id: "geology", label: "地质" },
  ] as const;
  const {
    status,
    coordinates,
    units,
    unit,
    selectedIndex,
    setSelectedIndex,
    lexiconStatus,
    rockInfo,
    eraInfo,
  } = geology;
  if (status === "idle" || !coordinates) {
    return (
      <div className="empty-inspector">
        <div className="empty-emblem">
          <MousePointerClick size={34} strokeWidth={1.4} aria-hidden="true" />
        </div>
        <h2>{t("点击地球上的")}<br />{t("任意位置")}</h2>
        <p>{t("查看附近城市、地点环境，以及已编绘的地表地质年代与岩石类型。")}</p>
        <span className="empty-hint">CLICK THE GLOBE TO BEGIN</span>
      </div>
    );
  }
  return (
    <div className="inspector-body">
      <div className="coordinates-block">
        <div className="metric-label">SELECTED COORDINATES</div>
        <div className="coordinate-values">
          <span>{t(coordinateLabel(coordinates.latitude, "N", "S"))}</span>
          <span>{t(coordinateLabel(coordinates.longitude, "E", "W"))}</span>
        </div>
      </div>

      <div className="location-actions">
        <button type="button" onClick={onCenter}>{t("居中地点")}</button>
        <button type="button" onClick={onCopy}>{t("复制坐标")}</button>
        <button type="button" onClick={onShare}>{t("分享地点")}</button>
      </div>
      <div className="location-tabs" role="tablist" aria-label={t("地点详情分类")}>
        {tabs.map((item, index) => (
          <button
            type="button"
            key={item.id}
            id={`location-tab-${item.id}`}
            role="tab"
            aria-selected={tab === item.id}
            aria-controls="location-tabpanel"
            tabIndex={tab === item.id ? 0 : -1}
            onClick={() => setTab(item.id)}
            onKeyDown={(event) => {
              let next = index;
              if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
              else if (event.key === "ArrowLeft")
                next = (index + tabs.length - 1) % tabs.length;
              else if (event.key === "Home") next = 0;
              else if (event.key === "End") next = tabs.length - 1;
              else return;
              event.preventDefault();
              setTab(tabs[next].id);
              document.getElementById(`location-tab-${tabs[next].id}`)?.focus();
            }}
          >
            {t(item.label)}
          </button>
        ))}
      </div>
      <div
        id="location-tabpanel"
        role="tabpanel"
        aria-labelledby={`location-tab-${tab}`}
        tabIndex={0}
      >
        {active && tab !== "geology" && (
          <LocationOverview coordinates={coordinates} live={live} mode={tab} />
        )}
        {tab === "geology" && (
          <>
            {status === "loading" && (
              <div className="query-message">
                <span className="loading-ring" />{t("正在查询 Macrostrat 地质数据库…")}</div>
            )}
            {status === "error" && (
              <div className="message-card error" role="alert">
                <strong>{t("地质查询暂时不可用")}</strong>
                <p>{t("请检查网络连接或稍后重试。不会使用模拟数据替代查询结果。")}</p>
              </div>
            )}
            {status === "empty" && (
              <div className="message-card">
                <strong>{t("当前位置暂无地质单元数据")}</strong>
                <p>{t("这可能是海域、未编绘区域或数据源暂时没有匹配记录。请尝试其他陆地区域。")}</p>
              </div>
            )}
            {status === "success" && unit && (
              <>
                {units.length > 1 && (
                  <div className="info-field">
                    <label
                      className="metric-label"
                      htmlFor="geologic-candidate"
                    >{t("MATCHING MAP UNITS · 候选地质单元 ({0})", units.length)}</label>
                    <select
                      id="geologic-candidate"
                      className="geology-select"
                      value={selectedIndex}
                      onChange={(event) =>
                        setSelectedIndex(Number(event.target.value))
                      }
                    >
                      {units.map((candidate, index) => (
                        <option
                          key={`${candidate.sourceId ?? "s"}-${candidate.mapId ?? "m"}-${index}`}
                          value={index}
                        >
                          {index + 1}. {t(candidate.name)}
                          {t(candidate.mapId !== null
                            ? ` · #${candidate.mapId}`
                            : "")}
                        </option>
                      ))}
                    </select>
                    <p>{t("同一坐标可能有来自不同地质图或不同比例尺的记录，请核对地图来源。")}</p>
                  </div>
                )}
                <div className="unit-heading">
                  <div className="metric-label">{t("MAP UNIT / 地质单元")}</div>
                  <h2>{t(unit.name)}</h2>
                </div>
                <div className="info-field">
                  <span className="metric-label">{t("GEOLOGICAL AGE · 地质年代")}</span>
                  <strong>{t(unit.age ?? "未提供")}</strong>
                </div>
                <div className="info-field">
                  <span className="metric-label">{t("LITHOLOGY · 原始岩性描述")}</span>
                  <strong>{t(unit.lithology ?? "未提供原图岩性文本")}</strong>
                </div>
                <div className="info-field">
                  <span className="metric-label">{t("ROCK CLASS · 岩石大类")}</span>
                  <div className="scientific-tag">
                    <span
                      className={"rock-swatch rock-" + rockInfo.rockClass}
                    />
                    <strong>{t(rockInfo.classLabel)}</strong>
                  </div>
                  {rockInfo.names.length > 0 && (
                    <p>{t("Macrostrat 标准岩性：{0}", t(rockInfo.names.join("、")))}</p>
                  )}
                  {lexiconStatus === "loading" && unit.lithIds.length > 0 && (
                    <p>{t("正在匹配官方岩性词典…")}</p>
                  )}
                  {lexiconStatus === "error" && unit.lithIds.length > 0 && (
                    <p>{t("词典暂不可用，已保留原始岩性；不进行推测分类。")}</p>
                  )}
                  {rockInfo.rockClass === "unclassified" &&
                    lexiconStatus !== "loading" &&
                    lexiconStatus !== "error" && (
                      <p>{t("缺少完整的标准分类依据，不从地层名称或自由文本推断。")}</p>
                    )}
                </div>
                <div className="info-field">
                  <span className="metric-label">{t("ESTIMATED AGE · 推算数值年龄")}</span>
                  <strong>{t(unit.ageRangeMa ?? "未提供完整年龄范围")}</strong>
                  <p>{t(unit.ageNote)}</p>
                </div>
                <div className="info-field">
                  <span className="metric-label">{t("ERA GUIDE · 地质年代概览")}</span>
                  <div className="scientific-tag">
                    <span
                      className="era-swatch"
                      style={{ backgroundColor: eraInfo.color }}
                    />
                    <strong>{t(eraInfo.label)}</strong>
                  </div>
                  <p>{t("仅当完整年龄范围属于同一地质代时标注；概览颜色不是当前地质图的图斑颜色。")}</p>
                  <div className="era-legend">
                    {ERA_GUIDE.map((era) => (
                      <span key={era.key} title={t(era.label)}>
                        <i style={{ backgroundColor: era.color }} />
                        {t(era.label.split(" / ")[0])}
                      </span>
                    ))}
                  </div>
                </div>
                {unit.description && (
                  <div className="info-field">
                    <span className="metric-label">{t("DESCRIPTION · 原图描述")}</span>
                    <p>{t(unit.description)}</p>
                  </div>
                )}
                <details className="source-card location-source">
                  <summary>{t("地质数据来源与说明")}</summary>
                  <strong>
                    {t(unit.sourceName ?? "Macrostrat integrated geologic map")}
                  </strong>
                  {unit.sourceId !== null && (
                    <span>Source ID: {unit.sourceId}</span>
                  )}
                  {unit.mapId !== null && (
                    <span>Map polygon ID: {unit.mapId}</span>
                  )}
                  <a
                    href={
                      unit.sourceId !== null
                        ? "https://macrostrat.org/api/v2/defs/sources?source_id=" +
                          unit.sourceId
                        : "https://macrostrat.org/map/"
                    }
                    target="_blank"
                    rel="noreferrer"
                  >{t("核对原始地图来源 ↗")}</a>
                  <p>{t("全球地质瓦片为多尺度拼接图；候选查询与可见图斑未必严格一一对应。")}</p>
                </details>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
