/** Broad geologic era guide, not a replacement for the source map's color legend.
 * Approximate boundaries (Ma) derived from the ICS chronostratigraphic chart.
 * Bands are deliberately used only when the *full* unit range falls in one.
 */
export type EraKey = "cenozoic" | "mesozoic" | "paleozoic" | "precambrian" | "unknown";
export interface EraGuide { key: EraKey; label: string; color: string; }

export const ERA_GUIDE: readonly EraGuide[] = [
  { key: "cenozoic", label: "新生代 / Cenozoic", color: "#D1B36D" },
  { key: "mesozoic", label: "中生代 / Mesozoic", color: "#75A7A0" },
  { key: "paleozoic", label: "古生代 / Paleozoic", color: "#7A97B5" },
  { key: "precambrian", label: "前寒武纪 / Precambrian", color: "#A999BC" },
];
const UNKNOWN: EraGuide = { key: "unknown", label: "跨代或无法确定 / Undetermined", color: "#A5ADA9" };

export function classifyGeologicEra(young: number | null, old: number | null): EraGuide {
  if (young === null || old === null || !Number.isFinite(young) || !Number.isFinite(old) ||
      young < 0 || old < young || old > 4600) return UNKNOWN;
  // At an exact boundary, a unit with both limits at the boundary alone
  // should not be assigned a single era.
  if (young === old && (young === 66 || young === 251.902 || young === 538.8)) return UNKNOWN;
  if (old <= 66) return ERA_GUIDE[0];
  if (young >= 66 && old <= 251.902) return ERA_GUIDE[1];
  if (young >= 251.902 && old <= 538.8) return ERA_GUIDE[2];
  if (young >= 538.8) return ERA_GUIDE[3];
  return UNKNOWN;
}
