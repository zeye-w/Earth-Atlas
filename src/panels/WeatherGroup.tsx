import { t, localeTag } from "../i18n";
import { Thermometer } from "lucide-react";
import { LayerGroup, ToggleRow } from "../ui/controls";
import type { LayerToggles } from "../hooks/useLayerSettings";
import type { useWeather } from "../layers/useWeather";
export function WeatherGroup({
  layers,
  setLayer,
  weather,
}: {
  layers: LayerToggles;
  setLayer: (key: keyof LayerToggles, value: boolean) => void;
  weather: ReturnType<typeof useWeather>;
}) {
  return (
    <LayerGroup title="WEATHER" subtitle={t("全球气温")}>
      <ToggleRow
        icon={<Thermometer size={17} />}
        title={t("全球气温")}
        caption={t("2 米气温 · °C")}
        checked={layers.temperature}
        onChange={(v) => setLayer("temperature", v)}
      />
      {layers.temperature && (
        <div className="weather-info" role="status">
          <p>{t("NOAA GFS 模式分析场 · 1° 展示网格")}</p>
          {weather.data && (
            <p>{t("有效时间：{0}", t(new Date(weather.data.validTime).toLocaleString(localeTag(), {
                timeZoneName: "short",
              })))}</p>
          )}
          {weather.message && <p>{t(weather.message)}</p>}
          {layers.temperature && (
            <>
              <div className="weather-ramp" />
              <div className="weather-ticks">
                <span>−60</span>
                <span>0</span>
                <span>25</span>
                <span>50 °C</span>
              </div>
              <p>{t("色带受昼夜光照影响。")}</p>
              {layers.dayNight && (
                <button
                  type="button"
                  onClick={() => setLayer("dayNight", false)}
                >{t("关闭昼夜光照，查看完整色带")}</button>
              )}
            </>
          )}
          <p>{t("全球数值模式数据，并非逐点实时实测；每 6 小时一个分析周期。暂不提供历史天气。")}</p>
        </div>
      )}
    </LayerGroup>
  );
}
