import {
  Cartesian3, Color, NearFarScalar, PointPrimitiveCollection, PolylineCollection, Material, type Viewer,
} from "cesium";
import { INTERNET_ID_PREFIX, type DnsFlow, type LonLat } from "./types.ts";
import type { InternetDatasets } from "./data.ts";

/**
 * First cut of the internet layers: plain lines and points, one primitive
 * collection per layer so each toggles on its own. Track B of
 * docs/internet-layers.md replaces the look (glow, flow animation, clustering,
 * growth with the timeline) behind the same methods.
 */
export type InternetPrimitiveLayer = "cables" | "landings" | "ixps" | "facilities" | "rootServers" | "dnsFlows";

const COLORS: Record<InternetPrimitiveLayer, Color> = {
  cables: Color.fromCssColorString("#38d6ff").withAlpha(0.55),
  landings: Color.fromCssColorString("#9eeaff"),
  ixps: Color.fromCssColorString("#ffb84d"),
  facilities: Color.fromCssColorString("#c792ff"),
  rootServers: Color.fromCssColorString("#7fe0b0"),
  dnsFlows: Color.fromCssColorString("#7fe0b0").withAlpha(0.5),
};
// Long simplified segments are cut so the straight chords stay above the sea.
const MAX_STEP_DEG = 0.5;
const CABLE_HEIGHT_M = 2_000;

function densify(path: LonLat[]): Cartesian3[] {
  const out: number[] = [];
  for (let i = 0; i < path.length; i++) {
    const [lon, lat] = path[i];
    if (i > 0) {
      const [lon0, lat0] = path[i - 1];
      // Across the antimeridian, step the short way round.
      const dLon = ((lon - lon0 + 540) % 360) - 180;
      const steps = Math.ceil(Math.max(Math.abs(dLon), Math.abs(lat - lat0)) / MAX_STEP_DEG);
      for (let k = 1; k < steps; k++) out.push(lon0 + (dLon * k) / steps, lat0 + ((lat - lat0) * k) / steps, CABLE_HEIGHT_M);
    }
    out.push(lon, lat, CABLE_HEIGHT_M);
  }
  return Cartesian3.fromDegreesArrayHeights(out);
}

export class InternetOverlay {
  private readonly viewer: Viewer;
  private readonly lines: Partial<Record<InternetPrimitiveLayer, PolylineCollection>> = {};
  private readonly points: Partial<Record<InternetPrimitiveLayer, PointPrimitiveCollection>> = {};
  private readonly visible: Partial<Record<InternetPrimitiveLayer, boolean>> = {};

  constructor(viewer: Viewer) {
    this.viewer = viewer;
  }

  private lineLayer(layer: InternetPrimitiveLayer): PolylineCollection {
    this.lines[layer] ??= this.viewer.scene.primitives.add(new PolylineCollection({ show: this.visible[layer] ?? false }));
    return this.lines[layer]!;
  }

  private pointLayer(layer: InternetPrimitiveLayer): PointPrimitiveCollection {
    this.points[layer] ??= this.viewer.scene.primitives.add(new PointPrimitiveCollection({ show: this.visible[layer] ?? false }));
    return this.points[layer]!;
  }

  private addPoints(layer: InternetPrimitiveLayer, items: Array<{ id: string; position: LonLat }>, size: number): void {
    const collection = this.pointLayer(layer);
    collection.removeAll();
    for (const item of items) {
      collection.add({
        id: item.id, position: Cartesian3.fromDegrees(item.position[0], item.position[1], 3_000), pixelSize: size, color: COLORS[layer],
        outlineColor: Color.BLACK.withAlpha(0.6), outlineWidth: 1, scaleByDistance: new NearFarScalar(2e5, 1.6, 2e7, 0.8),
      });
    }
  }

  setCables(data: InternetDatasets["cables"]): void {
    const collection = this.lineLayer("cables");
    collection.removeAll();
    const material = Material.fromType("Color", { color: COLORS.cables });
    for (const cable of data.cables) {
      for (const path of cable.paths) collection.add({ id: INTERNET_ID_PREFIX.cable + cable.id, positions: densify(path), width: 1.5, material });
    }
    this.addPoints("landings", data.landings.map((l) => ({ id: INTERNET_ID_PREFIX.landing + l.id, position: l.position })), 4);
    this.viewer.scene.requestRender();
  }

  setIxps(data: InternetDatasets["ixps"]): void {
    this.addPoints("ixps", data.ixps.map((x) => ({ id: INTERNET_ID_PREFIX.ixp + x.id, position: x.position })), 6);
    this.viewer.scene.requestRender();
  }

  setFacilities(data: InternetDatasets["facilities"]): void {
    this.addPoints("facilities", data.facilities.map((f) => ({ id: INTERNET_ID_PREFIX.facility + f.id, position: f.position })), 3);
    this.viewer.scene.requestRender();
  }

  setRootServers(data: InternetDatasets["rootServers"]): void {
    this.addPoints("rootServers", data.instances.map((r) => ({ id: INTERNET_ID_PREFIX.rootInstance + r.id, position: r.position })), 5);
    this.viewer.scene.requestRender();
  }

  setDnsFlows(flows: readonly DnsFlow[]): void {
    const collection = this.lineLayer("dnsFlows");
    collection.removeAll();
    const material = Material.fromType("Color", { color: COLORS.dnsFlows });
    for (const flow of flows) collection.add({ positions: densify([flow.probe, flow.instance]), width: 1, material });
    this.viewer.scene.requestRender();
  }

  setVisible(layer: InternetPrimitiveLayer, visible: boolean): void {
    this.visible[layer] = visible;
    const lines = this.lines[layer], points = this.points[layer];
    if (lines) lines.show = visible;
    if (points) points.show = visible;
    this.viewer.scene.requestRender();
  }

  dispose(): void {
    if (this.viewer.isDestroyed()) return;
    for (const c of [...Object.values(this.lines), ...Object.values(this.points)]) if (c) this.viewer.scene.primitives.remove(c);
  }
}
