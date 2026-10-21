import { BillboardCollection, Cartesian3, Color, NearFarScalar, type Billboard, type Viewer } from "cesium";
import { altitudeBand, extrapolate, type AltitudeBand, type Flight } from "./flightData";

export const FLIGHT_ID_PREFIX = "flight:";

export const BAND_COLORS: Record<AltitudeBand, string> = {
  ground: "#8d99a8",
  low: "#ffb454",
  mid: "#6fd3ff",
  high: "#f2f7ff",
};
const COLORS = Object.fromEntries(Object.entries(BAND_COLORS).map(([band, css]) => [band, Color.fromCssColorString(css)])) as Record<AltitudeBand, Color>;

/** A white aircraft silhouette pointing up (north), tinted per altitude band. */
function planeIcon(): HTMLCanvasElement {
  const size = 32;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.translate(size / 2, size / 2);
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "rgba(0, 0, 0, 0.55)";
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  // Nose, wings, tailplane, back to the nose (symmetrical about x = 0).
  const half: [number, number][] = [[0, -14], [2, -10], [2, -3], [13, 3], [13, 6], [2, 3], [1.6, 9], [6, 12], [6, 14], [0, 12.5]];
  const outline = [...half, ...half.slice(1, -1).reverse().map(([x, y]) => [-x, y] as [number, number])];
  outline.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.stroke();
  ctx.fill();
  return canvas;
}

/**
 * One billboard per aircraft at its reported altitude, rotated to its track.
 * Between feed updates, airborne aircraft move along their track at their
 * ground speed (dead reckoning, at most two minutes).
 */
export class FlightOverlay {
  private readonly viewer: Viewer;
  private readonly collection = new BillboardCollection();
  private readonly billboards: Billboard[] = [];
  private flights: Flight[] = [];
  private readonly icon = planeIcon();

  constructor(viewer: Viewer) {
    this.viewer = viewer;
    viewer.scene.primitives.add(this.collection);
  }

  setFlights(flights: Flight[], now: number): void {
    this.flights = flights;
    while (this.billboards.length < flights.length) {
      this.billboards.push(this.collection.add({
        position: Cartesian3.ZERO,
        image: this.icon,
        width: 18,
        height: 18,
        // Up is the Earth's axis projected on screen, so rotation is the track.
        alignedAxis: Cartesian3.UNIT_Z,
        scaleByDistance: new NearFarScalar(300_000, 1.2, 25_000_000, 0.32),
      }));
    }
    for (let i = 0; i < this.billboards.length; i++) {
      const billboard = this.billboards[i];
      const flight = flights[i];
      billboard.show = Boolean(flight);
      if (!flight) continue;
      billboard.id = FLIGHT_ID_PREFIX + i;
      billboard.color = COLORS[altitudeBand(flight.altitude)];
      billboard.rotation = -((flight.track ?? 0) * Math.PI) / 180;
    }
    this.advance(now);
  }

  /** Move every aircraft to its estimated position at `now`. */
  advance(now: number): void {
    for (let i = 0; i < this.flights.length; i++) {
      const flight = this.flights[i];
      const { latitude, longitude } = extrapolate(flight, (now - flight.reportedAt) / 1000);
      // Aircraft on the ground sit just above the ellipsoid so they are not clipped.
      this.billboards[i].position = Cartesian3.fromDegrees(longitude, latitude, flight.altitude ?? 30);
    }
    if (!this.viewer.isDestroyed()) this.viewer.scene.requestRender();
  }

  flight(index: number): Flight | null {
    return this.flights[index] ?? null;
  }

  setVisible(visible: boolean): void {
    this.collection.show = visible;
    if (!this.viewer.isDestroyed()) this.viewer.scene.requestRender();
  }

  dispose(): void {
    if (this.viewer.isDestroyed()) return;
    this.viewer.scene.primitives.remove(this.collection);
    this.viewer.scene.requestRender();
  }
}
