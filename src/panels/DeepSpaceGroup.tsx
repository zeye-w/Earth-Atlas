import { t, localeTag, useLocale } from "../i18n";
import { Orbit, Rocket, Telescope } from "lucide-react";
import type { LayerToggles } from "../hooks/useLayerSettings";
import type { SpaceState } from "../layers/useSpace";
import { distanceLabel, length, lightTimeLabel, LUNAR_DISTANCE_KM, probeAt, probeInfo, sizeLabel, type Asteroid } from "../spaceData";
import { relativeTime } from "../timeline";
import { now } from "../clock";
import { ICON, LayerGroup, ToggleRow } from "../ui/controls";
import "./deepspace.css";

const day = (time: number) => new Intl.DateTimeFormat(localeTag(), { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(time);

interface Props {
  layers: LayerToggles;
  setLayer: (key: keyof LayerToggles, value: boolean) => void;
  space: SpaceState;
  selected: string | null;
  onSelectAsteroid: (asteroid: Asteroid) => void;
  onViewCislunar: () => void;
  reveal?: unknown;
}

/** Near-Earth space: asteroids passing close and the deep space probes. */
export function DeepSpaceGroup({ layers, setLayer, space, selected, onSelectAsteroid, onViewCislunar, reveal }: Props) {
  const locale = useLocale();
  const at = now();
  const snapshot = space.snapshot;
  const status = !snapshot ? t(space.status === "error" ? "近地空间数据暂不可用。" : "正在读取 NASA JPL 数据…") : null;
  const asteroids = (snapshot?.asteroids ?? []).filter((a) => a.approach > at - 2 * 86_400_000);
  const probes = (snapshot?.probes ?? []).map((p) => ({ p, info: probeInfo(p.key)!, distance: length(probeAt(p, at)) })).sort((a, b) => a.distance - b.distance);
  return (
    <LayerGroup title="DEEP SPACE" subtitle={t("近地小行星与深空探测器")} reveal={reveal}>
      <ToggleRow icon={<Orbit {...ICON} />} title={t("近地小行星")} caption={t("NASA JPL · 未来 60 天内飞近地球的小行星")}
        checked={layers.asteroids} onChange={(v) => setLayer("asteroids", v)} />
      <ToggleRow icon={<Rocket {...ICON} />} title={t("深空探测器")} caption={t("NASA JPL Horizons · 韦布望远镜、旅行者号等此刻的位置")}
        checked={layers.probes} onChange={(v) => setLayer("probes", v)} />
      {(layers.asteroids || layers.probes) && (
        <div className="layer-extra deep-space">
          <button type="button" className="cislunar-button" onClick={onViewCislunar}><Telescope size={14} aria-hidden="true" />{t("地月空间视角")}</button>
          {status && <p className="layer-status" role="status">{status}</p>}
          {layers.asteroids && snapshot && (
            <>
              <p className="layer-status" role="status">{asteroids.length ? t("{0} 颗小行星将从 10 倍地月距离以内飞过", asteroids.length) : t("未来 60 天没有小行星飞进 10 倍地月距离。")}</p>
              <ul className="space-list">
                {asteroids.map((a) => {
                  const ld = a.distanceKm / LUNAR_DISTANCE_KM;
                  return (
                    <li key={a.id}>
                      <button type="button" className={selected === a.id ? "selected" : ""} onClick={() => onSelectAsteroid(a)}>
                        <i style={{ background: ld < 1 ? "#ff6b5a" : ld < 3 ? "#ffa94d" : "#c9b98a" }} />
                        <span>
                          <strong>{a.name.replace(/^\((.*)\)$/, "$1")}</strong>
                          <small>{day(a.approach)}（{relativeTime(a.approach, at, locale)}）· {t("{0} 倍地月距离", ld.toFixed(2))} · {a.speedKms.toFixed(1)} km/s · {sizeLabel(a, locale)}</small>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          {layers.probes && snapshot && probes.length > 0 && (
            <ul className="space-list probes">
              {probes.map(({ p, info, distance }) => (
                <li key={p.key}>
                  <div>
                    <i style={{ background: "#8fe3ff" }} />
                    <span>
                      <strong>{t(info.name)}</strong>
                      <small>{distanceLabel(distance, locale)} · {t("信号单程 {0}", lightTimeLabel(distance, locale))} · {t(info.note)}</small>
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="layer-note">{t("「地月空间视角」把镜头拉到约 650 万公里外：虚线圈是月球轨道，橙色线是小行星在最近点前后 3 天的真实路径，白点是它此刻的位置；SOHO 和韦布望远镜在日地 L1、L2 点附近；更远的探测器用指向它的虚线表示。数据来自 NASA JPL（近地天体接近数据与 Horizons 星历），每天更新。")}</p>
        </div>
      )}
    </LayerGroup>
  );
}
