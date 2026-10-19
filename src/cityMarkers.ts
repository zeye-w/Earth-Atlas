import {
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
