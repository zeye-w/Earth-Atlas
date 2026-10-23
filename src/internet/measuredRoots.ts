import type { DnsFlow, MeasuredRoot } from "./types.ts";

/**
 * The root-server instances that answered measured queries, one per site,
 * with how many queries and probes reached it and the median round trip.
 * The project does not republish the full instance list: the root layer
 * shows what the measurements saw.
 */
export function measuredRoots(flows: readonly DnsFlow[]): MeasuredRoot[] {
  const sites = new Map<string, { flows: DnsFlow[] }>();
  for (const flow of flows) {
    const site = sites.get(flow.instanceId) ?? { flows: [] };
    site.flows.push(flow);
    sites.set(flow.instanceId, site);
  }
  return [...sites.entries()].map(([id, { flows: hits }]) => {
    const first = hits[0];
    const rtts = hits.map((f) => f.rttMs).sort((a, b) => a - b);
    const mid = rtts.length >> 1;
    return {
      instance: { id, letter: first.letter, city: first.instanceCity ?? "", country: first.instanceCountry ?? null, position: first.instance, scope: null, identifiers: [] },
      queries: hits.length,
      probes: new Set(hits.map((f) => f.probeId)).size,
      medianRttMs: rtts.length % 2 ? rtts[mid] : (rtts[mid - 1] + rtts[mid]) / 2,
    };
  }).sort((a, b) => a.instance.id.localeCompare(b.instance.id));
}
