import assert from "node:assert/strict";
import { test } from "node:test";
import { analyticsAllowed, deviceClass, safeDetail } from "../src/analytics.ts";

const live = { production: true, recording: false, host: "earth-atlas.example", optedOut: false, doNotTrack: false, globalPrivacyControl: false };

test("statistics are sent only from the live site and never against a privacy signal", () => {
  assert.equal(analyticsAllowed(live), true);
  for (const off of [{ production: false }, { recording: true }, { optedOut: true }, { doNotTrack: true }, { globalPrivacyControl: true },
    { host: "localhost" }, { host: "127.0.0.1" }, { host: "mac.local" }]) {
    assert.equal(analyticsAllowed({ ...live, ...off }), false, JSON.stringify(off));
  }
});

test("device class comes from the viewport and pointer, not the user agent", () => {
  assert.equal(deviceClass(390, 844, true), "phone");
  assert.equal(deviceClass(844, 390, true), "phone");
  assert.equal(deviceClass(768, 1024, true), "tablet");
  assert.equal(deviceClass(1440, 900, false), "desktop");
});

test("event details keep identifiers only", () => {
  assert.equal(safeDetail("clouds"), "clouds");
  assert.equal(safeDetail("北京 39.9,116.4 <b>"), "39.9116.4b");
  assert.equal(safeDetail("x".repeat(80)).length, 40);
});
