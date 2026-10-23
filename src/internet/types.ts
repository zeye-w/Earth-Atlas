/**
 * Data contracts for the internet infrastructure layers (docs/internet-layers.md).
 * Static datasets are built weekly by scripts/internet/ into public/data/internet/;
 * DNS flows come live from the Worker (/api/internet/dns-flows).
 *
 * Coordinates are [longitude, latitude] in degrees, rounded to 3 decimals or less.
 * Change a shape here (and in the doc) before changing a producer or consumer.
 */

export const INTERNET_DATA_VERSION = 1;

/** Where a dataset came from, shown in the panel and the attribution line. */
export interface DatasetSource {
  name: string;
  url: string;
  license: string;
  /** When the upstream data was fetched, ISO 8601. */
  retrievedAt: string;
}

interface Dataset {
  version: typeof INTERNET_DATA_VERSION;
  /** When the file was built, ISO 8601. */
  generatedAt: string;
  sources: DatasetSource[];
}

export type LonLat = [number, number];

// ---------------------------------------------------------------- submarine cables

export interface Cable {
  id: string;
  name: string;
  /** Ready-for-service year; null when unknown. Planned cables have a future year. */
  rfsYear: number | null;
  lengthKm: number | null;
  owners: string[];
  landingIds: string[];
  /** Simplified route: one or more polylines (branches), each at least two points. */
  paths: LonLat[][];
  url?: string;
}

export interface LandingPoint {
  id: string;
  name: string;
  /** ISO 3166-1 alpha-2 when known. */
  country: string | null;
  position: LonLat;
}

export interface CableDataset extends Dataset {
  cables: Cable[];
  landings: LandingPoint[];
}

// ---------------------------------------------------------------- exchanges and facilities

export interface Ixp {
  /** PeeringDB ix id. */
  id: number;
  name: string;
  city: string;
  country: string | null;
  /** Centroid of the IXP's facilities with coordinates, else the city. */
  position: LonLat;
  /** Networks connected (PeeringDB net count); null when unknown. */
  members: number | null;
  /** Sum of member port speeds, Gbit/s; null when unknown. */
  portCapacityGbps: number | null;
  facilityIds: number[];
  website?: string;
}

export interface Facility {
  /** PeeringDB fac id. */
  id: number;
  name: string;
  operator: string | null;
  city: string;
  country: string | null;
  position: LonLat;
  /** IXPs present in the facility, and networks present (PeeringDB counts). */
  ixCount: number;
  networkCount: number;
}

export interface IxpDataset extends Dataset {
  ixps: Ixp[];
}

export interface FacilityDataset extends Dataset {
  facilities: Facility[];
}

// ---------------------------------------------------------------- DNS root servers

export type RootLetter = "a" | "b" | "c" | "d" | "e" | "f" | "g" | "h" | "i" | "j" | "k" | "l" | "m";
export const ROOT_LETTERS: readonly RootLetter[] = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m"];

export interface RootServer {
  letter: RootLetter;
  operator: string;
  ipv4: string;
  ipv6: string;
}

export interface RootInstance {
  /** Stable within a dataset, e.g. "k-ams" or the upstream site identifier. */
  id: string;
  letter: RootLetter;
  city: string;
  country: string | null;
  position: LonLat;
  /** Announced globally, or only to a local region (upstream's "local"/"global"). */
  scope: "global" | "local" | null;
  /**
   * Strings the instance answers with (hostname.bind / NSID), or patterns of
   * them, used to match a RIPE Atlas reply to this site. May be empty.
   */
  identifiers: string[];
}

export interface RootServerDataset extends Dataset {
  servers: RootServer[];
  instances: RootInstance[];
}

// ---------------------------------------------------------------- measured DNS queries (live)

/** One measured query: a RIPE Atlas probe asked a root letter and this instance answered. */
export interface DnsFlow {
  probeId: number;
  probe: LonLat;
  letter: RootLetter;
  /** RootInstance.id of the answering site; flows that cannot be matched are not sent. */
  instanceId: string;
  instance: LonLat;
  rttMs: number;
  /** When the measurement ran, ms since epoch. */
  time: number;
}

export interface DnsFlowSnapshot {
  version: typeof INTERNET_DATA_VERSION;
  generatedAt: string;
  source: DatasetSource;
  /** Results examined, and how many could be matched to a known instance. */
  examined: number;
  matched: number;
  flows: DnsFlow[];
}

// ---------------------------------------------------------------- the app side

export type InternetDatasetKey = "cables" | "ixps" | "facilities" | "rootServers";

export const INTERNET_DATA_URLS: Record<InternetDatasetKey, string> = {
  cables: "/data/internet/cables.json",
  ixps: "/data/internet/ixps.json",
  facilities: "/data/internet/facilities.json",
  rootServers: "/data/internet/root-servers.json",
};
export const DNS_FLOWS_URL = "/api/internet/dns-flows";

/** Picking ids: prefix + item id (see App.tsx handleClick). */
export const INTERNET_ID_PREFIX = {
  cable: "internet:cable:",
  landing: "internet:landing:",
  ixp: "internet:ixp:",
  facility: "internet:facility:",
  rootInstance: "internet:root:",
} as const;

export type InternetSelection =
  | { kind: "cable"; cable: Cable; landings: LandingPoint[] }
  | { kind: "landing"; landing: LandingPoint; cables: Cable[] }
  | { kind: "ixp"; ixp: Ixp; facilities: Facility[] }
  | { kind: "facility"; facility: Facility; ixps: Ixp[] }
  | { kind: "rootInstance"; instance: RootInstance; server: RootServer | null };
