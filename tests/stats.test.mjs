import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { parseBatch, referrerHost } from "../worker/statsCore.ts";
import { collectStats, statsSummary } from "../worker/stats.ts";

/** A minimal D1 stand-in on SQLite (D1 is SQLite), so the real SQL runs. */
function fakeD1() {
  const db = new DatabaseSync(":memory:");
  const statement = (sql, args = []) => ({
    bind: (...values) => statement(sql, values),
    run: async () => db.prepare(sql).run(...args),
    all: async () => ({ results: db.prepare(sql).all(...args).map((row) => ({ ...row })) }),
    first: async () => { const row = db.prepare(sql).get(...args); return row ? { ...row } : null; },
  });
  return { db, prepare: (sql) => statement(sql), batch: async (list) => { for (const s of list) await s.run(); } };
}
const batch = (over = {}) => ({ visitor: "visitor-aaaa", session: "session-1111", isNew: true, lang: "en", device: "phone", referrer: "https://www.example.org/path?q=1", events: [{ name: "view" }], ...over });

test("only well-formed batches are accepted", () => {
  const ok = parseBatch(batch({ events: [{ name: "view" }, { name: "layer", detail: "clouds" }] }));
  assert.equal(ok.referrer, "example.org");
  assert.equal(ok.events[1].detail, "clouds");
  for (const bad of [null, "x", batch({ visitor: "a" }), batch({ lang: "fr" }), batch({ device: "tv" }), batch({ events: [] }),
    batch({ events: [{ name: "drop table" }] }), batch({ events: [{ name: "layer", detail: "<script>" }] }),
    batch({ events: Array.from({ length: 21 }, () => ({ name: "ping" })) })]) {
    assert.equal(parseBatch(bad), null, JSON.stringify(bad)?.slice(0, 80));
  }
  assert.equal(referrerHost("not a url"), "");
  assert.equal(referrerHost("https://earth.example/x", "earth.example"), "");
});

async function post(env, body, cf = { country: "DE" }) {
  const pending = [];
  const request = new Request("https://earth.example/api/stats/collect", { method: "POST", body: JSON.stringify(body) });
  request.cf = cf;
  const response = await collectStats(request, env, { waitUntil: (p) => pending.push(p) });
  await Promise.all(pending);
  return response;
}

test("collection stores anonymous rows and is a no-op without a database", async () => {
  assert.equal((await post({}, batch())).status, 204);
  const STATS = fakeD1();
  assert.equal((await post({ STATS }, { nope: 1 })).status, 400);
  assert.equal((await post({ STATS }, batch({ events: [{ name: "view" }, { name: "layer", detail: "clouds" }] }))).status, 204);
  const rows = STATS.db.prepare("SELECT * FROM events ORDER BY ts").all();
  assert.equal(rows.length, 2);
  assert.deepEqual([rows[0].name, rows[0].is_new, rows[0].country, rows[0].referrer], ["view", 1, "DE", "example.org"]);
  assert.deepEqual([rows[1].name, rows[1].detail, rows[1].is_new, rows[1].referrer], ["layer", "clouds", 0, ""]);
  assert.ok(!Object.keys(rows[0]).some((k) => /ip|agent|url/i.test(k)), "no IP, user agent or URL column");
});

test("the dashboard needs the token and reports users, activity, retention and features", async () => {
  const STATS = fakeD1();
  const env = { STATS, STATS_TOKEN: "s3cret" };
  const ask = (token) => statsSummary(new Request("https://earth.example/api/stats/summary?days=30", token ? { headers: { Authorization: "Bearer " + token } } : {}), env);
  assert.equal((await ask()).status, 401);
  assert.equal((await ask("wrong")).status, 401);
  assert.equal((await statsSummary(new Request("https://x/api/stats/summary"), { STATS })).status, 503);
  await post(env, batch());
  // Seed history directly: A first seen 10 days ago and back the next day; B first seen 10 days ago only.
  const day = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
  const insert = STATS.db.prepare("INSERT INTO events (ts, day, visitor, session, name, detail, is_new, lang, device, country, referrer) VALUES (0, ?, ?, ?, ?, ?, ?, ?, ?, ?, '')");
  insert.run(day(10), "visitor-a", "s-a1", "view", "", 1, "zh", "desktop", "CN");
  insert.run(day(10), "visitor-a", "s-a1", "ping", "", 0, "zh", "desktop", "CN");
  insert.run(day(10), "visitor-a", "s-a1", "show", "rocket", 0, "zh", "desktop", "CN");
  insert.run(day(9), "visitor-a", "s-a2", "view", "", 0, "zh", "desktop", "CN");
  insert.run(day(10), "visitor-b", "s-b1", "view", "", 1, "en", "phone", "US");
  const response = await ask("s3cret");
  assert.equal(response.status, 200);
  const s = await response.json();
  assert.equal(s.totals.users, 3);
  assert.equal(s.totals.new_users, 3);
  assert.equal(s.totals.sessions, 4);
  assert.equal(s.totals.active_minutes, 1);
  assert.equal(s.activity.wau, 1);
  assert.equal(s.activity.mau, 3);
  // Cohort: A and B (eligible for day 1 and day 7) plus today's visitor (not yet eligible).
  assert.equal(s.retention.cohort, 3);
  assert.equal(s.retention.day1_eligible, 2);
  assert.equal(s.retention.day1, 1);
  assert.equal(s.retention.day7, 0);
  assert.deepEqual(s.features.map((f) => [f.name, f.detail, f.users]), [["show", "rocket", 1]]);
  assert.deepEqual(Object.fromEntries(s.breakdowns.lang.map((r) => [r.value, r.users])), { en: 2, zh: 1 });
  assert.equal(s.daily.find((d) => d.day === day(10)).users, 2);
});
