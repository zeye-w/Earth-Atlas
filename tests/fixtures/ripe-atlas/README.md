# Recorded DNS and root-site samples

Recorded on 2026-10-23. All HTTP requests identify
`Earth-Atlas (+https://github.com/zeye-w/Earth-Atlas)`.

- `a.json` through `m.json`: three real Atlas IPv4 UDP CHAOS TXT
  hostname.bind results each. Only prb_id, timestamp, msm_id, af and result
  were retained. Answer bytes, TXT text and RTT are unmodified; historical
  observations remain to test freshness rejection.
- `probes.json`: real public probe IDs and published approximate geometry.
- `roots/a.json` through `roots/m.json`: official per-letter responses from
  `https://root-servers.org/root/{A..M}/json/`. Only the Sites array was cropped
  to a few real entries (first usable site, first site with identifiers and
  selected Amsterdam/London entries where available). All retained fields and
  values are unchanged. These are test recordings, never production fallback.

Measurement IDs: A 10309, B 10310, C 10311, D 10312, E 10313, F 10304,
G 10314, H 10315, I 10305, J 10316, K 10301, L 10308, M 10306.

Sources and terms:
- https://atlas.ripe.net/docs/getting-started/built-in-measurements/
- https://atlas.ripe.net/docs/apis/rest-api-manual/measurements/results-and-latest/
- https://www.ripe.net/about-us/legal/ripe-atlas-service-terms-and-conditions/
- https://root-servers.org/
- https://developers.cloudflare.com/workers/platform/limits/

Atlas: RIPE NCC Service Terms v3.5, Article 4; research use under the terms,
commercial use requires prior permission. Not CC BY. Root site data:
operator-supplied Root Server Technical Operations Association JSON; no explicit
blanket data-reuse licence verified. No claim of CC licensing is made.

The worker now loads the 13 official root responses directly, with one second
between requests to avoid bursts (an initial unpaced recording encountered 429).
It retains actual Identifiers and rejects unusable coordinates, inactive sites,
IPv6-only sites and duplicate IDs. Root data lives only in server-side memory
and Cache API for at most 24h; refresh begins after 23h, with valid-cache fallback
on failure. An expired/missing root cache plus upstream failure returns 503.
There is no ASSETS/static-file dependency. Cache keys were versioned so old
104-probe or static-root snapshots cannot defeat the new sample bounds.

Samples: at most six connected public IPv4 probes per country (US, BR, ZA, DE,
IN, JP, AU, NL), at most 48. This convenience sample is not a statistical view of
global traffic. Results older than five minutes are examined but never drawn.
Exact identifiers are preferred, and I's sN.site response is compared against the
literal official site ID. No inferred aliases for A/J's incompatible formats.
Unknown codes and ambiguous cities remain unmatched. Probe coordinates are
rounded to two decimals; root coordinates to three. Output contract is unchanged.

The benchmark accepts a private recording of all 13 full upstream root objects
keyed a..m and optionally a DNS recording {probes:[{id,geometry}],all:{a:[],...}}:

    node --experimental-strip-types worker/ripeAtlas/benchmark.mjs ROOT-RESPONSES.json DNS-RECORDING.json

With no DNS recording it requests live Atlas results. Recording mode evaluates
freshness at the newest observation timestamp for repeatability. The small unit
fixtures deliberately are not a complete global dataset for rate benchmarking.

Replay of real recorded results against 1,575 full official sites, 48 probes:
A 0/48, B 29/48, C 22/48, D 29/48, E 0/48, F 29/48,
G 29/48, H 29/48, I 29/48, J 0/48, K 29/48, L 29/48, M 29/48.
Total 283/624, ten letters. I improves from 10/48 with city-only fallback to 29/48
with the literal official identifier. A/J remain incompatible; E lacks useful
Identifiers and has ambiguous co-located sites. These are replay rates, not a
claim that old observations remain drawable now.

Local Node v24.16.0 replay, 100 cold handler runs, pretty-printed full root JSON,
with all three Cache API writes serialized/consumed and cache misses simulated:
main-thread CPU average 8.44 ms, process-wide CPU 11.10 ms, wall time excluding
network/rate-limit waits 9.11 ms. Core match+serialization 1.09-1.56 ms per call.
Node process CPU includes background/runtime work; neither metric is deployed
Cloudflare CPU accounting. Production CPU and worst-case bursts remain to be
verified with Cloudflare telemetry. A complete live attempt fetched all 13 root
responses successfully, then failed TLS connections to Atlas and returned 503;
that outcome is not reported as a successful live snapshot.

Request counts, including cache operations conservatively as subrequests:
- Completely cold: 13 root + 8 probe + 13 measurement = 34 HTTP;
  3 cache reads + 3 cache writes = 40 total. Zero ASSETS.
- Normal refresh: 13 measurements + 1 snapshot cache write = 14 total.
- Root refresh with valid probe memory: 13 roots + 13 measurements + 2 writes = 28.
- Memory snapshot hit: 0. Separate isolate reading a fresh snapshot: 1 cache read.
Redirects are rejected, retries are not multiplied, and failures stop root loading.
Root requests are sequential; Workers queues concurrent Atlas fetches under its
connection limit. Daily root/probe refreshes are staggered at 23h versus 24h.
If deployed CPU exceeds the free budget, a scheduled snapshot generator remains
a proposed alternative, not implemented in this PR.
