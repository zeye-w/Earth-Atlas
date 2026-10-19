import {
  BillboardCollection,
  Cartesian3,
  DistanceDisplayCondition,
  NearFarScalar,
  VerticalOrigin,
  type Viewer,
} from "cesium";
import { VOLCANO_ID_PREFIX, isRecentlyActive, type Volcano } from "./volcanoData.ts";

const icon = (fill: string, stroke: string) => "data:image/svg+xml;charset=utf-8," + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><path d="M16 5 L28 27 H4 Z" fill="${fill}" stroke="${stroke}" stroke-width="3" stroke-linejoin="round"/></svg>`,
);
// Recently erupted: warm red; others: small muted triangles.
const RECENT_ICON = icon("#ff5a3c", "#2a0a04");
const DORMANT_ICON = icon("#d9c7b8", "#1b1410");

export class VolcanoOverlay {
  private readonly viewer: Viewer;
  private readonly billboards = new BillboardCollection();

  constructor(viewer: Viewer, volcanoes: readonly Volcano[], now = new Date()) {
    this.viewer = viewer;
    // Dormant first so recently active volcanoes draw on top.
    const sorted = [...volcanoes].sort((a, b) => Number(isRecentlyActive(a, now)) - Number(isRecentlyActive(b, now)));
    for (const volcano of sorted) {
      const recent = isRecentlyActive(volcano, now);
      this.billboards.add({
        id: VOLCANO_ID_PREFIX + (volcano.id ?? volcano.name),
        position: Cartesian3.fromDegrees(volcano.lon, volcano.lat, Math.max(volcano.elevation ?? 0, 0) + 3_000),
        image: recent ? RECENT_ICON : DORMANT_ICON,
        width: recent ? 13 : 8,
        height: recent ? 13 : 8,
        verticalOrigin: VerticalOrigin.CENTER,
        scaleByDistance: new NearFarScalar(500_000, 1.5, 25_000_000, 0.9),
        // Dormant volcanoes only appear once zoomed in a little.
        distanceDisplayCondition: new DistanceDisplayCondition(0, recent ? 65_000_000 : 20_000_000),
      });
    }
    viewer.scene.primitives.add(this.billboards);
    viewer.scene.requestRender();
  }

  setVisible(visible: boolean): void {
    this.billboards.show = visible;
    if (!this.viewer.isDestroyed()) this.viewer.scene.requestRender();
  }

  dispose(): void {
    if (this.viewer.isDestroyed()) return;
    this.viewer.scene.primitives.remove(this.billboards);
    this.viewer.scene.requestRender();
  }
}
