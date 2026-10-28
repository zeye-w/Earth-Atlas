import { t, localeTag } from "../i18n";
import { Network, Satellite } from "lucide-react";
import type { OrbitRecord, SatelliteChoice } from "../satelliteOrbits";
import type { Observer, SatellitePass } from "../satellitePasses";
import { PassPredictions } from "./PassPredictions";
import type { LocationState, UserLocation } from "../hooks/useUserLocation";
import type { ConstellationStatus } from "../layers/useConstellation";
import type { SatelliteSpeed } from "../satelliteOverlay";
import type { LayerOptions, LayerToggles } from "../hooks/useLayerSettings";
import type { SatelliteStatus } from "../layers/useSatellites";
import { ICON, LayerGroup, Segmented, ToggleRow } from "../ui/controls";
import { useTimeSelector } from "../hooks/useTimeline";
import type { TimeController } from "../timeline";

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
  timeline: TimeController;
  records: readonly OrbitRecord[];
  selectedPoint: { latitude: number; longitude: number } | null;
  onSelectPass: (pass: SatellitePass, observer: Observer) => void;
  trackedId: string | null;
  onTrack: (id: string) => void;
  onStopTracking: () => void;
  location: LocationState;
  onLocate: () => Promise<UserLocation | null>;
  starlink: ConstellationStatus;
}

export function SatellitesGroup({ layers, setLayer, options, setOption, status, catalog, selectedId, timeline, records, selectedPoint, onSelectPass, trackedId, onTrack, onStopTracking, location, onLocate, starlink }: Props) {
  const live = useTimeSelector(timeline, (state) => state.live);
  return (
    <LayerGroup title="SATELLITES" subtitle={t("在轨卫星")}>
      <ToggleRow icon={<Satellite {...ICON} />} title={t("真实卫星轨道")} caption={t("公开 GP 根数 · SGP4 轨道预测")} checked={layers.satellites} onChange={(v) => setLayer("satellites", v)} />
      {layers.satellites && (
        <div className="satellite-controls">
          <label className="satellite-path-toggle">
            <input type="checkbox" checked={layers.paths} onChange={(event) => setLayer("paths", event.target.checked)} />
            <span>{t("显示前后约 45 分钟预测轨迹")}</span>
          </label>
          {!live ? <p className="satellite-preview-note" role="status">{t("跟随时间轴：显示所选时刻的 SGP4 推算位置；距轨道根数历元超过 10 天的卫星不显示。")}</p> : <><div className="satellite-speed">
            <span>{t("播放速度")}</span>
            <Segmented label={t("卫星播放速度")} options={SATELLITE_SPEED_OPTIONS} value={options.satelliteSpeed} onChange={(v) => setOption("satelliteSpeed", v)} format={(speed) => (speed === 1 ? t("实时") : speed + "×")} />
          </div>
          {options.satelliteSpeed !== 1 && <p className="satellite-preview-note" role="status">{t("加速预览：显示的是推算的未来位置，并非当前实时位置。切回\"实时\"即恢复。")}</p>}</>}
          <p className="satellite-status" role="status">
            {t(status === "loading" ? "正在读取 CelesTrak 最新公开轨道根数…" :
             status === "error" ? "轨道数据暂不可用，已隐藏卫星；不会绘制虚构轨道。" :
             status === "ready" ? "已加载 " + catalog.length + " 颗卫星 · 位置连续推算" :
             "打开图层后读取轨道根数")}
          </p>
          {catalog.length > 0 && status === "ready" && (
            <div className="satellite-catalog">
              {catalog.map(({ choice, epochLabel }) => (
                <div className={"satellite-entry" + (selectedId === choice.id ? " selected" : "")} key={choice.id}>
                  <Satellite size={13} strokeWidth={1.7} className="satellite-glyph" aria-hidden="true" />
                  <span><strong>{t(choice.title)}</strong><small>{t("轨道历元：{0}", t(epochLabel))}</small></span>
                  <button type="button" className={"satellite-track" + (trackedId === choice.id ? " active" : "")} onClick={() => (trackedId === choice.id ? onStopTracking() : onTrack(choice.id))}
                    aria-label={t((trackedId === choice.id ? "停止跟踪 " : "跟踪 ") + choice.title)}>
                    {t(trackedId === choice.id ? "停止" : "跟踪")}
                  </button>
                </div>
              ))}
            </div>
          )}
          {status === "ready" && records.length > 0 && <PassPredictions records={records} selectedPoint={selectedPoint} onSelectPass={onSelectPass} location={location} onLocate={onLocate} />}
          <p className="satellite-disclaimer">{t("数据：CelesTrak GP / SGP4。位置为轨道推算，并非实时遥测；轨迹表示地固坐标系下的预测路径。")}</p>
        </div>
      )}
      <ToggleRow icon={<Network {...ICON} />} title={t("星链星座")} caption={t("Starlink · CelesTrak 全部在轨根数 · SGP4")} checked={layers.starlink} onChange={(v) => setLayer("starlink", v)} />
      {layers.starlink && starlink.state !== "idle" && (
        <div className="layer-extra">
          <p className="layer-status" role="status">
            {t(starlink.state === "loading" ? "正在下载 CelesTrak 星链轨道根数（约 1.7 MB）…" :
             starlink.state === "error" ? "星链轨道数据暂不可用，未显示；不会绘制虚构卫星。" :
             (starlink.shown ?? 0).toLocaleString(localeTag()) + " 颗卫星" + (starlink.stale ? " · " + starlink.stale + " 颗根数距所选时刻超过 10 天未显示" : "") + " · 根数获取于 " + (starlink.fetchedAt?.toISOString().slice(11, 16) ?? "—") + " UTC")}
          </p>
          {starlink.state === "ready" && (
            <>
              <div className="thematic-legend">
                <span><i className="constellation-dot sunlit" />{t("日照中")}</span>
                <span><i className="constellation-dot" />{t("地球阴影中")}</span>
              </div>
              <p className="layer-note">{t("轨道壳层（按倾角）：{0}。新发射的卫星还在爬升，会排成一串\"火车\"。位置为 SGP4 推算，每秒更新两次；点击亮点查看名称和高度。", t((starlink.shells ?? []).filter((s) => s.count >= 50).map((s) => s.inclination + "° " + s.count.toLocaleString(localeTag()) + " 颗").join(" · ")))}</p>
            </>
          )}
        </div>
      )}
    </LayerGroup>
  );
}
