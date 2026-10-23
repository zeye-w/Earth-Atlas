import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { hotspotChanges, readHotspots, verdict } from "../scripts/check-hotspots.mjs";

const hotspots = readHotspots(readFileSync(new URL("../.github/hotspots.txt", import.meta.url), "utf8"));

test("the hotspot list covers the shared files and directories", () => {
  for (const file of ["src/App.tsx", "src/internet/types.ts", "worker/index.ts", "package.json"]) assert.ok(hotspots.includes(file), file);
  assert.deepEqual(hotspotChanges(["tests/e2e/fixtures/internet/cables.json", "src/internet/flowMaterial.ts"], hotspots), ["tests/e2e/fixtures/internet/cables.json"]);
});

test("codex branches may not touch hotspots unless the integrator approves", () => {
  const changed = ["scripts/internet/build.mjs", "src/App.tsx"];
  assert.equal(verdict({ headRef: "codex/internet-ui", labels: [], changed, hotspots }).ok, false);
  assert.match(verdict({ headRef: "codex/internet-ui", labels: [], changed, hotspots }).message, /src\/App\.tsx/);
  assert.equal(verdict({ headRef: "codex/internet-ui", labels: ["hotspots-approved"], changed, hotspots }).ok, true);
  assert.equal(verdict({ headRef: "codex/internet-ui", labels: [], changed: ["scripts/internet/build.mjs"], hotspots }).ok, true);
  assert.equal(verdict({ headRef: "claude/internet-polish", labels: [], changed, hotspots }).ok, true);
});
