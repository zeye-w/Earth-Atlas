import { Cartesian3, Color, Material, PolylineCollection, type Viewer } from "cesium";

/**
 * Tectonic plate boundaries from Bird (2003) PB2002, bundled as a static
 * lazily imported JSON chunk (GeoJSON conversion by Hugo Ahlenius /
 * Nordpil, ODC-BY 1.0).
 */
export interface PlateBoundary {
  name: string;
  subduction: boolean;
  coordinates: [number, number][];
}

// Straight polyline chords between vertices sag below the globe surface;
// keep segments short and lift the lines slightly.
export const MAX_SEGMENT_DEG = 0.5;
const LINE_HEIGHT_M = 3_000;
const SUBDUCTION_COLOR = Color.fromCssColorString("#ff8a5c").withAlpha(0.85);
const BOUNDARY_COLOR = Color.fromCssColorString("#ffd27a").withAlpha(0.55);

export async function loadPlateBoundaries(): Promise<PlateBoundary[]> {
  const module = await import("./data/plateBoundaries.json");
  return (module.default as unknown as { boundaries: PlateBoundary[] }).boundaries;
}

/** Insert intermediate points so no segment exceeds maxDeg. */
export function densify(coordinates: readonly [number, number][], maxDeg = MAX_SEGMENT_DEG): [number, number][] {
  const out: [number, number][] = [];
  coordinates.forEach((point, i) => {
    if (i > 0) {
      const [lon0, lat0] = coordinates[i - 1];
      const steps = Math.ceil(Math.hypot(point[0] - lon0, point[1] - lat0) / maxDeg);
      for (let k = 1; k < steps; k++) {
        out.push([lon0 + ((point[0] - lon0) * k) / steps, lat0 + ((point[1] - lat0) * k) / steps]);
      }
    }
    out.push([point[0], point[1]]);
  });
  return out;
}

export class PlateBoundaryOverlay {
  private readonly viewer: Viewer;
  private readonly lines = new PolylineCollection();

  constructor(viewer: Viewer, boundaries: readonly PlateBoundary[]) {
    this.viewer = viewer;
    const subduction = Material.fromType("Color", { color: SUBDUCTION_COLOR });
    const boundary = Material.fromType("Color", { color: BOUNDARY_COLOR });
    for (const item of boundaries) {
      const points = densify(item.coordinates);
      if (points.length < 2) continue;
      this.lines.add({
        positions: points.map(([lon, lat]) => Cartesian3.fromDegrees(lon, lat, LINE_HEIGHT_M)),
        width: item.subduction ? 1.6 : 1.1,
        material: item.subduction ? subduction : boundary,
      });
    }
    viewer.scene.primitives.add(this.lines);
    viewer.scene.requestRender();
  }

  setVisible(visible: boolean): void {
    this.lines.show = visible;
    if (!this.viewer.isDestroyed()) this.viewer.scene.requestRender();
  }

  dispose(): void {
    if (this.viewer.isDestroyed()) return;
    this.viewer.scene.primitives.remove(this.lines);
    this.viewer.scene.requestRender();
  }
}
