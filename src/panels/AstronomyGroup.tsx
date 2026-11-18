import { t, localeTag, useLocale } from "../i18n";
import { useEffect, useMemo, useState } from "react";
import { Crosshair, LocateFixed, Moon, Sparkle, SunMoon } from "lucide-react";
import type { LayerToggles } from "../hooks/useLayerSettings";
import type { AstronomyModule } from "../layers/useAstronomy";
import type { Eclipse, MeteorShower, ShowerOutlook, Tonight } from "../astronomy/index";
import type { LocationState, UserLocation } from "../hooks/useUserLocation";
import { useTimeSelector } from "../hooks/useTimeline";
import type { TimeController } from "../timeline";
import { compassName } from "../compass";
import { ICON, LayerGroup, ToggleRow } from "../ui/controls";
import { now } from "../clock";
import "./astronomy.css";

export const ECLIPSE_LABELS = {
  "solar:total": "日全食", "solar:annular": "日环食", "solar:hybrid": "全环食", "solar:partial": "日偏食",
  "lunar:total": "月全食", "lunar:partial": "月偏食", "lunar:penumbral": "半影月食",
} as const;
export const ECLIPSE_COLORS = {
  "solar:total": "#ffcf5a", "solar:annular": "#ffa94d", "solar:hybrid": "#ffbd5a", "solar:partial": "#c9b98a",
  "lunar:total": "#ff6b4a", "lunar:partial": "#ff9a6b", "lunar:penumbral": "#b8a6a0",
} as const;
export const eclipseLabel = (e: Eclipse) => ECLIPSE_LABELS[(e.type + ":" + e.kind) as keyof typeof ECLIPSE_LABELS];
export const eclipseColor = (e: Eclipse) => ECLIPSE_COLORS[(e.type + ":" + e.kind) as keyof typeof ECLIPSE_COLORS];
const QUARTERS = ["新月", "上弦月", "满月", "下弦月"] as const;
const PLANET_NAMES = { Mercury: "水星", Venus: "金星", Mars: "火星", Jupiter: "木星", Saturn: "土星" } as const;

const DAY = 86_400_000;
/** "25.5°N 33.2°E": a tenth of a degree is plenty for where an eclipse is seen. */
export const place = (latitude: number, longitude: number) =>
  Math.abs(latitude).toFixed(1) + "°" + (latitude >= 0 ? "N" : "S") + " " + Math.abs(longitude).toFixed(1) + "°" + (longitude >= 0 ? "E" : "W");
/** How far ahead the eclipse list reaches. */
const ECLIPSE_YEARS = 3;

export const dayFormat = (time: number) => new Intl.DateTimeFormat(localeTag(), { year: "numeric", month: "short", day: "numeric" }).format(time);
const shortDay = (time: number) => new Intl.DateTimeFormat(localeTag(), { month: "short", day: "numeric" }).format(time);
const dayTime = (time: number) => new Intl.DateTimeFormat(localeTag(), { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(time);
const clock = (time: number) => new Intl.DateTimeFormat(localeTag(), { hour: "2-digit", minute: "2-digit", hour12: false }).format(time);

interface Props {
  layers: LayerToggles;
  setLayer: (key: keyof LayerToggles, value: boolean) => void;
  module: AstronomyModule | null;
  failed: boolean;
  timeline: TimeController;
  selectedEclipse: string | null;
  onSelectEclipse: (eclipse: Eclipse) => void;
  shower: string | null;
  onSelectShower: (shower: MeteorShower) => void;
  selectedPoint: { latitude: number; longitude: number } | null;
  location: LocationState;
  onLocate: () => Promise<UserLocation | null>;
  /** Asks for the astronomy code (for "tonight" with no layer on). */
  onWantModule: () => void;
  reveal: unknown;
}

export function AstronomyGroup(props: Props) {
  const { layers, setLayer, module, failed } = props;
  const loading = failed ? t("天文计算模块加载失败，请刷新页面重试。") : t("正在加载天文计算…");
  return (
    <LayerGroup title="ASTRONOMY" subtitle={t("天文 · 月亮、日月食与流星雨")} reveal={props.reveal}>
      <ToggleRow icon={<Moon {...ICON} />} title={t("月亮")} caption={t("月下点、能看到月亮的半球与月相 · 跟随时间轴")}
        checked={layers.moon} onChange={(v) => setLayer("moon", v)} />
      {layers.moon && <div className="layer-extra astro-section">{module ? <MoonSection module={module} timeline={props.timeline} /> : <p className="layer-status">{loading}</p>}</div>}
      <ToggleRow icon={<SunMoon {...ICON} />} title={t("日食与月食")} caption={t("未来{0}年 · 日食路径与月影动画", ECLIPSE_YEARS)}
        checked={layers.eclipses} onChange={(v) => setLayer("eclipses", v)} />
      {layers.eclipses && <div className="layer-extra astro-section">{module ? <EclipseList module={module} selected={props.selectedEclipse} onSelect={props.onSelectEclipse} /> : <p className="layer-status">{loading}</p>}</div>}
      <ToggleRow icon={<Sparkle {...ICON} />} title={t("流星雨")} caption={t("十大流星雨日历 · 此刻哪里能看到")}
        checked={layers.meteors} onChange={(v) => setLayer("meteors", v)} />
      {layers.meteors && <div className="layer-extra astro-section">{module ? <ShowerList module={module} selected={props.shower} onSelect={props.onSelectShower} timeline={props.timeline} /> : <p className="layer-status">{loading}</p>}</div>}
      <TonightSection {...props} />
    </LayerGroup>
  );
}

function MoonSection({ module, timeline }: { module: AstronomyModule; timeline: TimeController }) {
  // Ten-minute steps are plenty for the numbers in the panel.
  const step = useTimeSelector(timeline, (state) => Math.floor((state.live ? now() : state.time) / 600_000));
  const at = step * 600_000;
  const moon = useMemo(() => module.moonState(at), [module, at]);
  const quarters = useMemo(() => module.nextQuarters(at).map((q) => ({ ...q, distance: module.moonState(q.time).distanceKm })), [module, Math.floor(at / DAY)]);
  return (
    <>
      <p className="layer-status" role="status">
        {t(module.PHASE_LABELS[moon.phase])} · {t("亮面 {0}%", Math.round(moon.illuminated * 100))} · {t("距离 {0} 公里", Math.round(moon.distanceKm).toLocaleString(localeTag()))}
      </p>
      <ul className="astro-list compact">
        {quarters.map((q) => (
          <li key={q.time}><span>{t(QUARTERS[q.quarter])}{q.quarter === 2 && q.distance < module.SUPERMOON_KM && <em className="astro-badge">{t("超级月亮")}</em>}</span><small>{dayTime(q.time)}</small></li>
        ))}
      </ul>
      <p className="layer-note">{t("金色月亮图标处，月亮正好在头顶；虚线圈内的半个地球此刻能看到月亮（不论白天黑夜）。拉远视角可在太空中看到月亮本身。")}</p>
    </>
  );
}

function EclipseList({ module, selected, onSelect }: { module: AstronomyModule; selected: string | null; onSelect: (e: Eclipse) => void }) {
  const today = Math.floor(now() / DAY) * DAY;
  // Listed from yesterday, so an eclipse that has just happened stays for a day.
  const eclipses = useMemo(() => module.listEclipses(today - DAY, today + ECLIPSE_YEARS * 365 * DAY), [module, today]);
  return (
    <>
      <ul className="astro-list">
        {eclipses.map((e) => (
          <li key={e.id}>
            <button type="button" className={selected === e.id ? "selected" : ""} onClick={() => onSelect(e)}>
              <i style={{ background: eclipseColor(e) }} />
              <span><strong>{t(eclipseLabel(e))} · {dayFormat(e.peak)}</strong>
                <small>{e.type === "solar"
                  ? e.latitude !== null ? t("食甚 {0}", place(e.latitude, e.longitude!)) : t("只有偏食，在高纬度地区")
                  : t("全程约 {0} 小时 · 月亮在地平线上的地方都能看到", (e.semiDuration.penumbral * 2 / 60).toFixed(1))}</small></span>
            </button>
          </li>
        ))}
      </ul>
      <p className="layer-note">{t("点一次日食或月食，地球会切换到那一刻：金色实线为中心线，虚线为全食（或环食）带的边界，黑色斑块是月亮的本影，暗色范围能看到偏食。由 astronomy-engine 在浏览器内计算，与 NASA 星表相差不到 1 分钟。")}</p>
    </>
  );
}

function ShowerList({ module, selected, onSelect, timeline }: { module: AstronomyModule; selected: string | null; onSelect: (s: MeteorShower) => void; timeline: TimeController }) {
  const today = Math.floor(now() / DAY) * DAY;
  const outlook: ShowerOutlook[] = useMemo(() => module.showerOutlook(today), [module, today]);
  // Same moment and ten-minute steps as the map on the globe.
  const step = useTimeSelector(timeline, (state) => Math.floor((state.live ? now() : state.time) / 600_000));
  const shown = module.METEOR_SHOWERS.find((s) => s.code === selected) ?? null;
  // Share of the Earth's surface (cells weighted by area) where the radiant is up in a dark sky.
  const coverage = useMemo(() => {
    if (!shown) return null;
    const grid = module.visibilityGrid(shown, step * 600_000, 90, 45);
    let seen = 0, all = 0;
    for (let y = 0; y < grid.height; y++) {
      const weight = Math.cos(((90 - (y + 0.5) * 4) * Math.PI) / 180);
      for (let x = 0; x < grid.width; x++) { all += weight; if (grid.values[y * grid.width + x] > 0) seen += weight; }
    }
    return seen / all;
  }, [module, shown, step]);
  return (
    <>
      {shown && coverage !== null && (
        <p className="layer-status" role="status">{coverage > 0.005
          ? t("{0}：此刻约 {1}% 的地球表面天已全黑、辐射点在地平线以上（地球上的青色区域）", t(shown.name), Math.round(coverage * 100))
          : t("{0}：此刻地球上没有天黑而且辐射点已升起的地方，稍后再看", t(shown.name))}</p>
      )}
      <ul className="astro-list">
        {outlook.map(({ shower, peak, active, moonAtPeak }) => (
          <li key={shower.code}>
            <button type="button" className={selected === shower.code ? "selected" : ""} onClick={() => onSelect(shower)}>
              <i style={{ background: active ? "#46e6c8" : "rgba(70,230,200,.35)" }} />
              <span>
                <strong>{t(shower.name)}{active && <em className="astro-badge live">{t("活跃中")}</em>}</strong>
                <small>{t("极大 {0}", dayTime(peak))} · {t("每小时约 {0} 颗", shower.zhr)} · {t(moonAtPeak > 0.6 ? "月光较强" : moonAtPeak > 0.3 ? "有些月光" : "月光干扰小")}</small>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <p className="layer-note">{t("青色区域是此刻天已全黑、而且所选流星雨的辐射点在地平线以上的地方，颜色越亮辐射点越高、能看到的流星越多。每小时流星数是理想夜空下的天顶数（ZHR），实际看到的通常少得多。数据来自国际流星组织（IMO）。")}</p>
    </>
  );
}

type Source = { latitude: number; longitude: number; label: string };

function TonightSection({ module, selectedPoint, location, onLocate, onWantModule }: Props) {
  const [source, setSource] = useState<Source | null>(null);
  const [result, setResult] = useState<{ source: Source; at: number; tonight: Tonight } | null>(null);
  useEffect(() => {
    if (!source || !module) return;
    const at = now();
    // A few dozen small searches: under a tenth of a second, so no worker.
    setResult({ source, at, tonight: module.tonight(at, source.latitude, source.longitude) });
  }, [source, module]);

  const pick = (next: Source) => { onWantModule(); setSource(next); };
  const useMyLocation = async () => {
    const found = location.status === "ready" ? location.location : await onLocate();
    if (found) pick({ latitude: found.latitude, longitude: found.longitude, label: "我的位置" });
  };
  return (
    <div className="tonight">
      <div className="pass-head"><span>{t("今晚看什么")}</span></div>
      <div className="pass-sources">
        <button type="button" onClick={() => void useMyLocation()}><LocateFixed size={13} aria-hidden="true" />{t("使用我的位置")}</button>
        <button type="button" disabled={!selectedPoint} onClick={() => selectedPoint && pick({ ...selectedPoint, label: "所选地点" })} title={t(selectedPoint ? undefined : "先在地球上点选一个地点")}>
          <Crosshair size={13} aria-hidden="true" />{t("使用所选地点")}</button>
      </div>
      {location.status === "locating" && <p className="layer-status" role="status">{t("正在获取位置…")}</p>}
      {location.status === "error" && <p className="layer-status" role="status">{t("{0}也可以在地球上点选一个地点，再用「所选地点」。", t(location.message))}</p>}
      {source && !module && <p className="layer-status" role="status">{t("正在加载天文计算…")}</p>}
      {result && module && <TonightResult module={module} result={result} />}
    </div>
  );
}

function TonightResult({ module, result }: { module: AstronomyModule; result: { source: Source; at: number; tonight: Tonight } }) {
  const { source, tonight: sky } = result;
  const where = place(source.latitude, source.longitude);
  const moonUp = sky.moon.rise !== null || sky.moon.set !== null;
  const eclipse = sky.eclipse;
  return (
    <div className="tonight-result" role="status">
      <p className="layer-status">{t(source.label)}（{where}）</p>
      <dl>
        <div><dt>{t("天黑")}</dt><dd>{sky.dark ? t("{0} – 次日 {1}（太阳在地平线下 12° 以下）", clock(sky.dark.from), clock(sky.dark.to)) : sky.night ? t("今晚天不会全黑（{0} – {1} 为暮光）", clock(sky.night.from), clock(sky.night.to)) : t("极昼：今晚太阳不落")}</dd></div>
        <div><dt>{t("月亮")}</dt><dd>{t(module.PHASE_LABELS[sky.moon.phase])} · {t("亮面 {0}%", Math.round(sky.moon.illuminated * 100))}{moonUp && " · "}{sky.moon.rise !== null && t("{0} 升起", clock(sky.moon.rise))}{sky.moon.rise !== null && sky.moon.set !== null && t("，")}{sky.moon.set !== null && t("{0} 落下", clock(sky.moon.set))}</dd></div>
        <div><dt>{t("行星")}</dt><dd>{sky.planets.length ? (
          <ul className="astro-inline">{sky.planets.map((p) => (
            <li key={p.planet}><strong>{t(PLANET_NAMES[p.planet])}</strong> {t("{0} 前后在{1}方，高 {2}°，亮度 {3} 等", clock(p.best), t(compassName(p.azimuth)), Math.round(p.altitude), p.magnitude.toFixed(1))}</li>
          ))}</ul>
        ) : t("今晚没有亮行星升到 10° 以上")}</dd></div>
        <div><dt>{t("流星雨")}</dt><dd>{sky.showers.length ? sky.showers.map((s) => t("{0}（极大 {1}，辐射点最高 {2}°）", t(s.shower.name), shortDay(s.peak), Math.round(s.radiantMaxAltitude))).join(t("；")) : t("没有主要流星雨活跃")}</dd></div>
        <div><dt>{t("下次日月食")}</dt><dd>{eclipse ? t("{0}，{1}{2}", dayFormat(eclipse.time), t(eclipseLabel(eclipse.eclipse)), eclipse.obscuration !== null ? t("，这里最多遮住太阳的 {0}%", Math.round(eclipse.obscuration * 100)) : "") : t("未来一年这里看不到")}</dd></div>
      </dl>
      <p className="layer-note">{t("按本地时间显示。卫星和空间站过境见「卫星」分组里的过境预测。位置只在浏览器内计算，不会上传。")}</p>
    </div>
  );
}
