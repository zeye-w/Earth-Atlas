import {
  Cartesian2,
  Matrix4,
  SceneTransforms,
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
import { layoutLabels, type LabelBox } from "./labelLayout.ts";
import { LABEL_FONT } from "./labelFont";
import { getLocale, subscribeLocale } from "./i18n.ts";
const labelText = (label: GeoLabel) => getLocale() === "en" ? label.english : spacedName(label);

export const GEO_LABEL_ID_PREFIX = "geolabel:";

// Water names in cool blues, mountains in a warm sand tone, all quieter than
// the city labels so they read as part of the map.
const STYLE: Record<GeoLabelKind, { font: [string, string]; color: string; alpha: number }> = {
  ocean: { font: ["300 22px", "300 22px"], color: "#b4d6ec", alpha: 0.82 },
  sea: { font: ["400 15px", "400 13px"], color: "#a8cfe6", alpha: 0.9 },
  strait: { font: ["400 13px", "400 12px"], color: "#c4e3f3", alpha: 0.92 },
  desert: { font: ["400 14px", "400 12px"], color: "#e7c68c", alpha: 0.9 },
  plain: { font: ["400 14px", "400 12px"], color: "#c9dfb5", alpha: 0.9 },
  basin: { font: ["400 14px", "400 12px"], color: "#cbd5ac", alpha: 0.9 },
  river: { font: ["400 13px", "400 12px"], color: "#a9dafa", alpha: 0.92 },
  range: { font: ["500 14px", "500 12px"], color: "#ecd5ae", alpha: 0.92 },
};

export class GeoLabelOverlay {
  private readonly viewer: Viewer;
  private readonly labels = new LabelCollection();
  private readonly items: { label: Label; position: Cartesian3; data: GeoLabel; boxWidth: number; boxHeight: number }[] = [];
  private readonly lastView = new Matrix4();
  private lastWidth = 0;
  private lastHeight = 0;
  private lastLayoutMs = -Infinity;
  private dirty = true;
  private readonly scratch = new Cartesian2();
  private readonly occluder = new EllipsoidalOccluder(Ellipsoid.WGS84, Cartesian3.ZERO);
  private readonly removePreRender: () => void;
  private readonly removeLocale: () => void;

  constructor(viewer: Viewer, labels: readonly GeoLabel[]) {
    this.viewer = viewer;
    const outline = Color.fromCssColorString("#06111c").withAlpha(0.85);
    const measure = document.createElement("canvas").getContext("2d")!;
    for (const label of labels) {
      const style = STYLE[label.kind];
      const position = Cartesian3.fromDegrees(label.longitude, label.latitude, label.kind === "range" ? 6_000 : 2_000);
      measure.font = style.font[label.tier - 1] + " " + LABEL_FONT;
      this.items.push({ position, data: label, boxWidth: measure.measureText(labelText(label)).width + 20, boxHeight: parseInt(style.font[label.tier - 1].split(" ")[1]) + 14, label: this.labels.add({
        id: GEO_LABEL_ID_PREFIX + label.kind + ":" + label.english,
        position,
        text: labelText(label),
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
    this.removeLocale = subscribeLocale(() => {
      if (viewer.isDestroyed()) return;
      for (const item of this.items) {
        item.label.text = labelText(item.data);
        measure.font = STYLE[item.data.kind].font[item.data.tier - 1] + " " + LABEL_FONT;
        item.boxWidth = measure.measureText(item.label.text).width + 20;
      }
      this.dirty = true; viewer.scene.requestRender();
    });
    viewer.scene.requestRender();
  }

  private cullBehindHorizon(): void {
    if (!this.labels.show) return;
    const { camera, scene, canvas } = this.viewer;
    const width = canvas.clientWidth, height = canvas.clientHeight;
    const now = performance.now();
    const changed = !Matrix4.equalsEpsilon(this.lastView, camera.viewMatrix, 1e-8) || width !== this.lastWidth || height !== this.lastHeight;
    // Satellite animation can render repeatedly with a stationary camera.
    // Reuse label placement, but refresh reservations at most once a second.
    if (!this.dirty && !changed && now - this.lastLayoutMs < 1000) return;
    this.dirty = false;
    this.lastLayoutMs = now;
    Matrix4.clone(camera.viewMatrix, this.lastView);
    this.lastWidth = width; this.lastHeight = height;
    this.occluder.cameraPosition = camera.positionWC;
    const candidates: LabelBox[] = [];
    const reserved: LabelBox[] = [
      {id:"header",x:width/2,y:40,width,height:80,priority:100},
      {id:"footer",x:width/2,y:height-30,width,height:60,priority:100},
      {id:"hud",x:width/2,y:110,width:300,height:60,priority:100},
      {id:"guide",x:width/2,y:height-110,width:320,height:90,priority:100},
    ];
    // Reserve visible city and satellite text before geographic area names.
    for (const entity of this.viewer.entities.values) {
      if (!entity.show || !entity.label || !entity.position || !(String(entity.id).startsWith("city:") || String(entity.id).startsWith("satellite:"))) continue;
      const time = this.viewer.clock.currentTime;
      if (entity.label.show?.getValue(time) === false) continue;
      const position = entity.position.getValue(time);
      if (!position || !this.occluder.isPointVisible(position)) continue;
      const distance = Cartesian3.distance(camera.positionWC,position);
      const d = entity.label.distanceDisplayCondition?.getValue(time);
      if (d && (distance < d.near || distance > d.far)) continue;
      const screen = SceneTransforms.worldToWindowCoordinates(scene,position,this.scratch);
      if (!screen) continue;
      const text = String(entity.label.text?.getValue(time) ?? "");
      reserved.push({id:String(entity.id),x:screen.x+12+text.length*6,y:screen.y-11,width:text.length*12+20,height:28,priority:100});
    }
    this.items.forEach((item,index) => {
      const distance = Cartesian3.distance(camera.positionWC,item.position);
      if (distance < minLabelDistance(item.data) || distance > maxLabelDistance(item.data) || !this.occluder.isPointVisible(item.position)) return;
      const point = SceneTransforms.worldToWindowCoordinates(scene,item.position,this.scratch);
      if (!point) return;
      candidates.push({id:String(index),x:point.x,y:point.y,width:item.boxWidth,height:item.boxHeight,priority:(item.data.kind === "ocean" ? 30 : 20) - item.data.tier,group:item.data.kind+":"+item.data.english});
    });
    const visible = layoutLabels(candidates,reserved,width,height);
    this.items.forEach((item,index) => { item.label.show = visible.has(String(index)); });
  }

  setVisible(visible: boolean): void {
    this.labels.show = visible;
    this.dirty = true;
    if (!this.viewer.isDestroyed()) this.viewer.scene.requestRender();
  }

  dispose(): void {
    this.removeLocale();
    this.removePreRender();
    if (this.viewer.isDestroyed()) return;
    this.viewer.scene.primitives.remove(this.labels);
    this.viewer.scene.requestRender();
  }
}
