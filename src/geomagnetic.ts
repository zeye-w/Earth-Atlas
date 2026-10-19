/**
 * NOAA SWPC planetary K-index (Kp): global geomagnetic activity on a 0-9
 * scale. The 1-minute estimated Kp gives the current value; the 3-hourly
 * product gives the recent history.
 * https://www.swpc.noaa.gov/products/planetary-k-index
 */
export const KP_NOW_URL = "https://services.swpc.noaa.gov/json/planetary_k_index_1m.json";
export const KP_HISTORY_URL = "https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json";
export const KP_REFRESH_MS = 10 * 60 * 1000;

export interface KpSample {
  time: Date;
  kp: number;
}

function parseTime(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const iso = value.includes("T") ? value : value.replace(" ", "T");
  const date = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : iso + "Z");
  return Number.isFinite(date.getTime()) ? date : null;
}

function validKp(value: unknown): number | null {
  const kp = typeof value === "string" ? Number(value) : value;
  return typeof kp === "number" && Number.isFinite(kp) && kp >= 0 && kp <= 9 ? kp : null;
}

/** Latest estimated Kp from the 1-minute JSON (array of objects). */
export function parseKpNow(json: unknown): KpSample {
  if (!Array.isArray(json)) throw new Error("Kp feed is not an array");
  for (let i = json.length - 1; i >= 0; i--) {
    const row = json[i] as Record<string, unknown> | null;
    const time = parseTime(row?.time_tag);
    const kp = validKp(row?.estimated_kp) ?? validKp(row?.kp_index);
    if (time && kp !== null) return { time, kp };
  }
  throw new Error("Kp feed has no valid samples");
}

/**
 * 3-hourly Kp history. Accepts both the table form (first row is a header
 * such as ["time_tag","Kp",...]) and an array of objects.
 */
export function parseKpHistory(json: unknown): KpSample[] {
  if (!Array.isArray(json) || json.length === 0) throw new Error("Kp history is empty");
  const samples: KpSample[] = [];
  if (Array.isArray(json[0])) {
    const header = (json[0] as unknown[]).map((cell) => String(cell).toLowerCase());
    const timeIndex = header.indexOf("time_tag");
    const kpIndex = header.findIndex((cell) => cell === "kp" || cell === "kp_index");
    if (timeIndex < 0 || kpIndex < 0) throw new Error("Kp history header not recognised");
    for (const row of json.slice(1)) {
      if (!Array.isArray(row)) continue;
      const time = parseTime(row[timeIndex]);
      const kp = validKp(row[kpIndex]);
      if (time && kp !== null) samples.push({ time, kp });
    }
  } else {
    for (const row of json as Record<string, unknown>[]) {
      const time = parseTime(row?.time_tag);
      const kp = validKp(row?.Kp ?? row?.kp ?? row?.kp_index);
      if (time && kp !== null) samples.push({ time, kp });
    }
  }
  if (samples.length === 0) throw new Error("Kp history has no valid samples");
  return samples.sort((a, b) => a.time.getTime() - b.time.getTime());
}

/** NOAA geomagnetic storm scale: G1 at Kp 5 up to G5 at Kp 9. */
export function kpLevel(kp: number): { label: string; storm: string | null } {
  if (kp >= 9) return { label: "极端磁暴", storm: "G5" };
  if (kp >= 8) return { label: "特大磁暴", storm: "G4" };
  if (kp >= 7) return { label: "强磁暴", storm: "G3" };
  if (kp >= 6) return { label: "中等磁暴", storm: "G2" };
  if (kp >= 5) return { label: "小磁暴", storm: "G1" };
  if (kp >= 4) return { label: "活跃", storm: null };
  if (kp >= 3) return { label: "不稳定", storm: null };
  return { label: "平静", storm: null };
}

export interface GeomagneticState {
  now: KpSample;
  /** Last 24 hours of 3-hourly values (up to 8). */
  history: KpSample[];
}

export async function fetchGeomagnetic(signal?: AbortSignal): Promise<GeomagneticState> {
  const [nowResponse, historyResponse] = await Promise.all([
    fetch(KP_NOW_URL, { signal, headers: { Accept: "application/json" } }),
    fetch(KP_HISTORY_URL, { signal, headers: { Accept: "application/json" } }),
  ]);
  if (!nowResponse.ok) throw new Error("Kp HTTP " + nowResponse.status);
  const now = parseKpNow(await nowResponse.json());
  // History is optional: the current value is still useful without it.
  let history: KpSample[] = [];
  if (historyResponse.ok) {
    try {
      const cutoff = now.time.getTime() - 24 * 60 * 60 * 1000;
      history = parseKpHistory(await historyResponse.json()).filter((s) => s.time.getTime() > cutoff).slice(-8);
    } catch {
      history = [];
    }
  }
  return { now, history };
}
