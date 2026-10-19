import { MousePointerClick, X } from "lucide-react";
import { DEPTH_CLASSES, type Earthquake } from "../earthquakeData";
import { ERA_GUIDE } from "../geologicTime";
import { formatEruptionYear, gvpUrl, isRecentlyActive, type Volcano } from "../volcanoData";
import type { useGeologyQuery } from "../layers/useGeologyQuery";
import { coordinateLabel } from "../ui/controls";

interface Props {
  open: boolean;
  onClose: () => void;
  quake: Earthquake | null;
  volcano: Volcano | null;
  geology: ReturnType<typeof useGeologyQuery>;
}

export function Inspector({ open, onClose, quake, volcano, geology }: Props) {
  const { status } = geology;
  const footer = volcano
    ? "火山数据来自 Smithsonian GVP《Volcanoes of the World》全新世火山名录。"
    : quake
      ? "地震数据来自 USGS 实时目录，震级、深度与位置可能在复核后修订。"
      : "科学数据来自 Macrostrat。岩性与地质年代取自地表地质图，并非直接地下测量；不同地区的比例尺和数据完整性不同。";
  return (
    <aside id="earth-inspector-panel" aria-label="地点信息" aria-hidden={!open} inert={!open} className={"details-panel glass-panel" + (!open ? " is-collapsed" : "")} aria-live="polite">
      <button type="button" className="panel-dismiss" onClick={onClose} aria-label="收起地点信息面板"><X size={15} aria-hidden="true" /></button>
      <div className="details-head">
        <div className="section-caption">LOCATION INSPECTOR <span>地点信息</span></div>
        <span className="inspect-status">{volcano ? "VOLCANO" : quake ? "EARTHQUAKE" : status === "loading" ? "QUERYING" : status === "success" ? "RECORD FOUND" : "AWAITING POINT"}</span>
      </div>
      {volcano ? <VolcanoDetails volcano={volcano} /> : quake ? <QuakeDetails quake={quake} /> : <GeologyDetails geology={geology} />}
      <div className="details-footer">
        <span className="details-footer-dot" />
        <span>{footer}</span>
      </div>
    </aside>
  );
}

function QuakeDetails({ quake }: { quake: Earthquake }) {
  return (
    <div className="inspector-body">
      <div className="unit-heading">
        <div className="metric-label">EARTHQUAKE · 地震</div>
        <h2>M{quake.magnitude.toFixed(1)} {quake.place ?? "未命名地点"}</h2>
      </div>
      <div className="info-field"><span className="metric-label">TIME · 发震时间</span><strong>{quake.time.toISOString().replace("T", " ").slice(0, 19)} UTC</strong><p>本地时间：{quake.time.toLocaleString()}</p></div>
      <div className="info-field"><span className="metric-label">MAGNITUDE · 震级</span><strong>{quake.magnitude.toFixed(1)}{quake.magnitudeType ? " (" + quake.magnitudeType + ")" : ""}</strong></div>
      <div className="info-field"><span className="metric-label">DEPTH · 震源深度</span><strong>{quake.depthKm.toFixed(1)} km</strong><p>{DEPTH_CLASSES.find((item) => quake.depthKm < item.maxKm)?.label}</p></div>
      <div className="info-field"><span className="metric-label">EPICENTER · 震中</span><strong>{coordinateLabel(quake.latitude, "N", "S")} · {coordinateLabel(quake.longitude, "E", "W")}</strong></div>
      {quake.tsunami && <div className="message-card"><strong>USGS 标记了海啸相关信息</strong><p>这只表示该事件位于海域且震级较大，不代表发生了海啸；请以当地海啸预警机构为准。</p></div>}
      <div className="source-card"><div className="metric-label">SOURCE / 数据来源</div><strong>USGS Earthquake Hazards Program</strong><span>Event ID: {quake.id}</span>{quake.url && <a href={quake.url} target="_blank" rel="noreferrer">在 USGS 查看事件详情 ↗</a>}<p>实时目录中的震级和位置可能在后续复核中修订。</p></div>
    </div>
  );
}

function VolcanoDetails({ volcano }: { volcano: Volcano }) {
  return (
    <div className="inspector-body">
      <div className="unit-heading">
        <div className="metric-label">VOLCANO · 火山</div>
        <h2>{volcano.name}</h2>
      </div>
      <div className="info-field"><span className="metric-label">COUNTRY · 国家/地区</span><strong>{volcano.country || "未提供"}</strong></div>
      <div className="info-field"><span className="metric-label">TYPE · 火山类型</span><strong>{volcano.type || "未提供"}</strong></div>
      <div className="info-field"><span className="metric-label">LAST ERUPTION · 最近喷发</span><strong>{formatEruptionYear(volcano.lastEruption)}</strong><p>{isRecentlyActive(volcano) ? "近 5 年内有喷发记录。" : "取自 GVP 名录；不代表当前活动状态。"}</p></div>
      <div className="info-field"><span className="metric-label">ELEVATION · 海拔</span><strong>{volcano.elevation !== null ? volcano.elevation + " m" : "未提供"}</strong></div>
      <div className="info-field"><span className="metric-label">LOCATION · 位置</span><strong>{coordinateLabel(volcano.lat, "N", "S")} · {coordinateLabel(volcano.lon, "E", "W")}</strong></div>
      <div className="source-card"><div className="metric-label">SOURCE / 数据来源</div><strong>Smithsonian Global Volcanism Program</strong>{volcano.id !== null && <span>Volcano Number: {volcano.id}</span>}<a href={gvpUrl(volcano)} target="_blank" rel="noreferrer">在 GVP 查看火山档案 ↗</a><p>Volcanoes of the World 全新世火山名录。当前喷发与警戒级别请以各国火山观测机构为准。</p></div>
    </div>
  );
}

function GeologyDetails({ geology }: { geology: ReturnType<typeof useGeologyQuery> }) {
  const { status, coordinates, units, unit, selectedIndex, setSelectedIndex, lexiconStatus, rockInfo, eraInfo } = geology;
  if (status === "idle" || !coordinates) {
    return (
      <div className="empty-inspector">
        <div className="empty-emblem"><MousePointerClick size={34} strokeWidth={1.4} aria-hidden="true" /></div>
        <h2>点击地球上的<br />任意位置</h2>
        <p>查看该点的经纬度，以及已编绘的地表地质年代与岩石类型。</p>
        <span className="empty-hint">CLICK THE GLOBE TO BEGIN</span>
      </div>
    );
  }
  return (
    <div className="inspector-body">
      <div className="coordinates-block">
        <div className="metric-label">SELECTED COORDINATES</div>
        <div className="coordinate-values"><span>{coordinateLabel(coordinates.latitude, "N", "S")}</span><span>{coordinateLabel(coordinates.longitude, "E", "W")}</span></div>
      </div>

      {status === "loading" && <div className="query-message"><span className="loading-ring" />正在查询 Macrostrat 地质数据库…</div>}
      {status === "error" && <div className="message-card error" role="alert"><strong>地质查询暂时不可用</strong><p>请检查网络连接或稍后重试。不会使用模拟数据替代查询结果。</p></div>}
      {status === "empty" && <div className="message-card"><strong>当前位置暂无地质单元数据</strong><p>这可能是海域、未编绘区域或数据源暂时没有匹配记录。请尝试其他陆地区域。</p></div>}
      {status === "success" && unit && (
        <>
          {units.length > 1 && (
            <div className="info-field">
              <label className="metric-label" htmlFor="geologic-candidate">MATCHING MAP UNITS · 候选地质单元 ({units.length})</label>
              <select id="geologic-candidate" className="geology-select" value={selectedIndex} onChange={(event) => setSelectedIndex(Number(event.target.value))}>
                {units.map((candidate, index) => (
                  <option key={`${candidate.sourceId ?? "s"}-${candidate.mapId ?? "m"}-${index}`} value={index}>{index + 1}. {candidate.name}{candidate.mapId !== null ? ` · #${candidate.mapId}` : ""}</option>
                ))}
              </select>
              <p>同一坐标可能有来自不同地质图或不同比例尺的记录，请核对地图来源。</p>
            </div>
          )}
          <div className="unit-heading"><div className="metric-label">MAP UNIT / 地质单元</div><h2>{unit.name}</h2></div>
          <div className="info-field"><span className="metric-label">GEOLOGICAL AGE · 地质年代</span><strong>{unit.age ?? "未提供"}</strong></div>
          <div className="info-field"><span className="metric-label">LITHOLOGY · 原始岩性描述</span><strong>{unit.lithology ?? "未提供原图岩性文本"}</strong></div>
          <div className="info-field">
            <span className="metric-label">ROCK CLASS · 岩石大类</span>
            <div className="scientific-tag">
              <span className={"rock-swatch rock-" + rockInfo.rockClass} />
              <strong>{rockInfo.classLabel}</strong>
            </div>
            {rockInfo.names.length > 0 && <p>Macrostrat 标准岩性：{rockInfo.names.join("、")}</p>}
            {lexiconStatus === "loading" && unit.lithIds.length > 0 && <p>正在匹配官方岩性词典…</p>}
            {lexiconStatus === "error" && unit.lithIds.length > 0 && <p>词典暂不可用，已保留原始岩性；不进行推测分类。</p>}
            {rockInfo.rockClass === "unclassified" && lexiconStatus !== "loading" && lexiconStatus !== "error" && <p>缺少完整的标准分类依据，不从地层名称或自由文本推断。</p>}
          </div>
          <div className="info-field"><span className="metric-label">ESTIMATED AGE · 推算数值年龄</span><strong>{unit.ageRangeMa ?? "未提供完整年龄范围"}</strong><p>{unit.ageNote}</p></div>
          <div className="info-field">
            <span className="metric-label">ERA GUIDE · 地质年代概览</span>
            <div className="scientific-tag">
              <span className="era-swatch" style={{ backgroundColor: eraInfo.color }} />
              <strong>{eraInfo.label}</strong>
            </div>
            <p>仅当完整年龄范围属于同一地质代时标注；概览颜色不是当前地质图的图斑颜色。</p>
            <div className="era-legend">
              {ERA_GUIDE.map((era) => <span key={era.key} title={era.label}><i style={{ backgroundColor: era.color }} />{era.label.split(" / ")[0]}</span>)}
            </div>
          </div>
          {unit.description && <div className="info-field"><span className="metric-label">DESCRIPTION · 原图描述</span><p>{unit.description}</p></div>}
          <div className="source-card"><div className="metric-label">SOURCE / 数据来源</div><strong>{unit.sourceName ?? "Macrostrat integrated geologic map"}</strong>{unit.sourceId !== null && <span>Source ID: {unit.sourceId}</span>}{unit.mapId !== null && <span>Map polygon ID: {unit.mapId}</span>}<a href={unit.sourceId !== null ? "https://macrostrat.org/api/v2/defs/sources?source_id=" + unit.sourceId : "https://macrostrat.org/map/"} target="_blank" rel="noreferrer">核对原始地图来源 ↗</a><p>全球地质瓦片为多尺度拼接图；候选查询与可见图斑未必严格一一对应。</p></div>
        </>
      )}
    </div>
  );
}
