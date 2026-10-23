/**
 * GET /api/internet/dns-flows — measured DNS queries to the root servers from
 * RIPE Atlas probes, as a DnsFlowSnapshot (src/internet/types.ts).
 *
 * The root-instance positions come from the static dataset
 * (/data/internet/root-servers.json, read through the ASSETS binding).
 *
 * Placeholder until track C of docs/internet-layers.md lands: it answers 503,
 * which the app shows as "data unavailable" and draws nothing.
 */
export interface Assets { fetch(request: Request): Promise<Response> }

export async function dnsFlowsResponse(_request: Request, _assets: Assets): Promise<Response> {
  return new Response(JSON.stringify({ error: "DNS flows not available yet" }), {
    status: 503,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}
