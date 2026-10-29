import test from "node:test";
import assert from "node:assert/strict";
import { countdown, headlineLaunch, launchPads, launchPrecision, launchStatus, parseLaunchSnapshot, parseLibraryLaunch, parseLibraryResponse } from "../src/launchData.ts";
import { ENGLISH } from "../src/locales/en.ts";

const NOW = Date.parse("2026-10-29T12:00:00Z");

// The shape of a Launch Library 2.3.0 "normal" mode result (trimmed).
const library = (overrides = {}) => ({
  id: "e3df2ecd-c239-472f-95e4-2b89b4f75800",
  name: "Falcon 9 Block 5 | Starlink Group 10-9",
  status: { id: 1, name: "Go for Launch", abbrev: "Go", description: "Current T-0 confirmed by official or reliable sources." },
  net: "2026-10-30T03:15:00Z",
  net_precision: { id: 1, name: "Second", abbrev: "SEC" },
  window_start: "2026-10-30T03:15:00Z",
  window_end: "2026-10-30T07:15:00Z",
  launch_service_provider: { id: 121, name: "SpaceX", abbrev: "SpX" },
  rocket: { id: 8000, configuration: { id: 164, name: "Falcon 9", full_name: "Falcon 9 Block 5" } },
  mission: { id: 7000, name: "Starlink Group 10-9", type: "Communications", description: "A batch of   Starlink satellites.", orbit: { id: 8, name: "Low Earth Orbit", abbrev: "LEO" } },
  pad: { id: 80, name: "Space Launch Complex 40", latitude: 28.56194122, longitude: -80.57735736, country: { alpha_2_code: "US" }, location: { id: 12, name: "Cape Canaveral SFS, FL, USA" } },
  webcast_live: false,
  ...overrides,
});

test("Launch Library launches become compact records", () => {
  const launch = parseLibraryLaunch(library());
  assert.equal(launch.mission, "Starlink Group 10-9");
  assert.equal(launch.rocket, "Falcon 9 Block 5");
  assert.equal(launch.provider, "SpaceX");
  assert.equal(launch.status, "go");
  assert.equal(launch.precision, "time");
  assert.equal(launch.net, Date.parse("2026-10-30T03:15:00Z"));
  assert.equal(launch.padId, "80");
  assert.equal(launch.location, "Cape Canaveral SFS, FL, USA");
  assert.equal(launch.country, "US");
  assert.equal(launch.orbit, "Low Earth Orbit");
  assert.equal(launch.description, "A batch of Starlink satellites.");
});

test("older API shapes, missing missions and bad records are handled", () => {
  // 2.2.0: coordinates as strings, country code on the location.
  const old = parseLibraryLaunch(library({ mission: null, pad: { id: 27, name: "LC-39A", latitude: "28.608", longitude: "-80.604", location: { name: "KSC", country_code: "usa" } } }));
  assert.equal(old.latitude, 28.608);
  assert.equal(old.mission, "Starlink Group 10-9");
  assert.equal(old.country, "USA");
  assert.equal(parseLibraryLaunch(library({ net: "soon" })), null);
  assert.equal(parseLibraryLaunch(library({ pad: { id: 1, latitude: null, longitude: 10 } })), null);
  assert.equal(parseLibraryLaunch(library({ pad: { id: 1, latitude: 95, longitude: 10 } })), null);
  assert.equal(parseLibraryLaunch(null), null);
});

test("statuses and time precision map to the calendar's categories", () => {
  assert.equal(launchStatus("Go"), "go");
  assert.equal(launchStatus("TBC"), "tbc");
  assert.equal(launchStatus("TBD"), "tbd");
  assert.equal(launchStatus("Hold"), "hold");
  assert.equal(launchStatus("In Flight"), "flight");
  assert.equal(launchStatus("Success"), "success");
  assert.equal(launchStatus("Failure"), "failure");
  assert.equal(launchStatus("Partial Failure"), "failure");
  assert.equal(launchStatus("", "To Be Determined"), "tbd");
  assert.equal(launchPrecision({ name: "Minute" }), "time");
  assert.equal(launchPrecision(null), "time");
  assert.equal(launchPrecision({ name: "Day" }), "day");
  assert.equal(launchPrecision({ name: "Month" }), "month");
  assert.equal(launchPrecision({ name: "Quarter 1" }), "month");
});

test("a response becomes a snapshot sorted by time, without long-past launches", () => {
  const snapshot = parseLibraryResponse({ results: [
    library({ id: "b", net: "2026-11-02T00:00:00Z" }),
    library({ id: "a", net: "2026-10-30T00:00:00Z" }),
    library({ id: "old", net: "2026-10-27T00:00:00Z" }),
    library({ id: "bad", net: null }),
  ] }, NOW);
  assert.deepEqual(snapshot.launches.map((l) => l.id), ["a", "b"]);
  assert.throws(() => parseLibraryResponse({ detail: "Request was throttled." }, NOW), /no results/);
  // What the Worker serves survives its own check unchanged.
  assert.deepEqual(parseLaunchSnapshot(JSON.parse(JSON.stringify(snapshot))), snapshot);
});

test("snapshot check drops malformed launches and rejects malformed snapshots", () => {
  const good = parseLibraryResponse({ results: [library()] }, NOW);
  const broken = { ...good, launches: [...good.launches, { ...good.launches[0], status: "exploded" }, { id: 3 }] };
  assert.equal(parseLaunchSnapshot(broken).launches.length, 1);
  assert.throws(() => parseLaunchSnapshot({ v: 2, fetched: NOW, launches: [] }));
  assert.throws(() => parseLaunchSnapshot({ error: "Launch calendar unavailable" }));
});

test("pads group launches and show their next unflown launch", () => {
  const launches = parseLibraryResponse({ results: [
    library({ id: "flown", net: "2026-10-29T06:00:00Z", status: { name: "Launch Successful", abbrev: "Success" } }),
    library({ id: "next", net: "2026-11-01T00:00:00Z" }),
    library({ id: "china", net: "2026-10-31T00:00:00Z", pad: { id: 9, name: "LC-9", latitude: 40.96, longitude: 100.29, location: { name: "Jiuquan, PRC" } } }),
  ] }, NOW).launches;
  const pads = launchPads(launches);
  assert.deepEqual(pads.map((p) => p.id), ["80", "9"]);
  assert.deepEqual(pads[0].launches.map((l) => l.id), ["flown", "next"]);
  assert.equal(headlineLaunch(pads[0], NOW).id, "next");
  // With nothing left to fly, the latest launch stands for the pad.
  assert.equal(headlineLaunch({ ...pads[0], launches: [pads[0].launches[0]] }, NOW).id, "flown");
});

test("countdown runs to the second only when the time is known", () => {
  const net = NOW + 2 * 86_400_000 + 4 * 3_600_000 + 13 * 60_000 + 22_000;
  assert.equal(countdown({ net, precision: "time" }, NOW), "T−2d 04:13:22");
  assert.equal(countdown({ net: NOW - 12 * 60_000 - 9_000, precision: "time" }, NOW), "T+00:12:09");
  assert.equal(countdown({ net, precision: "day" }, NOW), null);
});

test("launch calendar copy has English text", () => {
  for (const key of ["真实火箭发射日历", "火箭发射日历", "确认发射", "待确认", "时间未定", "暂停", "飞行中", "发射成功", "发射失败", "{0} 次发射 · 数据更新于{1}", "观看虚拟发射"]) assert.ok(ENGLISH[key], key);
});

test("the Worker serves the checked release snapshot and keeps the last one on failure", async () => {
  const { launchesResponse } = await import("../worker/launches.ts");
  const original = globalThis.fetch;
  const snapshot = parseLibraryResponse({ results: [library()] }, NOW);
  let calls = 0;
  try {
    globalThis.fetch = async (url) => { calls++; assert.match(String(url), /releases\/download\/launch-data\/launches\.json$/); return new Response(JSON.stringify(snapshot)); };
    const ok = await launchesResponse(new Request("https://example.com/api/launches"));
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), snapshot);
    // Within ten minutes the cached copy answers.
    await launchesResponse(new Request("https://example.com/api/launches"));
    assert.equal(calls, 1);
    assert.equal((await launchesResponse(new Request("https://example.com/api/launches", { method: "POST" }))).status, 405);
  } finally { globalThis.fetch = original; }
});
