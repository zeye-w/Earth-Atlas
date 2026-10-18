/** Controlled lithology names and classes from Macrostrat's public lexicon. */
export type RockClass = "sedimentary" | "igneous" | "metamorphic" | "mixed" | "unclassified";

export interface LithologyDefinition {
  lithId: number;
  name: string;
  rockClass: RockClass;
}
export type LithologyDictionary = Map<number, LithologyDefinition>;

function obj(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;
}
function validId(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : NaN;
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}
function rockClass(v: unknown): RockClass {
  if (typeof v !== "string") return "unclassified";
  const x = v.trim().toLowerCase();
  return x === "sedimentary" || x === "igneous" || x === "metamorphic" ? x : "unclassified";
}

export function parseLithologyDictionary(response: unknown): LithologyDictionary {
  const root = obj(response);
  const success = obj(root?.success);
  const data = success && "data" in success ? success.data : root?.data;
  if (!Array.isArray(data)) throw new Error("Unexpected Macrostrat lithology dictionary response");
  const result: LithologyDictionary = new Map();
  for (const item of data) {
    const row = obj(item);
    if (!row) continue;
    const id = validId(row.lith_id);
    const name = typeof row.name === "string" ? row.name.trim() : "";
    if (id !== null && name) result.set(id, { lithId: id, name, rockClass: rockClass(row.class) });
  }
  if (result.size === 0) throw new Error("Empty Macrostrat lithology dictionary");
  return result;
}

export interface LithologyClassification {
  names: string[];
  rockClass: RockClass;
  classLabel: string;
  matchedCount: number;
  missingIds: number[];
}

const LABEL: Record<RockClass, string> = {
  sedimentary: "沉积岩 / Sedimentary",
  igneous: "火成岩 / Igneous",
  metamorphic: "变质岩 / Metamorphic",
  mixed: "多种岩石大类 / Mixed",
  unclassified: "未确定 / Unclassified",
};

/** Only classify dictionary-matched lith IDs, never infer classes from prose. */
export function classifyLithologies(ids: number[], dictionary: LithologyDictionary | null): LithologyClassification {
  const names: string[] = [];
  const classes = new Set<RockClass>();
  const missingIds: number[] = [];
  for (const id of [...new Set(ids)]) {
    const definition = dictionary?.get(id);
    if (!definition) {
      missingIds.push(id);
      continue;
    }
    names.push(definition.name);
    if (definition.rockClass !== "unclassified") classes.add(definition.rockClass);
  }
  const classValue: RockClass = classes.size > 1 ? "mixed" :
    missingIds.length > 0 || classes.size === 0 ? "unclassified" :
    [...classes][0];
  return { names, rockClass: classValue, classLabel: LABEL[classValue], matchedCount: names.length, missingIds };
}

let cached: Promise<LithologyDictionary> | null = null;

/** Lazy one-per-session remote dictionary; failures reset the cache for later retry. */
export function fetchLithologyDictionary(): Promise<LithologyDictionary> {
  if (cached) return cached;
  cached = (async () => {
    const response = await fetch("https://macrostrat.org/api/v2/defs/lithologies?format=json", {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error("Macrostrat lithology dictionary HTTP " + response.status);
    const type = response.headers.get("content-type") ?? "";
    if (!/json/i.test(type)) throw new Error("Macrostrat lithology dictionary is not JSON");
    return parseLithologyDictionary(await response.json());
  })().catch((err: unknown) => {
    cached = null;
    throw err;
  });
  return cached;
}
