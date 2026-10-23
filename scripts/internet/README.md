# Internet infrastructure data

Default: Node 22 ESM, no additional dependencies:

```
node --experimental-strip-types scripts/internet/build.mjs
npm test
```

Generates exactly `cables.json`, `facilities.json`, `ixps.json` in
`public/data/internet/`. No static `root-servers.json`: C line supplies root
information live through the Worker. The static root URL/hook is a separate
integration task; shared interfaces and UI files are not edited here.

## Licensing (verified 2026-10-23)

OSM data and the derived cables/facilities JSON databases are distributed under
**ODbL 1.0, © OpenStreetMap contributors**, separately from the code license.
Attribution and share-alike apply. Keep source credit visible in the app.
[OSM copyright](https://www.openstreetmap.org/copyright),
[ODbL legal text](https://opendatacommons.org/licenses/odbl/1-0/).

Wikidata structured data and `ixps.json`: **CC0 1.0**.
[Wikidata copyright](https://www.wikidata.org/wiki/Wikidata:Copyright),
[CC0 legal text](https://creativecommons.org/publicdomain/zero/1.0/).
The ODbL and CC0 databases stay separate. Restricted data/caches are never used
as a fallback or mixed into these files.

Exact Overpass and SPARQL queries are exported in `open-sources.mjs`.
Overpass endpoint: https://overpass-api.de/api/interpreter . Wikidata endpoint:
https://query.wikidata.org/sparql . Each output carries license, retrieval/build
timestamps and source links; OSM base timestamps are also in the quality report.

## Cables: tags, grouping and endpoints

Query `communication=line` or `telecom=line/cable` with `location=underwater`
or `submarine=yes`; also query `seamark:type=cable_submarine`, communication/
telecom route relations, and parents of matching ways. Accept seamark categories
telephone, telegraph, optical, fibre_optic as communication evidence. Exclude
explicit power/transmission/mooring/ferry and unclassified marine cables, and
power route relations: a submarine seamark alone need not carry communications.
[Communication line](https://wiki.openstreetmap.org/wiki/Tag:communication%3Dline),
[submarine](https://wiki.openstreetmap.org/wiki/Key:submarine),
[telecom guidance](https://wiki.openstreetmap.org/wiki/Telecommunication),
[marine categories](https://wiki.openstreetmap.org/wiki/Key:seamark:cable_submarine:category).

Route relation identity takes precedence over member ways; exact name/ref merges
split segments and disjoint branches. No fuzzy identity or proximity links.
Unnamed/unreferenced ways join only when they share an end node (the mapper
connected them in OSM's own topology; `joinByEndNodes`); the group takes the
lowest way id. Ways that merely lie close together stay apart, so the count
still measures mapped fragments, not unique global cable systems. Within a
cable, ways are stitched end to end through nodes shared by exactly two ways
(`stitchSegments`), so the line and its pulses run continuously; a junction
of three or more ways stays a branch point. Missing names are explicitly
marked as unnamed OSM objects; existing `name` tags are preserved. `start_date`
provides `rfsYear` if parseable, else null. Conflicting segment dates stay unknown
unless the route provides a year. OSM start dates are not independently verified
commercial RFS dates. Operators/owners copy tags; no cable length is invented.
Existing 0.04-degree Douglas–Peucker simplification and ±180° splitting apply.

No landing stations are published: OSM has no landing-station tagging to rely
on, and the loose ends of ways are often mid-sea where mapping stops. They are
only counted (`looseEnds` in the quality report). No coastal station
name/location is fabricated or imported from restricted sources.

## Data centers

Query `telecom=data_center`, `building=data_center`, `building:use=data_center`.
[Tag documentation](https://wiki.openstreetmap.org/wiki/Tag:telecom%3Ddata_center).
Ways/relations use Overpass bounding-box centers, not entrances or geometric
polygon centroids. Campuses, buildings and POIs can overlap: counts are mapped
objects, not deduplicated physical businesses. Numeric ID is OSM_ID * 4 + typeCode
(node 0, way 1, relation 2), checked as a safe integer. Name/operator/address copy
tags; absent interconnection/network counts are 0.

## IXPs

SPARQL uses P31/P279* Q1433061 (Internet exchange point), direct P625 coordinates,
otherwise P159 headquarters or P131 location restricted to Q486972 human
settlements and their P625. These city fallbacks are **inferred city locations**,
not exact IXP facilities; affected QIDs appear in the quality report. Distinct
multiple coordinates are excluded rather than selecting an arbitrary site.
Items without coordinates are omitted. ID is Q-number; website P856; members
P2124 when unambiguous (not guaranteed current). Conflicting counts become null.
Port capacity remains null and facilityIds stays empty: no OSM links are invented.

## Validation and automation

All three sources must pass application parsers without dropped/changed rows,
references, unique IDs, size/count budgets before a directory swap publishes the
bundle. Overpass `remark` (including partial timeouts) fails the build. Source
failure preserves old files and fails the run. Unchanged content and license
metadata preserve timestamps, avoiding timestamp-only commits. Quality report:
`.cache/internet-quality.json` and console output.

Floors: 500 cable records, 2000 data-center objects, 10 IXPs; zero inferred
landings is valid. These catch empty/truncated responses, not global completeness.
Weekly Monday 03:17 UTC and manual dispatch; PR runs use the same open-data build.
Only successful main runs commit changed data. No root-server file is generated.

Serial requests, at least one second apart (two for PeeringDB if enabled), at most
four attempts. Overpass timeout is 240 seconds for a 180-second server query;
other requests 60 seconds. Retry-After is bounded. No extra npm dependencies.

## Restricted adapters: disabled by default

`sources.mjs` retains PeeringDB, TeleGeography and root-servers.org adapters.
The project is not seeking permission. Default builds/workflows neither call
those endpoints nor read their caches. Explicit `--restricted` additionally
requires both INTERNET_DATA_PUBLICATION_APPROVED=true and a nonempty
INTERNET_DATA_PERMISSION_REFERENCE. Even with approval, output must be in .cache:

```
node --experimental-strip-types scripts/internet/build.mjs --restricted --output-dir .cache/restricted-preview
```

Do not set approval without evidence. [PeeringDB AUP](https://www.peeringdb.com/aup)
requires bulk redistribution approval. TeleGeography's current
[About](https://www.submarinecablemap.com/about) wording covers map references,
URLs/screenshots under CC BY-SA 4.0, not clearly bulk geocoded data;
[data licensing](https://www2.telegeography.com/license-geocoded-map-data) is separate.
No explicit data reuse license was found at https://root-servers.org/ .
