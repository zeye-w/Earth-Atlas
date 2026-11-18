import {
  ArcType, Cartesian2, Cartesian3, Color, ConstantPositionProperty, ConstantProperty, Entity, HorizontalOrigin, JulianDate, LabelStyle, Matrix3,
  NearFarScalar, PolylineDashMaterialProperty, Simon1994PlanetaryPositions, TimeInterval, Transforms, VerticalOrigin, type Viewer,
} from "cesium";
import { asteroidAt, distanceLabel, length, LUNAR_DISTANCE_KM, probeAt, probeInfo, type SpaceSnapshot, type Vec3 } from "./spaceData";
import { t } from "./i18n";

/**
 * Near-Earth space around the globe, seen from millions of kilometres: the
 * Moon's orbit, the Sun–Earth L1 and L2 points, the tracks of asteroids
 * passing close, and the deep space probes (in place when near, as a
 * direction line when far). Positions are inertial (ICRF) and turned into the
 * Earth-fixed frame of the scene's moment.
 */

const KM = 1000;
/** Sun–Earth L1/L2 lie about 1.5 million km from the Earth. */
const L_POINT_KM = 1_500_000;
/** Probes further than this get a direction line instead of a marker. */
const NEAR_PROBE_KM = 5_000_000;
/** How far the direction lines reach, km. */
const DIRECTION_KM = 1_700_000;

const ORANGE = Color.fromCssColorString("#ffa94d"), CYAN = Color.fromCssColorString("#8fe3ff"), GREY = Color.fromCssColorString("#c9c6bd");

let preloading: Promise<void> | null = null;
/** ICRF to Earth-fixed at `date` (precise once Cesium's EOP data has loaded, approximate before). */
function icrfToFixed(date: JulianDate): Matrix3 {
  preloading ??= Transforms.preloadIcrfFixed(new TimeInterval({ start: JulianDate.addDays(date, -40, new JulianDate()), stop: JulianDate.addDays(date, 40, new JulianDate()) })).catch(() => undefined);
  return Transforms.computeIcrfToFixedMatrix(date) ?? Transforms.computeTemeToPseudoFixedMatrix(date);
}

const toFixed = (m: Matrix3, v: Vec3 | Cartesian3, scale = KM) =>
  Matrix3.multiplyByVector(m, Array.isArray(v) ? new Cartesian3(v[0] * scale, v[1] * scale, v[2] * scale) : Cartesian3.multiplyByScalar(v, scale, new Cartesian3()), new Cartesian3());

const label = (text: string, color: Color) => ({
  text, font: "12px Inter, system-ui, sans-serif", fillColor: color, outlineColor: Color.BLACK, outlineWidth: 3, style: LabelStyle.FILL_AND_OUTLINE,
  pixelOffset: new Cartesian2(10, 0), verticalOrigin: VerticalOrigin.CENTER, horizontalOrigin: HorizontalOrigin.LEFT,
  // Readable from the cislunar view, out of the way near the Earth.
  translucencyByDistance: new NearFarScalar(2.0e7, 0, 1.2e8, 1),
});
const pointStyle = (color: Color, size = 7) => ({ pixelSize: size, color, outlineColor: Color.BLACK, outlineWidth: 1.5, translucencyByDistance: new NearFarScalar(2.0e7, 0, 1.2e8, 1) });

export class SpaceOverlay {
  private fixed: Entity[] = [];
  private moving: { entity: Entity; at: (time: number, m: Matrix3) => Cartesian3 | null }[] = [];
  private selected: string | null = null;

  constructor(private viewer: Viewer) {}

  /** Redraws everything for a snapshot (or none) at a moment. */
  set(data: SpaceSnapshot | null, layers: { asteroids: boolean; probes: boolean }, time: number, selected: string | null, lang: "zh" | "en" = "zh"): void {
    this.clear();
    this.selected = selected;
    if (!layers.asteroids && !layers.probes) return;
    const date = JulianDate.fromDate(new Date(time));
    const m = icrfToFixed(date);
    const add = (options: ConstructorParameters<typeof Entity>[0]) => { const e = this.viewer.entities.add(options!); this.fixed.push(e); return e; };

    // The Earth itself is a few pixels across from millions of kilometres.
    add({ position: Cartesian3.ZERO, label: { ...label(t("地球"), Color.WHITE), pixelOffset: new Cartesian2(12, -12) } });

    // The Moon's orbit over a month, and the Moon now.
    const orbit: Cartesian3[] = [];
    for (let h = 0; h <= 27.4 * 24; h += 6) {
      const d = JulianDate.addHours(date, h, new JulianDate());
      orbit.push(toFixed(m, Simon1994PlanetaryPositions.computeMoonPositionInEarthInertialFrame(d), 1));
    }
    add({ polyline: { positions: orbit, width: 1, arcType: ArcType.NONE, material: new PolylineDashMaterialProperty({ color: GREY.withAlpha(0.5), dashLength: 18 }) } });
    const moon = add({ position: toFixed(m, Simon1994PlanetaryPositions.computeMoonPositionInEarthInertialFrame(date), 1), point: pointStyle(GREY, 9), label: label(t("月球"), GREY) });
    this.moving.push({ entity: moon, at: (_, mm) => toFixed(mm, Simon1994PlanetaryPositions.computeMoonPositionInEarthInertialFrame(JulianDate.fromDate(new Date(_))), 1) });

    // Sun–Earth L1 (sunward) and L2 (anti-sunward).
    const sunDir = (d: JulianDate) => Cartesian3.normalize(Simon1994PlanetaryPositions.computeSunPositionInEarthInertialFrame(d), new Cartesian3());
    for (const [name, sign] of [["日地 L1", 1], ["日地 L2", -1]] as const) {
      const e = add({ position: toFixed(m, Cartesian3.multiplyByScalar(sunDir(date), sign * L_POINT_KM * KM, new Cartesian3()), 1), point: pointStyle(Color.WHITE.withAlpha(0.6), 5), label: label(t(name), Color.WHITE.withAlpha(0.75)) });
      this.moving.push({ entity: e, at: (tt, mm) => toFixed(mm, Cartesian3.multiplyByScalar(sunDir(JulianDate.fromDate(new Date(tt))), sign * L_POINT_KM * KM, new Cartesian3()), 1) });
    }

    if (layers.asteroids && data) {
      for (const a of data.asteroids) {
        if (a.track.length < 2) continue;
        const chosen = a.id === selected;
        const color = chosen ? Color.fromCssColorString("#ffd166") : ORANGE.withAlpha(0.85);
        add({ polyline: { positions: a.track.map(([, x, y, z]) => toFixed(m, [x, y, z])), width: chosen ? 2.5 : 1.5, arcType: ArcType.NONE, material: color } });
        // Closest approach.
        const closest = asteroidAt(a, a.approach);
        if (closest) add({ position: toFixed(m, closest), point: pointStyle(color, chosen ? 8 : 5),
          label: label(a.id + " · " + (a.distanceKm / LUNAR_DISTANCE_KM).toFixed(2) + " " + t("倍地月距离"), color) });
        const e = add({ position: undefined, point: pointStyle(Color.WHITE, chosen ? 7 : 5) });
        this.moving.push({ entity: e, at: (tt, mm) => { const p = asteroidAt(a, tt); return p ? toFixed(mm, p) : null; } });
      }
    }

    if (layers.probes && data) {
      for (const p of data.probes) {
        const info = probeInfo(p.key);
        if (!info) continue;
        const name = t(info.name.split("（")[0]);
        const here = probeAt(p, time), distance = length(here);
        if (distance < NEAR_PROBE_KM) {
          const e = add({ position: toFixed(m, here), point: pointStyle(CYAN, 7), label: label(name, CYAN) });
          this.moving.push({ entity: e, at: (tt, mm) => toFixed(mm, probeAt(p, tt)) });
        } else {
          // A line from the Earth towards the probe, with its distance at the end.
          const unit: Vec3 = [here[0] / distance, here[1] / distance, here[2] / distance];
          const end = toFixed(m, [unit[0] * DIRECTION_KM, unit[1] * DIRECTION_KM, unit[2] * DIRECTION_KM]);
          add({ polyline: { positions: [toFixed(m, [unit[0] * 30_000, unit[1] * 30_000, unit[2] * 30_000]), end], width: 1, arcType: ArcType.NONE,
            material: new PolylineDashMaterialProperty({ color: CYAN.withAlpha(0.45), dashLength: 10 }) } });
          add({ position: end, label: label(name + " · " + distanceLabel(distance, lang) + " →", CYAN.withAlpha(0.9)) });
        }
      }
    }
    this.setTime(time);
  }

  /** Moves the Moon, L points, asteroids and near probes to a moment. */
  setTime(time: number): void {
    if (this.viewer.isDestroyed()) return;
    const m = icrfToFixed(JulianDate.fromDate(new Date(time)));
    for (const { entity, at } of this.moving) {
      const p = at(time, m);
      entity.show = p !== null;
      if (p) entity.position = new ConstantPositionProperty(p);
    }
    this.viewer.scene.requestRender();
  }

  get selectedId(): string | null { return this.selected; }

  private clear(): void {
    if (!this.viewer.isDestroyed()) for (const e of this.fixed) this.viewer.entities.remove(e);
    this.fixed = [];
    this.moving = [];
  }

  dispose(): void {
    this.clear();
    if (!this.viewer.isDestroyed()) this.viewer.scene.requestRender();
  }
}

/**
 * A camera about `km` from the Earth, looking down from the celestial north
 * (slightly tilted) with the Sun–Earth line running across the screen, so the
 * L1 and L2 points sit either side of the Earth. `shift` (a fraction of the
 * distance) moves the Earth right, out from under the layer panel.
 */
export function cislunarCamera(km: number, time: number, shift = 0): { destination: Cartesian3; direction: Cartesian3; up: Cartesian3 } {
  const date = JulianDate.fromDate(new Date(time));
  const m = icrfToFixed(date);
  const sun = Cartesian3.normalize(toFixed(m, Simon1994PlanetaryPositions.computeSunPositionInEarthInertialFrame(date), 1), new Cartesian3());
  const north = Cartesian3.UNIT_Z;
  // Screen right = the Sun's direction (flattened onto the equator plane); up = right × down.
  const right = Cartesian3.normalize(new Cartesian3(sun.x, sun.y, 0), new Cartesian3());
  const down = Cartesian3.negate(north, new Cartesian3());
  const up0 = Cartesian3.normalize(Cartesian3.cross(right, down, new Cartesian3()), new Cartesian3());
  // From above and a little "south" of the plane on screen, for some depth.
  const destination = Cartesian3.add(Cartesian3.multiplyByScalar(north, km * KM * 0.94, new Cartesian3()), Cartesian3.multiplyByScalar(up0, -km * KM * 0.34, new Cartesian3()), new Cartesian3());
  const direction = Cartesian3.normalize(Cartesian3.negate(destination, new Cartesian3()), new Cartesian3());
  // Moving the camera sideways (same direction) puts the Earth off-centre: right of a side panel.
  Cartesian3.add(destination, Cartesian3.multiplyByScalar(right, -shift * km * KM, new Cartesian3()), destination);
  const up = Cartesian3.normalize(Cartesian3.cross(right, direction, new Cartesian3()), new Cartesian3());
  return { destination, direction, up };
}

export { ConstantProperty };
