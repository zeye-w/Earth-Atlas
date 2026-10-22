/**
 * The 30-second film: three long takes with hard cuts on the bar lines of a
 * 100 BPM grid (7.2 s, 19.2 s), one camera pose per output frame.
 *
 *   A  0.0– 7.2  "此刻"   orbital sunrise over the Atlantic limb, Europe's lights below
 *   B  7.2–19.2  "上升"   flights over Europe → chase and pass the ISS → Starlink shells
 *   C 19.2–30.0  "风暴"   magnetosphere side view → dive to the Nordic aurora → farewell
 *
 * Everything is a pure function of (t, plan): any frame can be rendered by any
 * job, so the takes are captured in parallel chunks and still join seamlessly.
 */
import {
  RE, add, clamp01, cross, dot, geo, inFrame, lerp, lookAt, monotone, monotone3, mul, norm, rad, satelliteFromOmm,
  slerp, smootherstep, smoothstep, sub, sunDirection, toGeo, unit,
} from "./geometry.mjs";

export const FPS = 30;
export const DURATION = 30;
export const FRAMES = FPS * DURATION;
export const WIDTH = 1920;
/** 2.39:1 picture inside 1920×1080; the bars hold the HUD. */
export const PICTURE_HEIGHT = 804;
export const HEIGHT = 1080;

export const TAKES = [
  { id: "A", start: 0, end: 7.2 },
  { id: "B", start: 7.2, end: 19.2 },
  { id: "C", start: 19.2, end: 30 },
];
export const takeAt = (t) => TAKES.find((take) => t >= take.start && t < take.end) ?? TAKES[TAKES.length - 1];
export const frameTime = (frame) => frame / FPS;

/** Region the film is set over; the flight is locked near the ISS ground track inside it. */
export const EUROPE = { lon: 9, lat: 50, box: { west: -10, east: 30, south: 37, north: 60 } };
/** Moments of take B the plan is built around. */
export const FLIGHT_LOCK = { start: 8.8, end: 10.2 };
export const ISS_LOCK = { start: 11.8, end: 14.4 };
export const ISS_CLOSEST = 13.1;

const Z = [0, 0, 1];

/** Up for a camera: the local vertical, turning to north when looking straight down or up. */
function upHint(position, direction) {
  const radial = unit(position);
  const w = smoothstep((Math.abs(dot(radial, direction)) - 0.75) / 0.2);
  const up = add(mul(radial, 1 - w), mul(Z, w));
  return norm(up) > 1e-6 ? up : Z;
}
function pose(position, target, fov) {
  const direction = unit(sub(target, position));
  return { ...lookAt(position, target, upHint(position, direction)), fov };
}

/**
 * Interpolate offsets spanning several orders of magnitude: distance on a log
 * scale, direction separately, so a run of keys along one ray stays on it.
 */
function logRadial(keys) {
  const r = monotone(keys.map((k) => ({ t: k.t, v: Math.log(norm(k.v)) })));
  const d = monotone3(keys.map((k) => ({ t: k.t, v: unit(k.v) })));
  return (t) => mul(unit(d(t)), Math.exp(r(t)));
}

// ---------------------------------------------------------------- take A

/** Height at which a point `elevation` degrees below the horizon clears the limb. */
const riseHeight = (elevation) => RE * (1 / Math.cos(rad(Math.min(70, Math.abs(elevation)))) - 1);
const dip = (h) => Math.acos(RE / (RE + h));

function takeA(t, ctx) {
  const time = ctx.T0 + t * 1000;
  const sun = sunDirection(time);
  const base = geo(EUROPE.lon, EUROPE.lat, 0);
  const upE = unit(base);
  // The Sun's azimuth seen from Europe: west-ish in the evening.
  const toSun = unit(sub(sun, mul(upE, dot(sun, upE))));
  const elevation = 90 - Math.acos(dot(sun, upE)) * 180 / Math.PI;
  const hr = riseHeight(elevation);
  // The Sun crosses the limb around t = 3.3 s as the camera climbs.
  const height = monotone([
    { t: 0, v: Math.max(160e3, hr * 0.72) }, { t: 1, v: Math.max(170e3, hr * 0.76) },
    { t: 4.6, v: hr * 1.45 + 60e3 }, { t: 6, v: hr * 1.5 + 70e3 }, { t: 7.2, v: hr * 1.3 + 50e3 },
  ])(t);
  // A slow drift across the limb, then a push toward the lights.
  const across = cross(upE, toSun);
  const drift = monotone([{ t: 0, v: -60e3 }, { t: 7.2, v: 90e3 }])(t);
  const push = monotone([{ t: 0, v: -250e3 }, { t: 6, v: -150e3 }, { t: 7.2, v: 250e3 }])(t);
  const ground = add(base, add(mul(across, drift), mul(toSun, push)));
  const position = add(ground, mul(unit(ground), height));
  const up = unit(position);
  const heading = unit(sub(toSun, mul(up, dot(toSun, up))));
  // Horizon a little above the centre, then tilt down onto the lights.
  const tilt = rad(2) + monotone([{ t: 0, v: 0 }, { t: 6, v: 0 }, { t: 7.2, v: rad(32) }])(t);
  const pitch = -dip(height) - tilt;
  const direction = add(mul(heading, Math.cos(pitch)), mul(up, Math.sin(pitch)));
  const fov = monotone([{ t: 0, v: 30 }, { t: 6, v: 30 }, { t: 7.2, v: 40 }])(t);
  return pose(position, add(position, mul(direction, 1e6)), fov);
}

// ---------------------------------------------------------------- take B

// Offsets in the ISS orbit frame (x along the velocity, y to the left, z up), metres.
// The approach and the pull-away run along the line of sight to the ISS, so
// it stays steady in frame; only the pass itself sweeps the view.
const APPROACH = [-1.0, 0.45, 0.3];
const RETREAT = [0.75, 0.5, 0.4];
const B_CAMERA = logRadial([
  { t: 7.2, v: [-420e3, -80e3, 260e3] },
  { t: 9.6, v: [-220e3, -20e3, 70e3] },
  { t: 10.2, v: [-130e3, 20e3, 45e3] },
  { t: 10.9, v: APPROACH.map((c) => c * 35e3) },
  { t: 11.9, v: APPROACH.map((c) => c * 1e3) },
  { t: 13.1, v: [-0.05e3, 0.42e3, 0.14e3] },
  { t: 14.4, v: RETREAT.map((c) => c * 1e3) },
  { t: 15.4, v: RETREAT.map((c) => c * 25e3) },
  { t: 17.0, v: [200e3, 500e3, 6_000e3] },
  { t: 19.2, v: [400e3, 2_000e3, 16_000e3] },
]);
/** The ground point the camera watches during the flight lock, ahead of the ISS. */
const B_GROUND_AHEAD = monotone([{ t: 7.2, v: 130e3 }, { t: 9.6, v: 60e3 }, { t: 11.8, v: 40e3 }]);

function takeB(t, ctx) {
  const time = ctx.T0 + t * 1000;
  const f = ctx.iss.frame(time);
  const altitude = norm(f.origin) - RE;
  const position = inFrame(f, B_CAMERA(t));
  // Turn between view directions (not between look-at points, which would
  // whip the view when the camera is close to the ISS): the ground ahead,
  // then the ISS, then the Earth's centre.
  const toGround = unit(sub(inFrame(f, [B_GROUND_AHEAD(t), 0, -altitude]), position));
  const toIss = unit(sub(f.origin, position));
  const toCentre = unit(mul(position, -1));
  const direction = slerp(slerp(toGround, toIss, smootherstep((t - 10.2) / 1.6)), toCentre, smootherstep((t - 15.0) / 2.0));
  const fov = monotone([{ t: 7.2, v: 40 }, { t: 11.2, v: 40 }, { t: 12.4, v: 50 }, { t: 14.4, v: 50 }, { t: 16, v: 42 }, { t: 19.2, v: 45 }])(t);
  return pose(position, add(position, mul(direction, 1e6)), fov);
}

// ---------------------------------------------------------------- take C

function takeC(t, ctx) {
  const time = ctx.T0 + t * 1000;
  const sun = sunDirection(time);
  // Viewed from this side the Sun is to the left and the wind blows rightward.
  let side = unit(cross(Z, sun));
  if (!Number.isFinite(side[0])) side = [1, 0, 0];
  const magnet = add(add(mul(side, 50 * RE), mul(Z, 12 * RE)), mul(sun, 5 * RE));
  const magnetTarget = mul(sun, 5 * RE);
  const keys = [
    { t: 19.2, p: magnet, look: magnetTarget },
    { t: 20.0, p: mul(magnet, 0.94), look: magnetTarget },
    { t: 21.0, p: null, look: null },
    { t: 21.6, p: geo(11, 59.5, 1.25e6), look: geo(17, 71, 120e3) },
    { t: 24.0, p: geo(24, 60.5, 1.15e6), look: geo(30, 71.5, 120e3) },
    { t: 26.4, p: geo(27, 54, 3.5e6), look: geo(24, 66, 0) },
    { t: 30.0, p: geo(21, 41, 9.0e6), look: geo(17, 58, 0) },
  ];
  // The dive: halfway in direction, already close to the Earth.
  keys[2].p = mul(unit(add(mul(unit(magnet), 0.35), mul(unit(keys[3].p), 0.65))), 3.2 * RE);
  const logR = monotone(keys.map((k) => ({ t: k.t, v: Math.log(norm(k.p)) })))(t);
  const dir = unit(monotone3(keys.map((k) => ({ t: k.t, v: unit(k.p) })))(t));
  const position = mul(dir, Math.exp(logR));
  // The view turns from the magnetosphere to the aurora by direction, so the
  // dive stays readable; after the flash it follows the aurora look points.
  const near = keys.slice(3);
  const look = monotone3(near.map((k) => ({ t: k.t, v: k.look })))(t);
  const direction = slerp(unit(sub(magnetTarget, position)), unit(sub(look, position)), smootherstep((t - 19.9) / 2.0));
  const fov = monotone([{ t: 19.2, v: 40 }, { t: 20.2, v: 42 }, { t: 21.2, v: 62 }, { t: 21.7, v: 52 }, { t: 30, v: 46 }])(t);
  return pose(position, add(position, mul(direction, 1e6)), fov);
}

// ---------------------------------------------------------------- shared

/**
 * Full-frame white (atmosphere entry) and black, 0–1, applied in post. The
 * dive of take C turns fastest where its white flash is opaque.
 */
export function whiteAt(t) {
  // The cut to take B lands inside the first flash.
  if (t >= 6.75 && t < 7.2) return smootherstep((t - 6.75) / 0.45);
  if (t >= 7.2 && t < 7.65) return 1 - smootherstep((t - 7.2) / 0.45);
  // Atmosphere entry in the dive: rise, hold over the fastest turn, clear onto the aurora.
  if (t >= 21.05 && t < 21.38) return smootherstep((t - 21.05) / 0.33);
  if (t >= 21.38 && t < 21.62) return 1;
  if (t >= 21.62 && t < 22.02) return 1 - smootherstep((t - 21.62) / 0.4);
  return 0;
}
export function blackAt(t) {
  if (t < 1) return 1 - smootherstep(t / 1);
  if (t >= 18.95 && t < 19.2) return smootherstep((t - 18.95) / 0.2);
  if (t >= 19.2 && t < 19.35) return 1 - smootherstep((t - 19.2) / 0.15);
  if (t >= 29.4) return smootherstep((t - 29.4) / 0.6);
  return 0;
}

/** Everything the capture needs to know about one frame. */
export function frameAt(frame, ctx) {
  const t = frameTime(frame);
  const take = takeAt(t);
  const camera = take.id === "A" ? takeA(t, ctx) : take.id === "B" ? takeB(t, ctx) : takeC(t, ctx);
  return {
    frame, t, take: take.id, virtualTime: ctx.T0 + t * 1000, camera,
    layers: layersAt(t),
    alpha: { flights: flightsAlpha(t), starlink: starlinkAlpha(t) },
    issModel: take.id === "B",
    effectsTime: t,
  };
}

const BASE_LAYERS = {
  clouds: false, geology: false, dayNight: true, cities: false, atmosphere: true, aurora: false, lights: true,
  quakes: false, plates: false, volcanoes: false, satellites: false, paths: false, geoLabels: false,
  trueColor: false, starlink: false, solarWind: false, flights: false, shells: false,
};
export function layersAt(t) {
  const take = takeAt(t).id;
  if (take === "A") return { ...BASE_LAYERS };
  if (take === "B") return { ...BASE_LAYERS, flights: true, satellites: true, paths: true, starlink: true };
  // The dive leaves the magnetosphere behind at the white flash.
  return { ...BASE_LAYERS, solarWind: t < 21.45, aurora: true };
}
const flightsAlpha = (t) => 1 - smoothstep((t - 14.4) / 1.0);
const starlinkAlpha = (t) => smoothstep((t - 15.0) / 1.0);

/** Build the context from the plan (T0, ISS elements). */
export function contextFrom(plan) {
  return { T0: plan.T0, iss: satelliteFromOmm(plan.issOmm) };
}

/** The camera's sub-point and height, for the HUD. */
export const cameraGeo = (camera) => toGeo(camera.position);

/** Frames belonging to a take. */
export function takeFrames(id) {
  const take = TAKES.find((x) => x.id === id);
  return { first: Math.round(take.start * FPS), last: Math.round(take.end * FPS) - 1 };
}

export { clamp01, lerp, smootherstep };
