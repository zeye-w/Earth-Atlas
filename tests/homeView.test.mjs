import assert from "node:assert/strict";
import { test } from "node:test";
import {
  HOME_LONGITUDE, HOME_LATITUDE, DESKTOP_HOME_HEIGHT_METRES,
  EARTH_RADIUS_METRES, homeViewHeight,
} from "../src/homeView.ts";

test("home geolocation is shared by desktop and phone, and desktop default is unchanged", () => {
  assert.equal(HOME_LONGITUDE, 58);
  assert.equal(HOME_LATITUDE, 19);
  assert.equal(homeViewHeight(1440, 900), DESKTOP_HOME_HEIGHT_METRES);
  assert.equal(homeViewHeight(1920, 1080), DESKTOP_HOME_HEIGHT_METRES);
  assert.equal(homeViewHeight(1024, 768), DESKTOP_HOME_HEIGHT_METRES);
});

test("phone portrait zooms out enough to show the whole planet above a compact default-open panel", () => {
  for (const [width, height] of [[390, 844], [360, 640], [375, 812]]) {
    const altitude = homeViewHeight(width, height);
    assert.ok(altitude > DESKTOP_HOME_HEIGHT_METRES);
    const angularRadius = Math.asin(EARTH_RADIUS_METRES / (EARTH_RADIUS_METRES + altitude));
    const halfFov = Math.atan(Math.tan(Math.PI / 6) * width / height);
    const fillWidth = Math.tan(angularRadius) / Math.tan(halfFov);
    assert.ok(fillWidth <= 0.61 && fillWidth >= 0.55, "width fraction " + fillWidth + " at " + width + "x" + height);
    // Mobile sheet consumes 30vh at the bottom; the globe must fit above it.
    const planetBottom = height / 2 + (width * fillWidth) / 2;
    const panelTop = height * 0.7 - 12;
    assert.ok(planetBottom < panelTop + 8, "planet bottom " + planetBottom + " vs panel top " + panelTop);
  }
});

test("short phone landscape gets a complete globe beside the open sidebar", () => {
  for (const [width, height] of [[844, 390], [667, 375]]) {
    const altitude = homeViewHeight(width, height);
    assert.ok(altitude > DESKTOP_HOME_HEIGHT_METRES);
    const angularRadius = Math.asin(EARTH_RADIUS_METRES / (EARTH_RADIUS_METRES + altitude));
    const minorHalfFov = Math.atan(Math.tan(Math.PI / 6) * height / width);
    const fractionOfHeight = Math.tan(angularRadius) / Math.tan(minorHalfFov);
    assert.ok(fractionOfHeight >= 0.65 && fractionOfHeight <= 0.69);
  }
});

test("invalid pre-layout viewport measurements cannot create invalid cameras", () => {
  for (const [width, height] of [[0, 800], [390, 0], [Number.NaN, 844], [-10, 100], [Infinity, 100]]) {
    assert.equal(homeViewHeight(width, height), DESKTOP_HOME_HEIGHT_METRES);
  }
});
