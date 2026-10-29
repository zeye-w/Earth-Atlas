import { t, localeTag, useLocale } from "../i18n";
import { useEffect, useRef, useState } from "react";
import { MapPin, Rocket } from "lucide-react";
import type { LayerToggles } from "../hooks/useLayerSettings";
import type { LaunchState } from "../layers/useLaunches";
import { countdown, type Launch, type LaunchStatus } from "../launchData";
import { STATUS_COLORS } from "../launchOverlay";
import { relativeTime } from "../timeline";
import { now } from "../clock";
import { ICON, LayerGroup, ToggleRow } from "../ui/controls";
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

interface Props {
  layers: LayerToggles;
  setLayer: (key: keyof LayerToggles, value: boolean) => void;
  launches: LaunchState;
  selectedId: string | null;
  /** Changes when a pad is picked on the globe, to open this group. */
  reveal: unknown;
  ready: boolean;
  onSelect: (launch: Launch) => void;
  onFlyTo: (launch: Launch) => void;
  onWatch: (launch: Launch) => void;
}

export function LaunchesGroup({ layers, setLayer, launches, selectedId, reveal, ready, onSelect, onFlyTo, onWatch }: Props) {
  return (
    <LayerGroup title="LAUNCHES" subtitle={t("真实火箭发射日历")} reveal={reveal}>
      <ToggleRow icon={<Rocket {...ICON} />} title={t("火箭发射日历")} caption={t("全球即将进行的真实发射 · Launch Library 2 · 每 2 小时更新")}
        checked={layers.launches} onChange={(v) => setLayer("launches", v)} />
      {layers.launches && <LaunchList launches={launches} selectedId={selectedId} ready={ready} onSelect={onSelect} onFlyTo={onFlyTo} onWatch={onWatch} />}
    </LayerGroup>
  );
}

function LaunchList({ launches, selectedId, ready, onSelect, onFlyTo, onWatch }: Omit<Props, "layers" | "setLayer" | "reveal">) {
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
