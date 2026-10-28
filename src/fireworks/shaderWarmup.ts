import {
  BillboardCollection, Cartesian3, Color, LabelCollection, Matrix4, PointPrimitiveCollection, Transforms,
  type Billboard, type Primitive, type Viewer,
} from "cesium";
import { cylinderGeometry, exhaustPrimitive, solidPrimitive } from "./rocketParts.ts";
import { cometMaterial, exhaustMaterial, RibbonCollection, sparkRibbonMaterial } from "./visualMaterials.ts";
import { EFFECT_BLEND, effectTexture } from "./visualTextures.ts";

/**
 * WebGL compiles a shader program the first time something draws with it, and
 * the page stalls meanwhile (on Windows each program can take 50-200 ms). The
 * shows used to compile five to seven programs at their first burst or
 * ignition, and again on every replay once a show's materials were destroyed.
 *
 * When the user shows interest in the shows (requestShowWarmup), draw one frame
 * with a near-invisible copy of every kind of show primitive, then hide the
 * copies and keep them: while they live, Cesium's shader cache keeps their
 * programs, and the real shows (identical shader sources) reuse them.
 */
let requested = false;
const listeners = new Set<() => void>();
export function requestShowWarmup() {
  if (requested) return;
  requested = true;
  listeners.forEach(listener => listener());
}
export function onShowWarmup(listener: () => void): () => void {
  listeners.add(listener);
  if (requested) listener();
  return () => { listeners.delete(listener); };
}

type Holder = { show: boolean; isDestroyed(): boolean };

export class ShowShaderWarmup {
  private viewer: Viewer;
  private holders: Holder[] = [];
  private started = false;
  private removePostRender: (() => void) | null = null;

  constructor(viewer: Viewer) {
    this.viewer = viewer;
  }

  get warmed() { return this.started && !this.removePostRender; }

  run() {
    if (this.started || this.viewer.isDestroyed()) return;
    this.started = true;
    const { scene, camera } = this.viewer;
    // A spot just in front of the camera: inside the frustum and above the globe.
    const spot = Cartesian3.add(camera.positionWC, Cartesian3.multiplyByScalar(camera.directionWC, 500, new Cartesian3()), new Cartesian3());
    const near = (metres: number) => Cartesian3.add(spot, Cartesian3.multiplyByScalar(camera.rightWC, metres, new Cartesian3()), new Cartesian3());
    const faint = new Color(0, 0, 0, 0.004);
    const add = <T extends Holder>(holder: T): T => { this.holders.push(scene.primitives.add(holder)); return holder; };

    // Points: one opaque and one translucent, for both render passes.
    const points = add(new PointPrimitiveCollection());
    points.add({ position: spot, pixelSize: 1, color: new Color(0.01, 0.02, 0.04, 1) });
    points.add({ position: spot, pixelSize: 1, color: faint });

    // Billboards in the three feature sets the shows use: plain halos
    // (fireworks), rotated smoke (rocket), axis-aligned comets (space).
    const billboards = (extra: Pick<Billboard.ConstructorOptions, "rotation" | "alignedAxis">) => {
      const collection = add(new BillboardCollection({ blendOption: EFFECT_BLEND }));
      collection.add({ position: spot, width: 1, height: 1, color: faint, ...extra }).setImage("terrascope-firework-glow", effectTexture("halo"));
    };
    billboards({});
    billboards({ rotation: 0.1 });
    billboards({ alignedAxis: Cartesian3.UNIT_Z });

    // Site labels in the space show (glyph and background programs).
    add(new LabelCollection()).add({ position: spot, text: "·", font: "13px sans-serif", fillColor: faint, showBackground: true,
      backgroundColor: faint, disableDepthTestDistance: 0 });

    // Spark and comet ribbons, fully faded.
    const ribbons = add(new RibbonCollection());
    ribbons.add({ positions: [spot, near(1)], width: 1, material: sparkRibbonMaterial([1, 1, 1], 0) });
    const comet = cometMaterial();
    comet.uniforms.fade = 0;
    ribbons.add({ positions: [near(2), near(3)], width: 1, material: comet });

    // Rocket body and exhaust: a sub-pixel cylinder of each.
    const frame = Transforms.eastNorthUpToFixedFrame(spot);
    add(solidPrimitive([{ geometry: cylinderGeometry(0.2, 0.1, 0.1), offset: Cartesian3.ZERO, color: new Color(0.01, 0.02, 0.04, 1) }], frame) as Primitive);
    add(exhaustPrimitive(exhaustMaterial(), Matrix4.clone(frame), 0.2, 0.1) as Primitive);

    // Two rendered frames cover programs created on the first update and drawn
    // on the next; then hide the copies but keep them (and their programs).
    let frames = 0;
    this.removePostRender = scene.postRender.addEventListener(() => {
      if (++frames < 2) { scene.requestRender(); return; }
      this.removePostRender?.();
      this.removePostRender = null;
      for (const holder of this.holders) holder.show = false;
      scene.requestRender();
    });
    scene.requestRender();
  }

  dispose() {
    this.removePostRender?.();
    this.removePostRender = null;
    if (!this.viewer.isDestroyed()) for (const holder of this.holders) this.viewer.scene.primitives.remove(holder);
    this.holders = [];
  }
}
