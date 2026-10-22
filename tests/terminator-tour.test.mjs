import { test } from "node:test";
import assert from "node:assert/strict";
import { terminatorPosition, localSolarTime } from "../src/terminatorTour.ts";
import { subsolarPoint, solarElevation } from "../src/solar.ts";
test("tour points stay on geometric horizon in all seasons and on correct side", () => {
  for (const date of ["2026-03-20", "2026-06-21", "2026-09-23", "2026-12-21"]) {
    const t = Date.parse(date + "T12:00:00Z"),
      sun = subsolarPoint(new Date(t));
    for (const side of ["sunrise", "sunset"])
      for (let i = 0; i < 120; i++) {
        const p = terminatorPosition(t, (i / 120) * Math.PI * 2, side);
        assert.ok(
          Math.abs(solarElevation(p.latitude, p.longitude, sun)) < 1e-6,
        );
        const after = solarElevation(
          p.latitude,
          p.longitude,
          subsolarPoint(new Date(t + 60000)),
        );
        assert.ok(side === "sunrise" ? after > 0 : after < 0);
        assert.ok(Number.isFinite(p.longitude) && Math.abs(p.latitude) <= 90);
      }
  }
});
test("path is periodic and local solar time wraps across dates", () => {
  const t = Date.parse("2026-10-22T00:00:00Z");
  const a = terminatorPosition(t, 0, "sunrise"),
    b = terminatorPosition(t, Math.PI * 2, "sunrise");
  assert.ok(Math.abs(a.latitude - b.latitude) < 1e-10);
  assert.equal(localSolarTime(t, 180), "12:00");
  assert.equal(localSolarTime(t, -15), "23:00");
});
