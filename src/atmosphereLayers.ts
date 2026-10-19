/**
 * Upper boundaries of the main atmospheric layers, after the U.S. Standard
 * Atmosphere 1976 and typical climatology. Heights are above the WGS84
 * ellipsoid in metres; real boundaries vary with latitude, season and
 * solar activity.
 */
export interface AtmosphereLayer {
  key: string;
  name: string;
  boundary: string;
  /** Boundary height at the equator and at the poles. */
  equatorHeightM: number;
  poleHeightM: number;
  color: string;
  note: string;
}

export const ATMOSPHERE_LAYERS: readonly AtmosphereLayer[] = [
  { key: "troposphere", name: "对流层", boundary: "对流层顶", equatorHeightM: 17_000, poleHeightM: 9_000, color: "#8fd3ff", note: "天气现象几乎都发生在这里；顶部高度随纬度变化，赤道约 17 km、两极约 9 km" },
  { key: "stratosphere", name: "平流层", boundary: "平流层顶", equatorHeightM: 50_000, poleHeightM: 50_000, color: "#7fe0d0", note: "臭氧层位于约 15–35 km" },
  { key: "mesosphere", name: "中间层", boundary: "中间层顶", equatorHeightM: 85_000, poleHeightM: 85_000, color: "#b9a6ff", note: "大气中最冷的区域，流星多在此燃尽" },
  { key: "karman", name: "卡门线", boundary: "卡门线", equatorHeightM: 100_000, poleHeightM: 100_000, color: "#ffffff", note: "国际航空联合会采用的太空边界（约定值）" },
  { key: "thermosphere", name: "热层", boundary: "热层顶", equatorHeightM: 600_000, poleHeightM: 600_000, color: "#f0a6ff", note: "顶部随太阳活动在约 500–1000 km 间变化；国际空间站在约 420 km 处运行" },
];

export const ATMOSPHERE_SCALES = [1, 5, 20] as const;
export type AtmosphereScale = (typeof ATMOSPHERE_SCALES)[number];

const WGS84_EQUATORIAL_M = 6_378_137;
const WGS84_POLAR_M = 6_356_752.314245;

/** Ellipsoid radii (x, y, z) of a layer boundary, heights multiplied by scale. */
export function shellRadii(layer: AtmosphereLayer, scale: number): [number, number, number] {
  const equatorial = WGS84_EQUATORIAL_M + layer.equatorHeightM * scale;
  return [equatorial, equatorial, WGS84_POLAR_M + layer.poleHeightM * scale];
}

export function formatHeight(layer: AtmosphereLayer): string {
  const km = (m: number) => Math.round(m / 1000);
  return layer.equatorHeightM === layer.poleHeightM
    ? km(layer.equatorHeightM) + " km"
    : km(layer.poleHeightM) + "–" + km(layer.equatorHeightM) + " km";
}
