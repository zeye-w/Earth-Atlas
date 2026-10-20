import assert from "node:assert/strict";
import { test } from "node:test";
import { FUTURE_MS, PLAY_RATE, SPAN_MS, STEP_MS, TimeController, clampTime, formatTime, relativeTime, timeRange } from "../src/timeline.ts";

const NOW = Date.UTC(2026, 9, 20, 12, 0);
const HOUR = 3_600_000;

function controller(initial = {}) {
  let now = NOW;
  const c = new TimeController(initial, () => now);
  return { c, advanceClock: (ms) => { now += ms; } };
}

test("range covers the span back and one day ahead, and clamps", () => {
  assert.deepEqual(timeRange("week", NOW), { start: NOW - SPAN_MS.week, end: NOW + FUTURE_MS });
  assert.equal(clampTime(NOW - 40 * 24 * HOUR, "month", NOW), NOW - SPAN_MS.month);
  assert.equal(clampTime(NOW + 5 * 24 * HOUR, "day", NOW), NOW + FUTURE_MS);
});

test("labels", () => {
  assert.equal(formatTime(NOW), "2026-10-20 12:00 UTC");
  assert.equal(relativeTime(NOW, NOW), "现在");
  assert.equal(relativeTime(NOW - 30 * HOUR, NOW), "1 天 6 小时前");
  assert.equal(relativeTime(NOW + 3 * HOUR, NOW), "3 小时后");
  assert.equal(relativeTime(NOW - 25 * 60_000, NOW), "25 分钟前");
});

test("starts live, or at a shared moment", () => {
  assert.equal(controller().c.getState().live, true);
  const { c } = controller({ time: NOW - 5 * HOUR, span: "day" });
  assert.deepEqual(c.getState(), { live: false, playing: false, time: NOW - 5 * HOUR, span: "day" });
});

test("moving the time leaves live; moving back to the present returns to it", () => {
  const { c } = controller();
  const seen = [];
  c.subscribe((state) => seen.push(state.live));
  c.step(-1);
  assert.equal(c.getState().time, NOW - STEP_MS.week);
  assert.equal(c.getState().live, false);
  c.setTime(NOW + 20_000);
  assert.equal(c.getState().live, true);
  assert.deepEqual(seen, [false, true]);
});

test("changing the span keeps the time inside the new range", () => {
  const { c } = controller({ time: NOW - 5 * 24 * HOUR, span: "week" });
  c.setSpan("day");
  assert.equal(c.getState().time, NOW - SPAN_MS.day);
});

test("replay starts at the range start from live and returns to live at the present", () => {
  const { c, advanceClock } = controller({ span: "day" });
  c.play();
  try {
    assert.equal(c.getState().time, NOW - SPAN_MS.day);
    assert.equal(c.getState().playing, true);
    advanceClock(100);
    c.advance();
    assert.equal(c.getState().time, NOW - SPAN_MS.day + 100 * PLAY_RATE.day);
    // Large real gaps (a hidden tab) are capped, so the replay does not jump.
    advanceClock(10_000);
    c.advance();
    assert.equal(c.getState().time, NOW - SPAN_MS.day + 350 * PLAY_RATE.day);
    for (let i = 0; i < 200 && c.getState().playing; i++) { advanceClock(250); c.advance(); }
    assert.equal(c.getState().live, true);
    assert.equal(c.getState().playing, false);
  } finally {
    c.pause();
  }
});

test("replay from a past moment continues from there", () => {
  const { c } = controller({ time: NOW - 3 * 24 * HOUR, span: "week" });
  c.play();
  assert.equal(c.getState().time, NOW - 3 * 24 * HOUR);
  c.pause();
  assert.equal(c.getState().playing, false);
});
