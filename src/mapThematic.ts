/**
 * Cesium MVT thematic styling for Macrostrat's public /carto vector tiles.
 *
 * Live vector schema (verified from /carto/4/3/6):
 * units: map_id, source_id, best_age_top, best_age_bottom, lith, color,
 *       t_int, b_int, name, reference metadata...
 * lines: line_id, source_id, type, name...
 *
 * Caveat: vector 'lith' is AUTHOR FREE TEXT. These rock-class colors are
 * explicitly provisional term matches and must not be presented as the
 * normalized Macrostrat lithology-ID lexicon of the point inspector.
 */
export type ThematicMode = "raster" | "age" | "lithology";
export type AgeFilter = "all" | "cenozoic" | "mesozoic" | "paleozoic" | "precambrian";
export type RockFilter = "all" | "sedimentary" | "igneous" | "metamorphic";

import { GLOBAL_VECTOR_MAX_ZOOM } from "./performance.ts";
export const THEMATIC_MAX_ZOOM = GLOBAL_VECTOR_MAX_ZOOM; // z0..z5: 1,365 nodes instead of 5,461 at z6

const top = "@@{best_age_top}";
const bottom = "@@{best_age_bottom}";
const lith = "@@{lith}";
const polygon = "@@{map_id} !== undefined && @@{map_id} >= 0";
const numeric = top + " !== undefined && " + bottom + " !== undefined && " + top + " >= 0 && " + bottom + " >= " + top + " && " + bottom + " <= 4600";

const eras: Record<Exclude<AgeFilter, "all">, { condition: string; color: string }> = {
  cenozoic: { condition: numeric + " && " + bottom + " <= 66", color: "#D1B36D" },
  mesozoic: { condition: numeric + " && " + top + " >= 66 && " + bottom + " <= 251.902", color: "#75A7A0" },
  paleozoic: { condition: numeric + " && " + top + " >= 251.902 && " + bottom + " <= 538.8", color: "#7A97B5" },
  precambrian: { condition: numeric + " && " + top + " >= 538.8", color: "#A999BC" },
};

/**
 * Conservative indicative rock-type matching from map-author text.
 * This is not an official Macrostrat classification. No opaque IDs.
 * Multiple matches are marked ambiguous and excluded from focused filters.
 */
const rockTokens: Record<Exclude<RockFilter, "all">, string> = {
  sedimentary: "sedimentary|sandstone|mudstone|shale|limestone|dolomite|conglomerate|siltstone|chalk|clastic|alluvium|loess|marl|evaporite",
  igneous: "igneous|plutonic|volcanic|granite|granitic|basalt|rhyolite|gabbro|andesite|diorite|intrusive|lava|tuff",
  metamorphic: "metamorph|gneiss|schist|quartzite|marble|phyllite|amphibolite|migmatite|slate",
};

function matches(kind: Exclude<RockFilter, "all">): string {
  return '(' + lith + ' !== undefined && regExp("(' + rockTokens[kind] + ')", "i").test(' + lith + '))';
}
function only(kind: Exclude<RockFilter, "all">): string {
  return Object.keys(rockTokens).map((key) => key === kind
    ? "(" + matches(kind) + ")"
    : "!(" + matches(key as Exclude<RockFilter, "all">) + ")").join(" && ");
}
function color(value: string, alpha: number): string {
  return 'color("' + value + '", ' + Math.max(0, Math.min(1, alpha)).toFixed(2) + ')';
}

export interface ThematicStyleDefinition {
  show: string;
  color: { conditions: [string, string][] };
  lineWidth?: number;
}
export function makeThematicStyle(mode: Exclude<ThematicMode, "raster">, ageFilter: AgeFilter, rockFilter: RockFilter, opacity = 0.9): ThematicStyleDefinition {
  const conditions: [string, string][] = [];
  const alpha = Math.max(0.15, Math.min(1, opacity));
  let show = polygon;
  if (mode === "age") {
    const entries = Object.entries(eras) as [Exclude<AgeFilter, "all">, typeof eras.cenozoic][];
    for (const [, data] of entries) conditions.push([data.condition, color(data.color, alpha)]);
    conditions.push(["true", color("#ADB9B2", alpha * 0.48)]);
    if (ageFilter !== "all") show += " && (" + eras[ageFilter].condition + ")";
  } else {
    conditions.push(["(" + matches("sedimentary") + ") && !(" + matches("igneous") + ") && !(" + matches("metamorphic") + ")", color("#C6A460", alpha)]);
    conditions.push(["(" + matches("igneous") + ") && !(" + matches("sedimentary") + ") && !(" + matches("metamorphic") + ")", color("#CF8F81", alpha)]);
    conditions.push(["(" + matches("metamorphic") + ") && !(" + matches("sedimentary") + ") && !(" + matches("igneous") + ")", color("#9B8CB7", alpha)]);
    conditions.push(["true", color("#A6B2AE", alpha * 0.4)]);
    if (rockFilter !== "all") show += " && (" + only(rockFilter) + ")";
  }
  // Replacement is intentional: avoid interpolation by the build-time generator.
  return JSON.parse(JSON.stringify({ show, color: { conditions } }).replaceAll("@@", "$")) as ThematicStyleDefinition;
}

export const AGE_OPTIONS = [
  { value: "all", label: "全部年代" },
  { value: "cenozoic", label: "新生代 · Cenozoic" },
  { value: "mesozoic", label: "中生代 · Mesozoic" },
  { value: "paleozoic", label: "古生代 · Paleozoic" },
  { value: "precambrian", label: "前寒武纪 · Precambrian" },
] as const;

export const ROCK_OPTIONS = [
  { value: "all", label: "全部岩性" },
  { value: "sedimentary", label: "沉积岩 · Sedimentary" },
  { value: "igneous", label: "火成岩 · Igneous" },
  { value: "metamorphic", label: "变质岩 · Metamorphic" },
] as const;
