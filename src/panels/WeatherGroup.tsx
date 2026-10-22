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
    <LayerGroup title="WEATHER" subtitle="全球气温">
      <ToggleRow
        icon={<Thermometer size={17} />}
        title="全球气温"
        caption="2 米气温 · °C"
        checked={layers.temperature}
        onChange={(v) => setLayer("temperature", v)}
      />
      {layers.temperature && (
        <div className="weather-info" role="status">
          <p>NOAA GFS 模式分析场 · 1° 展示网格</p>
          {weather.data && (
            <p>
              有效时间：
              {new Date(weather.data.validTime).toLocaleString("zh-CN", {
                timeZoneName: "short",
              })}
            </p>
          )}
          {weather.message && <p>{weather.message}</p>}
          {layers.temperature && (
            <>
              <div className="weather-ramp" />
              <div className="weather-ticks">
                <span>−60</span>
                <span>0</span>
                <span>25</span>
                <span>50 °C</span>
              </div>
              <p>色带受昼夜光照影响。</p>
              {layers.dayNight && (
                <button
                  type="button"
                  onClick={() => setLayer("dayNight", false)}
                >
                  关闭昼夜光照，查看完整色带
                </button>
              )}
            </>
          )}
          <p>
            全球数值模式数据，并非逐点实时实测；每 6
            小时一个分析周期。暂不提供历史天气。
          </p>
        </div>
      )}
    </LayerGroup>
  );
}
