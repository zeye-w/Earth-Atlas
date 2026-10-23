import { setTimeout as sleep } from 'node:timers/promises';

export const USER_AGENT = 'Earth-Atlas data builder (+https://github.com/zeye-w/Earth-Atlas)';
let lastRequest = 0;
export async function getJson(url, headers = {}) {
  for (let attempt = 0; attempt < 4; attempt++) {
    await sleep(Math.max(0, 1000 - (Date.now() - lastRequest)));
    lastRequest = Date.now();
    try {
      const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', ...headers }, signal: AbortSignal.timeout(60000) });
      if (!response.ok) {
        if (response.status !== 429 && response.status < 500) throw Object.assign(new Error(`${url}: HTTP ${response.status}`), { permanent: true });
        const retryAfter = response.headers.get('retry-after');
        const seconds = Number(retryAfter);
        const delay = retryAfter ? (Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retryAfter) - Date.now()) : 0;
        if (Number.isFinite(delay) && delay > 120000) throw Object.assign(new Error(`${url}: Retry-After exceeds bounded retry budget`), { permanent: true });
        await sleep(Math.max(0, delay || 0));
        throw new Error(`${url}: HTTP ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      if (error.permanent || attempt === 3) throw error;
      await sleep(2000 * 2 ** attempt);
    }
  }
}

export async function peeringList(tag) {
  const rows = [], ids = new Set();
  let url = `https://www.peeringdb.com/api/${tag}?limit=1000&skip=0&depth=0`;
  for (let page = 0; url && page < 200; page++) {
    const json = await getJson(url, process.env.PEERINGDB_API_KEY ? { Authorization: `Api-Key ${process.env.PEERINGDB_API_KEY}` } : {});
    if (!Array.isArray(json.data)) throw new Error(`PeeringDB ${tag}: missing data`);
    for (const row of json.data) {
      if (ids.has(row.id)) throw new Error(`PeeringDB ${tag}: repeated id; pagination failed`);
      ids.add(row.id); rows.push(row);
    }
    console.log(`PeeringDB ${tag}: ${rows.length} records fetched`);
    const next = json.meta?.next;
    if (next) {
      const target = new URL(next, url);
      if (target.origin !== 'https://www.peeringdb.com' || target.pathname !== `/api/${tag}` && target.pathname !== `/api/${tag}/`) throw new Error('Unexpected pagination origin/path');
      url = target.href;
    } else url = json.data.length === 1000 ? `https://www.peeringdb.com/api/${tag}?limit=1000&skip=${rows.length}&depth=0` : null;
  }
  if (url) throw new Error(`PeeringDB ${tag}: pagination limit exceeded`);
  return rows.filter(row => row.status === 'ok');
}
