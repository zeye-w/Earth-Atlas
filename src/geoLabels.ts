import {
  Cartesian3,
  Color,
  DistanceDisplayCondition,
  Ellipsoid,
  EllipsoidalOccluder,
  HorizontalOrigin,
  type Label,
  LabelCollection,
  LabelStyle,
  NearFarScalar,
  VerticalOrigin,
  type Viewer,
} from "cesium";
import { maxLabelDistance, minLabelDistance, spacedName, type GeoLabel, type GeoLabelKind } from "./geoLabelData.ts";
import { LABEL_FONT } from "./labelFont";

export const GEO_LABEL_ID_PREFIX = "geolabel:";

// Water names in cool blues, mountains in a warm sand tone, all quieter than
// the city labels so they read as part of the map.
const STYLE: Record<GeoLabelKind, { font: [string, string]; color: string; alpha: number }> = {
  ocean: { font: ["300 22px", "300 22px"], color: "#b4d6ec", alpha: 0.82 },
  sea: { font: ["400 15px", "400 13px"], color: "#a8cfe6", alpha: 0.9 },
  strait: { font: ["400 13px", "400 12px"], color: "#c4e3f3", alpha: 0.92 },
  range: { font: ["500 14px", "500 12px"], color: "#ecd5ae", alpha: 0.92 },
};

export class GeoLabelOverlay {
  private readonly viewer: Viewer;
  private readonly labels = new LabelCollection();
  private readonly items: { label: Label; position: Cartesian3 }[] = [];
  private readonly occluder = new EllipsoidalOccluder(Ellipsoid.WGS84, Cartesian3.ZERO);
  private readonly removePreRender: () => void;

  constructor(viewer: Viewer, labels: readonly GeoLabel[]) {
    this.viewer = viewer;
    const outline = Color.fromCssColorString("#06111c").withAlpha(0.85);
    for (const label of labels) {
      const style = STYLE[label.kind];
      const position = Cartesian3.fromDegrees(label.longitude, label.latitude, label.kind === "range" ? 6_000 : 2_000);
      this.items.push({ position, label: this.labels.add({
        id: GEO_LABEL_ID_PREFIX + label.kind + ":" + label.english,
        position,
        text: spacedName(label),
        font: style.font[label.tier - 1] + " " + LABEL_FONT,
        style: LabelStyle.FILL_AND_OUTLINE,
        fillColor: Color.fromCssColorString(style.color).withAlpha(style.alpha),
        outlineColor: outline,
        outlineWidth: 3,
        horizontalOrigin: HorizontalOrigin.CENTER,
        verticalOrigin: VerticalOrigin.CENTER,
        scaleByDistance: new NearFarScalar(1_000_000, 1, 25_000_000, 0.85),
        distanceDisplayCondition: new DistanceDisplayCondition(minLabelDistance(label), maxLabelDistance(label)),
      }) });
    }
    viewer.scene.primitives.add(this.labels);
    // The depth test hides a label's anchor behind the globe but not the text
    // that sticks out past the limb into space, so hide labels beyond the
    // horizon before each frame.
    this.removePreRender = viewer.scene.preRender.addEventListener(() => this.cullBehindHorizon());
    viewer.scene.requestRender();
  }

  private cullBehindHorizon(): void {
    if (!this.labels.show) return;
    this.occluder.cameraPosition = this.viewer.camera.positionWC;
    for (const item of this.items) item.label.show = this.occluder.isPointVisible(item.position);
  }

  setVisible(visible: boolean): void {
    this.labels.show = visible;
    if (!this.viewer.isDestroyed()) this.viewer.scene.requestRender();
  }

  dispose(): void {
    this.removePreRender();
    if (this.viewer.isDestroyed()) return;
    this.viewer.scene.primitives.remove(this.labels);
    this.viewer.scene.requestRender();
  }
}
