# RIPE Atlas DNS coverage: evidence, fixtures and reproduction

`a.json`..`m.json` retain the original three real Atlas results per letter.
`coverage-a.json`..`coverage-m.json` contain two real projected results per letter (three for E)
recorded on 2026-10-23 from the IPv4 UDP CHAOS TXT hostname.bind latest API.
Only prb_id, timestamp, msm_id, af and result are retained; TXT text, DNS packet
bytes, RTT and timestamps are unmodified. `global-anchors.json` is a 12-record
projection of real connected, public anchors spanning six inhabited continents.
The original `probes.json` retains real public probe IDs and approximate geometry.

`roots/*.json` remain entirely SYNTHETIC schema examples. Names, coordinates, IDs
and identifiers are fabricated and must never serve as a production fallback.
Unit tests sometimes attach synthetic site positions to recorded TXT strings to
isolate matching/output checks; those are not claims about real query locations.
Full real root responses stay outside the repository for private analysis only.
No static root-servers.org response is distributed with this change.

## Sampling

The worker requests public connected anchors (`status=1`, `is_public=true`,
`is_anchor=true`) with only id/geometry/country_code/status/is_public/is_anchor.
The API caps pages at 500 even if page_size=1000. We follow at most four computed
page URLs (never an arbitrary upstream next URL). The observed pool has 1,028
anchors in 113 countries, fetched in three pages (~215 KB projected JSON).
A larger future pool requiring more than four pages fails safely within budget.

Selection is pure, independent of input order and random/time state: validate and
deduplicate IDs; group by country and 10-degree grid; rotate countries across six
inhabited continents; take one per country before revisiting it, and one per grid
before revisiting a cell. Ascending IDs break ties. Russia is grouped with Europe,
Turkey/Cyprus with Asia; the explicit country table is a sampling convention, not
an inference of the probe's actual location. Unknown codes are grouped as OTHER.
Private/offline/non-anchor/invalid-position records are rejected.

Default 32: 32 countries, AF/AS=6 each and EU/NA/SA/OC=5 each, 289 matched
flows out of 416 examined results. This does NOT meet the aspirational 100-probe goal:
100-probe cold replay used 12.02-12.81 ms main-thread CPU. Default 32 was chosen
for the ~10ms budget. It is a geographic convenience sample of anchor networks,
not representative global user traffic. Sparse countries without anchors remain
absent. Different live pool contents can produce fewer countries or continents.
Coordinates remain rounded to two decimals and cached 24h. Cache keys are now
probes-v3 / dns-v3, avoiding the old eight-country cache.

## A / E / J evidence

- Naming grammar: original research, Section 3.2 and Appendix Table 2 of
  https://www.kyle.scho.mp/docs/anycast_flipping.pdf
  (also https://datatracker.ietf.org/meeting/122/materials/slides-122-maprg-characterizing-anycast-flipping-prevalence-and-impact-01.pdf).
  A/J can encode country+location UN/LOCODE and a replica suffix. Only explicit
  forms such as nnn1-ccxxx-1a / rootns-ccxxx-2 are normalized to cc-xxx. Compare
  with official Identifiers of form aN.cc-xxx.root / nN.cc-xxx.root AND Country.
  Require exactly one official RootInstance; never equate replica numbers with
  opaque site IDs or guess legacy el-prefixed meanings. Synthetic positive,
  unknown, country-mismatch and ambiguous multi-site cases exercise both letters.
  In the real sample all candidate geocodes remained ambiguous or unavailable;
  A/J therefore still have zero matches.
- Official field semantics: Sections 2.16.7 (Identifiers), 2.16.14 (opaque ID),
  and the co-located-site discussion in
  https://root-servers.org/media/news/draft-rsos-rss-operational-information.pdf .
  A/J naming convention fields were blank; their operator-supplied identifiers
  do not provide a proven per-replica translation for legacy Atlas names.
- E: the research Table 2 documents a server prefix and city/IATA segment.
  Recorded p/c/n forms and numeric city suffixes are parsed independently. Exact
  Identifiers still win; city matching must have exactly one official site.
  All 328 E sites in the local official recording had empty Identifiers. Unique
  city cases now match, but co-located sites are never picked arbitrarily.
  NASA's https://e.root-servers.org/ points to root-servers.org for locations and
  supplies no per-replica alias mapping. No p/c-prefix-to-scope guess is made.
- https://indico.dns-oarc.net/event/32/contributions/713/attachments/704/1168/wessels-root-atlas.pdf
  is Verisign's own presentation of hostname.bind measurements and the legacy
  nnn1-lon8 example, but is not a per-instance alias table.
- Current metadata for 10309/10313/10316 (and inspected SOA 10009/10013/10016)
  did not request NSID (set_nsid_bit null). Recorded A/E/J hostname results have
  no OPT/NSID additional record (ARCOUNT=0 where a DNS response exists). We do
  not invent or add an NSID query to an existing measured result.

A/E/J default rates vs PR18: A 0/32 vs 0/48; E 1/32 vs 0/48; J 0/32 vs 0/48.
Others: B 31/32, C 14/32, D 29/32, F 30/32, G 31/32, H 31/32,
I 30/32, K 30/32, L 31/32, M 31/32. Counts include stale/error/unmatched results.
These are real recording replays evaluated at the latest recorded observation,
not a claim the observations remain fresh forever. Different samples/times mean
this is not a controlled performance comparison of identical probes.

## Performance and reproduction

Record privately outside the repository (prints temp paths; --curl is an optional
local recording fallback for this Windows environment's Node TLS failures):

    node --experimental-strip-types worker/ripeAtlas/record.mjs --curl
    node --experimental-strip-types worker/ripeAtlas/benchmark.mjs ROOTS.json RECORDING.json 32,36,48,80,100,128,200

No runtime dependencies were added. The benchmark pre-serializes upstream bodies,
then measures 100 complete cold-cache handlers, including JSON decode/parse,
sampling, root matching, snapshot serialization and three cache-write consumers.
Root JSON is pretty printed; probe/measurement bodies retain all recorded fields.
No rate-limit sleep/network latency is included. Metrics are local Node v24.16.0
main-thread averages, NOT Cloudflare billing or worst-case guarantees.

Observed cold CPU ms: 32=9.38-9.70, 36=8.75-10.16, 48=9.54-10.15, 80=11.41-11.57,
100=12.02-12.81, 128=12.97-13.28, 200=15.78-16.73; PR18=8.44.
The latest 32-probe run after removing a redundant UTF-8 byte copy measured
9.38 ms main-thread / 10.94 ms process-wide. Default measurement URL 226 chars,
maximum per-letter result 17,737 bytes, 13 result bodies 215,367 bytes. At 200: URL 1,066 chars and max result 110,214
bytes, below the unchanged 1.5 MB per-response guard. Output always <=3,000 flows.

Default cold budget: 13 roots + 3 anchor pages + 13 measurements =29 HTTP,
3 cache reads +3 writes =>35 total. Worst four-page pool =>36 total.
Normal memory refresh:13 HTTP +1 write =>14. Root renewal:13 roots+13 measurements
+2 writes=>28 with valid probe memory. If probes also expire, four extra reads
and writes plus up to four pages still keep the conservative total <=36.
Root refresh remains background waitUntil between 23h and 24h; missing/expired
roots synchronously load. Probe coordinates keep 24h TTL. Failed measurement
refreshes reuse good snapshots only within five minutes, then return 503.

UI/integrator suggestions only (not implemented): label the geographic anchor
sample size/country count and A/J's unresolved station mapping. If city-only E
queries should ever be displayed, add explicit location precision and a city
selection shape to the contract first; never assign an arbitrary RootInstance.id.

Atlas attribution and terms remain RIPE Atlas / RIPE NCC, Service Terms v3.5
Article 4 (commercial use needs prior permission, not CC BY):
https://www.ripe.net/about-us/legal/ripe-atlas-service-terms-and-conditions/
Root site reuse licence is unverified; real root response recordings are not
committed. Official API references:
https://atlas.ripe.net/docs/apis/rest-api-reference/probes/probes_list
https://atlas.ripe.net/docs/apis/rest-api-manual/core-concepts/query-parameters/
