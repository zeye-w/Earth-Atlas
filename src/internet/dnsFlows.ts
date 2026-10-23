import { ROOT_LETTERS, type RootLetter, type RootInstance, type LonLat, type DnsFlowSnapshot } from './types.ts';
export const DNS_MEASUREMENTS: Record<RootLetter, number> = { a: 10309, b: 10310, c: 10311, d: 10312, e: 10313, f: 10304, g: 10314, h: 10315, i: 10305, j: 10316, k: 10301, l: 10308, m: 10306 };
const norm = (s: string) => s.toLowerCase().replace(/\.$/, '');
const capture = (s: string, re: RegExp) => norm(s).match(re)?.[1] ?? null;
export const parseA = (s: string) => capture(s, /^nnn\d+-([a-z]{3})\d+$/);
export const parseB = (s: string) => capture(s, /^b\d+-([a-z]{3})$/);
export const parseC = (s: string) => capture(s, /^([a-z]{3})\d+[a-z]\.c\.root-servers\.org$/);
export const parseD = (s: string) => capture(s, /^([a-z]{4})\d+\.droot\.maxgigapop\.net$/);
export const parseE = (s: string) => capture(s, /^p\d+\.([a-z]{3})\.eroot$/);
export const parseF = (s: string) => capture(s, /^([a-z]{3})(?:\d+[a-z])?\.(?:cf\.)?f\.root-servers\.org$/);
// A regional identifier does not establish a city; G only supports exact matching.
export const parseG = (_s: string): string | null => null;
export const parseH = (s: string) => capture(s, /^\d+\.([a-z]{3})\.h\.root-servers\.org$/);
export const parseI = (s: string) => capture(s, /^s\d+\.([a-z]{3})$/);
export const parseJ = (s: string) => capture(s, /^rootns-([a-z]{5})\d+$/);
export const parseK = (s: string) => capture(s, /^ns\d+\.[a-z]{2}-([a-z]{3})\.k\.ripe\.net$/);
export const parseL = (s: string) => capture(s, /^[a-z]{2}-([a-z]{3})-[a-z]+$/);
export const parseM = (s: string) => capture(s, /^m-([a-z]{3})-\d+$/);
export const identifierParsers = { a: parseA, b: parseB, c: parseC, d: parseD, e: parseE, f: parseF, g: parseG, h: parseH, i: parseI, j: parseJ, k: parseK, l: parseL, m: parseM };
const cities: Record<string, string> = { ams: 'amsterdam', amnl: 'amsterdam', amx: 'amsterdam', fra: 'frankfurt', lon: 'london', lcy: 'london', ory: 'paris', cdg: 'paris', par: 'paris', ham: 'hamburg', pmo: 'palermo', sin: 'singapore', hkg: 'hong kong', nrt: 'tokyo', tyo: 'tokyo', syd: 'sydney', lax: 'los angeles', iad: 'ashburn', gru: 'sao paulo', jnb: 'johannesburg', bom: 'mumbai', del: 'new delhi' };
function identifierPattern(pattern: string) {
    const parts = norm(pattern).split('*').map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    return new RegExp('^' + parts.join('.*') + '$');
}
export function createInstanceMatcher(instances: RootInstance[]) {
    const exact = new Map<string, Set<RootInstance>>(), byCity = new Map<string, Set<RootInstance>>();
    const patterns: { instance: RootInstance; re: RegExp }[] = [];
    const add = (map: Map<string, Set<RootInstance>>, key: string, i: RootInstance) => {
        const bucket = map.get(key) ?? new Set<RootInstance>(); bucket.add(i); map.set(key, bucket);
    };
    for (const i of instances) {
        add(byCity, i.letter + ':' + norm(i.city).normalize('NFD').replace(/[\u0300-\u036f]/g, ''), i);
        for (const p of i.identifiers) {
            if (p.includes('*')) patterns.push({ instance: i, re: identifierPattern(p) });
            else add(exact, i.letter + ':' + norm(p), i);
        }
    }
    return (letter: RootLetter, identifiers: string[]): RootInstance | null => {
        const matches = new Set<RootInstance>();
        for (const value of identifiers) {
            for (const i of exact.get(letter + ':' + norm(value)) ?? []) matches.add(i);
            for (const p of patterns) if (p.instance.letter === letter && p.re.test(norm(value))) matches.add(p.instance);
        }
        if (matches.size) return matches.size === 1 ? [...matches][0] : null;
        for (const value of identifiers) {
            const code = identifierParsers[letter](value), city = code && cities[code];
            if (city) for (const i of byCity.get(letter + ':' + city) ?? []) matches.add(i);
        }
        return matches.size === 1 ? [...matches][0] : null;
    };
}
export const matchInstance = (letter: RootLetter, identifiers: string[], instances: RootInstance[]) => createInstanceMatcher(instances)(letter, identifiers);
export interface AtlasResult {
    prb_id: number;
    msm_id: number;
    af: number;
    timestamp: number;
    result?: {
        rt?: number;
        answers?: {
            TYPE?: string;
            NAME?: string;
            RDATA?: string[];
        }[];
    };
}
export function buildSnapshot(results: Partial<Record<RootLetter, AtlasResult[]>>, probes: Map<number, LonLat>, instances: RootInstance[], now = Date.now()): DnsFlowSnapshot {
    const match = createInstanceMatcher(instances);
    const snapshot: DnsFlowSnapshot = { version: 1, generatedAt: new Date(now).toISOString(), source: { name: 'RIPE Atlas / RIPE NCC', url: 'https://atlas.ripe.net/', license: 'RIPE Atlas Service Terms and Conditions v3.5, Article 4 (commercial use requires prior permission)', retrievedAt: new Date(now).toISOString() }, examined: 0, matched: 0, flows: [] };
    for (const letter of ROOT_LETTERS)
        for (const r of results[letter] ?? []) {
            snapshot.examined++;
            const probe = probes.get(r.prb_id), rt = r.result?.rt;
            if (!probe || r.af !== 4 || r.msm_id !== DNS_MEASUREMENTS[letter] || !Number.isInteger(r.prb_id) || !Number.isFinite(rt) || rt! <= 0 || rt! > 10000 || !Number.isFinite(r.timestamp) || now - r.timestamp * 1000 > 300000 || r.timestamp * 1000 > now + 60000)
                continue;
            const identifiers = (r.result?.answers ?? []).filter(a => a.TYPE === 'TXT' && norm(a.NAME ?? '') === 'hostname.bind').flatMap(a => (a.RDATA ?? []).filter(v => typeof v === 'string'));
            const instance = match(letter, identifiers);
            if (!instance)
                continue;
            snapshot.matched++;
            if (snapshot.flows.length < 3000)
                snapshot.flows.push({ probeId: r.prb_id, probe, letter, instanceId: instance.id, instance: instance.position, rttMs: rt!, time: r.timestamp * 1000 });
        }
    return snapshot;
}
