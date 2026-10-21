import { Cloud, Globe, Image as ImageIcon, Layers2, Lightbulb, MapPin, Mountain, Sparkles, SunMoon, Wind } from "lucide-react";
import { EARTH_RADIUS_KM, solarWindLevel } from "../solarWindData";
import { SOLAR_WIND_TIME_LAPSE, SOUTHWARD_TINT_BZ } from "../solarWindOverlay";
import type { SolarWindState } from "../layers/useSolarWind";
import { ATMOSPHERE_LAYERS, ATMOSPHERE_SCALES, formatHeight } from "../atmosphereLayers";
import { kpLevel, type GeomagneticState } from "../geomagnetic";
import type { Polled } from "../hooks/usePolledData";
import type { LayerOptions, LayerToggles } from "../hooks/useLayerSettings";
import type { AuroraStatus } from "../layers/useAurora";
import { ICON, LayerGroup, Segmented, ToggleRow } from "../ui/controls";

interface Props {
  layers: LayerToggles;
  setLayer: (key: keyof LayerToggles, value: boolean) => void;
  options: LayerOptions;
  setOption: <K extends keyof LayerOptions>(key: K, value: LayerOptions[K]) => void;
  clouds: { status: string; time: string | null };
  aurora: AuroraStatus;
  geomagnetic: Polled<GeomagneticState>;
  /** False while the timeline shows another moment. */
  live: boolean;
  trueColor: { date: string; source: string };
  solarWind: SolarWindState;
  onViewMagnetosphere: () => void;
}

export function EarthViewGroup({ layers, setLayer, options, setOption, clouds, aurora, geomagnetic, live, trueColor, solarWind, onViewMagnetosphere }: Props) {
  return (
    <LayerGroup title="EARTH VIEW" subtitle="地球视图">
      <ToggleRow icon={<SunMoon {...ICON} />} title="实时昼夜光照" caption="按当前 UTC 时间计算太阳位置" checked={layers.dayNight} onChange={(v) => setLayer("dayNight", v)} />
      <ToggleRow icon={<Globe {...ICON} />} title="大气散射" caption="地球边缘的蓝色大气辉光" checked={layers.atmosphere} onChange={(v) => setLayer("atmosphere", v)} />
      <ToggleRow icon={<Layers2 {...ICON} />} title="大气分层" caption="按真实高度绘制各层顶部边界" checked={layers.shells} onChange={(v) => setLayer("shells", v)} />
      {layers.shells && (
        <div className="layer-extra">
          <Segmented label="大气层高度放大倍数" options={ATMOSPHERE_SCALES} value={options.shellScale} onChange={(v) => setOption("shellScale", v)} format={(scale) => (scale === 1 ? "真实比例" : "放大 " + scale + "×")} />
          {options.shellScale !== 1 && <p className="satellite-preview-note" role="status">高度已放大 {options.shellScale} 倍，仅为示意；真实大气比这薄得多。</p>}
          <ul className="shell-legend">
            {ATMOSPHERE_LAYERS.map((layer) => (
              <li key={layer.key} title={layer.note}><i style={{ backgroundColor: layer.color }} /><span>{layer.boundary}</span><b>{formatHeight(layer)}</b></li>
            ))}
          </ul>
          <p className="layer-note">真实比例下对流层不到地球半径的 0.3%，在全球视角里只有一两个像素厚；拉近到地球边缘侧看最清楚。高度参考美国标准大气 1976，实际随纬度、季节与太阳活动变化。</p>
        </div>
      )}
      <ToggleRow icon={<ImageIcon {...ICON} />} title="每日真彩影像" caption={"NASA GIBS · " + trueColor.source + " · 逐日拼接"} checked={layers.trueColor} onChange={(v) => setLayer("trueColor", v)} />
      {layers.trueColor && (
        <div className="layer-extra">
          <p className="layer-status" role="status">影像日期 {trueColor.date}（UTC）· 跟随时间轴</p>
          <p className="layer-note">极轨卫星一天内多次过境拼接而成，云是各地卫星过境时刻的云；轨道间的缝隙和极夜区域显示下方底图。当天影像仍在补全，因此"实时"时显示前一天。</p>
        </div>
      )}
      <ToggleRow icon={<Cloud {...ICON} />} title="卫星云图（红外）" caption="SSEC 多卫星全球合成 · 逐小时观测" checked={layers.clouds} onChange={(v) => setLayer("clouds", v)} />
      {layers.clouds && <div className="cloud-controls">
        <p className="thematic-note" role="status">{clouds.status === "loading" ? "正在读取卫星云图…" :
          clouds.status === "error" ? "云图加载失败；如保留上一时次，请以观测时间为准。" :
          clouds.status === "nodata" ? (live ? "暂无 6 小时内的云图观测。" : "这一时刻没有云图：只保留最近约 30 天的逐小时观测，未来时刻也没有。") :
          "观测时间 " + (clouds.time ?? "—") + (live ? "" : " · 跟随时间轴")}</p>
        <label className="opacity-head" htmlFor="cloud-opacity"><span>云图不透明度</span><span>{options.cloudOpacity}%</span></label>
        <input id="cloud-opacity" type="range" min="10" max="100" step="5" value={options.cloudOpacity} onChange={(event) => setOption("cloudOpacity", Number(event.target.value))} />
        <p className="thematic-note">亮白通常表示较冷云顶；包含地表信号，并非精确云掩膜。极区与拼接处可能有误差。免费服务可能显示水印。</p>
        <a href="https://www.ssec.wisc.edu/realearth/" target="_blank" rel="noreferrer">数据：SSEC / UW–Madison</a>
      </div>}
      <ToggleRow icon={<Lightbulb {...ICON} />} title="城市夜光" caption={layers.dayNight ? "NASA Black Marble 卫星夜光 · 仅夜侧" : "需开启实时昼夜光照"} checked={layers.lights} onChange={(v) => setLayer("lights", v)} />
      <ToggleRow icon={<Sparkles {...ICON} />} title="极光" caption="NOAA OVATION 实时预报 · 南北半球 · 夜侧可见" checked={layers.aurora} onChange={(v) => setLayer("aurora", v)} />
      {layers.aurora && !live && <p className="layer-status" role="status">极光预报与 Kp 指数只有实时数据，回看其他时刻时暂不显示。</p>}
      {layers.aurora && live && aurora.state !== "idle" && (
        <p className="layer-status" role="status">
          {aurora.state === "loading" ? "正在读取 NOAA 极光预报…" :
           aurora.state === "error" ? "NOAA 极光数据暂不可用，未显示极光；不会绘制虚构极光。" :
           aurora.state === "quiet" ? "当前预报无明显极光（最高可见概率 " + aurora.max + "%）" :
           "预报时间 " + (aurora.forecast ?? "—") + " · 最高可见概率 " + aurora.max + "%（北半球 " + aurora.north + "% · 南半球 " + aurora.south + "%）· 亮度按概率显示"}
        </p>
      )}
      {layers.aurora && live && geomagnetic.status !== "idle" && <KpPanel geomagnetic={geomagnetic} />}
      <ToggleRow icon={<Wind {...ICON} />} title="太阳风与磁层" caption="NOAA 实时太阳风 · 磁层顶模型 · 粒子示意" checked={layers.solarWind} onChange={(v) => setLayer("solarWind", v)} />
      {layers.solarWind && <SolarWindPanel state={solarWind} live={live} onView={onViewMagnetosphere} />}
      <ToggleRow icon={<Mountain {...ICON} />} title="地理标注" caption="海洋、山脉、沙漠、平原、盆地与河流 · 自动避让" checked={layers.geoLabels} onChange={(v) => setLayer("geoLabels", v)} />
      <ToggleRow icon={<MapPin {...ICON} />} title="全球主要城市" caption="远景自动隐藏次要城市" checked={layers.cities} onChange={(v) => setLayer("cities", v)} />
    </LayerGroup>
  );
}

function KpPanel({ geomagnetic }: { geomagnetic: Polled<GeomagneticState> }) {
  if (geomagnetic.status !== "ready" || !geomagnetic.data) {
    return (
      <div className="layer-extra kp-panel" role="status">
        <p className="layer-status">{geomagnetic.status === "loading" ? "正在读取 NOAA 地磁指数…" : "NOAA 地磁指数暂不可用。"}</p>
      </div>
    );
  }
  const { now, history } = geomagnetic.data;
  const level = kpLevel(now.kp);
  return (
    <div className="layer-extra kp-panel" role="status">
      <div className="kp-head">
        <span className="kp-value">Kp {now.kp.toFixed(1)}</span>
        <span className={"kp-level" + (level.storm ? " storm" : "")}>{level.storm ? level.storm + " " : ""}{level.label}</span>
        <span className="kp-time">{now.time.toISOString().slice(11, 16)} UTC</span>
      </div>
      {history.length > 0 && (
        <div className="kp-bars" aria-label="过去 24 小时 Kp（每 3 小时）">
          {history.map((sample) => (
            <span key={sample.time.getTime()} title={sample.time.toISOString().slice(5, 16).replace("T", " ") + " UTC · Kp " + sample.kp.toFixed(1)}
              className={sample.kp >= 5 ? "storm" : sample.kp >= 4 ? "active" : ""} style={{ height: Math.max(3, (sample.kp / 9) * 28) + "px" }} />
          ))}
        </div>
      )}
      <p className="layer-note">NOAA 行星 K 指数（0–9）：数值越高地磁活动越强、极光越亮越偏南；Kp ≥ 5 即为磁暴。柱状图为过去 24 小时每 3 小时数值。</p>
    </div>
  );
}

const number = (value: number, digits = 0) => value.toLocaleString("zh-CN", { maximumFractionDigits: digits, minimumFractionDigits: digits });

function SolarWindPanel({ state, live, onView }: { state: SolarWindState; live: boolean; onView: () => void }) {
  const { status, sample, pressure, magnetopause } = state;
  if (status !== "ready" || !sample || pressure === null || !magnetopause) {
    return (
      <p className="layer-status" role="status">
        {status === "loading" ? "正在读取 NOAA 实时太阳风（约 4 MB）…" :
         status === "nodata" ? (live ? "暂无实时太阳风数据，未绘制磁层。" : "这一时刻没有太阳风数据：NOAA 只提供最近约 24 小时，未绘制磁层。") :
         "NOAA 太阳风数据暂不可用，未绘制磁层；不会绘制虚构的太阳风。"}
      </p>
    );
  }
  const level = solarWindLevel(sample);
  const south = sample.bz !== null && sample.bz < 0;
  const tinted = sample.bz !== null && sample.bz <= SOUTHWARD_TINT_BZ;
  return (
    <div className="layer-extra solar-wind-panel" role="status">
      <div className="kp-head">
        <span className="kp-value">{number(sample.speed)} km/s</span>
        <span className={"kp-level" + (level.stormy ? " storm" : "")}>{level.label}</span>
        <span className="kp-time">{sample.source} · {new Date(sample.time).toISOString().slice(11, 16)} UTC</span>
      </div>
      <p className="layer-status">
        密度 {number(sample.density, 1)} /cm³ · Bz {sample.bz === null ? "—" : number(sample.bz, 1) + " nT" + (south ? "（南向）" : "（北向）")} · 动压 {number(pressure, 2)} nPa
        <br />磁层顶距地心 {number(magnetopause.r0, 1)} 个地球半径（约 {number(magnetopause.r0 * EARTH_RADIUS_KM)} km）{south ? "，南向磁场时更易发生磁暴" : ""}
      </p>
      <div className="thematic-legend">
        <span><i style={{ backgroundColor: tinted ? "#ff7ad9" : "#6fd3ff", height: 3, borderRadius: 2 }} />磁层顶（{tinted ? "粉色：Bz ≤ " + SOUTHWARD_TINT_BZ + " nT，明显南向" : "青色：Bz > " + SOUTHWARD_TINT_BZ + " nT"}）</span>
        <span><i style={{ backgroundColor: "#ffb36b", height: 3, borderRadius: 2 }} />弓激波</span>
        <span><i className="constellation-dot sunlit" style={{ background: "#ffd27a" }} />太阳风粒子</span>
      </div>
      <button type="button" className="track-locate" onClick={onView}>拉远查看磁层</button>
      <p className="layer-note">磁层顶按 Shue 等 (1998) 经验模型由实测动压和 Bz 计算；弓激波为约 1.3 倍距离的近似。粒子流动轨迹为示意，速度按实测风速、加速约 {SOLAR_WIND_TIME_LAPSE} 倍。忽略地磁偶极倾斜。</p>
    </div>
  );
}

