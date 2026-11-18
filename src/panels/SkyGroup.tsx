import { t, localeTag, useLocale } from "../i18n";
import { useState } from "react";
import { Shapes, Sparkles, Sun } from "lucide-react";
import type { LayerToggles } from "../hooks/useLayerSettings";
import { usePolledData } from "../hooks/usePolledData";
import { fetchSolarActivity, flareClass, radioBlackout, SDO_VIEWS, sdoImageUrl, SOLAR_REFRESH_MS, strongestFlare, type SdoView } from "../solarActivity";
import { relativeTime } from "../timeline";
import { now } from "../clock";
import { ICON, LayerGroup, ToggleRow } from "../ui/controls";
import "./sky.css";

const DAY = 86_400_000;
/** Flares listed: M class and above in the last week, newest first. */
const LISTED_FLUX = 1e-5, MAX_LISTED = 6;
const LEVEL_COLORS: Record<string, string> = { A: "#6f7d8c", B: "#8fe3ff", C: "#ffd166", M: "#ff9f43", X: "#ff5a5f" };
const time = (value: number) => new Intl.DateTimeFormat(localeTag(), { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(value);

interface Props {
  layers: LayerToggles;
  setLayer: (key: keyof LayerToggles, value: boolean) => void;
  reveal?: unknown;
}

/** The sky behind the globe and the live Sun. */
export function SkyGroup({ layers, setLayer, reveal }: Props) {
  return (
    <LayerGroup title="SKY" subtitle={t("星空与太阳")} reveal={reveal}>
      <ToggleRow icon={<Sparkles {...ICON} />} title={t("真实星空")} caption={t("NASA 星图 · 恒星与银河的真实位置")}
        checked={layers.realSky} onChange={(v) => setLayer("realSky", v)} />
      {layers.realSky && (
        <ToggleRow icon={<Shapes {...ICON} />} title={t("星座连线")} caption={t("88 个星座的连线")}
          checked={layers.constellations} onChange={(v) => setLayer("constellations", v)} />
      )}
      <ToggleRow icon={<Sun {...ICON} />} title={t("实时太阳")} caption={t("NASA SDO 太阳图像 · NOAA 耀斑监测")}
        checked={layers.sun} onChange={(v) => setLayer("sun", v)} />
      {layers.sun && <SunSection />}
      {layers.realSky && <p className="layer-note">{t("拉远视角就能看到地球背后的真实星空：恒星和银河的位置、亮度与颜色来自 NASA 深空星图（2020，依巴谷、第谷与盖亚星表），随地球自转转动。")}</p>}
    </LayerGroup>
  );
}

function SunSection() {
  const locale = useLocale();
  const [view, setView] = useState<SdoView>("0171");
  const [failed, setFailed] = useState<string | null>(null);
  const poll = usePolledData(fetchSolarActivity, { enabled: true, intervalMs: SOLAR_REFRESH_MS, refreshOnVisible: true, keepDataOnError: true });
  const at = now();
  const data = poll.data;
  const current = data?.xray ? flareClass(data.xray.flux) : null;
  const day = data ? strongestFlare(data.flares, at - DAY, at) : null;
  const listed = (data?.flares ?? []).filter((f) => f.peakFlux >= LISTED_FLUX).slice(0, MAX_LISTED);
  const info = SDO_VIEWS.find((v) => v.id === view)!;
  const src = sdoImageUrl(view, at);
  return (
    <div className="layer-extra sun-section">
      <figure className="sdo">
        {failed === src
          ? <div className="sdo-missing" role="status">{t("SDO 图像暂时无法加载")}</div>
          : <img src={src} alt={t("太阳 · {0}", t(info.label))} width={512} height={512} loading="lazy" decoding="async" onError={() => setFailed(src)} />}
        <figcaption>{t(info.note)} · {t("NASA/SDO 与 AIA、HMI 科学团队")}</figcaption>
      </figure>
      <div className="sdo-views" role="group" aria-label={t("太阳图像波段")}>
        {SDO_VIEWS.map((v) => <button key={v.id} type="button" aria-pressed={v.id === view} onClick={() => setView(v.id)}>{t(v.label)}</button>)}
      </div>
      <p className="layer-status" role="status">
        {!data ? t(poll.status === "error" ? "耀斑数据暂不可用" : "正在读取耀斑数据…")
          : <>{current && <>{t("此刻 X 射线：")}<Level value={current} />{" · "}</>}
            {day ? <>{t("24 小时最强耀斑：")}<Level value={day.peakClass} />（{relativeTime(day.peak, at, locale)}）</> : t("24 小时内没有耀斑")}</>}
      </p>
      {listed.length > 0 && (
        <ul className="flare-list" aria-label={t("近 7 天 M 级以上耀斑")}>
          {listed.map((f) => (
            <li key={f.begin}><Level value={f.peakClass} /><span>{time(f.peak)}</span>{radioBlackout(f.peakFlux) && <em>{t("短波通信中断 {0}", radioBlackout(f.peakFlux)!)}</em>}</li>
          ))}
        </ul>
      )}
      <p className="layer-note">{t("耀斑按 GOES 卫星测到的 X 射线峰值分级：C 级常见，M 级可造成高纬度短波通信短暂中断，X 级最强。大耀斑常伴随日冕物质抛射，1–3 天后可能引发地磁暴和极光。数据：NOAA SWPC，每 5 分钟更新。")}</p>
    </div>
  );
}

function Level({ value }: { value: string }) {
  return <b className="flare-level" style={{ color: LEVEL_COLORS[value[0]] ?? "inherit" }}>{value}</b>;
}
