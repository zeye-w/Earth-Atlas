// SSEC multi-satellite hourly infrared composite. This is imagery, not a cloud mask.
export const CLOUD_METADATA_URL = "https://realearth.ssec.wisc.edu/api/products?products=globalir&timespan=-6h";
export const CLOUD_REFRESH_MS = 15 * 60_000;
export const CLOUD_MAX_AGE_MS = 6 * 60 * 60_000;

export function latestCloudObservation(payload: unknown, now = Date.now()): Date {
  if (!Array.isArray(payload)) throw new Error("Invalid cloud catalog");
  const product = payload.find((item) => item?.id === "globalir");
  const dates = (Array.isArray(product?.times) ? product.times : []).flatMap((time: unknown) => {
    if (typeof time !== "string" || !/^\d{8}\.\d{6}$/.test(time)) return [];
    const iso = `${time.slice(0,4)}-${time.slice(4,6)}-${time.slice(6,8)}T${time.slice(9,11)}:${time.slice(11,13)}:${time.slice(13,15)}Z`;
    const date = new Date(iso);
    return Number.isFinite(date.getTime()) && date.toISOString().replace(/[-:TZ]/g, "").slice(0,14) === time.replace(".", "") && date.getTime() <= now ? [date] : [];
  });
  const latest = dates.sort((a: Date, b: Date) => b.getTime() - a.getTime())[0];
  if (!latest || now - latest.getTime() > CLOUD_MAX_AGE_MS) throw new Error("No recent cloud observation");
  return latest;
}

export function cloudTileUrl(date: Date): string {
  const stamp = date.toISOString().slice(0,19).replace(/[-:]/g, "").replace("T", "_");
  return `https://realearth.ssec.wisc.edu/api/image?products=globalir_${stamp}&x={x}&y={y}&z={z}`;
}

export async function fetchCloudObservation(signal: AbortSignal): Promise<Date> {
  const response = await fetch(CLOUD_METADATA_URL, { signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]) });
  if (!response.ok) throw new Error(`Cloud catalog HTTP ${response.status}`);
  return latestCloudObservation(await response.json());
}
