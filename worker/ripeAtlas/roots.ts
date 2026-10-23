import type { RootInstance, RootLetter } from '../../src/internet/types.ts';
import { isLonLat } from '../../src/internet/data.ts';
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
/** Preserve only actual upstream identifiers; never synthesize aliases or infer a site. */
export function parseRootSites(letter: RootLetter, raw: unknown): RootInstance[] {
    if (!object(raw) || !Array.isArray(raw.Sites))
        throw Error('Invalid root site response');
    const sites: RootInstance[] = [];
    const seen = new Set<string>();
    for (const site of raw.Sites) {
        if (!object(site) || typeof site.ID !== 'string' || !site.ID || (site.Status && site.Status !== 'operational') || site.IPv4 === false)
            continue;
        const position = [site.Longitude, site.Latitude];
        if (!isLonLat(position))
            continue;
        const id = `${letter}-${site.ID}`;
        if (seen.has(id))
            throw Error('Duplicate root site ID');
        seen.add(id);
        sites.push({ id, letter, city: typeof site.Town === 'string' ? site.Town : '', country: typeof site.Country === 'string' ? site.Country : null,
            position: position.map(v => Math.round(v * 1000) / 1000) as [
                number,
                number
            ],
            scope: typeof site.Type === 'string' && ['global', 'local'].includes(site.Type.toLowerCase()) ? site.Type.toLowerCase() as 'global' | 'local' : null,
            identifiers: Array.isArray(site.Identifiers) ? [...new Set(site.Identifiers.filter((v): v is string => typeof v === 'string' && !!v))] : [] });
    }
    if (!sites.length)
        throw Error('No usable root sites for ' + letter);
    return sites;
}
