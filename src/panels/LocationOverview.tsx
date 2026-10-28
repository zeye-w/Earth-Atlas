import { t, localeTag } from "../i18n";
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
  mode,
}: {
  coordinates: Coordinates;
  live: boolean;
  mode: "overview" | "weather";
}) {
  const { latitude, longitude } = coordinates;
  const [state, setState] = useState<{
    key: string;
    data?: LocationWeather;
    error?: string;
  }>({ key: "" });
  const key = `${latitude},${longitude}`;
  useEffect(() => {
    if (!live || mode !== "weather") return;
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
                error instanceof Error ? error.message : t("地点天气暂不可用"),
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
  }, [latitude, longitude, key, live, mode]);
  const city = nearbyCity(latitude, longitude);
  const data = live && state.key === key ? state.data : undefined;
  const value = (n: number | null, unit: string) =>
    n === null ? t("未提供") : `${n.toFixed(unit === "%" ? 0 : 1)} ${unit}`;
  return (
    <section
      className="location-overview"
      aria-label={t(mode === "overview" ? "地点概览" : "地点天气")}
    >
      <div className="metric-label">
        {t(mode === "overview"
          ? "PLACE OVERVIEW · 地点概览"
          : "WEATHER · 地点天气")}
      </div>
      {mode === "overview" && (
        <>
          {city && (
            <div className="info-field">
              <strong>{t("附近城市：{0}", t(city.name))}</strong>
              <p>{t("距收录城市中心约{0}{1}km；不表示行政归属。", Math.round(city.distance), t(" "))}</p>
            </div>
          )}
          {!city && (
            <p>{t("所选坐标附近 300 km 内暂无收录城市。可继续查看该坐标的环境与地质信息。")}</p>
          )}
          <p>{t("切换“天气”查看地点环境，切换“地质”查看岩性与年代。城市距离来自已收录的城市坐标。")}</p>
        </>
      )}
      {mode === "weather" &&
        (!live ? (
          <p>{t("历史回放中不展示当前天气，请返回实时模式查看。")}</p>
        ) : data ? (
          <>
            <div className="location-weather-heading">
              <strong>{t(data.condition)}</strong>
              <span>{t(value(data.temperature, "°C"))}</span>
            </div>
            <dl className="location-metrics">
              <div>
                <dt>{t("体感温度")}</dt>
                <dd>{t(value(data.apparent, "°C"))}</dd>
              </div>
              <div>
                <dt>{t("相对湿度")}</dt>
                <dd>{t(value(data.humidity, "%"))}</dd>
              </div>
              <div>
                <dt>{t("地表气压")}</dt>
                <dd>{t(value(data.pressure, "hPa"))}</dd>
              </div>
              <div>
                <dt>{t("云量")}</dt>
                <dd>{t(value(data.cloud, "%"))}</dd>
              </div>
              <div>
                <dt>{t("网格海拔")}</dt>
                <dd>{t(value(data.elevation, "m"))}</dd>
              </div>
              <div>
                <dt>{t("所在地时区")}</dt>
                <dd>{t(data.timezone)}</dd>
              </div>
            </dl>
            <p>{t("数据时间：{0}（所在地时间）", t(new Date(data.time).toLocaleString(localeTag(), {
                timeZone: data.timezone,
                timeZoneName: "short",
              })))}</p>
            <p>{t("数值模式估计 · 非现场实测")}</p>
            <details className="location-source">
              <summary>{t("数据来源与说明")}</summary>
              <p>{t("天气来自")}{t(" ")}
                <a
                  href="https://open-meteo.com/"
                  target="_blank"
                  rel="noreferrer"
                >
                  Open-Meteo
                </a>{t("（CC BY 4.0），为数值模式估计，并非该点实测；与气温热力图的数据源和时间可能不同。")}</p>
              <p>{t("天气网格距点击坐标约{0}{1}{2}km。海拔为服务返回的地形网格高度，海域不能据此推算水深。", t(" "), t(distanceKm(
                  latitude,
                  longitude,
                  data.latitude,
                  data.longitude,
                ).toFixed(1)), t(" "))}</p>
            </details>
          </>
        ) : state.key === key && state.error ? (
          <p role="status">{t("{0}，仍可查看坐标与地质记录。", t(state.error))}</p>
        ) : (
          <p role="status">{t("正在查询地点环境…")}</p>
        ))}
    </section>
  );
}
