import test from "node:test";
import assert from "node:assert/strict";
import { STATION, FRAMES, REGIONS, TAKES, contextFrom, frameAt, ovalLatitude, takeFrames, whiteAt } from "../video/cinematic/story.mjs";
import { RE, dot, geo, monotone, norm, satelliteFromOmm, sub, sunElevationAt, toGeo } from "../video/cinematic/geometry.mjs";
import { filmable, findFilmWindow } from "../video/cinematic/pass.mjs";

// Synthetic station-like elements (not a real element set).
const EPOCH = Date.UTC(2026, 9, 22, 12);
const STATION_OMM = {
  OBJECT_NAME: "station (SYNTHETIC)", OBJECT_ID: "1998-067A", EPOCH: new Date(EPOCH).toISOString().slice(0, 23),
  MEAN_MOTION: 15.49, ECCENTRICITY: 0.0004, INCLINATION: 51.64, RA_OF_ASC_NODE: 240, ARG_OF_PERICENTER: 60, MEAN_ANOMALY: 300,
  EPHEMERIS_TYPE: 0, CLASSIFICATION_TYPE: "U", NORAD_CAT_ID: 25544, ELEMENT_SET_NO: 999, REV_AT_EPOCH: 50000,
  BSTAR: 0.0002, MEAN_MOTION_DOT: 0.0001, MEAN_MOTION_DDOT: 0,
};
const station = satelliteFromOmm(STATION_OMM);

test("geometry: WGS84 round trip and monotone keys without overshoot", () => {
  const p = geo(9, 50, 400e3);
  const g = toGeo(p);
  assert.ok(Math.abs(g.lon - 9) < 1e-6 && Math.abs(g.lat - 50) < 1e-5 && Math.abs(g.h - 400e3) < 1);
  const f = monotone([{ t: 0, v: 0 }, { t: 1, v: 10 }, { t: 2, v: 10 }, { t: 3, v: 100 }]);
  for (let t = 0; t <= 3; t += 0.01) assert.ok(f(t) >= -1e-9 && f(t) <= 100 + 1e-9);
  for (let t = 1; t <= 2; t += 0.01) assert.ok(Math.abs(f(t) - 10) < 1e-9, "flat between equal keys");
  assert.ok(station.at(EPOCH) && Math.abs(norm(station.at(EPOCH)) - RE - 420e3) < 40e3);
});

test("the film window: a dark, busy region under a sunlit station, soon", () => {
  const window = findFilmWindow(station, EPOCH, 48);
  assert.ok(window, "a synthetic station orbit finds a window somewhere within two days");
  assert.ok(window.T0 - EPOCH < 12 * 3_600_000, "usually within hours, not days");
  const { region } = window;
  assert.ok(REGIONS.some((r) => r.id === region.id));
  assert.deepEqual(filmable(station, window.T0), region);
  assert.ok(sunElevationAt(region.lon, region.lat, window.T0) < -6);
  assert.ok(station.sunlit(window.T0 + 13_000));
});

test("aurora oval latitude follows the magnetic pole", () => {
  // Over Canada the oval sits further south than over Siberia; mirrored in the south.
  assert.ok(ovalLatitude(-95, 1) < ovalLatitude(100, 1) - 5);
  assert.ok(ovalLatitude(15, 1) > 60 && ovalLatitude(15, 1) < 72);
  assert.ok(ovalLatitude(140, -1) < -55 && ovalLatitude(140, -1) > -72);
});

test("camera: smooth within each take, the station passed at a few hundred metres", () => {
  const window = findFilmWindow(station, EPOCH, 48);
  const ctx = contextFrom({ T0: window.T0, stationOmm: STATION_OMM, region: window.region });
  let previous = null;
  let closest = Infinity;
  for (let frame = 0; frame < FRAMES; frame++) {
    const f = frameAt(frame, ctx);
    const { position, direction, up, fov } = f.camera;
    assert.ok([...position, ...direction, ...up, fov].every(Number.isFinite), "finite pose at frame " + frame);
    assert.ok(Math.abs(norm(direction) - 1) < 1e-9 && Math.abs(norm(up) - 1) < 1e-9 && Math.abs(dot(direction, up)) < 1e-9);
    assert.ok(norm(position) > RE + 100e3, "camera above 100 km at frame " + frame);
    if (f.take === "B") {
      const d = norm(sub(position, station.at(f.virtualTime)));
      closest = Math.min(closest, d);
    }
    if (previous && previous.take === f.take) {
      // No jumps: the view turns less than 3° per frame (6° in the dive of
      // take C); faster only under an opaque white flash.
      const turn = Math.acos(Math.min(1, dot(previous.camera.direction, direction))) * 180 / Math.PI;
      const limit = whiteAt(f.t) >= 0.8 ? 12 : f.take === "C" && f.t > 20 && f.t < 21.8 ? 6 : 3;
      assert.ok(turn < limit, `view turns ${turn.toFixed(2)}° at frame ${frame} (take ${f.take})`);
      assert.ok(Math.abs(fov - previous.camera.fov) < 1.2, "field of view jumps at frame " + frame);
    }
    previous = f;
  }
  assert.ok(closest > 150 && closest < 600, "closest approach to the station " + closest.toFixed(0) + " m");
  assert.ok(closest >= 180 && closest <= 250, "Tiangong close pass remains within 180–250 m");
  assert.deepEqual(TAKES.map((t) => takeFrames(t.id)), [{ first: 0, last: 215 }, { first: 216, last: 575 }, { first: 576, last: 899 }]);
});

test("station identity and region filter apply to strict and relaxed searches", () => {
  assert.deepEqual(STATION, {id:"tiangong",noradId:48274,name:"TIANGONG",spanM:55});
  const from=EPOCH;
  const at=geo(52,27,400e3);
  const fixed={at:()=>at,sunlit:()=>true};
  assert.equal(filmable(fixed,from,true,"middle-east").id,"middle-east");
  assert.equal(filmable(fixed,from,true,"europe"),null);
  assert.equal(filmable(fixed,from,false,"europe"),null);
  assert.equal(findFilmWindow(fixed,from,.01,1000,true,"middle-east").region.id,"middle-east");
  assert.equal(findFilmWindow(fixed,from,.01,1000,true,"europe"),null);
  assert.equal(filmable({...fixed,sunlit:()=>false},from,false,"middle-east"),null);
});

test("layers and fades follow the storyboard", () => {
  const ctx = contextFrom({ T0: EPOCH, stationOmm: STATION_OMM, region: { id: "europe", lon: 9, lat: 50 } });
  assert.equal(frameAt(100, ctx).layers.flights, false);
  assert.equal(frameAt(300, ctx).layers.flights, true);
  assert.equal(frameAt(300, ctx).alpha.starlink, 0);
  assert.equal(frameAt(540, ctx).alpha.starlink, 1);
  assert.equal(frameAt(600, ctx).layers.solarWind, true);
  assert.equal(frameAt(700, ctx).layers.solarWind, false);
  assert.equal(frameAt(700, ctx).layers.aurora, true);
  assert.equal(frameAt(400, ctx).stationModel, true);
});
