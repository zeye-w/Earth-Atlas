import { Cartesian3, Color, NearFarScalar, PointPrimitiveCollection, type PointPrimitive, type Viewer } from "cesium";

export const CONSTELLATION_ID_PREFIX = "constellation:";

// Sunlit satellites catch the light; those in Earth's shadow stay faint.
const SUNLIT = Color.fromCssColorString("#e4f4ff").withAlpha(0.9);
const SHADOW = Color.fromCssColorString("#6c89a8").withAlpha(0.4);

/**
 * One small point per satellite of a constellation. Positions come from the
 * propagation worker as Earth-fixed metres; points are depth-tested against
 * the globe so the far side stays hidden.
 */
export class ConstellationOverlay {
  private readonly viewer: Viewer;
  private readonly collection = new PointPrimitiveCollection();
  private readonly points: PointPrimitive[] = [];
  private readonly names: readonly string[];
  private positions: Float64Array | null = null;
  private flags: Uint8Array | null = null;
  private readonly scratch = new Cartesian3();
  private alpha = 1;
  private sunlit = SUNLIT;
  private shadow = SHADOW;

  constructor(viewer: Viewer, idPrefix: string, names: readonly string[]) {
    this.viewer = viewer;
    this.names = names;
    for (let i = 0; i < names.length; i++) {
      this.points.push(this.collection.add({
        id: idPrefix + i,
        show: false,
        pixelSize: 2.4,
        color: SUNLIT,
        scaleByDistance: new NearFarScalar(1_500_000, 2.2, 40_000_000, 0.8),
      }));
    }
    viewer.scene.primitives.add(this.collection);
  }

  setPositions(positions: Float64Array, flags: Uint8Array): void {
    this.positions = positions;
    this.flags = flags;
    for (let i = 0; i < this.points.length; i++) {
      const point = this.points[i];
      const flag = flags[i];
      point.show = flag !== 0;
      if (flag === 0) continue;
      point.position = Cartesian3.fromElements(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2], this.scratch);
      point.color = flag === 2 ? this.sunlit : this.shadow;
    }
    if (!this.viewer.isDestroyed()) this.viewer.scene.requestRender();
  }

  /** Name and altitude of a picked point. */
  describe(index: number): { name: string; altitudeKm: number; sunlit: boolean } | null {
    if (!this.positions || !this.flags || !this.flags[index]) return null;
    const position = Cartesian3.fromElements(this.positions[index * 3], this.positions[index * 3 + 1], this.positions[index * 3 + 2], this.scratch);
    const altitudeKm = (this.viewer.scene.globe.ellipsoid.cartesianToCartographic(position)?.height ?? Number.NaN) / 1000;
    return { name: this.names[index] ?? "", altitudeKm, sunlit: this.flags[index] === 2 };
  }

  get visibleCount(): number {
    return this.flags ? this.flags.reduce((n, flag) => n + (flag ? 1 : 0), 0) : 0;
  }

  /** Fade the whole constellation (recording mode). */
  setAlpha(alpha: number): void {
    this.alpha = Math.max(0, Math.min(1, alpha));
    this.sunlit = SUNLIT.withAlpha(SUNLIT.alpha * this.alpha);
    this.shadow = SHADOW.withAlpha(SHADOW.alpha * this.alpha);
    if (this.positions && this.flags) this.setPositions(this.positions, this.flags);
  }

  setVisible(visible: boolean): void {
    this.collection.show = visible;
    if (!this.viewer.isDestroyed()) this.viewer.scene.requestRender();
  }

  dispose(): void {
    if (this.viewer.isDestroyed()) return;
    this.viewer.scene.primitives.remove(this.collection);
    this.viewer.scene.requestRender();
  }
}
