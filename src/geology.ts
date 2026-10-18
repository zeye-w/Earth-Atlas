/** Defensive parser for Macrostrat API v2 geologic_units/map responses. */
export interface GeologicalUnit {
  name: string;
  age: string | null;
  lithology: string | null;
  ageRangeMa: string | null;
  description: string | null;
  sourceId: number | null;
  sourceName: string | null;
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function label(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (Array.isArray(value)) {
    const labels = value.map(label).filter((item): item is string => Boolean(item));
    return labels.length ? labels.join(", ") : null;
  }
  const record = object(value);
  if (record) return label(record.name ?? record.lith ?? record.label ?? record.title);
  return null;
}

function first(...values: unknown[]): string | null {
  for (const value of values) {
    const result = label(value);
    if (result) return result;
  }
  return null;
}

function numerical(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function parseGeologicalUnit(payload: unknown): GeologicalUnit | null {
  const root = object(payload);
  const data = root && "data" in root ? root.data : payload;
  const firstRecord = Array.isArray(data) ? data.find((value) => object(value)) : data;
  const unit = object(firstRecord);
  if (!unit || Object.keys(unit).length === 0) return null;
  // Do not treat empty metadata or API status wrappers as geological units.
  if (!["map_id", "source_id", "unit_id", "name", "strat_name", "unit_name", "lith", "lithology", "age", "t_age", "b_age", "best_t_age", "best_b_age"].some((field) => unit[field] !== undefined && unit[field] !== null)) return null;

  // Macrostrat gives young/top and old/bottom ages in Ma. Missing
  // numerical ages remain unknown rather than being invented.
  const top = numerical(unit.best_t_age ?? unit.best_age_top ?? unit.t_age);
  const bottom = numerical(unit.best_b_age ?? unit.best_age_bottom ?? unit.b_age);
  let ageRangeMa: string | null = null;
  if (top !== null && bottom !== null) {
    const young = Math.min(top, bottom);
    const old = Math.max(top, bottom);
    ageRangeMa = young.toFixed(1) + "–" + old.toFixed(1) + " Ma";
  } else if (top !== null || bottom !== null) {
    ageRangeMa = (top ?? bottom)!.toFixed(1) + " Ma (single boundary)";
  }

  const sourceIdCandidate = numerical(unit.source_id);
  const sourceId = sourceIdCandidate !== null ? sourceIdCandidate : null;

  return {
    name: first(unit.name, unit.strat_name, unit.unit_name, unit.map_id && "Map unit " + unit.map_id) ?? "未命名地质单元",
    age: first(unit.age, unit.age_name, unit.t_int_name, unit.b_int_name),
    lithology: first(unit.lith, unit.lithology, unit.lith_name),
    ageRangeMa,
    description: first(unit.descrip, unit.description, unit.comments),
    sourceId,
    sourceName: first(unit.source, unit.source_name, unit.reference, unit.ref),
  };
}

export async function queryGeology(latitude: number, longitude: number, signal?: AbortSignal): Promise<GeologicalUnit | null> {
  const url = new URL("https://macrostrat.org/api/v2/geologic_units/map");
  url.searchParams.set("lat", latitude.toFixed(6));
  url.searchParams.set("lng", longitude.toFixed(6));
  const response = await fetch(url, { signal, headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error("Macrostrat HTTP " + response.status);
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("json")) {
    throw new Error("Macrostrat returned " + (contentType || "unknown content-type") + " instead of JSON");
  }
  return parseGeologicalUnit(await response.json());
}
