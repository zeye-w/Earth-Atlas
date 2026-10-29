import { t, localeTag, useLocale } from "../i18n";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { MapPin, Rocket, RotateCcw, Square } from "lucide-react";
import type { LayerToggles } from "../hooks/useLayerSettings";
import type { LaunchState } from "../layers/useLaunches";
import { countdown, type Launch, type LaunchStatus } from "../launchData";
import { STATUS_COLORS } from "../launchOverlay";
import { relativeTime } from "../timeline";
import { now } from "../clock";
import { ICON, LayerGroup, Segmented, ToggleRow } from "../ui/controls";
import { LAUNCH_SITES, type LaunchSite } from "../launchSites";
import { getExperience, subscribeExperience, updateExperience, type RocketPhase } from "../fireworks/experience";
import { requestShowWarmup } from "../fireworks/shaderWarmup";
import "./launches.css";

const STATUS_LABELS: Record<LaunchStatus, string> = {
  go: "确认发射", tbc: "待确认", tbd: "时间未定", hold: "暂停", flight: "飞行中", success: "发射成功", failure: "发射失败",
};

function launchDate(launch: Launch): string {
  const options: Intl.DateTimeFormatOptions = launch.precision === "time" ? { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }
    : launch.precision === "day" ? { year: "numeric", month: "short", day: "numeric" } : { year: "numeric", month: "long" };
  return new Intl.DateTimeFormat(localeTag(), options).format(launch.net);
}

/** Ticks once a second while mounted. */
function useTicker(): number {
  const [time, setTime] = useState(now);
  useEffect(() => {
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") setTime(now()); }, 1_000);
    return () => window.clearInterval(timer);
  }, []);
  return time;
}

const PHASES: Record<RocketPhase, string> = {
  idle: "镜头前往发射场…", countdown: "发射倒计时 {0}", ignition: "主发动机点火", liftoff: "起飞 · 垂直升空", ascent: "转向 · 持续爬升", complete: "发射表演结束",
};

type Tab = "upcoming" | "sites";

interface Props {
  layers: LayerToggles;
  setLayer: (key: keyof LayerToggles, value: boolean) => void;
  launches: LaunchState;
  selectedId: string | null;
  /** Changes when a pad is picked on the globe, to open this group. */
  reveal: unknown;
  ready: boolean;
  /** A rocket (or other) show is playing. */
  showRunning: boolean;
  onStopShow: () => void;
  onSelect: (launch: Launch) => void;
  onFlyTo: (launch: Launch) => void;
  onWatch: (launch: Launch) => void;
  /** Play the virtual launch at a bundled launch site. */
  onWatchSite: (site: LaunchSite) => void;
  /** Where the current or last virtual launch plays. */
  showSite: string;
  onReplay: () => void;
}

export function LaunchesGroup({ layers, setLayer, launches, selectedId, reveal, ready, showRunning, onStopShow, onSelect, onFlyTo, onWatch, onWatchSite, showSite, onReplay }: Props) {
  const [tab, setTab] = useState<Tab>("upcoming");
  // A pad picked on the globe opens the upcoming launches.
  useEffect(() => { if (reveal != null) setTab("upcoming"); }, [reveal]);
  return (
    <LayerGroup title="LAUNCHES" subtitle={t("火箭发射 · 日历与虚拟发射")} reveal={reveal}>
      <div onPointerEnter={requestShowWarmup} onFocus={requestShowWarmup}>
        <ShowStatus running={showRunning} site={showSite} onStop={onStopShow} onReplay={onReplay} ready={ready} />
        <ToggleRow icon={<Rocket {...ICON} />} title={t("火箭发射日历")} caption={t("全球即将进行的真实发射 · Launch Library 2 · 每 2 小时更新")}
          checked={layers.launches} onChange={(v) => setLayer("launches", v)} />
        <div className="layer-extra launch-tabs">
          <Segmented label={t("发射视图")} options={["upcoming", "sites"] as const} value={tab} onChange={setTab}
            format={(value) => value === "upcoming" ? t("即将发射") : t("发射场")} />
        </div>
        {tab === "upcoming" ? layers.launches
          ? <LaunchList launches={launches} selectedId={selectedId} ready={ready} onSelect={onSelect} onFlyTo={onFlyTo} onWatch={onWatch} />
          : <p className="layer-status">{t("打开「火箭发射日历」查看即将进行的真实发射，并在地球上标出发射场。")}</p>
          : <SiteList ready={ready} running={showRunning} onWatch={onWatchSite} />}
      </div>
    </LayerGroup>
  );
}

/** The virtual launch in progress: phase, simulated readings, camera and stop. */
function ShowStatus({ running, site, onStop, onReplay, ready }: { running: boolean; site: string; onStop: () => void; onReplay: () => void; ready: boolean }) {
  const experience = useSyncExternalStore(subscribeExperience, getExperience, getExperience);
  if (experience.mode !== "rocket" || (!running && experience.phase !== "complete")) return null;
  return (
    <div className="launch-show" role="group" aria-label={t("虚拟发射")}>
      <div className="launch-show-head"><Rocket size={14} aria-hidden="true" /><strong>{t("虚拟发射")}</strong><span>{t(site)}</span></div>
      <p className="launch-show-phase" role="status" aria-live="polite">{t(PHASES[running ? experience.phase : "complete"], experience.countdown)}</p>
      <div className="rocket-telemetry" aria-label={t("模拟飞行数据")} aria-live="off"><span>{t("模拟高度")}<strong>{t((experience.altitude / 1000).toFixed(1))} km</strong></span><span>{t("模拟速度")}<strong>{Math.round(experience.speed)} m/s</strong></span></div>
      <label className="rocket-follow"><input type="checkbox" checked={experience.follow} onChange={event => updateExperience({ follow: event.target.checked })} />{t("跟随火箭镜头（关闭后可自由浏览）")}</label>
      <div className="launch-actions">
        <button type="button" disabled={!ready} onClick={onReplay}><RotateCcw size={12} aria-hidden="true" />{t("重新播放")}</button>
        <button type="button" className="primary" disabled={!running} onClick={onStop}><Square size={12} aria-hidden="true" />{t("停止虚拟发射")}</button>
      </div>
    </div>
  );
}

function SiteList({ ready, running, onWatch }: { ready: boolean; running: boolean; onWatch: (site: LaunchSite) => void }) {
  return (
    <div className="layer-extra launch-calendar">
      <p className="layer-note">{t("选择一个发射场观看虚拟发射：火箭立在发射台上，10 秒倒计时、点火后升空，爬升至约 52 km，全程约 52 秒。火箭与发射场设施均为艺术模拟，不代表真实型号或场地布局。")}</p>
      <ul className="launch-sites">
        {LAUNCH_SITES.map((site) => (
          <li key={site.id}>
            <button type="button" disabled={!ready} onClick={() => onWatch(site)} aria-label={t("在{0}观看虚拟发射", t(site.label))}>
              <strong>{t(site.label)}</strong><small>{site.pad}</small>
            </button>
          </li>
        ))}
      </ul>
      {running && <p className="layer-note">{t("选择其他发射场会结束当前表演。")}</p>}
    </div>
  );
}

function LaunchList({ launches, selectedId, ready, onSelect, onFlyTo, onWatch }: Pick<Props, "launches" | "selectedId" | "ready" | "onSelect" | "onFlyTo" | "onWatch">) {
  const locale = useLocale();
  const at = useTicker();
  const selectedRef = useRef<HTMLLIElement>(null);
  useEffect(() => { selectedRef.current?.scrollIntoView({ block: "nearest" }); }, [selectedId]);
  const snapshot = launches.snapshot;
  const list = snapshot?.launches ?? [];
  return (
    <div className="layer-extra launch-calendar">
      <p className="layer-status" role="status">
        {!snapshot ? t(launches.status === "error" ? "发射日历暂不可用，未显示；不会显示虚构的发射。" : "正在读取发射日历…") :
          list.length === 0 ? t("近期没有已公布的发射。") :
          t("{0} 次发射 · 数据更新于{1}", list.length, relativeTime(snapshot.fetched, at, locale))}
      </p>
      {list.length > 0 && (
        <ul className="launch-list">
          {list.map((launch) => {
            const selected = launch.id === selectedId;
            const clock = countdown(launch, at);
            return (
              <li key={launch.id} ref={selected ? selectedRef : undefined} className={selected ? "selected" : ""}>
                <button type="button" className="launch-entry" aria-expanded={selected} onClick={() => onSelect(launch)}>
                  <span className="launch-when">
                    <i className="launch-status" style={{ color: STATUS_COLORS[launch.status] }}>{t(STATUS_LABELS[launch.status])}</i>
                    <span className="launch-clock">{clock ?? launchDate(launch)}</span>
                  </span>
                  <strong className="launch-mission">{launch.mission}</strong>
                  <small>{launch.rocket}{launch.provider ? " · " + launch.provider : ""}</small>
                  <small className="launch-pad"><MapPin size={10} aria-hidden="true" />{launch.location || launch.pad}</small>
                </button>
                {selected && (
                  <div className="launch-detail">
                    <dl>
                      <dt>{t("发射时间")}</dt><dd>{launchDate(launch)}{launch.precision !== "time" && " · " + t("尚未精确到分钟")}</dd>
                      {launch.windowStart !== null && launch.windowEnd !== null && launch.windowEnd > launch.windowStart && (
                        <><dt>{t("发射窗口")}</dt><dd>{new Intl.DateTimeFormat(localeTag(), { hour: "2-digit", minute: "2-digit", hour12: false }).format(launch.windowStart)}–{new Intl.DateTimeFormat(localeTag(), { hour: "2-digit", minute: "2-digit", hour12: false }).format(launch.windowEnd)}</dd></>
                      )}
                      <dt>{t("状态")}</dt><dd>{launch.statusName || t(STATUS_LABELS[launch.status])}</dd>
                      {launch.orbit && <><dt>{t("目标轨道")}</dt><dd>{launch.orbit}</dd></>}
                      {launch.missionType && <><dt>{t("任务类型")}</dt><dd>{launch.missionType}</dd></>}
                      <dt>{t("发射台")}</dt><dd>{launch.pad}</dd>
                    </dl>
                    {launch.description && <p className="launch-description" lang="en">{launch.description}</p>}
                    <div className="launch-actions">
                      <button type="button" onClick={() => onFlyTo(launch)}><MapPin size={12} aria-hidden="true" />{t("飞到发射场")}</button>
                      <button type="button" className="primary" disabled={!ready} onClick={() => onWatch(launch)}><Rocket size={12} aria-hidden="true" />{t("观看虚拟发射")}</button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <p className="layer-note">{t("数据来源：The Space Devs · Launch Library 2。时间按你的本地时区显示，发射常会推迟，请以发射方公告为准。虚拟发射为艺术模拟，不代表这次任务的火箭外形或轨迹。")}</p>
    </div>
  );
}
