import { Cartesian3, Color } from "cesium";
import { boxGeometry, cylinderGeometry, type SolidPart } from "./rocketParts.ts";

/**
 * A generic launch complex around the rocket, in pad east-north-up metres:
 * concrete apron, launch mount, flame trench, a lattice service tower with
 * two swing arms, lightning-protection masts, a water tower and a blockhouse.
 * Illustrative, not a model of any real site. Everything static is one
 * primitive; the arms are a second one so they can swing away.
 */
// West of the rocket, so the flight camera (looking north) sees it beside the rocket, not behind it.
export const TOWER = { east: -25, north: 0, half: 7, height: 112 } as const;
/** The tower face towards the rocket. */
const FACE = TOWER.east + TOWER.half;
/** The arms reach to just outside the rocket's 6 m radius, above the boosters (which end at 54 m). */
const ARM_TIP = -6.5;
/** The arms swing about this vertical line on the tower face. */
export const ARM_HINGE = new Cartesian3(FACE, -1.5, 0);
/** How far the arms swing away (radians, clockwise seen from above). */
export const ARM_SWING = -1.75;
const ARM_HEIGHTS = [64, 84] as const;
const MASTS = [[-72, -66], [72, -66], [-72, 70], [72, 70]] as const;
export const MAST_HEIGHT = 140;

export interface PadLight { east: number; north: number; up: number; color: "white" | "red"; size: number }

export function launchComplex() {
  const pad: SolidPart[] = [], arms: SolidPart[] = [];
  const part = (list: SolidPart[], geometry: SolidPart["geometry"], east: number, north: number, up: number, color: string) =>
    list.push({ geometry, offset: new Cartesian3(east, north, up), color: Color.fromCssColorString(color) });
  const box = (list: SolidPart[], x: number, y: number, z: number, east: number, north: number, up: number, color: string) =>
    part(list, boxGeometry(x, y, z), east, north, up, color);
  const cylinder = (list: SolidPart[], length: number, top: number, bottom: number, east: number, north: number, up: number, color: string) =>
    part(list, cylinderGeometry(length, top, bottom), east, north, up, color);

  // Ground: apron, the trench the exhaust is deflected into, and the mount.
  box(pad, 240, 240, 0.5, 0, 0, 0.25, "#7c838b");
  box(pad, 18, 96, 0.12, 0, -66, 0.56, "#262c32");
  box(pad, 22, 4, 1.4, 0, -17, 0.7, "#5d666f");
  cylinder(pad, 1, 29, 29, 0, 0, 0.5, "#71808b");
  cylinder(pad, 1.2, 26, 26, 0, 0, 1.1, "#25343e");
  for (const x of [-9, 9]) cylinder(pad, 4.2, 1.5, 2, x, 0, 3.8, "#687887");

  // Service tower: corner columns, a ring of beams every 8 m with cross braces, decks at the arms and a crane on top.
  const { east: te, north: tn, half: h, height } = TOWER;
  const steel = "#b3bcc6", beam = "#8b96a2";
  for (const e of [-h, h]) for (const n of [-h, h]) box(pad, 1.6, 1.6, height, te + e, tn + n, height / 2, steel);
  for (let z = 6; z <= height; z += 8) {
    for (const n of [-h, h]) box(pad, 2 * h, 0.8, 0.8, te, tn + n, z, beam);
    for (const e of [-h, h]) box(pad, 0.8, 2 * h, 0.8, te + e, tn, z, beam);
  }
  // A mid-column on each face makes the lattice read from a distance.
  for (const e of [-h, h]) box(pad, 0.9, 0.9, height, te + e, tn, height / 2, beam);
  for (const n of [-h, h]) box(pad, 0.9, 0.9, height, te, tn + n, height / 2, beam);
  for (const z of ARM_HEIGHTS) box(pad, 2 * h, 2 * h, 0.6, te, tn, z - 1.6, beam);
  box(pad, 26, 2.4, 2.4, te + 8, tn, height + 3, "#d0a548");
  box(pad, 5, 5, 4, te - 3, tn, height + 6, "#d0a548");

  // Swing arms, from the tower face to the rocket; a hood clamps each one.
  for (const z of ARM_HEIGHTS) {
    box(arms, ARM_TIP - FACE, 3, 2.4, (FACE + ARM_TIP) / 2, ARM_HINGE.y + 1.5, z, "#dfe3e8");
    box(arms, 1.8, 5, 3.4, ARM_TIP - 0.9, ARM_HINGE.y + 1.5, z, "#bcc3cb");
  }

  // Lightning-protection masts.
  for (const [e, n] of MASTS) cylinder(pad, MAST_HEIGHT, 0.45, 1.6, e, n, MAST_HEIGHT / 2, "#c9ced4");

  // Water tower and blockhouse at the edge of the apron.
  for (const e of [-4, 4]) for (const n of [-4, 4]) cylinder(pad, 33, 0.45, 0.6, -95 + e, 45 + n, 16.5, "#8b949d");
  cylinder(pad, 10, 7, 7, -95, 45, 38, "#d7dbe0");
  box(pad, 22, 12, 7, 108, -42, 3.5, "#9ca3aa");

  const lights: PadLight[] = [
    ...MASTS.map(([east, north]) => ({ east, north, up: MAST_HEIGHT + 1, color: "red" as const, size: 5 })),
    { east: te - 3, north: tn, up: height + 9, color: "red", size: 5 },
    // Floodlights on the tower face, lighting the rocket.
    ...[30, 50, 70, 92].map(up => ({ east: FACE + 0.6, north: tn + 4, up, color: "white" as const, size: 7 })),
  ];
  return { pad, arms, lights };
}
