import {
  ConstantProperty,
  Ellipsoid,
  EllipsoidalOccluder,
  Matrix4,
  SceneTransforms,
  Cartesian2,
  Cartesian3,
  Color,
  DistanceDisplayCondition,
  HorizontalOrigin,
  LabelStyle,
  NearFarScalar,
  VerticalOrigin,
  type Entity,
  type Viewer,
} from "cesium";
import { WORLD_CITIES } from "./worldCities";
import { layoutLabels, type LabelBox } from "./labelLayout.ts";
import { LABEL_FONT } from "./labelFont";

/**
 * A single static, bounded Cesium entity set. City labels follow the globe
 * with correct far-side occlusion (never disable the depth test globally).
 * Tier 2 labels appear only as the user approaches their region.
 */
export function addWorldCityMarkers(viewer: Viewer): Entity[] {
  const collection: Entity[] = [];
  const major = Color.fromCssColorString("#e9f7ff");
  const minor = Color.fromCssColorString("#c5deea");
  const outline = Color.fromCssColorString("#09182b");
  for (const city of WORLD_CITIES) {
    const isMajor = city.tier === 1;
    collection.push(viewer.entities.add({
      id: "city:" + city.id,
      name: city.english + " · " + city.chinese,
      position: Cartesian3.fromDegrees(city.longitude, city.latitude, 8000),
      point: {
        pixelSize: isMajor ? 5 : 4,
        color: isMajor ? major : minor,
        outlineColor: Color.fromCssColorString("#18364b"),
        outlineWidth: 1.5,
        distanceDisplayCondition: new DistanceDisplayCondition(0, isMajor ? 45_000_000 : 9_000_000),
        disableDepthTestDistance: 0,
      },
      label: {
        text: city.chinese,
        font: isMajor ? "500 12px " + LABEL_FONT : "11px " + LABEL_FONT,
        style: LabelStyle.FILL_AND_OUTLINE,
        fillColor: isMajor ? major : minor,
        outlineColor: outline,
        outlineWidth: 3,
        showBackground: false,
        pixelOffset: new Cartesian2(9, -11),
        horizontalOrigin: HorizontalOrigin.LEFT,
        verticalOrigin: VerticalOrigin.CENTER,
        scaleByDistance: new NearFarScalar(250_000, 1, 25_000_000, 0.75),
        distanceDisplayCondition: new DistanceDisplayCondition(0, isMajor ? 45_000_000 : 9_000_000),
        disableDepthTestDistance: 0,
      },
    }));
  }
  return collection;
}

/** City names share the same padded screen-space collision policy as areas. */
export function declutterCityLabels(viewer: Viewer, markers: readonly Entity[]): () => void {
  const matrix = new Matrix4();
  const occluder = new EllipsoidalOccluder(Ellipsoid.WGS84,Cartesian3.ZERO);
  let previous = "";
  return viewer.scene.preRender.addEventListener(() => {
    const {camera,canvas,clock,scene} = viewer;
    const signature = `${canvas.clientWidth}:${canvas.clientHeight}:${markers.map(m=>Number(m.show)).join("")}`;
    if (previous === signature && Matrix4.equalsEpsilon(matrix,camera.viewMatrix,1e-8)) return;
    previous=signature; Matrix4.clone(camera.viewMatrix,matrix);
    occluder.cameraPosition=camera.positionWC;
    const boxes: LabelBox[]=[];
    for (const marker of markers) {
      if (!marker.show || !marker.label) continue;
      const p=marker.position?.getValue(clock.currentTime);
      if (!p || !occluder.isPointVisible(p)) continue;
      const d=marker.label.distanceDisplayCondition?.getValue(clock.currentTime);
      const distance=Cartesian3.distance(camera.positionWC,p);
      if (d && distance > d.far) continue;
      const screen=SceneTransforms.worldToWindowCoordinates(scene,p);
      if (!screen) continue;
      const name=String(marker.label.text?.getValue(clock.currentTime) ?? "");
      const width=name.length*12+18;
      boxes.push({id:String(marker.id),x:screen.x+9+(width-18)/2,y:screen.y-11,width,height:28,priority:String(marker.label.font?.getValue(clock.currentTime)).includes("500") ? 2 : 1});
    }
    const visible=layoutLabels(boxes,[],canvas.clientWidth,canvas.clientHeight);
    for (const marker of markers) {
      if (!marker.label) continue;
      const show=visible.has(String(marker.id));
      if (marker.label.show?.getValue(clock.currentTime) !== show) marker.label.show=new ConstantProperty(show);
    }
  });
}
