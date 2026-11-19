import {
  ArcType, BoundingSphere, Cartesian2, Cartesian3, Color, ColorGeometryInstanceAttribute, ComponentDatatype, ConstantPositionProperty, Entity, Geometry,
  GeometryAttribute, GeometryAttributes, GeometryInstance, HorizontalOrigin, JulianDate, LabelStyle, Matrix3, NearFarScalar, PerInstanceColorAppearance,
  PolylineDashMaterialProperty, Primitive, PrimitiveType, Simon1994PlanetaryPositions, Transforms, VerticalOrigin, type Viewer,
} from "cesium";
import {
  BELTS, earthMoonLagrange, EARTH_RADIUS_KM, equatorialRing, fieldLine, fieldShell, GEO_ALTITUDE_KM, orbitPoints, REFERENCE_ORBITS, SAA, type Vec3,
} from "./nearEarth";
import { t } from "./i18n";

/**
 * The structure of near-Earth space on the globe: orbit bands with reference
 * orbits and the geostationary ring, the Van Allen belts as translucent
 * shells along the geomagnetic dipole's field lines with the South Atlantic
 * Anomaly marked below them, and the Earth–Moon Lagrange points moving with
 * the Moon. Orbits and belts are in the Earth-fixed frame (the belts turn
 * with the Earth; the reference orbits are drawn as examples); the Lagrange
 * points follow the Moon at the scene's moment.
 */

const KM = 1000;
const toCartesian = (p: Vec3) => new Cartesian3(p[0] * KM, p[1] * KM, p[2] * KM);

const label = (text: string, color: Color, far = 2.5e8) => ({
  text, font: "12px Inter, system-ui, sans-serif", fillColor: color, outlineColor: Color.BLACK, outlineWidth: 3, style: LabelStyle.FILL_AND_OUTLINE,
  pixelOffset: new Cartesian2(8, 0), verticalOrigin: VerticalOrigin.CENTER, horizontalOrigin: HorizontalOrigin.LEFT,
  // Hidden when the camera is close to the ground, where they would clutter the map.
  translucencyByDistance: new NearFarScalar(9.0e6, 0, 1.6e7, 1),
  scaleByDistance: new NearFarScalar(2.0e7, 1, far, 0.85),
});

/** A translucent surface from a grid of points (rows = meridians), drawn unlit. */
function gridSurface(rows: Vec3[][], color: Color): Primitive {
  const positions: number[] = [], indices: number[] = [];
  const cols = rows[0].length;
  for (const row of rows) for (const p of row) positions.push(p[0] * KM, p[1] * KM, p[2] * KM);
  for (let r = 0; r < rows.length - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const a = r * cols + c, b = a + 1, d = a + cols, e = d + 1;
      indices.push(a, d, b, b, d, e);
    }
  }
  const values = new Float64Array(positions);
  const geometry = new Geometry({
    attributes: { position: new GeometryAttribute({ componentDatatype: ComponentDatatype.DOUBLE, componentsPerAttribute: 3, values }) } as GeometryAttributes,
    indices: new Uint32Array(indices), primitiveType: PrimitiveType.TRIANGLES, boundingSphere: BoundingSphere.fromVertices(Array.from(values)),
  });
  return new Primitive({
    geometryInstances: new GeometryInstance({ geometry, attributes: { color: ColorGeometryInstanceAttribute.fromColor(color) } }),
    appearance: new PerInstanceColorAppearance({ flat: true, translucent: true, closed: false }),
    asynchronous: false,
  });
}

/** A sphere at a radius (km), as a grid surface. */
function sphere(radiusKm: number): Vec3[][] {
  const rows: Vec3[][] = [];
  for (let lon = 0; lon <= 360; lon += 10) {
    const row: Vec3[] = [];
    for (let lat = -90; lat <= 90; lat += 6) {
      const a = (lat * Math.PI) / 180, b = (lon * Math.PI) / 180;
      row.push([radiusKm * Math.cos(a) * Math.cos(b), radiusKm * Math.cos(a) * Math.sin(b), radiusKm * Math.sin(a)]);
    }
    rows.push(row);
  }
  return rows;
}

export interface NearEarthLayers { orbitBands: boolean; radiationBelts: boolean; lagrange: boolean }

export class NearEarthOverlay {
  private entities: Entity[] = [];
  private primitives: Primitive[] = [];
  private lagrange: Entity[] = [];
  private shown: NearEarthLayers = { orbitBands: false, radiationBelts: false, lagrange: false };

  constructor(private viewer: Viewer) {}

  set(layers: NearEarthLayers, time: number): void {
    this.clear();
    this.shown = { ...layers };
    const add = (options: ConstructorParameters<typeof Entity>[0]) => { const e = this.viewer.entities.add(options!); this.entities.push(e); return e; };
    const addPrimitive = (p: Primitive) => { this.primitives.push(this.viewer.scene.primitives.add(p)); };

    if (layers.orbitBands) {
      // The top of low Earth orbit (2,000 km), a faint shell.
      addPrimitive(gridSurface(sphere(EARTH_RADIUS_KM + 2000), Color.fromCssColorString("#8fe3ff").withAlpha(0.05)));
      add({ position: toCartesian([0, 0, EARTH_RADIUS_KM + 2000]), label: label(t("近地轨道上限 · 2000 km"), Color.fromCssColorString("#8fe3ff")) });
      REFERENCE_ORBITS.forEach((o, i) => {
        const color = Color.fromCssColorString(o.color);
        // Ascending nodes spread around so the rings do not overlap (orientation illustrative).
        const points = orbitPoints(o, 25 + i * 47);
        add({ polyline: { positions: points.map(toCartesian), width: 1.4, arcType: ArcType.NONE, material: color.withAlpha(0.8) } });
        const top = points.reduce((best, p) => (p[2] > best[2] ? p : best));
        add({ position: toCartesian(top), point: { pixelSize: 4, color }, label: label(t(o.name), color) });
      });
      const gold = Color.fromCssColorString("#ffcf5a");
      add({ polyline: { positions: equatorialRing(GEO_ALTITUDE_KM).map(toCartesian), width: 2, arcType: ArcType.NONE, material: gold } });
      add({ position: toCartesian([EARTH_RADIUS_KM + GEO_ALTITUDE_KM, 0, 0]), label: label(t("地球同步轨道 · 35,786 km"), gold) });
      add({ polyline: { positions: equatorialRing(GEO_ALTITUDE_KM + 300).map(toCartesian), width: 1, arcType: ArcType.NONE,
        material: new PolylineDashMaterialProperty({ color: Color.GRAY.withAlpha(0.7), dashLength: 12 }) } });
      add({ position: toCartesian([-(EARTH_RADIUS_KM + GEO_ALTITUDE_KM + 300), 0, 0]), label: label(t("卫星坟场轨道 · +300 km"), Color.GRAY) });
    }

    if (layers.radiationBelts) {
      for (const belt of BELTS) {
        const color = Color.fromCssColorString(belt.color);
        // A translucent shell at the belt's heart, and field lines at its edges.
        addPrimitive(gridSurface(fieldShell(belt.lPeak), color.withAlpha(belt.key === "inner" ? 0.12 : 0.05)));
        for (const L of belt.lRange) {
          for (let phi = 0; phi < 360; phi += 30) {
            add({ polyline: { positions: fieldLine(L, phi).map(toCartesian), width: 1, arcType: ArcType.NONE, material: color.withAlpha(0.35) } });
          }
        }
        const top = fieldLine(belt.lPeak, 90).reduce((best, p) => (Math.hypot(...p) > Math.hypot(...best) ? p : best));
        add({ position: toCartesian(top), label: label(t(belt.name), color) });
      }
      // Where the inner belt dips lowest, over the South Atlantic.
      const orange = Color.fromCssColorString("#ff8c5a");
      add({ position: Cartesian3.fromDegrees(SAA.longitude, SAA.latitude), ellipse: { semiMajorAxis: SAA.semiMajorKm * KM, semiMinorAxis: SAA.semiMinorKm * KM,
        rotation: (SAA.rotation * Math.PI) / 180, material: orange.withAlpha(0.22), outline: false } });
      add({ position: Cartesian3.fromDegrees(SAA.longitude, SAA.latitude, 50_000), label: { ...label(t("南大西洋异常区"), orange), translucencyByDistance: undefined } });
    }

    if (layers.lagrange) {
      const pink = Color.fromCssColorString("#ff9bd2");
      for (const name of ["L1", "L2", "L3", "L4", "L5"] as const) {
        const e = add({ position: Cartesian3.ZERO, point: { pixelSize: 6, color: pink, outlineColor: Color.BLACK, outlineWidth: 1 }, label: label(t("地月 {0}", name), pink, 2e9) });
        this.lagrange.push(e);
      }
      this.setTime(time);
    }
    this.viewer.scene.requestRender();
  }

  /** Moves the Earth–Moon Lagrange points with the Moon. */
  setTime(time: number): void {
    if (!this.shown.lagrange || !this.lagrange.length || this.viewer.isDestroyed()) return;
    const date = JulianDate.fromDate(new Date(time)), later = JulianDate.addSeconds(date, 3600, new JulianDate());
    const inertial = (d: JulianDate): Vec3 => { const p = Simon1994PlanetaryPositions.computeMoonPositionInEarthInertialFrame(d); return [p.x / KM, p.y / KM, p.z / KM]; };
    const a = inertial(date), b = inertial(later);
    const points = earthMoonLagrange(a, [(b[0] - a[0]) / 3600, (b[1] - a[1]) / 3600, (b[2] - a[2]) / 3600]);
    const m = Transforms.computeIcrfToFixedMatrix(date) ?? Transforms.computeTemeToPseudoFixedMatrix(date);
    (["L1", "L2", "L3", "L4", "L5"] as const).forEach((name, i) => {
      this.lagrange[i].position = new ConstantPositionProperty(Matrix3.multiplyByVector(m, toCartesian(points[name]), new Cartesian3()));
    });
    this.viewer.scene.requestRender();
  }

  private clear(): void {
    if (this.viewer.isDestroyed()) return;
    for (const e of this.entities) this.viewer.entities.remove(e);
    for (const p of this.primitives) this.viewer.scene.primitives.remove(p);
    this.entities = []; this.primitives = []; this.lagrange = [];
  }

  dispose(): void {
    this.clear();
    if (!this.viewer.isDestroyed()) this.viewer.scene.requestRender();
  }
}

/** A side view: the camera on the magnetic equator, `re` Earth radii out, north up — the belts' crescents in profile. */
export function sideViewCamera(re: number): { destination: Cartesian3; direction: Cartesian3; up: Cartesian3 } {
  const destination = new Cartesian3(0, -re * EARTH_RADIUS_KM * KM, re * EARTH_RADIUS_KM * KM * 0.08);
  const direction = Cartesian3.normalize(Cartesian3.negate(destination, new Cartesian3()), new Cartesian3());
  const right = Cartesian3.normalize(Cartesian3.cross(direction, Cartesian3.UNIT_Z, new Cartesian3()), new Cartesian3());
  const up = Cartesian3.normalize(Cartesian3.cross(right, direction, new Cartesian3()), new Cartesian3());
  return { destination, direction, up };
}

/** A view from `km` above the surface on the side facing 0° longitude, a little north, for the altitude ruler. */
export function altitudeCamera(km: number): { destination: Cartesian3; direction: Cartesian3; up: Cartesian3 } {
  // Far enough to see the object's altitude ring around the Earth.
  const distance = (EARTH_RADIUS_KM + km) * 2.6 * KM;
  return sideViewCamera(distance / (EARTH_RADIUS_KM * KM));
}
