export interface WeatherGrid {
  version: number;
  source: string;
  validTime: string;
  nx: number;
  ny: number;
  temperatureScale: number;
  windScale: number;
  temperature: number[];
  u: number[];
  v: number[];
}
export const WEATHER_MAX_AGE = 36 * 3600_000;
export function parseWeather(raw: unknown, now = Date.now()): WeatherGrid {
  const d = raw as WeatherGrid;
  if (
    !d ||
    d.version !== 1 ||
    d.source !== "NOAA GFS" ||
    d.nx !== 360 ||
    d.ny !== 181 ||
    d.temperatureScale !== 0.1 ||
    d.windScale !== 0.01
  )
    throw Error("气象数据格式错误");
  const time = Date.parse(d.validTime);
  if (
    !Number.isFinite(time) ||
    time > now + 900_000 ||
    now - time > WEATHER_MAX_AGE
  )
    throw Error("气象数据已过期，等待下一次更新");
  for (const [key, limit] of [
    ["temperature", 1500],
    ["u", 15000],
    ["v", 15000],
  ] as const) {
    if (
      !Array.isArray(d[key]) ||
      d[key].length !== 360 * 181 ||
      !d[key].every((n) => Number.isInteger(n) && Math.abs(n) <= limit)
    )
      throw Error("气象网格不完整");
  }
  return d;
}
export function sampleWeather(d: WeatherGrid, lat: number, lon: number) {
  const x = ((lon % 360) + 360) % 360,
    y = 90 - Math.max(-90, Math.min(90, lat));
  const x0 = Math.floor(x),
    y0 = Math.floor(y),
    x1 = (x0 + 1) % 360,
    y1 = Math.min(180, y0 + 1),
    fx = x - x0,
    fy = y - y0;
  const value = (a: number[], scale: number) =>
    ((a[y0 * 360 + x0] * (1 - fx) + a[y0 * 360 + x1] * fx) * (1 - fy) +
      (a[y1 * 360 + x0] * (1 - fx) + a[y1 * 360 + x1] * fx) * fy) *
    scale;
  return {
    temperature: value(d.temperature, 0.1),
    u: value(d.u, 0.01),
    v: value(d.v, 0.01),
  };
}
export const TEMPERATURE_STOPS = [
  [-60, 94, 49, 143],
  [-30, 49, 92, 180],
  [0, 67, 186, 204],
  [15, 111, 193, 119],
  [25, 245, 217, 87],
  [35, 238, 132, 58],
  [50, 186, 45, 65],
];
export function temperatureColor(t: number): number[] {
  const stops = TEMPERATURE_STOPS;
  const i = Math.max(
    1,
    stops.findIndex((s) => t <= s[0]),
  );
  const hi = t > 50 ? stops.at(-1)! : stops[i],
    lo = t > 50 ? hi : stops[i - 1];
  const f =
    hi === lo ? 0 : Math.max(0, Math.min(1, (t - lo[0]) / (hi[0] - lo[0])));
  return [1, 2, 3].map((k) => Math.round(lo[k] + (hi[k] - lo[k]) * f));
}
/** Cesium billboard rotation is counterclockwise; window y increases downwards. */
export const windRotation = (dx: number, dy: number) =>
  Math.atan2(-dx, -dy) || 0;
