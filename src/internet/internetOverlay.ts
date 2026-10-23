import {
  Cartesian3, Color, Material, NearFarScalar, PointPrimitiveCollection, PolylineCollection,
  type PointPrimitive, type Polyline, type Viewer,
} from "cesium";
import { now } from "../clock.ts";
import { flowMaterial, setFlowTime } from "./flowMaterial.ts";
import { INTERNET_ID_PREFIX, ROOT_LETTERS, type DnsFlow, type LonLat, type RootInstance, type RootLetter } from "./types.ts";
import type { InternetDatasets } from "./data.ts";

/**
 * The internet layers on the globe, one primitive collection per layer so
 * each toggles on its own:
 * - cables: glowing lines with pulses running along them (planned cables
 *   steady and dim), filtered by ready-for-service year;
 * - landing stations, exchanges (sized by connected networks), data centres
 *   and root-server instances (coloured by letter) as points;
 * - measured DNS queries as faint arcs with a packet flying probe -> instance
 *   -> probe, slower for a longer round trip.
 * Pulses and packets follow the scene clock (src/clock.ts), so recordings
 * are deterministic; with reduced motion they stand still.
 */
export type InternetPrimitiveLayer = "cables" | "landings" | "ixps" | "facilities" | "rootServers" | "dnsFlows";

const CABLE_COLOR = Color.fromCssColorString("#38d6ff");
const PLANNED_COLOR = Color.fromCssColorString("#8fb3c9");
const COLORS = {
  landings: Color.fromCssColorString("#9eeaff"),
  ixps: Color.fromCssColorString("#ffb84d"),
  facilities: Color.fromCssColorString("#c792ff"),
};
/** One hue per root letter, round the colour wheel. */
export const ROOT_COLORS: Record<RootLetter, Color> = Object.fromEntries(
  ROOT_LETTERS.map((letter, i) => [letter, Color.fromHsl(((i * 5) % 13) / 13, 0.75, 0.66)]),
) as Record<RootLetter, Color>;

// Long simplified segments are cut so the straight chords stay above the sea.
const MAX_STEP_DEG = 0.5;
const CABLE_HEIGHT_M = 2_000;
const POINT_HEIGHT_M = 3_000;
// Cables are grouped by length so the pulses keep a similar spacing on all of them.
const PULSE_SPACING_KM = 900;
const LENGTH_BUCKETS_KM = [1_500, 4_000, 9_000, 16_000, Infinity];
// Arc vertices: one per ~2° of arc, 6 to 32, so thousands of short hops stay cheap.
const ARC_MIN_SAMPLES = 6;
const ARC_MAX_SAMPLES = 32;
// Pulses and packets advance at most this often. Moving layers keep the scene
// rendering continuously; half of 60 fps halves that cost and still reads smooth.
const ANIMATION_FPS = 30;

function densify(path: LonLat[], height = CABLE_HEIGHT_M): Cartesian3[] {
  const out: number[] = [];
  for (let i = 0; i < path.length; i++) {
    const [lon, lat] = path[i];
    if (i > 0) {
      const [lon0, lat0] = path[i - 1];
      // Across the antimeridian, step the short way round.
      const dLon = ((lon - lon0 + 540) % 360) - 180;
      const steps = Math.ceil(Math.max(Math.abs(dLon), Math.abs(lat - lat0)) / MAX_STEP_DEG);
      for (let k = 1; k < steps; k++) out.push(lon0 + (dLon * k) / steps, lat0 + ((lat - lat0) * k) / steps, height);
    }
    out.push(lon, lat, height);
  }
  return Cartesian3.fromDegreesArrayHeights(out);
}

/** Great-circle arc between two points, lifted in the middle (higher for longer hops). */
export function arc(from: LonLat, to: LonLat, samples?: number): Cartesian3[] {
  const pa = Cartesian3.fromDegrees(from[0], from[1], 0), pb = Cartesian3.fromDegrees(to[0], to[1], 0);
  // Ellipsoid radius at each end, so the arc starts and ends on the surface.
  const ra = Cartesian3.magnitude(pa), rb = Cartesian3.magnitude(pb);
  const a = Cartesian3.normalize(pa, new Cartesian3()), b = Cartesian3.normalize(pb, new Cartesian3());
  const angle = Math.acos(Math.min(1, Math.max(-1, Cartesian3.dot(a, b))));
  const lift = Math.min(1_200_000, 40_000 + angle * 6_371_000 * 0.18);
  const n = samples ?? Math.min(ARC_MAX_SAMPLES, Math.max(ARC_MIN_SAMPLES, Math.ceil((angle * 180) / Math.PI / 2)));
  const out: Cartesian3[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    // Spherical interpolation of the direction, then a sine-shaped height.
    const s = angle < 1e-6 ? a : Cartesian3.add(
      Cartesian3.multiplyByScalar(a, Math.sin((1 - t) * angle) / Math.sin(angle), new Cartesian3()),
      Cartesian3.multiplyByScalar(b, Math.sin(t * angle) / Math.sin(angle), new Cartesian3()), new Cartesian3());
    const ll = Cartesian3.normalize(s, new Cartesian3());
    out.push(Cartesian3.multiplyByScalar(ll, ra + (rb - ra) * t + 5_000 + lift * Math.sin(Math.PI * t), new Cartesian3()));
  }
  return out;
}

/** Seconds for a packet to fly one way: longer round trips fly visibly slower. */
export function packetSeconds(rttMs: number): number {
  return 0.6 + Math.min(rttMs, 600) / 40;
}

/** Where a flow's packet is at `seconds`: 0..1 along the arc, or null while it rests. */
export function packetProgress(flow: Pick<DnsFlow, "rttMs" | "probeId">, seconds: number): number | null {
  const leg = packetSeconds(flow.rttMs);
  const rest = 1.5 + (flow.probeId % 7) * 0.4;
  const period = 2 * leg + rest;
  const t = (((seconds + (flow.probeId % 97) * 0.37) % period) + period) % period;
  if (t < leg) return t / leg;
  if (t < 2 * leg) return 2 - t / leg;
  return null;
}

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

interface CableLine { line: Polyline; rfsYear: number | null }
interface Packet { point: PointPrimitive; path: Cartesian3[]; flow: DnsFlow }

export class InternetOverlay {
  private readonly viewer: Viewer;
  private readonly lines: Partial<Record<InternetPrimitiveLayer, PolylineCollection>> = {};
  private readonly points: Partial<Record<InternetPrimitiveLayer, PointPrimitiveCollection>> = {};
  private readonly visible: Partial<Record<InternetPrimitiveLayer, boolean>> = {};
  private cableLines: CableLine[] = [];
  private cableMaterials: Material[] = [];
  private plannedMaterial: Material | null = null;
  private arcMaterial: Material | null = null;
  private packets: Packet[] = [];
  private cableYear: number | null = null;
  private frame: number | null = null;
  private readonly still = reducedMotion();

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

  private addPoints(layer: InternetPrimitiveLayer, items: Array<{ id: string; position: LonLat; color: Color; size: number }>, fade?: NearFarScalar): void {
    const collection = this.pointLayer(layer);
    collection.removeAll();
    for (const item of items) {
      collection.add({
        id: item.id, position: Cartesian3.fromDegrees(item.position[0], item.position[1], POINT_HEIGHT_M), pixelSize: item.size, color: item.color,
        outlineColor: Color.BLACK.withAlpha(0.55), outlineWidth: 1, scaleByDistance: new NearFarScalar(2e5, 1.6, 2e7, 0.75),
        ...(fade ? { translucencyByDistance: fade } : {}),
      });
    }
  }

  setCables(data: InternetDatasets["cables"]): void {
    const collection = this.lineLayer("cables");
    collection.removeAll();
    this.cableMaterials = LENGTH_BUCKETS_KM.map((limit, i) => {
      const typical = i === 0 ? 800 : Math.min(limit, LENGTH_BUCKETS_KM[i - 1] * 2);
      return flowMaterial({ color: CABLE_COLOR.withAlpha(0.9), repeat: Math.max(1, typical / PULSE_SPACING_KM), speed: 0.45, pulse: this.still ? 0 : 1 });
    });
    this.plannedMaterial = flowMaterial({ color: PLANNED_COLOR.withAlpha(0.45), pulse: 0 });
    const thisYear = new Date(now()).getUTCFullYear();
    this.cableLines = [];
    for (const cable of data.cables) {
      const planned = cable.rfsYear !== null && cable.rfsYear > thisYear;
      for (const path of cable.paths) {
        const positions = densify(path);
        const lengthKm = pathLengthKm(positions);
        const material = planned ? this.plannedMaterial : this.cableMaterials[LENGTH_BUCKETS_KM.findIndex((limit) => lengthKm <= limit)];
        const line = collection.add({ id: INTERNET_ID_PREFIX.cable + cable.id, positions, width: planned ? 3 : 6, material });
        this.cableLines.push({ line, rfsYear: cable.rfsYear });
      }
    }
    this.applyCableYear();
    this.addPoints("landings", data.landings.map((l) => ({ id: INTERNET_ID_PREFIX.landing + l.id, position: l.position, color: COLORS.landings, size: 4 })));
    this.updateAnimation();
    this.viewer.scene.requestRender();
  }

  /** Show only cables in service by `year` (null: all, planned ones included). */
  setCableYear(year: number | null): void {
    this.cableYear = year;
    this.applyCableYear();
    this.viewer.scene.requestRender();
  }

  private applyCableYear(): void {
    for (const { line, rfsYear } of this.cableLines) line.show = this.cableYear === null || (rfsYear !== null && rfsYear <= this.cableYear);
  }

  setIxps(data: InternetDatasets["ixps"]): void {
    this.addPoints("ixps", data.ixps.map((x) => ({
      id: INTERNET_ID_PREFIX.ixp + x.id, position: x.position, color: COLORS.ixps,
      // 4 px for a handful of networks up to 13 px for the largest exchanges.
      size: 4 + Math.min(9, Math.log10(Math.max(1, x.members ?? 1)) * 3),
    })));
    this.viewer.scene.requestRender();
  }

  setFacilities(data: InternetDatasets["facilities"]): void {
    // Thousands of sites: faint from far away, full strength when close.
    this.addPoints("facilities", data.facilities.map((f) => ({ id: INTERNET_ID_PREFIX.facility + f.id, position: f.position, color: COLORS.facilities, size: 3 })), new NearFarScalar(1.5e6, 1, 2.2e7, 0.35));
    this.viewer.scene.requestRender();
  }

  setRootInstances(instances: readonly RootInstance[]): void {
    this.addPoints("rootServers", instances.map((r) => ({ id: INTERNET_ID_PREFIX.rootInstance + r.id, position: r.position, color: ROOT_COLORS[r.letter], size: 6 })));
    this.viewer.scene.requestRender();
  }

  setDnsFlows(flows: readonly DnsFlow[]): void {
    const lines = this.lineLayer("dnsFlows");
    const points = this.pointLayer("dnsFlows");
    lines.removeAll();
    points.removeAll();
    this.arcMaterial ??= flowMaterial({ color: Color.WHITE.withAlpha(0.22), pulse: 0 });
    this.packets = [];
    for (const flow of flows) {
      const path = arc(flow.probe, flow.instance);
      lines.add({ positions: path, width: 1.5, material: this.arcMaterial });
      const point = points.add({ position: path[0], pixelSize: 5, color: ROOT_COLORS[flow.letter], outlineColor: Color.WHITE.withAlpha(0.5), outlineWidth: 1, show: false });
      this.packets.push({ point, path, flow });
    }
    this.placePackets(now() / 1000);
    this.updateAnimation();
    this.viewer.scene.requestRender();
  }

  private placePackets(seconds: number): void {
    for (const { point, path, flow } of this.packets) {
      const progress = this.still ? 1 : packetProgress(flow, seconds);
      point.show = progress !== null;
      if (progress === null) continue;
      const x = progress * (path.length - 1);
      const i = Math.min(path.length - 2, Math.floor(x));
      point.position = Cartesian3.lerp(path[i], path[i + 1], x - i, new Cartesian3());
    }
  }

  setVisible(layer: InternetPrimitiveLayer, visible: boolean): void {
    this.visible[layer] = visible;
    const lines = this.lines[layer], points = this.points[layer];
    if (lines) lines.show = visible;
    if (points) points.show = visible;
    this.updateAnimation();
    this.viewer.scene.requestRender();
  }

  /** Render continuously only while something is moving on screen. */
  private updateAnimation(): void {
    const moving = !this.still && ((this.visible.cables && this.cableLines.length > 0) || (this.visible.dnsFlows && this.packets.length > 0));
    if (moving && this.frame === null) {
      let last = -Infinity;
      const tick = (frameMs: number) => {
        if (this.viewer.isDestroyed()) return;
        this.frame = requestAnimationFrame(tick);
        if (document.visibilityState !== "visible" || frameMs - last < 1000 / ANIMATION_FPS - 1) return;
        last = frameMs;
        const seconds = now() / 1000;
        setFlowTime(this.cableMaterials, seconds);
        if (this.visible.dnsFlows) this.placePackets(seconds);
        this.viewer.scene.requestRender();
      };
      this.frame = requestAnimationFrame(tick);
    } else if (!moving && this.frame !== null) {
      cancelAnimationFrame(this.frame);
      this.frame = null;
    }
  }

  /** Recording mode: place pulses and packets for the scene clock right now. */
  advance(): void {
    const seconds = now() / 1000;
    setFlowTime(this.cableMaterials, seconds);
    this.placePackets(seconds);
    this.viewer.scene.requestRender();
  }

  dispose(): void {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    if (this.viewer.isDestroyed()) return;
    for (const c of [...Object.values(this.lines), ...Object.values(this.points)]) if (c) this.viewer.scene.primitives.remove(c);
  }
}

function pathLengthKm(positions: Cartesian3[]): number {
  let total = 0;
  for (let i = 1; i < positions.length; i++) total += Cartesian3.distance(positions[i - 1], positions[i]);
  return total / 1000;
}

