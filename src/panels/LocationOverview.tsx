import { useEffect, useState } from "react";
import {
  fetchLocationWeather,
  nearbyCity,
  distanceKm,
  type LocationWeather,
} from "../locationData";
import type { Coordinates } from "../layers/useGeologyQuery";

export function LocationOverview({
  coordinates,
  live,
}: {
  coordinates: Coordinates;
  live: boolean;
}) {
  const { latitude, longitude } = coordinates;
  const [state, setState] = useState<{
    key: string;
    data?: LocationWeather;
    error?: string;
  }>({ key: "" });
  const key = `${latitude},${longitude}`;
  useEffect(() => {
    if (!live) return;
    const controller = new AbortController();
    setState({ key });
    // Rapid globe clicks should not issue a request for every intermediate point.
    let busy = false;
    const query = () => {
      if (busy || controller.signal.aborted) return;
      busy = true;
      void fetchLocationWeather(latitude, longitude, controller.signal)
        .then((data) => {
          if (!controller.signal.aborted) setState({ key, data });
        })
        .catch((error) => {
          if (!controller.signal.aborted)
            setState({
              key,
              error:
                error instanceof Error ? error.message : "地点天气暂不可用",
            });
        })
        .finally(() => {
          busy = false;
        });
    };
    const timer = setTimeout(query, 250);
    const refresh = setInterval(() => {
      if (document.visibilityState === "visible") query();
    }, 15 * 60_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") query();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      controller.abort();
      clearTimeout(timer);
      clearInterval(refresh);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [latitude, longitude, key, live]);
  const city = nearbyCity(latitude, longitude);
  const data = live && state.key === key ? state.data : undefined;
  const value = (n: number | null, unit: string) =>
    n === null ? "未提供" : `${n.toFixed(unit === "%" ? 0 : 1)} ${unit}`;
  return (
    <section className="location-overview" aria-label="地点概览">
      <div className="metric-label">PLACE OVERVIEW · 地点概览</div>
      {city && (
        <div className="info-field">
          <strong>附近城市：{city.name}</strong>
          <p>
            距收录城市中心约 {Math.round(city.distance)} km；不表示行政归属。
          </p>
        </div>
      )}
      {!city && (
        <p>
          所选坐标附近 300 km 内暂无收录城市。可继续查看该坐标的环境与地质信息。
        </p>
      )}
      {!live ? (
        <p>历史回放中不展示当前天气，请返回实时模式查看。</p>
      ) : data ? (
        <>
          <div className="location-weather-heading">
            <strong>{data.condition}</strong>
            <span>{value(data.temperature, "°C")}</span>
          </div>
          <dl className="location-metrics">
            <div>
              <dt>体感温度</dt>
              <dd>{value(data.apparent, "°C")}</dd>
            </div>
            <div>
              <dt>相对湿度</dt>
              <dd>{value(data.humidity, "%")}</dd>
            </div>
            <div>
              <dt>地表气压</dt>
              <dd>{value(data.pressure, "hPa")}</dd>
            </div>
            <div>
              <dt>云量</dt>
              <dd>{value(data.cloud, "%")}</dd>
            </div>
            <div>
              <dt>网格海拔</dt>
              <dd>{value(data.elevation, "m")}</dd>
            </div>
            <div>
              <dt>所在地时区</dt>
              <dd>{data.timezone}</dd>
            </div>
          </dl>
          <p>
            数据时间：
            {new Date(data.time).toLocaleString("zh-CN", {
              timeZone: data.timezone,
              timeZoneName: "short",
            })}
            （所在地时间）
          </p>
          <p>
            天气来自{" "}
            <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">
              Open-Meteo
            </a>
            （CC BY
            4.0），为数值模式估计，并非该点实测；与气温热力图的数据源和时间可能不同。
          </p>
          <p>
            天气网格距点击坐标约{" "}
            {distanceKm(
              latitude,
              longitude,
              data.latitude,
              data.longitude,
            ).toFixed(1)}{" "}
            km。海拔为服务返回的地形网格高度，海域不能据此推算水深。
          </p>
        </>
      ) : state.key === key && state.error ? (
        <p role="status">{state.error}，仍可查看坐标与地质记录。</p>
      ) : (
        <p role="status">正在查询地点环境…</p>
      )}
    </section>
  );
}
