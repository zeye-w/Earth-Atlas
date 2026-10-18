import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const required = [
  "index.html",
  "cesium/Workers/transferTypedArrayTest.js",
  "cesium/Workers/createVerticesFromHeightmap.js",
  "cesium/Workers/createTaskProcessorWorker.js",
  "cesium/Assets/approximateTerrainHeights.json",
];
let failed = false;
for (const name of required) {
  const path = join("dist", name);
  if (!existsSync(path)) {
    console.error("MISSING static asset: " + path);
    failed = true;
    continue;
  }
  const bytes = statSync(path).size;
  const header = readFileSync(path, { encoding: "utf8", flag: "r" }).slice(0, 200).trimStart();
  if (bytes < 5 || (name.endsWith(".js") || name.endsWith(".json")) && /^(?:<!doctype|<html)/i.test(header)) {
    console.error("INVALID static asset: " + path);
    failed = true;
  } else {
    console.log("OK " + path + " (" + bytes + " bytes)");
  }
}
if (failed) process.exitCode = 1;
else console.log("Cesium worker and runtime assets are present in dist/.");
