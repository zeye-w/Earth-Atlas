import { parseDnsFlowSnapshot, parseRootServerDataset } from '../src/internet/data.ts';
import { selectProbes, anchorPageUrl, ANCHOR_PAGE_LIMIT, ANCHOR_PAGE_SIZE, PROBE_LIMIT, type AtlasProbe } from './ripeAtlas/probes.ts';
import { parseRootSites } from './ripeAtlas/roots.ts';
import { DNS_MEASUREMENTS, buildSnapshot, type AtlasResult } from '../src/internet/dnsFlows.ts';
import { ROOT_LETTERS, type LonLat, type RootLetter, type RootInstance } from '../src/internet/types.ts';
export interface Assets {
    fetch(request: Request): Promise<Response>;
}
export interface DnsFlowsContext {
    waitUntil(promise: Promise<unknown>): void;
}
const TTL = 300000;
const ROOT_TTL = 86400000;
class RootsUnavailable extends Error {
}
const UA = 'Earth-Atlas (+https://github.com/zeye-w/Earth-Atlas)';
const COUNTRIES = ['US', 'BR', 'ZA', 'DE', 'IN', 'JP', 'AU', 'NL'];
type Entry = {
    body: string;
    at: number;
};
type EdgeCache = Pick<Cache, 'match' | 'put'>;
export function createDnsFlowsHandler(network: typeof fetch = fetch, clock = Date.now, edge?: EdgeCache, pause = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms)), probeLimit = PROBE_LIMIT) {
    const sampleLimit = Math.max(1, Math.min(200, Math.floor(probeLimit) || PROBE_LIMIT));
    let cached: Entry | undefined, pending: Promise<Entry> | undefined;
    let rootPending: Promise<RootInstance[]> | undefined;
    let locations: {
        points: Map<number, LonLat>;
        at: number;
    } | undefined;
    let rootSites: {
        at: number;
        instances: RootInstance[];
    } | undefined;
    async function json(url: string, lifetime?: AbortSignal): Promise<unknown> {
        const r = await network(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, redirect: 'error', signal: lifetime ? AbortSignal.any([lifetime, AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000) });
        if (!r.ok)
            throw Error('Upstream HTTP ' + r.status);
        const reader = r.body?.getReader();
        if (!reader)
            throw Error('Empty upstream');
        const decoder = new TextDecoder();
        let body = "";
        let size = 0;
        for (;;) {
            const { done, value } = await reader.read();
            if (done)
                break;
            size += value.length;
            if (size > 1500000) {
                await reader.cancel();
                throw Error('Oversized upstream');
            }
            body += decoder.decode(value, { stream: true });
        }
        return JSON.parse(body + decoder.decode());
    }
    async function roots(cache: EdgeCache | undefined, origin: string, ctx?: DnsFlowsContext) {
        const valid = (at: number) => Number.isFinite(at) && at <= clock() && clock() - at < ROOT_TTL;
        const key = new Request(origin + '/__atlas-cache/root-sites-v2');
        if (!rootSites) {
            try {
                const stored = await cache?.match(key);
                if (stored) {
                    const data = await stored.json() as {
                        at: number;
                        instances: unknown[];
                    };
                    if (valid(data.at)) {
                        const { instances } = parseRootServerDataset({ version: 1, instances: data.instances });
                        if (instances.length === data.instances.length && ROOT_LETTERS.every(l => instances.some(i => i.letter === l)))
                            rootSites = { at: data.at, instances };
                    }
                }
            }
            catch { /* Corrupt/missing edge data is a cache miss. */ }
        }
        const refresh = (background: boolean) => {
            rootPending ??= (async () => {
                const instances: RootInstance[] = [];
                const at = clock();
                // waitUntil has a limited post-response lifetime. Stop a background
                // attempt within 25s, retaining the old cache if upstream is slow.
                const lifetime = background ? AbortSignal.timeout(25000) : undefined;
                for (const [index, letter] of ROOT_LETTERS.entries()) {
                    if (index)
                        await pause(1000);
                    lifetime?.throwIfAborted();
                    const raw = await json(`https://root-servers.org/root/${letter.toUpperCase()}/json/`, lifetime);
                    instances.push(...parseRootSites(letter, raw));
                }
                rootSites = { at, instances };
                await cache?.put(key, new Response(JSON.stringify(rootSites), { headers: { 'Cache-Control': 'public, max-age=86400' } })).catch(() => undefined);
                return instances;
            })().finally(() => { rootPending = undefined; });
            return rootPending;
        };
        if (rootSites && valid(rootSites.at)) {
            if (clock() - rootSites.at >= 23 * 3600000 && ctx) {
                ctx.waitUntil(refresh(true).catch(() => undefined));
            }
            // Without a context, keep serving valid data and defer renewal until
            // expiry. Claude wires ctx through the hotspot entry point separately.
            return rootSites.instances;
        }
        try {
            return await refresh(false);
        }
        catch {
            throw new RootsUnavailable('Root sites unavailable');
        }
    }
    async function probes(cache: EdgeCache | undefined, origin: string) {
        if (locations && clock() - locations.at < 86400000)
            return locations.points;
        const key = new Request(origin + '/__atlas-cache/probes-v3');
        const stored = await cache?.match(key).catch(() => undefined);
        if (stored) {
            const data = await stored.json() as {
                at: number;
                points: [
                    number,
                    LonLat
                ][];
            };
            if (clock() - data.at < 86400000) {
                locations = { at: data.at, points: new Map(data.points) };
                return locations.points;
            }
        }
        const rows: AtlasProbe[] = [];
        for (let page = 1; page <= ANCHOR_PAGE_LIMIT; page++) {
            const data = await json(anchorPageUrl(page)) as {
                results?: AtlasProbe[];
                next?: unknown;
            };
            if (!Array.isArray(data.results) || data.results.length > ANCHOR_PAGE_SIZE)
                throw Error('Invalid anchor page');
            rows.push(...data.results);
            if (!data.next)
                break;
            if (page === ANCHOR_PAGE_LIMIT)
                throw Error('Anchor pagination exceeds budget');
        }
        const sample = selectProbes(rows, sampleLimit);
        const points = new Map<number, LonLat>(sample.map(p => [p.id, p.position]));
        if (!points.size)
            throw Error('No public probes');
        locations = { points, at: clock() };
        await cache?.put(key, new Response(JSON.stringify({ at: locations.at, points: [...points] }), { headers: { 'Cache-Control': 'public, max-age=86400' } })).catch(() => undefined);
        return points;
    }
    return async (request: Request, _assets?: Assets, ctx?: DnsFlowsContext): Promise<Response> => {
        if (!['GET', 'HEAD'].includes(request.method))
            return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } });
        const origin = new URL(request.url).origin;
        const cache = edge ?? (globalThis.caches as CacheStorage & {
            default?: EdgeCache;
        } | undefined)?.default;
        const key = new Request(origin + '/__atlas-cache/dns-v3');
        try {
            if (!cached) {
                const stored = await cache?.match(key).catch(() => undefined);
                if (stored) {
                    const body = await stored.text();
                    const s = parseDnsFlowSnapshot(JSON.parse(body));
                    const at = Date.parse(s.generatedAt);
                    if (Number.isFinite(at) && at <= clock())
                        cached = { body, at };
                }
            }
            // Refresh at four minutes; the last good snapshot survives failures until minute five.
            if (!cached || clock() - cached.at >= 240000) {
                pending ??= (async () => {
                    const instances = await roots(cache, origin, ctx);
                    const points = await probes(cache, origin), ids = [...points.keys()].join(',');
                    const results: Partial<Record<RootLetter, AtlasResult[]>> = {};
                    await Promise.all(Object.entries(DNS_MEASUREMENTS).map(async ([letter, id]) => {
                        const data = await json(`https://atlas.ripe.net/api/v2/measurements/${id}/latest/?probe_ids=${ids}`);
                        if (!Array.isArray(data) || data.length > sampleLimit)
                            throw Error('Invalid measurement results');
                        results[letter as RootLetter] = data;
                    }));
                    const snapshot = buildSnapshot(results, points, instances, clock());
                    if (!snapshot.flows.length)
                        throw Error('No identifiable recent DNS results');
                    const entry = { body: JSON.stringify(snapshot), at: clock() };
                    await cache?.put(key, new Response(entry.body, { headers: { 'Cache-Control': 'public, max-age=300' } })).catch(() => undefined);
                    cached = entry;
                    return entry;
                })().finally(() => { pending = undefined; });
                try {
                    await pending;
                }
                catch (error) {
                    if (error instanceof RootsUnavailable || !cached || clock() - cached.at >= TTL)
                        throw error;
                }
            }
            const age = Math.max(0, Math.floor((clock() - cached!.at) / 1000));
            return new Response(request.method === 'HEAD' ? null : cached!.body, { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': `public, max-age=${Math.max(0, 240 - age)}`, Age: String(age) } });
        }
        catch {
            return new Response(request.method === 'HEAD' ? null : JSON.stringify({ error: 'Measured DNS flows temporarily unavailable' }), { status: 503, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
        }
    };
}
export const dnsFlowsResponse = createDnsFlowsHandler();
