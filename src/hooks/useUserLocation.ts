import { useCallback, useEffect, useState } from "react";
import { Cartesian2, Cartesian3, Color, HorizontalOrigin, LabelStyle, NearFarScalar, VerticalOrigin, type Entity, type Viewer } from "cesium";
import { LABEL_FONT } from "../labelFont";

export interface UserLocation {
  latitude: number;
  longitude: number;
  /** Metres (95 %-ish radius reported by the browser). */
  accuracy: number;
  heightKm: number;
}

export type LocationState =
  | { status: "idle" | "locating" }
  | { status: "ready"; location: UserLocation }
  | { status: "error"; message: string };

function requestPosition(): Promise<UserLocation> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) { reject(new Error("此浏览器不支持定位。")); return; }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({ latitude: coords.latitude, longitude: coords.longitude, accuracy: coords.accuracy, heightKm: Math.max(0, (coords.altitude ?? 0) / 1000) }),
      (error) => reject(new Error(error.code === error.PERMISSION_DENIED ? "未获得定位权限，可在浏览器地址栏的网站设置中允许。" : "暂时无法获取位置，请稍后重试。")),
      { enableHighAccuracy: false, timeout: 15_000, maximumAge: 10 * 60_000 },
    );
  });
}

/**
 * The user's position, only after they ask for it (or if the site already
 * has permission, so no prompt appears unasked). It never leaves the browser.
 */
export function useUserLocation() {
  const [state, setState] = useState<LocationState>({ status: "idle" });

  const locate = useCallback(async (): Promise<UserLocation | null> => {
    setState({ status: "locating" });
    try {
      const location = await requestPosition();
      setState({ status: "ready", location });
      return location;
    } catch (error) {
      setState({ status: "error", message: error instanceof Error ? error.message : "暂时无法获取位置。" });
      return null;
    }
  }, []);

  useEffect(() => {
    let active = true;
    void navigator.permissions?.query({ name: "geolocation" }).then((permission) => {
      if (active && permission.state === "granted") void locate();
    }).catch(() => undefined);
    return () => { active = false; };
  }, [locate]);

  return { state, locate, location: state.status === "ready" ? state.location : null };
}

const MARKER_COLOR = Color.fromCssColorString("#4da3ff");

/** A blue dot (with the accuracy circle when it is meaningful) at the user's position. */
export function useUserLocationMarker(viewer: Viewer | null, location: UserLocation | null) {
  useEffect(() => {
    if (!viewer || !location) return;
    const position = Cartesian3.fromDegrees(location.longitude, location.latitude, 0);
    const entities: Entity[] = [];
    if (location.accuracy > 200 && location.accuracy < 100_000) {
      entities.push(viewer.entities.add({
        id: "user-location-accuracy",
        position,
        ellipse: {
          semiMajorAxis: location.accuracy,
          semiMinorAxis: location.accuracy,
          material: MARKER_COLOR.withAlpha(0.16),
          outline: false,
        },
      }));
    }
    entities.push(viewer.entities.add({
      id: "user-location",
      name: "我的位置",
      position: Cartesian3.fromDegrees(location.longitude, location.latitude, 5_000),
      point: { pixelSize: 11, color: MARKER_COLOR, outlineColor: Color.WHITE, outlineWidth: 2.5, disableDepthTestDistance: 0 },
      label: {
        text: "我的位置",
        font: "500 12px " + LABEL_FONT,
        style: LabelStyle.FILL_AND_OUTLINE,
        fillColor: Color.fromCssColorString("#d6e9ff"),
        outlineColor: Color.fromCssColorString("#06111c"),
        outlineWidth: 3,
        horizontalOrigin: HorizontalOrigin.LEFT,
        verticalOrigin: VerticalOrigin.CENTER,
        pixelOffset: new Cartesian2(12, 0),
        scaleByDistance: new NearFarScalar(300_000, 1, 25_000_000, 0.8),
        disableDepthTestDistance: 0,
      },
    }));
    viewer.scene.requestRender();
    return () => {
      if (!viewer.isDestroyed()) {
        for (const entity of entities) viewer.entities.remove(entity);
        viewer.scene.requestRender();
      }
    };
  }, [viewer, location]);
}
