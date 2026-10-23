import { readFileSync } from "node:fs";
import type { Page, Route } from "@playwright/test";

/**
 * Hermetic network for end-to-end tests. Every external request is answered
 * with a synthetic fixture (clearly NOT real observations) or aborted, so the
 * tests never depend on third-party availability.
 */
const TRANSPARENT_PNG = readFileSync(new URL("./fixtures/transparent.png", import.meta.url));
const OCEAN_PNG = readFileSync(new URL("./fixtures/ocean.png", import.meta.url));
/** Synthetic internet datasets (tests/e2e/fixtures/internet/): the app's static files and the DNS-flow API. */
const internetFixture = (name: string) => readFileSync(new URL("./fixtures/internet/" + name + ".json", import.meta.url), "utf8");

/** A synthetic earthquake the tests can click on (placed at QUAKE_POINT). */
export const QUAKE_POINT = { longitude: 142.4, latitude: 38.3 };
export const ETNA = { longitude: 14.999, latitude: 37.748 };

const json = (route: Route, body: unknown) =>
  route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body) });
const png = (route: Route, body: Buffer) =>
  route.fulfill({ status: 200, contentType: "image/png", headers: { "access-control-allow-origin": "*" }, body });

function quakeFeed() {
  const now = Date.now();
  const features = [
    { id: "e2e-big", properties: { mag: 7.1, place: "E2E synthetic event", time: now - 3_600_000, url: "https://earthquake.usgs.gov/", tsunami: 0, magType: "mww" },
      geometry: { coordinates: [QUAKE_POINT.longitude, QUAKE_POINT.latitude, 24] } },
  ];
  for (let i = 0; i < 20; i++) {
    features.push({ id: "e2e-" + i, properties: { mag: 3 + (i % 3), place: "E2E synthetic", time: now - i * 3_600_000, url: "https://earthquake.usgs.gov/", tsunami: 0, magType: "mb" },
      geometry: { coordinates: [-70 + i, -20 - (i % 5), 10 + i * 20] } });
  }
  return { type: "FeatureCollection", features };
}

function ovationGrid() {
  const coordinates: number[][] = [];
  for (let lon = 0; lon < 360; lon++) {
    for (let lat = -90; lat <= 90; lat++) coordinates.push([lon, lat, Math.max(0, 30 - 8 * Math.abs(lat - 67))]);
  }
  return { "Observation Time": new Date().toISOString(), "Forecast Time": new Date(Date.now() + 30 * 60_000).toISOString(), coordinates };
}

function kpHistory() {
  const rows: (string | number)[][] = [["time_tag", "Kp", "a_running", "station_count"]];
  for (let i = 8; i >= 1; i--) rows.push([new Date(Date.now() - i * 3 * 3_600_000).toISOString().replace("T", " ").slice(0, 19), "2.33", "9", "8"]);
  return rows;
}

function celestrak(url: URL) {
  const epoch = new Date().toISOString().replace("Z", "");
  const make = (id: number, inclination: number, raan: number) => ({
    OBJECT_NAME: "E2E " + id, OBJECT_ID: "E2E", EPOCH: epoch, MEAN_MOTION: 15.5, ECCENTRICITY: 0.0005,
    INCLINATION: inclination, RA_OF_ASC_NODE: raan, ARG_OF_PERICENTER: 0, MEAN_ANOMALY: 0, EPHEMERIS_TYPE: 0,
    CLASSIFICATION_TYPE: "U", NORAD_CAT_ID: id, ELEMENT_SET_NO: 999, REV_AT_EPOCH: 1, BSTAR: 0.0001, MEAN_MOTION_DOT: 0, MEAN_MOTION_DDOT: 0,
  });
  const catalogue = url.searchParams.get("CATNR");
  return catalogue ? [make(Number(catalogue), 98, 40)] : [make(25544, 51.6, 10), make(48274, 41.5, 120)];
}

/** Synthetic Starlink-like constellation in CelesTrak's OMM CSV form (not real elements). */
function constellationCsv() {
  const epoch = new Date().toISOString().replace("Z", "");
  const header = "OBJECT_NAME,OBJECT_ID,EPOCH,MEAN_MOTION,ECCENTRICITY,INCLINATION,RA_OF_ASC_NODE,ARG_OF_PERICENTER,MEAN_ANOMALY,EPHEMERIS_TYPE,CLASSIFICATION_TYPE,NORAD_CAT_ID,ELEMENT_SET_NO,REV_AT_EPOCH,BSTAR,MEAN_MOTION_DOT,MEAN_MOTION_DDOT";
  const rows = Array.from({ length: 240 }, (_, i) => ["E2E-STARLINK-" + i, "E2E", epoch, 15.06, 0.0001, i % 2 ? 53 : 97.6, (i * 9) % 360, 90, (i * 23) % 360, 0, "U", 90000 + i, 999, 1, 0.0002, 0, 0].join(","));
  return [header, ...rows].join("\n") + "\n";
}

/** Synthetic /api/flights snapshot (not real aircraft): one cruising over 0°N 0°E, one on the ground. */
function flightSnapshot() {
  const aircraft = [
    ["e2e001", "E2E101", 0, 0, 10_973, 231.5, 90, "A20N", "B-E2E1", 2],
    ["e2e002", "E2E202", 40, -73, null, 5, 180, "B738", "", 1],
  ];
  for (let i = 0; i < 40; i++) aircraft.push(["e2e1" + String(i).padStart(2, "0"), "", -30 + i, 60 + i, 2000 + i * 250, 200, (i * 37) % 360, "", "", 5]);
  return { v: 1, source: "adsb.lol", time: Date.now(), aircraft };
}

/** Two hours of synthetic RTSW solar wind (not NOAA data), newest first. */
function rtsw(kind: "wind" | "mag") {
  const rows = [];
  for (let i = 0; i < 120; i++) {
    const time_tag = new Date(Date.now() - i * 60_000).toISOString().slice(0, 19);
    rows.push(kind === "wind"
      ? { time_tag, active: true, source: "E2E", proton_speed: 450, proton_density: 6 }
      : { time_tag, active: true, source: "E2E", bz_gsm: -6, bt: 8 });
  }
  return rows;
}

function cloudProducts() {
  const stamp = new Date(Date.now() - 30 * 60_000).toISOString().replace(/[-:]/g, "").replace("T", ".").slice(0, 15);
  return [{ id: "globalir", times: [stamp] }];
}

export async function mockNetwork(page: Page): Promise<void> {
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === "localhost" && url.pathname === "/api/flights") return json(route, flightSnapshot());
    if (url.hostname === "localhost" && url.pathname === "/api/internet/dns-flows") return json(route, JSON.parse(internetFixture("dns-flows")));
    if (url.hostname === "localhost" && url.pathname.startsWith("/data/internet/")) return json(route, JSON.parse(internetFixture(url.pathname.slice("/data/internet/".length).replace(/\.json$/, ""))));
    if (url.hostname === "localhost" || url.protocol === "data:" || url.protocol === "blob:") return route.continue();
    if (url.hostname === "gibs.earthdata.nasa.gov") return png(route, url.pathname.includes("Black_Marble") ? TRANSPARENT_PNG : OCEAN_PNG);
    if (url.hostname === "tiles.macrostrat.org") return png(route, TRANSPARENT_PNG);
    if (url.hostname === "macrostrat.org" && url.pathname.includes("geologic_units")) {
      return json(route, { success: { v: 2, data: [{ map_id: 1, source_id: 25, name: "E2E Synthetic Formation", lith: "Major:: {sandstone}", liths: [7], best_int_name: "Maastrichtian", t_age: 66, b_age: 72.1 }] } });
    }
    if (url.hostname === "macrostrat.org" && url.pathname.includes("lithologies")) {
      return json(route, { success: { v: 2, data: [{ lith_id: 7, name: "Sandstone", class: "sedimentary" }] } });
    }
    if (url.hostname === "earthquake.usgs.gov") return json(route, quakeFeed());
    if (url.hostname === "services.swpc.noaa.gov" && url.pathname.includes("rtsw_wind")) return json(route, rtsw("wind"));
    if (url.hostname === "services.swpc.noaa.gov" && url.pathname.includes("rtsw_mag")) return json(route, rtsw("mag"));
    if (url.hostname === "services.swpc.noaa.gov" && url.pathname.includes("ovation")) return json(route, ovationGrid());
    if (url.hostname === "services.swpc.noaa.gov" && url.pathname.includes("planetary_k_index_1m")) {
      return json(route, [{ time_tag: new Date().toISOString().slice(0, 19), kp_index: 2, estimated_kp: 2.33 }]);
    }
    if (url.hostname === "services.swpc.noaa.gov" && url.pathname.includes("noaa-planetary-k-index")) return json(route, kpHistory());
    if (url.hostname === "celestrak.org" && url.searchParams.get("FORMAT") === "csv") return route.fulfill({ status: 200, contentType: "text/plain", headers: { "access-control-allow-origin": "*" }, body: constellationCsv() });
    if (url.hostname === "celestrak.org") return json(route, celestrak(url));
    if (url.hostname === "realearth.ssec.wisc.edu" && url.pathname.includes("products")) return json(route, cloudProducts());
    if (url.hostname === "realearth.ssec.wisc.edu") return png(route, TRANSPARENT_PNG);
    if (url.hostname === "geocoding-api.open-meteo.com") return json(route, { results: [] });
    return route.abort();
  });
}

/** Open the app with an optional shared scene (camera looking straight down). */
export function sceneUrl(longitude: number, latitude: number, height: number, layers: Record<string, boolean>, options: Record<string, unknown> = {}): string {
  const scene = {
    v: 1,
    camera: [longitude, latitude, height, 0, -Math.PI / 2 + 1e-6, 0],
    layers: { clouds: false, geology: false, dayNight: true, cities: false, atmosphere: true, aurora: false, lights: false, quakes: false, plates: false, volcanoes: false, satellites: false, paths: false, ...layers },
    options: { cloudOpacity: 65, opacity: 90, mapMode: "raster", ageFilter: "all", rockFilter: "all", quakeRange: "week", ...options },
  };
  return "/#scene=" + encodeURIComponent(JSON.stringify(scene));
}

/** Wait until the splash is gone and the globe is interactive. */
export async function waitForGlobe(page: Page): Promise<void> {
  await page.locator("#splash").waitFor({ state: "detached", timeout: 30_000 });
  await page.locator(".cesium-widget canvas").waitFor();
}
