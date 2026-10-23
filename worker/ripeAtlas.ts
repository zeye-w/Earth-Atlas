import { parseDnsFlowSnapshot, parseRootServerDataset, isLonLat } from '../src/internet/data.ts';
import { parseRootSites } from './ripeAtlas/roots.ts';
import { DNS_MEASUREMENTS, buildSnapshot, type AtlasResult } from '../src/internet/dnsFlows.ts';
import { ROOT_LETTERS, type LonLat, type RootLetter, type RootInstance } from '../src/internet/types.ts';
export interface Assets {
    fetch(request: Request): Promise<Response>;
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
type Probe = {
    id: number;
    geometry?: {
        coordinates?: unknown;
    };
    is_public?: boolean;
};
type EdgeCache = Pick<Cache, 'match' | 'put'>;
export function createDnsFlowsHandler(network: typeof fetch = fetch, clock = Date.now, edge?: EdgeCache, pause = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))) {
    let cached: Entry | undefined, pending: Promise<Entry> | undefined;
    let locations: {
        points: Map<number, LonLat>;
        at: number;
    } | undefined;
    let rootSites: {
        at: number;
        instances: RootInstance[];
    } | undefined;
    async function json(url: string): Promise<unknown> {
        const r = await network(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(8000) });
        if (!r.ok)
            throw Error('Upstream HTTP ' + r.status);
        const reader = r.body?.getReader();
        if (!reader)
            throw Error('Empty upstream');
        const chunks: Uint8Array[] = [];
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
            chunks.push(value);
        }
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
            bytes.set(chunk, offset);
            offset += chunk.length;
        }
        return JSON.parse(new TextDecoder().decode(bytes));
    }
    async function roots(cache: EdgeCache | undefined, origin: string) {
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
        // Try a refresh one hour before expiry; a failure can still use the original data.
        if (rootSites && valid(rootSites.at) && clock() - rootSites.at < 23 * 3600000)
            return rootSites.instances;
        try {
            const instances: RootInstance[] = [];
            const at = clock();
            // Avoid a burst to one upstream and stay below the six-open-connection limit.
            for (const [index, letter] of ROOT_LETTERS.entries()) {
                if (index)
                    await pause(1000);
                const raw = await json(`https://root-servers.org/root/${letter.toUpperCase()}/json/`);
                const sites = parseRootSites(letter, raw);
                instances.push(...sites);
            }
            rootSites = { at, instances };
            await cache?.put(key, new Response(JSON.stringify(rootSites), { headers: { 'Cache-Control': 'public, max-age=86400' } })).catch(() => undefined);
            return instances;
        }
        catch {
            if (rootSites && valid(rootSites.at))
                return rootSites.instances;
            throw new RootsUnavailable('Root sites unavailable');
        }
    }
    async function probes(cache: EdgeCache | undefined, origin: string) {
        if (locations && clock() - locations.at < 86400000)
            return locations.points;
        const key = new Request(origin + '/__atlas-cache/probes-v2');
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
        const pages = await Promise.all(COUNTRIES.map(async (c) => {
            const p = await json(`https://atlas.ripe.net/api/v2/probes/?status=1&is_public=true&country_code=${c}&page_size=6`) as {
                results?: Probe[];
            };
            if (!Array.isArray(p.results))
                throw Error('Invalid probe list');
            return p.results.filter(p => p.is_public !== false && Number.isInteger(p.id) && isLonLat(p.geometry?.coordinates));
        }));
        const points = new Map<number, LonLat>();
        for (let i = 0; i < 6; i++)
            for (const page of pages) {
                const p = page[i];
                if (p)
                    points.set(p.id, (p.geometry!.coordinates as LonLat).map(v => Math.round(v * 100) / 100) as LonLat);
            }
        if (!points.size)
            throw Error('No public probes');
        locations = { points, at: clock() };
        await cache?.put(key, new Response(JSON.stringify({ at: locations.at, points: [...points] }), { headers: { 'Cache-Control': 'public, max-age=86400' } })).catch(() => undefined);
        return points;
    }
    return async (request: Request, _assets?: Assets): Promise<Response> => {
        if (!['GET', 'HEAD'].includes(request.method))
            return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } });
        const origin = new URL(request.url).origin;
        const cache = edge ?? (globalThis.caches as CacheStorage & {
            default?: EdgeCache;
        } | undefined)?.default;
        const key = new Request(origin + '/__atlas-cache/dns-v2');
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
                    const instances = await roots(cache, origin);
                    const points = await probes(cache, origin), ids = [...points.keys()].join(',');
                    const results: Partial<Record<RootLetter, AtlasResult[]>> = {};
                    await Promise.all(Object.entries(DNS_MEASUREMENTS).map(async ([letter, id]) => {
                        const data = await json(`https://atlas.ripe.net/api/v2/measurements/${id}/latest/?probe_ids=${ids}`);
                        if (!Array.isArray(data) || data.length > 48)
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
