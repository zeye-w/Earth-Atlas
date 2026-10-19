/**
 * Turns a Black Marble pixel into a city-light pixel. Black Marble also
 * contains moonlit ground (snow, terrain) and a navy background; drawing it
 * as-is pastes a second, differently shaded Earth over the night side. Keep
 * only warm, bright emission: lights are yellow-white (red >= blue), the
 * background and moonlit snow are blue.
 */
const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

export function lightPixel(r: number, g: number, b: number): [number, number, number, number] {
  const warmth = 0.62 * r + 0.48 * g - 0.55 * b;
  const alpha = smoothstep(6, 95, warmth) ** 0.8;
  // Sodium-amber for dim lights, whitening toward bright city cores.
  const hot = smoothstep(70, 200, warmth);
  return [255, Math.round(184 + 62 * hot), Math.round(108 + 120 * hot), Math.round(alpha * 255)];
}

/** Applies lightPixel to RGBA image data in place. */
export function extractLights(data: Uint8ClampedArray): void {
  for (let i = 0; i < data.length; i += 4) {
    const [r, g, b, a] = lightPixel(data[i], data[i + 1], data[i + 2]);
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = a;
  }
}
