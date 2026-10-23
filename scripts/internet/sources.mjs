import { getJson, peeringList } from './http.mjs';
import { centroid, position, splitAntimeridian } from './geometry.mjs';

const source = (name, url, license) => ({ name, url, license, retrievedAt: new Date().toISOString() });
const header = sources => ({ version: 1, generatedAt: new Date().toISOString(), sources });
const cableBase = 'https://www.submarinecablemap.com/api/v3';
const countryNames = new Intl.DisplayNames(['en'], { type: 'region' });
const countries = new Map();
for (let a = 65; a <= 90; a++) for (let b = 65; b <= 90; b++) {
  const code = String.fromCharCode(a, b), name = countryNames.of(code);
  if (name !== code) countries.set(name, code);
}
for (const [name, code] of Object.entries({ 'Congo, Dem. Rep.': 'CD', 'Congo, Rep.': 'CG', 'Korea, Rep.': 'KR', 'Korea, Dem. Rep.': 'KP', 'Russia': 'RU', 'Vietnam': 'VN', 'Taiwan': 'TW', 'Türkiye': 'TR', 'Turkey': 'TR', 'Côte d’Ivoire': 'CI', "Côte d'Ivoire": 'CI' })) countries.set(name, code);

export async function buildCables() {
  const geo = await getJson(`${cableBase}/cable/cable-geo.json`);
  const landingGeo = await getJson(`${cableBase}/landing-point/landing-point-geo.json`);
  if (!Array.isArray(geo.features) || !Array.isArray(landingGeo.features)) throw new Error('Cable GeoJSON missing features');
  const landings = landingGeo.features.map(f => ({ id: f.properties.id, name: f.properties.name, country: null, position: position(...f.geometry.coordinates) })).filter(row => row.position);
  const landingMap = new Map(landings.map(row => [row.id, row]));
  const routes = new Map();
  for (const feature of geo.features) {
    const { id } = feature.properties;
    const coordinates = feature.geometry.type === 'MultiLineString' ? feature.geometry.coordinates : feature.geometry.type === 'LineString' ? [feature.geometry.coordinates] : null;
    if (!coordinates) throw new Error(`Unexpected geometry for ${id}`);
    routes.set(id, [...(routes.get(id) ?? []), ...coordinates.flatMap(splitAntimeridian)]);
  }
  const cables = []; let missingLandings = 0;
  for (const [id, paths] of [...routes].sort(([a], [b]) => a.localeCompare(b))) {
    const detail = await getJson(`${cableBase}/cable/${encodeURIComponent(id)}.json`);
    if (detail.id !== id || !detail.name || !Array.isArray(detail.landing_points)) throw new Error(`Invalid cable detail: ${id}`);
    const landingIds = [];
    for (const point of detail.landing_points) {
      const landing = landingMap.get(point.id);
      if (landing) { landing.country = countries.get(point.country) ?? null; landingIds.push(point.id); }
      else missingLandings++;
    }
    const year = String(detail.rfs_year ?? detail.rfs ?? '').match(/\b(?:18|19|20|21)\d{2}\b/);
    const length = String(detail.length ?? '').replaceAll(',', '').match(/\d+(?:\.\d+)?/);
    cables.push({ id, name: detail.name, rfsYear: year ? Number(year[0]) : null, lengthKm: length ? Number(length[0]) : null, owners: typeof detail.owners === 'string' ? detail.owners.split(',').map(s => s.trim()).filter(Boolean) : [], landingIds: [...new Set(landingIds)], paths, url: `https://www.submarinecablemap.com/submarine-cable/${id}` });
    if (cables.length % 50 === 0) console.log(`Cable details ${cables.length}/${routes.size}`);
  }
  return { datasets: { 'cables.json': { ...header([source('TeleGeography Submarine Cable Map', 'https://www.submarinecablemap.com/about', 'Data redistribution permission unverified; website map references/screenshots: CC BY-SA 4.0; https://www2.telegeography.com/license-geocoded-map-data')]), cables, landings: landings.sort((a, b) => a.id.localeCompare(b.id)) } }, quality: { cables: { missingLandingReferences: missingLandings, discardedLandingCoordinates: landingGeo.features.length - landings.length, unknownLandingCountries: landings.filter(row => !row.country).length } } };
}

export async function buildPeering() {
  const fac = await peeringList('fac'), ix = await peeringList('ix'), links = await peeringList('ixfac'), ports = await peeringList('netixlan');
  const facilities = fac.map(row => ({ id: row.id, name: row.name, operator: row.org_name || null, city: row.city || '', country: row.country || null, position: position(row.longitude, row.latitude), ixCount: row.ix_count ?? 0, networkCount: row.net_count ?? 0 })).filter(row => row.position).sort((a, b) => a.id - b.id);
  const byId = new Map(facilities.map(row => [row.id, row])), cities = new Map(), ixFacilities = new Map(), capacities = new Map();
  for (const row of facilities) {
    const key = `${row.country}:${row.city.trim().toLowerCase()}`;
    if (row.city) cities.set(key, [...(cities.get(key) ?? []), row.position]);
  }
  for (const row of links) if (byId.has(row.fac_id)) ixFacilities.set(row.ix_id, new Set([...(ixFacilities.get(row.ix_id) ?? []), row.fac_id]));
  for (const row of ports) if (Number.isFinite(row.speed) && row.speed >= 0) capacities.set(row.ix_id, (capacities.get(row.ix_id) ?? 0) + row.speed / 1000);
  let cityFallback = 0, missingCoordinates = 0;
  const ixps = [];
  for (const row of ix) {
    const facilityIds = [...(ixFacilities.get(row.id) ?? [])].sort((a, b) => a - b);
    let points = facilityIds.map(id => byId.get(id).position);
    if (!points.length) { points = cities.get(`${row.country}:${(row.city || '').trim().toLowerCase()}`) ?? []; if (points.length) cityFallback++; }
    if (!points.length) { missingCoordinates++; continue; }
    ixps.push({ id: row.id, name: row.name, city: row.city || '', country: row.country || null, position: centroid(points), members: row.net_count ?? null, portCapacityGbps: capacities.has(row.id) ? Math.round(capacities.get(row.id) * 1000) / 1000 : null, facilityIds, ...(row.website ? { website: row.website } : {}) });
  }
  const metadata = header([source('PeeringDB', 'https://www.peeringdb.com/apidocs/', 'PeeringDB AUP; bulk redistribution requires approval: https://www.peeringdb.com/aup')]);
  return { datasets: { 'ixps.json': { ...metadata, ixps: ixps.sort((a, b) => a.id - b.id) }, 'facilities.json': { ...metadata, facilities } }, quality: { peeringdb: { discardedFacilities: fac.length - facilities.length, discardedIxps: missingCoordinates, cityFallback, cityFallbackMethod: 'Centroid of geolocated PeeringDB facilities in the same country/city; not a geocoder city centre', activePortRecords: ports.length } } };
}

export async function buildRoots() {
  const servers = [], instances = [], sources = []; let discarded = 0, groupedInstances = 0;
  for (const letter of 'abcdefghijklm') {
    const url = `https://root-servers.org/root/${letter.toUpperCase()}/json/`, raw = await getJson(url);
    console.log(`Root ${letter.toUpperCase()}: ${raw.Sites?.length ?? 0} sites fetched`);
    if (!raw.Operator || !raw.IPv4 || !raw.IPv6 || !Array.isArray(raw.Sites)) throw new Error(`Invalid ${letter}-root response`);
    sources.push(source(`Root Server Technical Operations Association: ${letter.toUpperCase()}`, url, 'No explicit data reuse license found; permission unverified: https://root-servers.org/'));
    servers.push({ letter, operator: raw.Operator, ipv4: raw.IPv4, ipv6: raw.IPv6 });
    for (const site of raw.Sites) {
      if (site.Status && site.Status !== 'operational') { discarded++; continue; }
      const coordinates = position(site.Longitude, site.Latitude);
      if (!coordinates) { discarded++; continue; }
      if (!site.ID) throw new Error(`${letter}-root site has no stable upstream ID`);
      groupedInstances += Math.max(0, (site.Instances || 1) - 1);
      instances.push({ id: `${letter}-${site.ID}`, letter, city: site.Town || '', country: site.Country || null, position: coordinates, scope: ['global', 'local'].includes(site.Type?.toLowerCase()) ? site.Type.toLowerCase() : null, identifiers: Array.isArray(site.Identifiers) ? [...new Set(site.Identifiers.filter(s => typeof s === 'string' && s.length))].sort() : [] });
    }
  }
  return { datasets: { 'root-servers.json': { ...header(sources), servers, instances: instances.sort((a, b) => a.id.localeCompare(b.id)) } }, quality: { roots: { discardedSites: discarded, additionalInstancesGroupedAtSites: groupedInstances, granularity: 'One record per upstream site ID; multiple co-located instances retain all supplied identifiers; no invented hostnames/patterns' } } };
}
