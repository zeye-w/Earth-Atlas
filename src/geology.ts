/**
 * Macrostrat v2 map-unit adapter.
 * https://macrostrat.org/api/v2/geologic_units/map
 *
 * This endpoint describes mapped surface units, not a unique subsurface column.
 * The carto raster is a blended multiscale compilation, so do not force an
 * arbitrary single scale here or imply results exactly match its raster pixels.
 */

export interface GeologicalUnit {
  name: string;
  age: string | null;
  lithology: string | null;
  ageRangeMa: string | null;
  ageNote: string;
  description: string | null;
  sourceId: number | null;
  sourceName: string | null;
  mapId: number | null;
}

type RecordValue = Record<string, unknown>;

function object(value: unknown): RecordValue | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordValue)
    : null;
}

function textValue(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (Array.isArray(value)) {
    const names = value.map(textValue).filter((s): s is string => s !== null);
    return names.length ? Array.from(new Set(names)).join(", ") : null;
  }
  const item = object(value);
  if (item) return first(item.name, item.lith, item.label, item.title, item.strat_name);
  // Numeric lithology identifiers refer to a dictionary; they are not names.
  return null;
}

function first(...values: unknown[]): string | null {
  for (const value of values) {
    const result = textValue(value);
    if (result !== null) return result;
  }
  return null;
}

function idValue(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value.trim()) ? Number(value) : NaN;
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

function ageValue(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  return Number.isFinite(n) && n >= 0 && n <= 4600 ? n : null;
}

function boundary(...values: unknown[]): { value: number; fallbackInterval: boolean } | null {
  for (let i = 0; i < values.length; i++) {
    const value = ageValue(values[i]);
    if (value !== null) return { value, fallbackInterval: i === values.length - 1 };
  }
  return null;
}

function ma(value: number): string {
  return String(Number(value.toFixed(2)));
}

function parseRecord(raw: RecordValue): GeologicalUnit | null {
  const unit = object(raw.properties) ?? raw; // GeoJSON or standard JSON
  const mapId = idValue(unit.map_id);
  const sourceId = idValue(unit.source_id);
  const name = first(unit.name, unit.strat_name, unit.unit_name);
  const lithology = first(unit.lith, unit.lithology, unit.lith_name, unit.lith1, unit.lith2);
  const age = first(unit.best_int_name, unit.age, unit.age_name, unit.int_name, unit.t_int_name, unit.b_int_name);
  const description = first(unit.descrip, unit.description, unit.comments);
  // A wrapper or a source-only record is NOT a geological map unit.
  if (mapId === null && !name && !lithology && !age && !description) return null;

  // Unit age estimates have priority. t_int_age / b_int_age are *interval*
  // boundaries; if used as fallback, the UI must say so explicitly.
  const top = boundary(unit.t_age, unit.best_t_age, unit.t_int_age);
  const bottom = boundary(unit.b_age, unit.best_b_age, unit.b_int_age);
  let ageRangeMa: string | null = null;
  let ageNote = "Macrostrat 的推算年龄；不是该地点岩石的直接测年结果。";

  if (top && bottom) {
    if (top.value > bottom.value) {
      ageNote = "原始年龄边界不一致（顶部年龄大于底部年龄），未展示数值范围。";
    } else {
      ageRangeMa = ma(top.value) + "–" + ma(bottom.value) + " Ma";
      if (top.fallbackInterval || bottom.fallbackInterval) {
        ageNote = "包含年代地层单元边界推算值，不能视为精确岩石测年。";
      }
    }
  } else if (top || bottom) {
    ageNote = "仅有一侧年龄边界，不能确定完整年代范围。";
  } else {
    ageNote = "未提供可验证的数值年龄范围。";
  }

  const source = object(unit.source);
  return {
    name: name ?? (mapId !== null ? "Map unit " + mapId : "未命名地质单元"),
    age,
    lithology,
    ageRangeMa,
    ageNote,
    description,
    mapId,
    sourceId: sourceId ?? idValue(source?.source_id),
    sourceName: first(unit.source_name, source?.name, source?.title, unit.reference, unit.ref, typeof unit.source === "string" ? unit.source : null),
  };
}

/** Return all available matching units in API order; never silently discard overlaps. */
export function parseGeologicalUnits(payload: unknown): GeologicalUnit[] {
  const root = object(payload);
  if (!root && !Array.isArray(payload)) throw new Error("Invalid Macrostrat JSON payload");

  if (root && (root.success === false || root.error)) {
    throw new Error("Macrostrat returned an API error");
  }

  // Macrostrat API v2 commonly wraps responses in success.data, not root.data.
  // Support both variants and retain explicit error handling for malformed JSON.
  const success = root ? object(root.success) : null;
  const data = root && "data" in root
    ? root.data
    : success && "data" in success
      ? success.data
      : payload;
  const collection = object(data);
  const rows: unknown[] = Array.isArray(data)
    ? data
    : collection?.type === "FeatureCollection" && Array.isArray(collection.features)
      ? collection.features
      : object(data) && ("map_id" in (data as RecordValue) || "properties" in (data as RecordValue))
        ? [data]
        : [];
  if (rows.length === 0) {
    if (Array.isArray(data) || collection?.type === "FeatureCollection") return [];
    throw new Error("Unexpected Macrostrat response structure");
  }

  const seen = new Set<string>();
  const units: GeologicalUnit[] = [];
  for (const item of rows) {
    const record = object(item);
    if (!record) continue;
    const unit = parseRecord(record);
    if (!unit) continue;
    // A map polygon may be repeated by the API. Keep unique map/source pairs.
    const key = unit.mapId !== null ? unit.sourceId + ":" + unit.mapId : null;
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    units.push(unit);
  }
  return units;
}

/** Compatibility helper for callers that only need the first candidate. */
export function parseGeologicalUnit(payload: unknown): GeologicalUnit | null {
  return parseGeologicalUnits(payload)[0] ?? null;
}

export function buildGeologyUrl(latitude: number, longitude: number): string {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) ||
      latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    throw new RangeError("Invalid geographic coordinates");
  }
  const url = new URL("https://macrostrat.org/api/v2/geologic_units/map");
  url.searchParams.set("lat", latitude.toFixed(6));
  url.searchParams.set("lng", longitude.toFixed(6));
  url.searchParams.set("format", "json");
  // Do not choose arbitrary scale=tiny/small/medium/large: the rendered
  // /carto raster blends maps and does not resolve to one scale bucket.
  return url.toString();
}

export async function queryGeology(latitude: number, longitude: number, signal?: AbortSignal): Promise<GeologicalUnit[]> {
  const response = await fetch(buildGeologyUrl(latitude, longitude), {
    signal,
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error("Macrostrat HTTP " + response.status);
  const contentType = response.headers.get("content-type") ?? "";
  if (!/(?:application\/json|\+json)/i.test(contentType)) {
    throw new Error("Macrostrat returned " + (contentType || "unknown content-type") + " instead of JSON");
  }
  return parseGeologicalUnits(await response.json());
}
