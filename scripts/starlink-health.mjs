import { parseOmmCsv, epochOf, CONSTELLATION_CACHE_MS, CONSTELLATION_MAX_ELEMENT_AGE_DAYS } from '../src/constellationData.ts';

// Share successful downloads across both schedulers. A denied request is never
// evidence of healthy data; only a recent, validated previous download can help.
export async function checkStarlink({ read, write, request, now = Date.now() }) {
  const validate = text => {
    const records = parseOmmCsv(text);
    if (records.length < 1000) throw new Error('only ' + records.length + ' satellites');
    const recent = records.filter(r => {
      const age = now - epochOf(r).getTime();
      return age >= -60_000 && age <= CONSTELLATION_MAX_ELEMENT_AGE_DAYS * 86400000;
    });
    if (recent.length < 1000) throw new Error('fewer than 1000 usable recent satellite elements');
    return records.length;
  };
  let cached, previous;
  try {
    const value = await read();
    previous = value;
    if (Number.isFinite(value.at) && value.at <= now && now - value.at < CONSTELLATION_CACHE_MS) {
      cached = { ...value, count: validate(value.text) };
    }
  } catch { /* Missing or corrupt cache must not pass the check. */ }
  if (cached) return `${cached.count} satellites (validated cache, ${Math.floor((now - cached.at) / 60000)} min old; no upstream download)`;
  if (Number.isFinite(previous?.attemptAt) && previous.attemptAt <= now && now - previous.attemptAt < CONSTELLATION_CACHE_MS) {
    throw new Error('CelesTrak download cooldown: last attempt was less than 2 hours ago; no recent validated cache');
  }
  await write({ ...previous, attemptAt: now });
  const response = await request();
  if (!response.ok) throw new Error(`CelesTrak HTTP ${response.status}; no recent validated cache; next scheduled run will retry`);
  const text = await response.text();
  const count = validate(text);
  await write({ at: now, attemptAt: now, text });
  return count + ' satellites (fresh download)';
}
