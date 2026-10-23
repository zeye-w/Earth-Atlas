/**
 * Fails a pull request from a codex/* branch that changes a hotspot file
 * (.github/hotspots.txt) unless it carries the "hotspots-approved" label.
 * Env: HEAD_REF, BASE_SHA, LABELS (comma-separated), HOTSPOTS (path, optional).
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

export function readHotspots(text) {
  return text.split("\n").map((line) => line.trim()).filter((line) => line && !line.startsWith("#"));
}

export function hotspotChanges(changed, hotspots) {
  return changed.filter((file) => hotspots.some((spot) => (spot.endsWith("/") ? file.startsWith(spot) : file === spot)));
}

export function verdict({ headRef, labels, changed, hotspots }) {
  if (!headRef.startsWith("codex/")) return { ok: true, message: "Not a codex/* branch: ownership rules do not apply." };
  const touched = hotspotChanges(changed, hotspots);
  if (!touched.length) return { ok: true, message: "No hotspot files changed." };
  if (labels.includes("hotspots-approved")) return { ok: true, message: "Hotspot changes approved by the integrator: " + touched.join(", ") };
  return {
    ok: false,
    message: "This pull request changes files only the Claude integrator edits:\n  " + touched.join("\n  ") +
      "\nRevert them and describe the change you need in the pull request instead (docs/internet-layers.md, \"热点文件\")." +
      "\nThe integrator can allow it with the label \"hotspots-approved\".",
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const hotspots = readHotspots(readFileSync(process.env.HOTSPOTS || ".github/hotspots.txt", "utf8"));
  const changed = execFileSync("git", ["diff", "--name-only", `${process.env.BASE_SHA}...HEAD`], { encoding: "utf8" }).split("\n").filter(Boolean);
  const result = verdict({ headRef: process.env.HEAD_REF || "", labels: (process.env.LABELS || "").split(",").filter(Boolean), changed, hotspots });
  console.log(result.message);
  if (!result.ok) {
    console.log("::error title=Hotspot files changed::" + result.message.split("\n")[0]);
    process.exit(1);
  }
}
