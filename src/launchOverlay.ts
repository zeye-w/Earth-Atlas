import {
  BillboardCollection,
  Cartesian2,
  Cartesian3,
  Color,
  LabelCollection,
  LabelStyle,
  NearFarScalar,
  VerticalOrigin,
  type Billboard,
  type Label,
  type Viewer,
} from "cesium";
import { headlineLaunch, LAUNCH_PAD_ID_PREFIX, launchPads, type Launch, type LaunchPad, type LaunchStatus } from "./launchData.ts";

export const STATUS_COLORS: Record<LaunchStatus, string> = {
  go: "#5ee08a", tbc: "#c6e46b", tbd: "#ffc56b", hold: "#ff9f43", flight: "#8fe3ff", success: "#aab4c3", failure: "#ff6b6b",
};

// A small rocket on a dark disc, tinted by the next launch's status.
const icon = (color: string) => "data:image/svg+xml;charset=utf-8," + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40"><circle cx="20" cy="20" r="17" fill="rgba(5,9,16,.82)" stroke="${color}" stroke-width="2.5"/>` +
  `<path d="M20 8c4 3 5.5 8 5 14l3 4h-4l-1 3h-6l-1-3h-4l3-4c-.5-6 1-11 5-14z" fill="${color}"/><circle cx="20" cy="17" r="2.2" fill="rgba(5,9,16,.9)"/></svg>`,
);
const ICONS = Object.fromEntries(Object.entries(STATUS_COLORS).map(([status, color]) => [status, icon(color)])) as Record<LaunchStatus, string>;

/** Launch pad markers for the launch calendar layer; ids are LAUNCH_PAD_ID_PREFIX + pad id. */
export class LaunchOverlay {
  private readonly viewer: Viewer;
  private readonly billboards = new BillboardCollection();
  private readonly labels = new LabelCollection();
  private readonly markers = new Map<string, { billboard: Billboard; label: Label; pad: LaunchPad }>();
  private selected: string | null = null;

  constructor(viewer: Viewer) {
    this.viewer = viewer;
    viewer.scene.primitives.add(this.billboards);
    viewer.scene.primitives.add(this.labels);
  }

  setLaunches(launches: readonly Launch[], at: number): void {
    this.billboards.removeAll();
    this.labels.removeAll();
    this.markers.clear();
    for (const pad of launchPads(launches)) {
      const position = Cartesian3.fromDegrees(pad.longitude, pad.latitude, 2_000);
      const billboard = this.billboards.add({
        id: LAUNCH_PAD_ID_PREFIX + pad.id,
        position,
        image: ICONS[headlineLaunch(pad, at).status],
        width: 22,
        height: 22,
        verticalOrigin: VerticalOrigin.CENTER,
        scaleByDistance: new NearFarScalar(500_000, 1.35, 25_000_000, 0.85),
      });
      const label = this.labels.add({
        id: LAUNCH_PAD_ID_PREFIX + pad.id,
        position,
        text: pad.location || pad.name,
        font: "500 12px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        fillColor: Color.WHITE,
        outlineColor: Color.fromCssColorString("#05070b"),
        outlineWidth: 3,
        style: LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: VerticalOrigin.BOTTOM,
        pixelOffset: new Cartesian2(0, -18),
        show: false,
      });
      this.markers.set(pad.id, { billboard, label, pad });
    }
    this.setSelected(this.selected);
  }

  /** Enlarge and label the selected pad. */
  setSelected(padId: string | null): void {
    this.selected = padId;
    for (const [id, { billboard, label }] of this.markers) {
      const on = id === padId;
      billboard.width = billboard.height = on ? 32 : 22;
      label.show = on;
    }
    this.requestRender();
  }

  pad(padId: string): LaunchPad | null {
    return this.markers.get(padId)?.pad ?? null;
  }

  private requestRender() {
    if (!this.viewer.isDestroyed()) this.viewer.scene.requestRender();
  }

  dispose(): void {
    if (this.viewer.isDestroyed()) return;
    this.viewer.scene.primitives.remove(this.billboards);
    this.viewer.scene.primitives.remove(this.labels);
    this.viewer.scene.requestRender();
  }
}
