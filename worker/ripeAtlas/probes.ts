import { isLonLat } from '../../src/internet/data.ts';
import type { LonLat } from '../../src/internet/types.ts';
export const PROBE_LIMIT = 32;
export const ANCHOR_PAGE_LIMIT = 4;
export const ANCHOR_PAGE_SIZE = 500;
export const ANCHOR_FIELDS = 'id,geometry,country_code,status,is_public,is_anchor';
export function anchorPageUrl(page: number) {
    return `https://atlas.ripe.net/api/v2/probes/?status=1&is_public=true&is_anchor=true&page_size=${ANCHOR_PAGE_SIZE}&page=${page}&fields=${ANCHOR_FIELDS}`;
}
// Six inhabited continents, with Russia in Europe and Turkey/Cyprus in Asia.
// This explicit ISO-country convention is for sampling/diagnostics, not geolocation.
const REGIONS: Record<string, string> = {
    AF: 'AO BF BI BJ BW CD CF CG CI CM CV DJ DZ EG EH ER ET GA GH GM GN GQ GW KE KM LR LS LY MA MG ML MR MU MW MZ NA NE NG RE RW SC SD SH SL SN SO SS ST SZ TD TG TN TZ UG YT ZA ZM ZW',
    AS: 'AE AF AM AZ BD BH BN BT CN CY GE HK ID IL IN IO IQ IR JO JP KG KH KP KR KW KZ LA LB LK MM MN MO MV MY NP OM PH PK PS QA SA SG SY TH TJ TL TM TR TW UZ VN YE',
    EU: 'AD AL AT AX BA BE BG BY CH CZ DE DK EE ES FI FO FR GB GG GI GR HR HU IE IM IS IT JE LI LT LU LV MC MD ME MK MT NL NO PL PT RO RS RU SE SI SJ SK SM UA VA',
    NA: 'AG AI AW BB BL BM BQ BS BZ CA CR CU CW DM DO GD GL GP GT HN HT JM KN KY LC MF MQ MS MX NI PA PM PR SV SX TC TT US VC VG VI',
    SA: 'AR BO BR CL CO EC FK GF GY PE PY SR UY VE',
    OC: 'AS AU CC CK CX FJ FM GU KI MH MP NC NF NR NU NZ PF PG PN PW SB TK TO TV UM VU WF WS',
};
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const continentByCountry = new Map(Object.entries(REGIONS).flatMap(([region, codes]) => codes.split(' ').map(code => [code, region] as const)));
export const probeContinent = (country: string) => continentByCountry.get(country) ?? 'OTHER';
export interface SampleProbe {
    id: number;
    country: string;
    position: LonLat;
}
export interface AtlasProbe {
    id: number;
    country_code?: string;
    is_public?: boolean;
    is_anchor?: boolean;
    status?: {
        id?: number;
    };
    geometry?: {
        coordinates?: unknown;
    };
}
/** Stable for any permutation of the same upstream records; no random or clock input. */
export function selectProbes(rows: AtlasProbe[], limit = PROBE_LIMIT): SampleProbe[] {
    const cap = Math.max(0, Math.min(200, Math.floor(limit)));
    if (!Number.isFinite(cap) || !cap)
        return [];
    const valid = rows.filter(p => Number.isInteger(p.id) && p.id > 0 && p.is_public === true && p.is_anchor === true && p.status?.id === 1
        && typeof p.country_code === 'string' && /^[A-Z]{2}$/.test(p.country_code) && isLonLat(p.geometry?.coordinates));
    // Deduplicate independently of response ordering, including conflicting duplicate IDs.
    valid.sort((a, b) => a.id - b.id || compare(a.country_code!, b.country_code!) || compare(JSON.stringify(a.geometry!.coordinates), JSON.stringify(b.geometry!.coordinates)));
    const byCountry = new Map<string, Map<string, SampleProbe[]>>();
    const seen = new Set<number>();
    for (const p of valid) {
        if (seen.has(p.id))
            continue;
        seen.add(p.id);
        const [lon, lat] = p.geometry!.coordinates as LonLat;
        const country = p.country_code!;
        const grid = `${Math.floor((lon + 180) / 10)}:${Math.floor((lat + 90) / 10)}`;
        const cells = byCountry.get(country) ?? new Map<string, SampleProbe[]>();
        const cell = cells.get(grid) ?? [];
        cell.push({ id: p.id, country, position: [Math.round(lon * 100) / 100, Math.round(lat * 100) / 100] });
        cells.set(grid, cell);
        byCountry.set(country, cells);
    }
    // One per grid before a country's second round of cells; ascending ID within a cell.
    const queues = new Map<string, SampleProbe[]>();
    for (const [country, cells] of byCountry) {
        const buckets = [...cells].sort(([a], [b]) => compare(a, b)).map(([, v]) => v);
        const queue: SampleProbe[] = [];
        for (let round = 0; buckets.some(b => round < b.length); round++)
            for (const b of buckets)
                if (b[round])
                    queue.push(b[round]);
        queues.set(country, queue);
    }
    const regions = Object.keys(REGIONS).concat('OTHER');
    const nations = regions.map(region => [...queues.keys()].filter(c => probeContinent(c) === region).sort());
    const countryOrder: string[] = [];
    for (let round = 0; nations.some(n => round < n.length); round++)
        for (const n of nations)
            if (n[round])
                countryOrder.push(n[round]);
    const sample: SampleProbe[] = [];
    for (let round = 0; sample.length < cap && countryOrder.some(c => round < queues.get(c)!.length); round++)
        for (const c of countryOrder) {
            const p = queues.get(c)![round];
            if (p)
                sample.push(p);
            if (sample.length === cap)
                break;
        }
    return sample;
}
