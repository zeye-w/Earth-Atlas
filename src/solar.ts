/**
 * Low-precision solar position (Astronomical Almanac approximation, about
 * 0.01° in declination for 1950–2050), enough to classify map tiles as
 * daylit or not.
 */
const DEG = Math.PI / 180;

/** Latitude/longitude (degrees) where the Sun is at the zenith. */
export function subsolarPoint(date: Date): { latitude: number; longitude: number } {
  const n = date.getTime() / 86_400_000 + 2440587.5 - 2451545.0; // days since J2000.0
  const meanLongitude = 280.46 + 0.9856474 * n;
  const meanAnomaly = (357.528 + 0.9856003 * n) * DEG;
  const eclipticLongitude = (meanLongitude + 1.915 * Math.sin(meanAnomaly) + 0.02 * Math.sin(2 * meanAnomaly)) * DEG;
  const obliquity = (23.439 - 0.0000004 * n) * DEG;
  const declination = Math.asin(Math.sin(obliquity) * Math.sin(eclipticLongitude));
  const rightAscension = Math.atan2(Math.cos(obliquity) * Math.sin(eclipticLongitude), Math.cos(eclipticLongitude)) / DEG;
  const gmst = 280.46061837 + 360.98564736629 * n;
  const longitude = ((((rightAscension - gmst) % 360) + 540) % 360) - 180;
  return { latitude: declination / DEG, longitude };
}

/** Solar elevation (degrees) at a point, ignoring refraction. */
export function solarElevation(latitude: number, longitude: number, sun: { latitude: number; longitude: number }): number {
  const cosAngle = Math.sin(latitude * DEG) * Math.sin(sun.latitude * DEG) +
    Math.cos(latitude * DEG) * Math.cos(sun.latitude * DEG) * Math.cos((longitude - sun.longitude) * DEG);
  return 90 - Math.acos(Math.min(1, Math.max(-1, cosAngle))) / DEG;
}

/**
 * True if every sampled point of a lon/lat rectangle (degrees) has the Sun
 * at least `marginDeg` above the horizon. Valid for rectangles up to ~90°
 * across, where the darkest point lies on the boundary.
 */
export function rectangleFullyDaylit(rect: { west: number; south: number; east: number; north: number }, sun: { latitude: number; longitude: number }, marginDeg: number): boolean {
  const steps = 4;
  for (let i = 0; i <= steps; i++) {
    for (let j = 0; j <= steps; j++) {
      if (i !== 0 && i !== steps && j !== 0 && j !== steps) continue; // boundary only
      const longitude = rect.west + ((rect.east - rect.west) * i) / steps;
      const latitude = rect.south + ((rect.north - rect.south) * j) / steps;
      if (solarElevation(latitude, longitude, sun) < marginDeg) return false;
    }
  }
  return true;
}
