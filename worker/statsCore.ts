/**
 * Anonymous usage statistics: what the client may send, how it is stored
 * (Cloudflare D1, i.e. SQLite) and the queries behind /admin. Pure, so the
 * same SQL is tested against SQLite in tests/stats.test.mjs.
 *
 * Stored per event: a random visitor ID (no personal data), a per-tab session
 * ID, the event name and one short detail, UI language, device class, country
 * (from Cloudflare, two letters) and the referring site's host name. No IP
 * address, user agent, URL or coordinates are kept.
 */

export const EVENT_NAMES = ["view", "ping", "layer", "show", "share", "tour", "live_photo", "search"] as const;
export type EventName = (typeof EVENT_NAMES)[number];
export const DEVICES = ["phone", "tablet", "desktop"] as const;

export interface StatsEvent { name: EventName; detail: string }
export interface StatsBatch {
  visitor: string; session: string; isNew: boolean;
  lang: "en" | "zh"; device: (typeof DEVICES)[number]; referrer: string; events: StatsEvent[];
}

const ID = /^[a-z0-9-]{8,40}$/;
const DETAIL = /^[A-Za-z0-9_.:-]{0,40}$/;
export const MAX_EVENTS = 20;
export const MAX_BODY_BYTES = 4096;
/** Rows older than this are deleted (see pruneSql). */
export const KEEP_DAYS = 400;

/** Validate a client batch; anything unexpected rejects the whole batch. */
export function parseBatch(json: unknown): StatsBatch | null {
  if (!json || typeof json !== "object") return null;
  const b = json as Record<string, unknown>;
  if (typeof b.visitor !== "string" || !ID.test(b.visitor) || typeof b.session !== "string" || !ID.test(b.session)) return null;
  if (b.lang !== "en" && b.lang !== "zh") return null;
  if (typeof b.device !== "string" || !(DEVICES as readonly string[]).includes(b.device)) return null;
  if (!Array.isArray(b.events) || b.events.length === 0 || b.events.length > MAX_EVENTS) return null;
  const events: StatsEvent[] = [];
  for (const e of b.events) {
    if (!e || typeof e !== "object") return null;
    const { name, detail = "" } = e as Record<string, unknown>;
    if (typeof name !== "string" || !(EVENT_NAMES as readonly string[]).includes(name)) return null;
    if (typeof detail !== "string" || !DETAIL.test(detail)) return null;
    events.push({ name: name as EventName, detail });
  }
  return {
    visitor: b.visitor, session: b.session, isNew: b.isNew === true,
    lang: b.lang, device: b.device as StatsBatch["device"], referrer: referrerHost(b.referrer), events,
  };
}

/** Only the referring site's host name, never its path; "" for none or ourselves. */
export function referrerHost(value: unknown, self?: string): string {
  if (typeof value !== "string" || value.length > 300) return "";
  try {
    const host = new URL(value).hostname.toLowerCase().replace(/^www\./, "");
    return host && host !== self && /^[a-z0-9.-]{1,80}$/.test(host) ? host : "";
  } catch { return ""; }
}

export function country(value: unknown): string {
  return typeof value === "string" && /^[A-Z]{2}$/.test(value) ? value : "";
}

export const SCHEMA_SQL = [
  `CREATE TABLE IF NOT EXISTS events (
    ts INTEGER NOT NULL, day TEXT NOT NULL, visitor TEXT NOT NULL, session TEXT NOT NULL,
    name TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', is_new INTEGER NOT NULL DEFAULT 0,
    lang TEXT NOT NULL DEFAULT '', device TEXT NOT NULL DEFAULT '', country TEXT NOT NULL DEFAULT '', referrer TEXT NOT NULL DEFAULT '')`,
  "CREATE INDEX IF NOT EXISTS events_day ON events(day, name)",
  "CREATE INDEX IF NOT EXISTS events_visitor ON events(visitor, day)",
];

export const INSERT_SQL = "INSERT INTO events (ts, day, visitor, session, name, detail, is_new, lang, device, country, referrer) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
export const PRUNE_SQL = "DELETE FROM events WHERE day < ?";

export function insertRows(batch: StatsBatch, now: number, countryCode: string): unknown[][] {
  const day = new Date(now).toISOString().slice(0, 10);
  return batch.events.map((e, i) => [
    now + i, day, batch.visitor, batch.session, e.name, e.detail,
    // Only a first view marks a new visitor.
    batch.isNew && e.name === "view" ? 1 : 0, batch.lang, batch.device, countryCode, i === 0 ? batch.referrer : "",
  ]);
}

export function dayString(time: number): string { return new Date(time).toISOString().slice(0, 10); }
export function shiftDay(day: string, days: number): string { return dayString(Date.parse(day + "T00:00:00Z") + days * 86_400_000); }

/** One minute of active time per heartbeat (sent every 60 s while the tab is visible). */
export const PING_MINUTES = 1;

/**
 * Queries for the dashboard, all over [from, to] (inclusive UTC days).
 * "Active" means the visitor sent any event that day.
 */
export const SUMMARY_SQL = {
  daily: `SELECT day,
      COUNT(DISTINCT visitor) AS users,
      COUNT(DISTINCT CASE WHEN is_new = 1 THEN visitor END) AS new_users,
      COUNT(DISTINCT session) AS sessions,
      SUM(name = 'view') AS views,
      SUM(name = 'ping') * ${PING_MINUTES} AS active_minutes
    FROM events WHERE day BETWEEN ?1 AND ?2 GROUP BY day ORDER BY day`,
  totals: `SELECT COUNT(DISTINCT visitor) AS users,
      COUNT(DISTINCT CASE WHEN is_new = 1 THEN visitor END) AS new_users,
      COUNT(DISTINCT session) AS sessions,
      SUM(name = 'view') AS views,
      SUM(name = 'ping') * ${PING_MINUTES} AS active_minutes
    FROM events WHERE day BETWEEN ?1 AND ?2`,
  /** Distinct active visitors in the 7 and 30 days ending ?2. */
  wauMau: `SELECT
      COUNT(DISTINCT CASE WHEN day > ?1 THEN visitor END) AS wau,
      COUNT(DISTINCT visitor) AS mau
    FROM events WHERE day > ?3 AND day <= ?2`,
  /** For visitors first seen in [from, to]: how many came back 1 and 7 days later. */
  retention: `WITH first AS (
      SELECT visitor, MIN(day) AS d0 FROM events WHERE is_new = 1 GROUP BY visitor
    )
    SELECT COUNT(*) AS cohort,
      SUM(EXISTS (SELECT 1 FROM events e WHERE e.visitor = f.visitor AND e.day = date(f.d0, '+1 day'))) AS day1,
      SUM(EXISTS (SELECT 1 FROM events e WHERE e.visitor = f.visitor AND e.day = date(f.d0, '+7 day'))) AS day7,
      SUM(date(f.d0, '+1 day') <= ?3) AS day1_eligible,
      SUM(date(f.d0, '+7 day') <= ?3) AS day7_eligible
    FROM first f WHERE f.d0 BETWEEN ?1 AND ?2`,
  features: `SELECT name, detail, COUNT(*) AS uses, COUNT(DISTINCT visitor) AS users
    FROM events WHERE day BETWEEN ?1 AND ?2 AND name NOT IN ('view', 'ping')
    GROUP BY name, detail ORDER BY users DESC, uses DESC LIMIT 30`,
  breakdown: `SELECT ?3 AS dimension, value, COUNT(DISTINCT visitor) AS users FROM (
      SELECT visitor, CASE ?3 WHEN 'lang' THEN lang WHEN 'device' THEN device WHEN 'country' THEN country ELSE referrer END AS value
      FROM events WHERE day BETWEEN ?1 AND ?2 AND name = 'view'
    ) WHERE value != '' GROUP BY value ORDER BY users DESC LIMIT 12`,
} as const;
export const BREAKDOWNS = ["lang", "device", "country", "referrer"] as const;
