/**
 * Geographic place names: oceans, seas, straits and mountain ranges.
 * Positions are derived from Natural Earth 1:10m geography polygons (public
 * domain) by scripts/build-geo-labels.mjs; names are curated simplified
 * Chinese. Cesium-free so it can be unit tested.
 */
export type GeoLabelKind = "ocean" | "sea" | "strait" | "range";

export interface GeoLabel {
  kind: GeoLabelKind;
  /** 1 = visible from far away, 2 = only when closer. */
  tier: 1 | 2;
  name: string;
  english: string;
  longitude: number;
  latitude: number;
}

export async function loadGeoLabels(): Promise<GeoLabel[]> {
  const module = await import("./data/geoLabels.json");
  return module.default as GeoLabel[];
}

/** Camera distance (m) beyond which a label is hidden. */
export function maxLabelDistance(label: Pick<GeoLabel, "kind" | "tier">): number {
  if (label.kind === "ocean") return 65_000_000;
  if (label.kind === "strait") return label.tier === 1 ? 11_000_000 : 5_000_000;
  return label.tier === 1 ? 19_000_000 : 8_000_000;
}

/** Camera distance (m) below which a label is hidden (oceans only). */
export function minLabelDistance(label: Pick<GeoLabel, "kind">): number {
  return label.kind === "ocean" ? 1_500_000 : 0;
}

/**
 * Wide spacing for area names, as on printed maps. Cesium labels have no
 * letter-spacing, so put thin spaces between the characters.
 */
export function spacedName(label: Pick<GeoLabel, "kind" | "name">): string {
  if (label.kind === "ocean") return [...label.name].join(" ");
  if (label.kind === "range") return [...label.name].join(" ");
  return label.name;
}
