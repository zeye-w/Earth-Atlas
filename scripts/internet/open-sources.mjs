import { getJson } from './http.mjs';
import { position, splitAntimeridian } from './geometry.mjs';

export const OSM_LICENSE = 'ODbL 1.0, © OpenStreetMap contributors';
export const WIKIDATA_LICENSE = 'CC0 1.0';
export const OVERPASS = 'https://overpass-api.de/api/interpreter';
export const OSM_QUERIES = {
  cables: '[out:json][timeout:180];(way[communication=line][location=underwater];way[communication=line][submarine=yes];way[telecom~"^(line|cable)$"][location=underwater];way[telecom~"^(line|cable)$"][submarine=yes];way["seamark:type"=cable_submarine];rel[route~"^(communication|telecom)$"];)->.c;(.c;rel(bw.c););out body geom;',
  facilities: '[out:json][timeout:180];(nwr[telecom=data_center];nwr[building=data_center];nwr["building:use"=data_center];);out body center;',
};
// Class verified by its English label; P2124 is member count, P856 official website.
export const IXP_QUERY = `SELECT ?item ?itemLabel ?coord ?city ?cityLabel ?cityCoord ?countryCode ?website ?members WHERE {
  ?item wdt:P31/wdt:P279* wd:Q1433061.
  OPTIONAL { ?item wdt:P625 ?coord }
  OPTIONAL { ?item (wdt:P159|wdt:P131) ?city. ?city wdt:P31/wdt:P279* wd:Q486972. OPTIONAL { ?city wdt:P625 ?cityCoord } }
  OPTIONAL { ?item wdt:P17/wdt:P297 ?countryCode }
  OPTIONAL { ?item wdt:P856 ?website }
  OPTIONAL { ?item wdt:P2124 ?members }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,mul" }
}`;
const metadata = (name, url, license, retrievedAt) => ({ version: 1, generatedAt: new Date().toISOString(), sources: [{ name, url, license, retrievedAt }] });
const sort = rows => rows.sort((a, b) => String(a.id).localeCompare(String(b.id), 'en', { numeric: true }));
const parts = value => (value || '').split(';').map(s => s.trim()).filter(Boolean);
export function osmNumericId(type, id) {
  const value = Number(id) * 4 + { node: 0, way: 1, relation: 2 }[type];
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`Invalid OSM identity: ${type}/${id}`);
  return value;
}
export function rfsYear(value) {
  const match = /^(?:~|circa\s+|c\.\s*)?(\d{4})(?:$|[-/; ])/.exec(value || '');
  return match ? Number(match[1]) : null;
}
export function isCommunicationCable(tags = {}) {
  if (tags.power || /(^|;)(power|transmission|mooring|ferry)(;|$)/.test(tags['seamark:cable_submarine:category'] || '')) return false;
  return tags.communication === 'line' || ['line', 'cable'].includes(tags.telecom) || /(^|;)(telephone|telegraph|optical|fibre_optic)(;|$)/.test(tags['seamark:cable_submarine:category'] || '');
}
const isUnderwater = tags => tags.location === 'underwater' || tags.submarine === 'yes' || tags['seamark:type'] === 'cable_submarine';
function checkOsm(raw) {
  if (raw.remark || !Array.isArray(raw.elements) || !raw.osm3s?.timestamp_osm_base) throw new Error(`Incomplete Overpass response: ${raw.remark || 'missing elements/base timestamp'}`);
}

export function convertCables(raw, retrievedAt = new Date().toISOString()) {
  checkOsm(raw);
  const ways = new Map(raw.elements.filter(e => e.type === 'way').map(e => [e.id, e]));
  const selected = new Map([...ways].filter(([, way]) => isUnderwater(way.tags || {}) && isCommunicationCable(way.tags)));
  const groups = new Map(), assigned = new Set();
  // A route relation takes precedence over its split ways. Never infer a link by proximity.
  for (const relation of raw.elements.filter(e => e.type === 'relation').sort((a, b) => a.id - b.id)) {
    if (relation.tags?.power || relation.tags?.route === 'power' || relation.tags?.type === 'power') continue;
    const members = (relation.members || []).filter(m => m.type === 'way' && (selected.has(m.ref) || (isCommunicationCable(relation.tags) && isUnderwater(relation.tags || {}))));
    if (!members.length || !(relation.tags?.name || relation.tags?.ref)) continue;
    const group = { id: `osm-relation-${relation.id}`, tags: relation.tags || {}, segments: [], url: `https://www.openstreetmap.org/relation/${relation.id}` };
    for (const member of members) {
      const way = ways.get(member.ref) || member;
      if (way.tags?.power) continue;
      const geometry = way.geometry || member.geometry;
      if (geometry?.length >= 2) { group.segments.push({ ...way, geometry, id: member.ref }); assigned.add(member.ref); }
    }
    if (group.segments.length) groups.set(group.id, group);
  }
  for (const way of [...selected.values()].sort((a, b) => a.id - b.id)) {
    if (assigned.has(way.id)) continue;
    const tags = way.tags || {};
    // Exact name/ref identity merges disjoint branches, but never merges unnamed cables.
    const identity = tags.name ? `name:${tags.name.trim().normalize('NFC')}` : tags.ref ? `ref:${tags.ref}` : `way:${way.id}`;
    let group = groups.get(identity);
    if (!group) {
      group = [...groups.values()].find(g => tags.name && g.tags.name === tags.name);
      if (!group) { group = { id: `osm-way-${way.id}`, tags, segments: [], url: `https://www.openstreetmap.org/way/${way.id}` }; groups.set(identity, group); }
    }
    group.segments.push(way);
  }
  const cables = [], landings = new Map();
  let unnamed = 0, conflictingYears = 0, missingGeometry = 0;
  const merged = new Map();
  for (const group of groups.values()) {
    const key = group.tags.name ? `name:${group.tags.name.trim().normalize('NFC')}` : group.tags.ref ? `ref:${group.tags.ref}` : group.id;
    if (merged.has(key)) merged.get(key).segments.push(...group.segments);
    else merged.set(key, group);
  }
  for (const group of merged.values()) {
    group.segments = [...new Map(group.segments.map(s => [s.id, s])).values()];
    const paths = [], endpointCounts = new Map();
    for (const segment of group.segments) {
      if (!segment.geometry?.length) { missingGeometry++; continue; }
      const points = segment.geometry.map(p => [p.lon, p.lat]);
      paths.push(...splitAntimeridian(points));
      for (const index of [0, points.length - 1]) {
        const key = segment.nodes?.[index] ? `osm-node-${segment.nodes[index]}` : `osm-endpoint-${points[index].join(',')}`;
        const previous = endpointCounts.get(key);
        endpointCounts.set(key, { count: (previous?.count || 0) + 1, position: position(...points[index]) });
      }
    }
    if (!paths.length) continue;
    const landingIds = [];
    for (const [id, endpoint] of endpointCounts) if (endpoint.count === 1) {
      // Topological endpoint inference, not a verified coastal landing station.
      landings.set(id, { id, name: `Inferred cable endpoint (${id})`, country: null, position: endpoint.position }); landingIds.push(id);
    }
    const name = group.tags.name || group.tags.ref || `Unnamed OSM cable (${group.id})`;
    if (!group.tags.name) unnamed++;
    const years = [...new Set([group.tags, ...group.segments.map(s => s.tags || {})].map(t => rfsYear(t.start_date)).filter(y => y !== null))];
    if (years.length > 1) conflictingYears++;
    cables.push({ id: group.id, name, rfsYear: rfsYear(group.tags.start_date) ?? (years.length === 1 ? years[0] : null), lengthKm: null, owners: [...new Set([group.tags, ...group.segments.map(s => s.tags || {})].flatMap(t => [...parts(t.operator), ...parts(t.owner)]))].sort(), landingIds: landingIds.sort(), paths, url: group.url });
  }
  return { dataset: { ...metadata('OpenStreetMap submarine communication cables (Overpass)', `${OVERPASS}?data=${encodeURIComponent(OSM_QUERIES.cables)}`, OSM_LICENSE, retrievedAt), cables: sort(cables), landings: sort([...landings.values()]) }, quality: { osmBaseTimestamp: raw.osm3s.timestamp_osm_base, queriedElements: raw.elements.length, communicationWays: selected.size, excludedNonCommunicationWays: ways.size - selected.size, unnamed, conflictingYears, missingGeometry, withRfsYear: cables.filter(c => c.rfsYear !== null).length, withOwners: cables.filter(c => c.owners.length).length, inferredEndpoints: landings.size } };
}

export function convertFacilities(raw, retrievedAt = new Date().toISOString()) {
  checkOsm(raw); let missingCoordinates = 0, unnamed = 0;
  const facilities = [];
  for (const element of raw.elements) {
    const tags = element.tags || {}, p = element.type === 'node' ? element : element.center;
    const coordinates = p && position(p.lon, p.lat);
    if (!coordinates) { missingCoordinates++; continue; }
    if (!tags.name) unnamed++;
    facilities.push({ id: osmNumericId(element.type, element.id), name: tags.name || `Unnamed OSM data center (${element.type}/${element.id})`, operator: tags.operator || null, city: tags['addr:city'] || '', country: /^[A-Z]{2}$/.test(tags['addr:country'] || '') ? tags['addr:country'] : null, position: coordinates, ixCount: 0, networkCount: 0 });
  }
  return { dataset: { ...metadata('OpenStreetMap data centers (Overpass)', `${OVERPASS}?data=${encodeURIComponent(OSM_QUERIES.facilities)}`, OSM_LICENSE, retrievedAt), facilities: facilities.sort((a, b) => a.id - b.id) }, quality: { osmBaseTimestamp: raw.osm3s.timestamp_osm_base, queriedElements: raw.elements.length, missingCoordinates, unnamed, withOperator: facilities.filter(f => f.operator).length, areaCenters: raw.elements.filter(e => e.type !== 'node' && e.center).length } };
}
function wkt(value) {
  const match = /^Point\(([-+\d.eE]+) ([-+\d.eE]+)\)$/.exec(value || '');
  return match ? position(match[1], match[2]) : null;
}
export function convertIxps(raw, retrievedAt = new Date().toISOString()) {
  if (!Array.isArray(raw.results?.bindings)) throw new Error('Wikidata: missing SPARQL bindings');
  const groups = new Map();
  for (const binding of raw.results.bindings) {
    const row = Object.fromEntries(Object.entries(binding).map(([k, v]) => [k, v.value]));
    if (!/^http:\/\/www.wikidata.org\/entity\/Q\d+$/.test(row.item || '')) throw new Error('Invalid Wikidata item');
    const id = Number(row.item.split('/Q')[1]);
    groups.set(id, [...(groups.get(id) || []), row]);
  }
  const ixps = []; let cityFallback = 0, missingCoordinates = 0, ambiguousCoordinates = 0, conflictingMembers = 0;
  const fallbackIds = [];
  for (const [id, rows] of groups) {
    const direct = rows.map(r => wkt(r.coord)).filter(Boolean), city = rows.map(r => wkt(r.cityCoord)).filter(Boolean);
    const candidates = [...new Map((direct.length ? direct : city).map(p => [p.join(','), p])).values()];
    if (!candidates.length) { missingCoordinates++; continue; }
    if (candidates.length > 1) { ambiguousCoordinates++; continue; }
    if (!direct.length) { cityFallback++; fallbackIds.push(id); }
    const first = rows[0], counts = [...new Set(rows.filter(r => r.members !== undefined).map(r => Number(r.members)).filter(n => Number.isSafeInteger(n) && n >= 0))];
    if (counts.length > 1) conflictingMembers++;
    const websites = [...new Set(rows.map(r => r.website).filter(s => /^https?:\/\//.test(s || '')))].sort();
    ixps.push({ id, name: first.itemLabel || `Q${id}`, city: first.cityLabel && !/^Q\d+$/.test(first.cityLabel) ? first.cityLabel : '', country: rows.find(r => /^[A-Z]{2}$/.test(r.countryCode || ''))?.countryCode || null, position: candidates[0], members: counts.length === 1 ? counts[0] : null, portCapacityGbps: null, facilityIds: [], ...(websites.length ? { website: websites[0] } : {}) });
  }
  return { dataset: { ...metadata('Wikidata internet exchange points (SPARQL)', `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(IXP_QUERY)}`, WIKIDATA_LICENSE, retrievedAt), ixps: ixps.sort((a, b) => a.id - b.id) }, quality: { queriedItems: groups.size, missingCoordinates, ambiguousCoordinates, cityFallback, cityFallbackQids: fallbackIds.map(id => `Q${id}`).sort(), conflictingMembers, withMembers: ixps.filter(i => i.members !== null).length, withWebsite: ixps.filter(i => i.website).length } };
}

export async function buildOpenData() {
  const datasets = {}, quality = {};
  for (const [key, convert] of [['cables', convertCables], ['facilities', convertFacilities]]) {
    console.log(`Fetching OpenStreetMap ${key}`);
    const raw = await getJson(`${OVERPASS}?data=${encodeURIComponent(OSM_QUERIES[key])}`, {}, { timeoutMs: 240000 });
    const result = convert(raw); datasets[`${key}.json`] = result.dataset; quality[key] = result.quality;
  }
  console.log('Fetching Wikidata IXPs');
  const result = convertIxps(await getJson(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(IXP_QUERY)}`));
  datasets['ixps.json'] = result.dataset; quality.ixps = result.quality;
  return { datasets, quality };
}
