const COMPASS = ["北", "东北", "东", "东南", "南", "西南", "西", "西北"];

/** Azimuth in degrees (0 = north, clockwise) to an 8-point Chinese compass name. */
export function compassName(azimuth: number): string {
  return COMPASS[Math.round((((azimuth % 360) + 360) % 360) / 45) % 8];
}
