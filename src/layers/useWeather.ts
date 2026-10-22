import { useEffect, useState } from "react";
import type { Viewer } from "cesium";
import {
  parseWeather,
  WEATHER_MAX_AGE,
  type WeatherGrid,
} from "../weatherData";
import { beginWork } from "../pendingWork";

export function useWeather(
  viewer: Viewer | null,
  temperature: boolean,
  live: boolean,
) {
  const [state, setState] = useState<{ message: string; data?: WeatherGrid }>({
    message: "",
  });
  useEffect(() => {
    if (!viewer || !temperature) {
      setState({ message: "" });
      return;
    }
    if (!live) {
      setState({ message: "仅提供最新分析场；历史回放中已隐藏" });
      return;
    }
    let cancelled = false,
      dispose: (() => void) | undefined,
      expiry: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    let busy = false;
    const refresh = async () => {
      if (busy) return;
      busy = true;
      controller = new AbortController();
      const done = beginWork();
      try {
        setState({ message: "正在加载 NOAA GFS…" });
        const response = await fetch("/data/weather/latest.json", {
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(20000),
          ]),
          cache: "no-cache",
        });
        if (!response.ok) throw Error("气象数据暂时不可用");
        const data = parseWeather(await response.json());
        const { createWeatherOverlay } = await import("../weatherOverlay");
        if (cancelled) return;
        dispose?.();
        dispose = undefined;
        dispose = await createWeatherOverlay(
          viewer,
          data,
          temperature,
          () => cancelled,
        );
        if (cancelled) {
          dispose();
          return;
        }
        setState({ message: "", data });
        clearTimeout(expiry);
        expiry = setTimeout(
          () => {
            dispose?.();
            dispose = undefined;
            setState({ message: "气象数据已过期，等待更新" });
          },
          Math.max(
            1,
            Date.parse(data.validTime) + WEATHER_MAX_AGE - Date.now(),
          ),
        );
      } catch (error) {
        if (!cancelled) {
          dispose?.();
          dispose = undefined;
          setState({
            message: error instanceof Error ? error.message : "气象加载失败",
          });
        }
      } finally {
        busy = false;
        done();
      }
    };
    void refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 1800_000);
    return () => {
      cancelled = true;
      controller?.abort();
      clearInterval(timer);
      clearTimeout(expiry);
      dispose?.();
    };
  }, [viewer, temperature, live]);
  return state;
}
