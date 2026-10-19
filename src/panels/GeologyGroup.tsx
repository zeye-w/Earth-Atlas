import { Mountain } from "lucide-react";
import { ERA_GUIDE } from "../geologicTime";
import { AGE_OPTIONS, ROCK_OPTIONS, type AgeFilter, type RockFilter, type ThematicMode } from "../mapThematic";
import type { LayerOptions, LayerToggles } from "../hooks/useLayerSettings";
import type { VectorState } from "../layers/useGeologyMap";
import { ICON, LayerGroup, ToggleRow } from "../ui/controls";

interface Props {
  layers: LayerToggles;
  setLayer: (key: keyof LayerToggles, value: boolean) => void;
  options: LayerOptions;
  setOption: <K extends keyof LayerOptions>(key: K, value: LayerOptions[K]) => void;
  vectorState: VectorState;
}

export function GeologyGroup({ layers, setLayer, options, setOption, vectorState }: Props) {
  const visible = layers.geology;
  const { mapMode } = options;
  return (
    <LayerGroup title="GEOLOGY" subtitle="地表地质">
      <ToggleRow icon={<Mountain {...ICON} />} title="全球地质图" caption="Macrostrat 地表地质单元" checked={visible} onChange={(v) => setLayer("geology", v)} />
      <div className="thematic-controls">
        <label htmlFor="geology-style" className="metric-label">MAP STYLE · 显示方式</label>
        <select id="geology-style" disabled={!visible} value={mapMode} onChange={(event) => setOption("mapMode", event.target.value as ThematicMode)}>
          <option value="raster">原始地质图 · Raster</option>
          <option value="age">地质年代专题图 · Age</option>
          <option value="lithology">岩性专题图 · Lithology（试验）</option>
        </select>
        {mapMode === "age" && <label className="thematic-filter"><span>年代筛选</span><select value={options.ageFilter} disabled={!visible} onChange={(event) => setOption("ageFilter", event.target.value as AgeFilter)}>
          {AGE_OPTIONS.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
        </select></label>}
        {mapMode === "lithology" && <label className="thematic-filter"><span>岩性筛选</span><select value={options.rockFilter} disabled={!visible} onChange={(event) => setOption("rockFilter", event.target.value as RockFilter)}>
          {ROCK_OPTIONS.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
        </select></label>}
        {mapMode !== "raster" && <p className="thematic-note" role="status">
          {vectorState === "loading" ? "正在初始化全球矢量专题图，暂时保留原始地图…" :
           vectorState === "error" ? "矢量图层加载失败，已回退到原始地质图。" :
           mapMode === "age" ? "依据地质图编绘的数值年龄着色；跨代或未知年代显示灰色。全球专题图使用低至中分辨率瓦片。" :
           "试验性岩性专题图：仅根据原始英文岩性描述中的明确术语匹配，不等同于官方标准岩性分类。"}
        </p>}
        {mapMode === "age" && <div className="thematic-legend">{ERA_GUIDE.map((era) => <span key={era.key}><i style={{ backgroundColor: era.color }} />{era.label.split(" / ")[0]}</span>)}<span><i style={{ backgroundColor: "#ADB9B2" }} />不确定</span></div>}
        {mapMode === "lithology" && <div className="thematic-legend"><span><i style={{ backgroundColor: "#C6A460" }} />沉积岩</span><span><i style={{ backgroundColor: "#CF8F81" }} />火成岩</span><span><i style={{ backgroundColor: "#9B8CB7" }} />变质岩</span><span><i style={{ backgroundColor: "#A6B2AE" }} />未分类</span></div>}
      </div>
      <div className={"opacity-control" + (!visible ? " muted" : "")}>
        <div className="opacity-head"><span>图层不透明度</span><span>{options.opacity}%</span></div>
        <input type="range" min="15" max="100" step="5" value={options.opacity} disabled={!visible} onChange={(event) => setOption("opacity", Number(event.target.value))} aria-label="地质图不透明度" />
      </div>
    </LayerGroup>
  );
}
