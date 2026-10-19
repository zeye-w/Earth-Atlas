import { Activity, Triangle, Waypoints } from "lucide-react";
import { DEPTH_CLASSES, QUAKE_FEEDS, QUAKE_RANGES } from "../earthquakeData";
import type { LayerOptions, LayerToggles } from "../hooks/useLayerSettings";
import type { QuakeStatus } from "../layers/useEarthquakes";
import type { VolcanoInfo } from "../layers/useTectonics";
import { ICON, LayerGroup, Segmented, ToggleRow } from "../ui/controls";

interface Props {
  layers: LayerToggles;
  setLayer: (key: keyof LayerToggles, value: boolean) => void;
  options: LayerOptions;
  setOption: <K extends keyof LayerOptions>(key: K, value: LayerOptions[K]) => void;
  quakes: QuakeStatus;
  volcanoes: { status: "idle" | "loading" | "ready" | "error"; result?: VolcanoInfo };
  plateStatus: "idle" | "loading" | "ready" | "error";
}

export function TectonicsGroup({ layers, setLayer, options, setOption, quakes, volcanoes, plateStatus }: Props) {
  return (
    <LayerGroup title="TECTONICS" subtitle="地震与板块" open={layers.quakes || layers.plates || layers.volcanoes}>
      <ToggleRow icon={<Activity {...ICON} />} title="实时地震" caption={"USGS · M" + QUAKE_FEEDS[options.quakeRange].minMagnitude + "+ · 每 5 分钟更新"} checked={layers.quakes} onChange={(v) => setLayer("quakes", v)} />
      {layers.quakes && (
        <div className="layer-extra">
          <Segmented label="地震时间范围" options={QUAKE_RANGES} value={options.quakeRange} onChange={(v) => setOption("quakeRange", v)} format={(range) => QUAKE_FEEDS[range].label} />
          <p className="layer-status" role="status">
            {quakes.state === "loading" ? "正在读取 USGS 地震目录…" :
             quakes.state === "error" ? "USGS 地震数据暂不可用，未显示地震。" :
             quakes.state === "ready" ? (quakes.count ? quakes.count + " 次地震 · 最大 M" + quakes.largest!.magnitude.toFixed(1) + (quakes.largest!.place ? "（" + quakes.largest!.place + "）" : "") : "该时段没有符合条件的地震") : ""}
          </p>
          <div className="thematic-legend">
            {DEPTH_CLASSES.map((item) => <span key={item.label}><i style={{ backgroundColor: item.color, borderRadius: "50%" }} />{item.label}</span>)}
          </div>
          <p className="layer-note">圆点越大震级越高，白色描边为 24 小时内发生；点击圆点查看详情。</p>
        </div>
      )}
      <ToggleRow icon={<Triangle {...ICON} />} title="火山" caption="Smithsonian GVP 全新世火山名录" checked={layers.volcanoes} onChange={(v) => setLayer("volcanoes", v)} />
      {layers.volcanoes && volcanoes.status !== "idle" && (
        <div className="layer-extra">
          <p className="layer-status" role="status">
            {volcanoes.status === "loading" ? "正在加载火山名录…" :
             volcanoes.status === "error" || !volcanoes.result ? "火山名录加载失败。" :
             volcanoes.result.total + " 座火山 · 近 5 年有喷发记录 " + volcanoes.result.recent + " 座 · 名录更新于 " + volcanoes.result.retrieved}
          </p>
          <div className="thematic-legend">
            <span><i className="volcano-swatch recent" />近 5 年有喷发</span>
            <span><i className="volcano-swatch" />其他全新世火山（拉近显示）</span>
          </div>
          <p className="layer-note">依据 GVP 名录中的最近喷发年份，并非实时火山警报。点击三角查看详情。</p>
        </div>
      )}
      <ToggleRow icon={<Waypoints {...ICON} />} title="板块边界" caption="Bird (2003) PB2002 全球板块模型" checked={layers.plates} onChange={(v) => setLayer("plates", v)} />
      {layers.plates && (
        <div className="layer-extra">
          {plateStatus === "error" ? <p className="layer-status" role="status">板块边界数据加载失败。</p> : (
            <div className="thematic-legend">
              <span><i style={{ backgroundColor: "#ff8a5c", height: 3, borderRadius: 2 }} />俯冲带</span>
              <span><i style={{ backgroundColor: "#ffd27a", height: 3, borderRadius: 2 }} />其他板块边界</span>
            </div>
          )}
        </div>
      )}
    </LayerGroup>
  );
}
