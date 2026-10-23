# Recorded RIPE Atlas DNS samples

Recorded on 2026-10-23 from the public RIPE Atlas v2 API with User-Agent
`Earth-Atlas (+https://github.com/zeye-w/Earth-Atlas)`.

Each letter file contains three actual results from
`https://atlas.ripe.net/api/v2/measurements/{id}/latest/?probe_ids=...`.
Only the fields needed by the tests are retained: prb_id, timestamp, msm_id,
af and result. DNS answer bytes, TXT answers and RTT are unmodified. Historical
results deliberately remain in the recordings to exercise age filtering.
`probes.json` retains only public probe IDs and their published geometry from
`/api/v2/probes/?status=1&is_public=true&country_code=...&page_size=100`.
Synthetic root instances in unit tests are explicitly test data, not evidence
of an actual answering location.

IPv4 UDP CHAOS TXT hostname.bind IDs:
A 10309, B 10310, C 10311, D 10312, E 10313, F 10304, G 10314,
H 10315, I 10305, J 10316, K 10301, L 10308, M 10306.

Sources:
- https://atlas.ripe.net/docs/getting-started/built-in-measurements/
- https://atlas.ripe.net/docs/apis/rest-api-manual/measurements/results-and-latest/
- https://www.ripe.net/about-us/legal/ripe-atlas-service-terms-and-conditions/

RIPE Atlas data is governed by Service Terms and Conditions v3.5, Article 4;
it is not labelled CC BY. Research use is permitted under the service terms;
commercial use requires prior RIPE NCC permission. Attribution: RIPE Atlas / RIPE NCC.

The worker samples 13 connected public probes in each of US, BR, ZA, DE, IN,
JP, AU and NL (at most 104), selected from bounded country pages. This is a
geographically spread convenience sample, not statistically uniform or
representative of global Internet users. Probe geometry is approximate and
rounded to two decimals in the output. Results older than five minutes are
counted in examined but never drawn. Exact identifiers and explicit '*' globs
are preferred; city fallback requires one unique same-letter site. G regional
names and unrecognised codes have no city fallback. A/J therefore had zero
matches in the recorded integration check. No nearest-probe/site inference.

Reproduce local measurements with an A-line root dataset:

    node --experimental-strip-types worker/ripeAtlas/benchmark.mjs public/data/internet/root-servers.json

Cold refresh: 21 external requests + 1 ASSETS request. Later refresh with probe
cache: 13 external + 1 ASSETS. Memory hits: zero external/ASSETS. Cache API
operations are additional platform operations (up to two lookups/two writes on
cold fill); the total remains below 50. Cache API is per location, not global.
In-memory refreshes are coalesced; independent isolates may still refresh.

2026-10-23 local Node v24.16.0 replay: 1,575 real root sites, 104 real probes,
1,352 results, 657 matched across 11 letters (evaluated at newest recorded result).
A 0/104, B 74/104, C 52/104, D 70/104, E 1/104, F 72/104,
G 74/104, H 73/104, I 24/104, J 0/104, K 73/104, L 73/104, M 71/104.
Matching + serialization: 1.56-1.88 ms CPU per snapshot (10 batches of 100).
Complete cold-handler replay including decoding/parsing: 7.82 ms CPU average
(100 runs). These are local process CPU averages, not Cloudflare CPU metrics or
a guarantee of the free-plan limit. The original 200-probe replay took 14.54 ms;
sampling was reduced before shipping. A separate live handler check returned
624 validated flows across 11 letters, 22 subrequests, then a memory-cache hit.
If deployed Cloudflare CPU exceeds the plan budget, the proposed next step is
a scheduled GitHub Action generating snapshots and a lightweight serving worker;
that alternative is intentionally not implemented in this change.
