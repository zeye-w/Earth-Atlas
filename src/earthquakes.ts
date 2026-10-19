import {
  Cartesian3,
  Color,
  DistanceDisplayCondition,
  NearFarScalar,
  PointPrimitiveCollection,
  type Viewer,
} from "cesium";

/**
 * USGS real-time earthquake feeds (GeoJSON, CORS-enabled, updated every
 * minute). https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php
 */
export type QuakeRange = "day" | "week" | "month";
export const QUAKE_FEEDS: Readonly<Record<QuakeRange, { url: string; label: string; minMagnitude: number }>> = {
  day: { url: "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson", label: "24 小时", minMagnitude: 2.5 },
  week: { url: "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_week.geojson", label: "7 天", minMagnitude: 2.5 },
  month: { url: "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_month.geojson", label: "30 天", minMagnitude: 4.5 },
};
export const QUAKE_RANGES: readonly QuakeRange[] = ["day", "week", "month"];
export const QUAKE_REFRESH_MS = 5 * 60 * 1000;
export const QUAKE_ID_PREFIX = "quake:";

export interface Earthquake {
  id: string;
  magnitude: number;
  magnitudeType: string | null;
  place: string | null;
  time: Date;
  depthKm: number;
  longitude: number;
  latitude: number;
  url: string | null;
  tsunami: boolean;
}

export function parseQuakeFeed(json: unknown): Earthquake[] {
  const features = (json as { features?: unknown } | null)?.features;
  if (!Array.isArray(features)) throw new Error("USGS feed has no features");
  const quakes: Earthquake[] = [];
  for (const feature of features) {
    const f = feature as { id?: unknown; properties?: Record<string, unknown>; geometry?: { coordinates?: unknown } };
    const coordinates = f.geometry?.coordinates;
    const p = f.properties ?? {};
    if (!Array.isArray(coordinates) || coordinates.length < 3) continue;
    const [longitude, latitude, depthKm] = coordinates.map(Number);
    // USGS publishes mag: null for some events; Number(null) would be 0.
    if (typeof p.mag !== "number") continue;
    const magnitude = p.mag;
    const time = new Date(Number(p.time));
    if (![longitude, latitude, depthKm, magnitude].every(Number.isFinite) || !Number.isFinite(time.getTime())) continue;
    if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) continue;
    quakes.push({
      id: String(f.id ?? `${longitude},${latitude},${time.getTime()}`),
      magnitude,
      magnitudeType: typeof p.magType === "string" ? p.magType : null,
      place: typeof p.place === "string" ? p.place : null,
      time,
      depthKm,
      longitude,
      latitude,
      url: typeof p.url === "string" && p.url.startsWith("https://") ? p.url : null,
      tsunami: Number(p.tsunami) === 1,
    });
  }
  // Draw large events last so they sit on top of small ones.
  return quakes.sort((a, b) => a.magnitude - b.magnitude);
}

export async function fetchQuakes(range: QuakeRange, signal?: AbortSignal): Promise<Earthquake[]> {
  const response = await fetch(QUAKE_FEEDS[range].url, { signal, headers: { Accept: "application/geo+json, application/json" } });
  if (!response.ok) throw new Error("USGS feed HTTP " + response.status);
  return parseQuakeFeed(await response.json());
}

/** Depth classes used by USGS maps: shallow, intermediate, deep. */
export const DEPTH_CLASSES = [
  { maxKm: 70, label: "浅源 <70 km", color: "#ffd166" },
  { maxKm: 300, label: "中源 70–300 km", color: "#ff7a45" },
  { maxKm: Number.POSITIVE_INFINITY, label: "深源 >300 km", color: "#b26bff" },
] as const;

export function depthColor(depthKm: number): string {
  return (DEPTH_CLASSES.find((c) => depthKm < c.maxKm) ?? DEPTH_CLASSES[DEPTH_CLASSES.length - 1]).color;
}

/** Marker diameter in px: grows with magnitude (energy is ~32x per unit). */
export function magnitudePixelSize(magnitude: number): number {
  return Math.min(22, Math.max(3, 3 + (magnitude - 2.5) * 2.6));
}

export class EarthquakeOverlay {
  private readonly viewer: Viewer;
  private readonly points = new PointPrimitiveCollection();

  constructor(viewer: Viewer) {
    this.viewer = viewer;
    viewer.scene.primitives.add(this.points);
  }

  setQuakes(quakes: readonly Earthquake[], now = new Date()): void {
    this.points.removeAll();
    const outlineRecent = Color.fromCssColorString("#ffffff").withAlpha(0.9);
    const outlineOld = Color.fromCssColorString("#05070b").withAlpha(0.7);
    for (const quake of quakes) {
      const recent = now.getTime() - quake.time.getTime() < 24 * 60 * 60 * 1000;
      this.points.add({
        id: QUAKE_ID_PREFIX + quake.id,
        position: Cartesian3.fromDegrees(quake.longitude, quake.latitude, 4_000),
        pixelSize: magnitudePixelSize(quake.magnitude),
        color: Color.fromCssColorString(depthColor(quake.depthKm)).withAlpha(0.82),
        outlineColor: recent ? outlineRecent : outlineOld,
        outlineWidth: recent ? 1.5 : 1,
        scaleByDistance: new NearFarScalar(500_000, 1.4, 25_000_000, 0.9),
        distanceDisplayCondition: new DistanceDisplayCondition(0, 65_000_000),
      });
    }
    this.viewer.scene.requestRender();
  }

  setVisible(visible: boolean): void {
    this.points.show = visible;
    if (!this.viewer.isDestroyed()) this.viewer.scene.requestRender();
  }

  dispose(): void {
    if (this.viewer.isDestroyed()) return;
    this.viewer.scene.primitives.remove(this.points);
    this.viewer.scene.requestRender();
  }
}
