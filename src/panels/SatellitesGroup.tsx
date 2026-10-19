import { Satellite } from "lucide-react";
import type { SatelliteChoice } from "../satelliteOrbits";
import type { SatelliteSpeed } from "../satelliteOverlay";
import type { LayerOptions, LayerToggles } from "../hooks/useLayerSettings";
import type { SatelliteStatus } from "../layers/useSatellites";
import { ICON, LayerGroup, Segmented, ToggleRow } from "../ui/controls";

// Mirrors SATELLITE_SPEEDS; kept here so the overlay module stays lazy-loaded.
const SATELLITE_SPEED_OPTIONS: readonly SatelliteSpeed[] = [1, 60, 300];

interface Props {
  layers: LayerToggles;
  setLayer: (key: keyof LayerToggles, value: boolean) => void;
  options: LayerOptions;
  setOption: <K extends keyof LayerOptions>(key: K, value: LayerOptions[K]) => void;
  status: SatelliteStatus;
  catalog: Array<{ choice: SatelliteChoice; epochLabel: string }>;
  selectedId: string | null;
}

export function SatellitesGroup({ layers, setLayer, options, setOption, status, catalog, selectedId }: Props) {
  return (
    <LayerGroup title="SATELLITES" subtitle="在轨卫星" open={layers.satellites}>
      <ToggleRow icon={<Satellite {...ICON} />} title="真实卫星轨道" caption="公开 GP 根数 · SGP4 轨道预测" checked={layers.satellites} onChange={(v) => setLayer("satellites", v)} />
      {layers.satellites && (
        <div className="satellite-controls">
          <label className="satellite-path-toggle">
            <input type="checkbox" checked={layers.paths} onChange={(event) => setLayer("paths", event.target.checked)} />
            <span>显示前后约 45 分钟预测轨迹</span>
          </label>
          <div className="satellite-speed">
            <span>播放速度</span>
            <Segmented label="卫星播放速度" options={SATELLITE_SPEED_OPTIONS} value={options.satelliteSpeed} onChange={(v) => setOption("satelliteSpeed", v)} format={(speed) => (speed === 1 ? "实时" : speed + "×")} />
          </div>
          {options.satelliteSpeed !== 1 && <p className="satellite-preview-note" role="status">加速预览：显示的是推算的未来位置，并非当前实时位置。切回"实时"即恢复。</p>}
          <p className="satellite-status" role="status">
            {status === "loading" ? "正在读取 CelesTrak 最新公开轨道根数…" :
             status === "error" ? "轨道数据暂不可用，已隐藏卫星；不会绘制虚构轨道。" :
             status === "ready" ? "已加载 " + catalog.length + " 颗卫星 · 位置连续推算" :
             "打开图层后读取轨道根数"}
          </p>
          {catalog.length > 0 && status === "ready" && (
            <div className="satellite-catalog">
              {catalog.map(({ choice, epochLabel }) => (
                <div className={"satellite-entry" + (selectedId === choice.id ? " selected" : "")} key={choice.id}>
                  <Satellite size={13} strokeWidth={1.7} className="satellite-glyph" aria-hidden="true" />
                  <span><strong>{choice.title}</strong><small>轨道历元：{epochLabel}</small></span>
                </div>
              ))}
            </div>
          )}
          <p className="satellite-disclaimer">数据：CelesTrak GP / SGP4。位置为轨道推算，并非实时遥测；轨迹表示地固坐标系下的预测路径。</p>
        </div>
      )}
    </LayerGroup>
  );
}
