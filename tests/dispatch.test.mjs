import test from "node:test";
import assert from "node:assert/strict";
import { dispatchWorkflow, dueWorkflows, runSchedule } from "../worker/dispatch.ts";

const at = (iso) => Date.parse(iso);

test("the flight snapshot is due every tick; the two-hourly and weather jobs on their own ticks", () => {
  assert.deepEqual(dueWorkflows(at("2026-11-06T03:00:00Z")), ["flight-data.yml"]);
  assert.deepEqual(dueWorkflows(at("2026-11-06T02:45:00Z")), ["flight-data.yml", "launch-data.yml"]);
  assert.deepEqual(dueWorkflows(at("2026-11-06T03:15:00Z")), ["flight-data.yml", "site-health.yml"]);
  assert.deepEqual(dueWorkflows(at("2026-11-06T04:15:00Z")), ["flight-data.yml", "weather-data.yml"]);
  // A tick a few seconds late still counts as its slot.
  assert.deepEqual(dueWorkflows(at("2026-11-06T02:45:07Z")), ["flight-data.yml", "launch-data.yml"]);
  // Over a day: 96 flight runs, 12 launch, 12 health, 4 weather.
  const day = Array.from({ length: 96 }, (_, i) => dueWorkflows(at("2026-11-06T00:00:00Z") + i * 15 * 60_000)).flat();
  const count = (w) => day.filter((x) => x === w).length;
  assert.deepEqual([count("flight-data.yml"), count("launch-data.yml"), count("site-health.yml"), count("weather-data.yml")], [96, 12, 12, 4]);
});

test("a dispatch posts to the workflow's dispatches endpoint on main with the token", async () => {
  let call;
  const network = async (url, init) => { call = { url, init }; return new Response(null, { status: 204 }); };
  assert.equal(await dispatchWorkflow("t0ken", "flight-data.yml", network), "flight-data.yml: started");
  assert.equal(call.url, "https://api.github.com/repos/zeye-w/Earth-Atlas/actions/workflows/flight-data.yml/dispatches");
  assert.equal(call.init.method, "POST");
  assert.equal(new Headers(call.init.headers).get("authorization"), "Bearer t0ken");
  assert.deepEqual(JSON.parse(call.init.body), { ref: "main" });
  await assert.rejects(dispatchWorkflow("bad", "flight-data.yml", async () => new Response('{"message":"Bad credentials"}', { status: 401 })), /flight-data\.yml: HTTP 401 .*Bad credentials/);
});

test("the cron tick sends nothing without the token, and one failure does not stop the others", async () => {
  let calls = 0;
  const counting = async () => { calls++; return new Response(null, { status: 204 }); };
  assert.deepEqual(await runSchedule(at("2026-11-06T03:15:00Z"), {}, counting), []);
  assert.equal(calls, 0);
  const flaky = async (url) => (String(url).includes("flight-data") ? new Response("boom", { status: 500 }) : new Response(null, { status: 204 }));
  const lines = await runSchedule(at("2026-11-06T03:15:00Z"), { GITHUB_DISPATCH_TOKEN: " t " }, flaky);
  assert.deepEqual(lines, ["flight-data.yml: HTTP 500 boom", "site-health.yml: started"]);
});
