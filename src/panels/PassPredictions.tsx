import { useEffect, useState } from "react";
import { Crosshair, LocateFixed } from "lucide-react";
import type { OrbitRecord } from "../satelliteOrbits";
import type { Observer, SatellitePass } from "../satellitePasses";
import { compassName } from "../compass";

const HOURS = 24;
const MAX_LISTED = 8;

type Source = { observer: Observer; label: string };
type State =
  | { state: "idle" }
  | { state: "locating" }
  | { state: "error"; message: string }
  | { state: "ready"; source: Source; passes: SatellitePass[]; at: Date };

const timeFormat = new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
const clockFormat = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });

interface Props {
  records: readonly OrbitRecord[];
  /** The location picked on the globe or by search, if any. */
  selectedPoint: { latitude: number; longitude: number } | null;
  onSelectPass: (pass: SatellitePass, observer: Observer) => void;
}

/** "Satellites over me": the next passes over the user's or the selected location. */
export function PassPredictions({ records, selectedPoint, onSelectPass }: Props) {
  const [result, setResult] = useState<State>({ state: "idle" });
  const [source, setSource] = useState<Source | null>(null);

  // Recompute when the source or the orbital elements change. The module
  // (and satellite.js) is already loaded with the satellite layer.
  useEffect(() => {
    if (!source || records.length === 0) return;
    let active = true;
    void import("../satellitePasses").then(({ predictPasses }) => {
      const at = new Date();
      const passes = predictPasses(records, source.observer, at, HOURS);
      if (active) setResult({ state: "ready", source, passes, at });
    });
    return () => { active = false; };
  }, [source, records]);

  const useMyLocation = () => {
    if (!("geolocation" in navigator)) { setResult({ state: "error", message: "此浏览器不支持定位。" }); return; }
    setResult({ state: "locating" });
    navigator.geolocation.getCurrentPosition(
      (position) => setSource({ observer: { latitude: position.coords.latitude, longitude: position.coords.longitude, heightKm: Math.max(0, (position.coords.altitude ?? 0) / 1000) }, label: "我的位置" }),
      (error) => setResult({ state: "error", message: error.code === error.PERMISSION_DENIED ? "未获得定位权限；也可以在地球上点选一个地点再用「所选地点」。" : "暂时无法获取位置，请稍后重试。" }),
      { enableHighAccuracy: false, timeout: 15_000, maximumAge: 10 * 60_000 },
    );
  };

  return (
    <div className="pass-predictions">
      <div className="pass-head">
        <span>过境预测 · 未来 {HOURS} 小时</span>
      </div>
      <div className="pass-sources">
        <button type="button" onClick={useMyLocation}><LocateFixed size={13} aria-hidden="true" />使用我的位置</button>
        <button type="button" disabled={!selectedPoint} onClick={() => selectedPoint && setSource({ observer: selectedPoint, label: "所选地点" })} title={selectedPoint ? undefined : "先在地球上点选一个地点"}>
          <Crosshair size={13} aria-hidden="true" />使用所选地点
        </button>
      </div>
      {result.state === "locating" && <p className="layer-status" role="status">正在获取位置…</p>}
      {result.state === "error" && <p className="layer-status" role="status">{result.message}</p>}
      {result.state === "ready" && <PassList result={result} onSelectPass={onSelectPass} />}
      <p className="layer-note">按本地时间显示，最低仰角 10°。「可目视」指观测地天已黑而卫星仍被阳光照亮。位置只在浏览器内计算，不会上传。</p>
    </div>
  );
}

function PassList({ result, onSelectPass }: { result: Extract<State, { state: "ready" }>; onSelectPass: Props["onSelectPass"] }) {
  const { source, passes, at } = result;
  const shown = passes.slice(0, MAX_LISTED);
  return (
    <>
      <p className="layer-status" role="status">
        {source.label}（{place(source.observer)}）· {passes.length ? "共 " + passes.length + " 次过境" : "未来 " + HOURS + " 小时内没有仰角 10° 以上的过境"}
        <small> · 计算于 {clockFormat.format(at)}</small>
      </p>
      {shown.length > 0 && (
        <ol className="pass-list">
          {shown.map((pass) => (
            <li key={pass.id + pass.rise.getTime()}>
              <button type="button" onClick={() => onSelectPass(pass, source.observer)} aria-label={pass.title + " " + timeFormat.format(pass.rise) + " 过境，在时间轴上查看"}>
                <span className="pass-name">{pass.title.split(" · ")[0].split("（")[0]}</span>
                {pass.visible && <span className="pass-visible">可目视</span>}
                <span className="pass-time">{pass.inProgress ? "正在过境" : timeFormat.format(pass.rise)} – {clockFormat.format(pass.set)}</span>
                <span className="pass-detail">最高 {Math.round(pass.maxElevation)}° · {directionLabel(pass)}</span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}

const place = ({ latitude, longitude }: Observer) =>
  Math.abs(latitude).toFixed(1) + "°" + (latitude >= 0 ? "N" : "S") + " " + Math.abs(longitude).toFixed(1) + "°" + (longitude >= 0 ? "E" : "W");

function directionLabel(pass: SatellitePass): string {
  return "从" + compassName(pass.riseAzimuth) + "到" + compassName(pass.setAzimuth);
}
