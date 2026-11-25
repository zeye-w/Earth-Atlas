/**
 * The bright stars drawn as points (src/stars/StarField.ts): the Hipparcos
 * catalogue (ESA 1997, via CDS VizieR I/239) down to V 7, positions moved to
 * J2000, built by scripts/sky/build-sky-layers.py into public/sky/stars.bin.
 * The sky box faces (bg-*) hold everything fainter.
 *
 * stars.bin: little-endian float32 records of x, y, z, V, B−V, brightest
 * first. (x, y, z) is the unit vector in the sky box's own frame: equator of
 * J2000, x to the equinox, z to the north celestial pole.
 */
export const STARS_URL = "/sky/stars.bin";
export const STAR_RECORD_FLOATS = 5;
/** Floats per vertex in the GPU buffer: x, y, z, r, g, b, light. */
export const STAR_VERTEX_FLOATS = 7;

/** Brightness of the points: light of a V = 0 star, in device px at a peak of 1 (tuned against the sky box faces). */
export const STAR_BRIGHTNESS = 950;
/** Width (Gaussian sigma) of a star that is not saturated, in css px. */
export const STAR_SIGMA = 0.9;
/**
 * How fast saturated stars widen with their light. Small, as the faces' tone
 * curve also compresses the brightest stars: Sirius is about 2.5 times as
 * wide as a faint star. (Brightness, width and this were matched to the
 * 4096 px faces with the bright stars in them, on a 2560 px wide screen.)
 */
export const STAR_GROWTH = 0.15;

export interface StarCatalog {
  count: number;
  /** x, y, z, V, B−V per star. */
  records: Float32Array;
}

export function parseStars(buffer: ArrayBuffer): StarCatalog {
  const bytes = STAR_RECORD_FLOATS * 4;
  if (buffer.byteLength === 0 || buffer.byteLength % bytes !== 0) throw new Error(`star catalogue: ${buffer.byteLength} bytes is not a whole number of records`);
  // DataView: the file is little-endian whatever the machine.
  const view = new DataView(buffer);
  const count = buffer.byteLength / bytes;
  const records = new Float32Array(count * STAR_RECORD_FLOATS);
  for (let i = 0; i < records.length; i++) records[i] = view.getFloat32(i * 4, true);
  return { count, records };
}

/** Light relative to a V = 0 star. */
export function starLight(v: number): number {
  return 10 ** (-0.4 * v);
}

/**
 * Colour of a star of colour index B−V, as an sRGB triple in 0..1 with its
 * largest channel at 1: the temperature from Ballesteros (2012), the colour
 * of a black body of that temperature (Tanner Helland's fit), then half-way
 * to white, as the eye sees star colours (only the reddest and bluest are
 * clearly tinted).
 */
export function starColor(bv: number): [number, number, number] {
  const b = Math.min(Math.max(Number.isFinite(bv) ? bv : 0.6, -0.4), 2.0);
  const t = 4600 * (1 / (0.92 * b + 1.7) + 1 / (0.92 * b + 0.62));
  const k = t / 100;
  const r = k <= 66 ? 255 : 329.698727446 * (k - 60) ** -0.1332047592;
  const g = k <= 66 ? 99.4708025861 * Math.log(k) - 161.1195681661 : 288.1221695283 * (k - 60) ** -0.0755148492;
  const bl = k >= 66 ? 255 : k <= 19 ? 0 : 138.5177312231 * Math.log(k - 10) - 305.0447927307;
  const rgb = [r, g, bl].map((c) => Math.min(Math.max(c, 0), 255) / 255);
  const max = Math.max(...rgb, 1e-6);
  return rgb.map((c) => 0.5 + 0.5 * (c / max)) as [number, number, number];
}

/** Interleaved vertices for the GPU: direction, colour, light (relative to V = 0). */
export function starVertices(catalog: StarCatalog): Float32Array {
  const out = new Float32Array(catalog.count * STAR_VERTEX_FLOATS);
  const r = catalog.records;
  for (let i = 0; i < catalog.count; i++) {
    const s = i * STAR_RECORD_FLOATS, o = i * STAR_VERTEX_FLOATS;
    out[o] = r[s]; out[o + 1] = r[s + 1]; out[o + 2] = r[s + 2];
    const [cr, cg, cb] = starColor(r[s + 4]);
    out[o + 3] = cr; out[o + 4] = cg; out[o + 5] = cb;
    out[o + 6] = starLight(r[s + 3]);
  }
  return out;
}

/**
 * How a star of a given light is drawn, in device pixels (mirrors the vertex
 * shader in StarField.ts, so it can be tested): a Gaussian of width `sigma`
 * holding all its light, with a peak of at most 1. Stars too bright for that
 * peak grow instead, with the light's 0.3 power.
 */
export function starSprite(light: number, brightness: number, sigma0: number, pixelRatio = 1): { sigma: number; peak: number } {
  const s0 = sigma0 * pixelRatio;
  const total = light * brightness * pixelRatio * pixelRatio;
  const saturated = 2 * Math.PI * s0 * s0;
  const sigma = total > saturated ? s0 * (total / saturated) ** STAR_GROWTH : s0;
  return { sigma, peak: Math.min(1, total / (2 * Math.PI * sigma * sigma)) };
}
