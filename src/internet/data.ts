/**
 * Loading and checking the internet datasets. The parsers are the contract
 * in code: producers (scripts/internet/, worker/ripeAtlas.ts) test their
 * output with them, and the app never draws an item that fails them.
 * Malformed items are dropped; a wrong version or a missing list fails the file.
 */
import {
  DNS_FLOWS_URL, INTERNET_DATA_URLS, INTERNET_DATA_VERSION, ROOT_LETTERS,
  type Cable, type CableDataset, type DatasetSource, type DnsFlow, type DnsFlowSnapshot, type Facility, type FacilityDataset,
  type InternetDatasetKey, type Ixp, type IxpDataset, type LandingPoint, type LonLat, type RootInstance, type RootLetter,
  type RootServer, type RootServerDataset,
} from "./types.ts";

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const isString = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const orNull = <T>(v: unknown, check: (x: unknown) => x is T): T | null => (check(v) ? v : null);

export function isLonLat(v: unknown): v is LonLat {
  return Array.isArray(v) && v.length === 2 && finite(v[0]) && finite(v[1]) && Math.abs(v[0]) <= 180 && Math.abs(v[1]) <= 90;
}
const isLetter = (v: unknown): v is RootLetter => typeof v === "string" && (ROOT_LETTERS as readonly string[]).includes(v);

function header(json: unknown, list: string): Json {
  if (!isObject(json)) throw new Error("not an object");
  if (json.version !== INTERNET_DATA_VERSION) throw new Error("unsupported version " + String(json.version));
  if (!Array.isArray(json[list])) throw new Error("missing " + list);
  return json;
}

function sources(json: Json): DatasetSource[] {
  return Array.isArray(json.sources) ? json.sources.filter((s): s is DatasetSource => isObject(s) && isString(s.name) && isString(s.url) && isString(s.license) && isString(s.retrievedAt)) : [];
}

function cable(v: unknown): Cable | null {
  if (!isObject(v) || !isString(v.id) || !isString(v.name) || !Array.isArray(v.paths)) return null;
  const paths = v.paths.filter((p): p is LonLat[] => Array.isArray(p) && p.length >= 2 && p.every(isLonLat));
  if (!paths.length) return null;
  return {
    id: v.id, name: v.name, paths,
    rfsYear: orNull(v.rfsYear, finite), lengthKm: orNull(v.lengthKm, finite),
    owners: Array.isArray(v.owners) ? v.owners.filter(isString) : [],
    landingIds: Array.isArray(v.landingIds) ? v.landingIds.filter(isString) : [],
    ...(isString(v.url) ? { url: v.url } : {}),
  };
}

function landing(v: unknown): LandingPoint | null {
  if (!isObject(v) || !isString(v.id) || !isString(v.name) || !isLonLat(v.position)) return null;
  return { id: v.id, name: v.name, country: orNull(v.country, isString), position: v.position };
}

function ixp(v: unknown): Ixp | null {
  if (!isObject(v) || !finite(v.id) || !isString(v.name) || !isLonLat(v.position)) return null;
  return {
    id: v.id, name: v.name, city: isString(v.city) ? v.city : "", country: orNull(v.country, isString), position: v.position,
    members: orNull(v.members, finite), portCapacityGbps: orNull(v.portCapacityGbps, finite),
    facilityIds: Array.isArray(v.facilityIds) ? v.facilityIds.filter(finite) : [],
    ...(isString(v.website) ? { website: v.website } : {}),
  };
}

function facility(v: unknown): Facility | null {
  if (!isObject(v) || !finite(v.id) || !isString(v.name) || !isLonLat(v.position)) return null;
  return {
    id: v.id, name: v.name, operator: orNull(v.operator, isString), city: isString(v.city) ? v.city : "", country: orNull(v.country, isString),
    position: v.position, ixCount: finite(v.ixCount) ? v.ixCount : 0, networkCount: finite(v.networkCount) ? v.networkCount : 0,
  };
}

function rootServer(v: unknown): RootServer | null {
  if (!isObject(v) || !isLetter(v.letter) || !isString(v.operator)) return null;
  return { letter: v.letter, operator: v.operator, ipv4: isString(v.ipv4) ? v.ipv4 : "", ipv6: isString(v.ipv6) ? v.ipv6 : "" };
}

function rootInstance(v: unknown): RootInstance | null {
  if (!isObject(v) || !isString(v.id) || !isLetter(v.letter) || !isLonLat(v.position)) return null;
  return {
    id: v.id, letter: v.letter, city: isString(v.city) ? v.city : "", country: orNull(v.country, isString), position: v.position,
    scope: v.scope === "global" || v.scope === "local" ? v.scope : null,
    identifiers: Array.isArray(v.identifiers) ? v.identifiers.filter(isString) : [],
  };
}

function dnsFlow(v: unknown): DnsFlow | null {
  if (!isObject(v) || !finite(v.probeId) || !isLonLat(v.probe) || !isLetter(v.letter) || !isString(v.instanceId) || !isLonLat(v.instance)) return null;
  if (!finite(v.rttMs) || v.rttMs <= 0 || v.rttMs > 10_000 || !finite(v.time)) return null;
  return {
    probeId: v.probeId, probe: v.probe, letter: v.letter, instanceId: v.instanceId, instance: v.instance, rttMs: v.rttMs, time: v.time,
    ...(isString(v.instanceCity) ? { instanceCity: v.instanceCity } : {}),
    ...(v.instanceCountry === null || isString(v.instanceCountry) ? { instanceCountry: v.instanceCountry } : {}),
  };
}

const keep = <T>(list: unknown[], parse: (v: unknown) => T | null): T[] => list.map(parse).filter((x): x is T => x !== null);

export function parseCableDataset(json: unknown): CableDataset {
  const h = header(json, "cables");
  return { version: INTERNET_DATA_VERSION, generatedAt: String(h.generatedAt ?? ""), sources: sources(h), cables: keep(h.cables as unknown[], cable), landings: Array.isArray(h.landings) ? keep(h.landings, landing) : [] };
}
export function parseIxpDataset(json: unknown): IxpDataset {
  const h = header(json, "ixps");
  return { version: INTERNET_DATA_VERSION, generatedAt: String(h.generatedAt ?? ""), sources: sources(h), ixps: keep(h.ixps as unknown[], ixp) };
}
export function parseFacilityDataset(json: unknown): FacilityDataset {
  const h = header(json, "facilities");
  return { version: INTERNET_DATA_VERSION, generatedAt: String(h.generatedAt ?? ""), sources: sources(h), facilities: keep(h.facilities as unknown[], facility) };
}
export function parseRootServerDataset(json: unknown): RootServerDataset {
  const h = header(json, "instances");
  return { version: INTERNET_DATA_VERSION, generatedAt: String(h.generatedAt ?? ""), sources: sources(h), servers: Array.isArray(h.servers) ? keep(h.servers, rootServer) : [], instances: keep(h.instances as unknown[], rootInstance) };
}
export function parseDnsFlowSnapshot(json: unknown): DnsFlowSnapshot {
  const h = header(json, "flows");
  const [source] = sources({ sources: [h.source] });
  if (!source) throw new Error("missing source");
  return { version: INTERNET_DATA_VERSION, generatedAt: String(h.generatedAt ?? ""), source, examined: finite(h.examined) ? h.examined : 0, matched: finite(h.matched) ? h.matched : 0, flows: keep(h.flows as unknown[], dnsFlow) };
}

export interface InternetDatasets {
  cables: CableDataset;
  ixps: IxpDataset;
  facilities: FacilityDataset;
  rootServers: RootServerDataset;
}

const PARSERS: { [K in InternetDatasetKey]: (json: unknown) => InternetDatasets[K] } = {
  cables: parseCableDataset, ixps: parseIxpDataset, facilities: parseFacilityDataset, rootServers: parseRootServerDataset,
};

/** Fetch and check one static dataset; rejects when it is missing or malformed. */
export async function loadInternetDataset<K extends InternetDatasetKey>(key: K, signal?: AbortSignal): Promise<InternetDatasets[K]> {
  const response = await fetch(INTERNET_DATA_URLS[key], { signal });
  if (!response.ok) throw new Error(INTERNET_DATA_URLS[key] + " HTTP " + response.status);
  return PARSERS[key](await response.json());
}

export const DNS_FLOWS_REFRESH_MS = 5 * 60_000;

export async function fetchDnsFlows(signal?: AbortSignal): Promise<DnsFlowSnapshot> {
  const response = await fetch(DNS_FLOWS_URL, { signal });
  if (!response.ok) throw new Error(DNS_FLOWS_URL + " HTTP " + response.status);
  return parseDnsFlowSnapshot(await response.json());
}
