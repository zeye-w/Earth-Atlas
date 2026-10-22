import { WORLD_CITIES } from "./worldCities.ts";
import { validCoordinates } from "./sceneState.ts";

export interface LocationWeather {
  time: number;
  timezone: string;
  elevation: number | null;
  latitude: number;
  longitude: number;
  temperature: number | null;
  apparent: number | null;
  humidity: number | null;
  pressure: number | null;
  cloud: number | null;
  condition: string;
}

export function distanceKm(
  lat: number,
  lon: number,
  otherLat: number,
  otherLon: number,
): number {
  const radians = Math.PI / 180;
  const a =
    Math.sin(((otherLat - lat) * radians) / 2) ** 2 +
    Math.cos(lat * radians) *
      Math.cos(otherLat * radians) *
      Math.sin(((otherLon - lon) * radians) / 2) ** 2;
  return 6371.0088 * 2 * Math.asin(Math.sqrt(Math.min(1, a)));
}

/** A reference city only; this is not administrative reverse geocoding. */
export function nearbyCity(latitude: number, longitude: number) {
  let nearest: { name: string; distance: number } | null = null;
  for (const city of WORLD_CITIES) {
    const distance = distanceKm(
      latitude,
      longitude,
      city.latitude,
      city.longitude,
    );
    if (distance <= 300 && (!nearest || distance < nearest.distance))
      nearest = { name: city.chinese, distance };
  }
  return nearest;
}

export function weatherCondition(code: unknown): string {
  if (typeof code !== "number" || !Number.isInteger(code))
    return "天气状况未提供";
  const conditions: Record<number, string> = {
    0: "晴",
    1: "大部晴朗",
    2: "局部多云",
    3: "阴",
    45: "雾",
    48: "雾凇",
    51: "小毛毛雨",
    53: "毛毛雨",
    55: "强毛毛雨",
    56: "轻冻毛毛雨",
    57: "冻毛毛雨",
    61: "小雨",
    63: "中雨",
    65: "大雨",
    66: "轻冻雨",
    67: "冻雨",
    71: "小雪",
    73: "中雪",
    75: "大雪",
    77: "雪粒",
    80: "小阵雨",
    81: "阵雨",
    82: "强阵雨",
    85: "小阵雪",
    86: "强阵雪",
    95: "雷暴",
    96: "雷暴伴冰雹",
    99: "强雷暴伴冰雹",
  };
  return conditions[code] ?? "天气状况未提供";
}

function numberOrNull(value: unknown, min: number, max: number): number | null {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= min &&
    value <= max
    ? value
    : null;
}

export function parseLocationWeather(
  raw: unknown,
  now = Date.now(),
): LocationWeather {
  if (!raw || typeof raw !== "object") throw Error("地点天气数据格式错误");
  const d = raw as Record<string, any>,
    c = d.current,
    units = d.current_units;
  if (
    !c ||
    !units ||
    units.time !== "unixtime" ||
    !validCoordinates(d.latitude, d.longitude) ||
    typeof d.timezone !== "string"
  )
    throw Error("地点天气数据格式错误");
  try {
    new Intl.DateTimeFormat("zh-CN", { timeZone: d.timezone });
  } catch {
    throw Error("地点时区无效");
  }
  const time = typeof c.time === "number" ? c.time * 1000 : NaN;
  if (
    !Number.isFinite(time) ||
    time > now + 30 * 60_000 ||
    now - time > 3 * 3600_000
  )
    throw Error("地点天气数据已过期");
  const field = (key: string, unit: string, min: number, max: number) =>
    units[key] === unit ? numberOrNull(c[key], min, max) : null;
  return {
    time,
    timezone: d.timezone,
    elevation: numberOrNull(d.elevation, -500, 9000),
    latitude: d.latitude,
    longitude: d.longitude,
    temperature: field("temperature_2m", "°C", -100, 65),
    apparent: field("apparent_temperature", "°C", -120, 100),
    humidity: field("relative_humidity_2m", "%", 0, 100),
    pressure: field("surface_pressure", "hPa", 200, 1100),
    cloud: field("cloud_cover", "%", 0, 100),
    condition: weatherCondition(
      units.weather_code === "wmo code" ? c.weather_code : null,
    ),
  };
}

const cache = new Map<string, LocationWeather>();
export async function fetchLocationWeather(
  latitude: number,
  longitude: number,
  signal: AbortSignal,
): Promise<LocationWeather> {
  if (!validCoordinates(latitude, longitude)) throw Error("地点坐标无效");
  const key = `${latitude.toFixed(4)},${longitude.toFixed(4)}`,
    cached = cache.get(key);
  if (cached && Date.now() - cached.time < 15 * 60_000) return cached;
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.search = new URLSearchParams({
    latitude: latitude.toFixed(4),
    longitude: longitude.toFixed(4),
    current:
      "temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,surface_pressure,cloud_cover",
    timezone: "auto",
    timeformat: "unixtime",
    forecast_days: "1",
  }).toString();
  const response = await fetch(url, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(12000)]),
  });
  if (!response.ok) throw Error("地点天气服务暂时不可用");
  const result = parseLocationWeather(await response.json());
  if (distanceKm(latitude, longitude, result.latitude, result.longitude) > 100)
    throw Error("天气网格距离过远");
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  if (cache.size >= 50) cache.delete(cache.keys().next().value!);
  cache.set(key, result);
  return result;
}
