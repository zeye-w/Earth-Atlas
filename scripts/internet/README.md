# Internet infrastructure data builder

PUBLICATION WITHHELD — no PeeringDB bulk redistribution approval has been obtained
(confirmed by the project owner on 2026-10-23). No production JSON is committed.
This is an implementation awaiting permission, not a completed production dataset release.

Requires Node 22 with `--experimental-strip-types`; no npm dependencies added.

```
node --experimental-strip-types scripts/internet/build.mjs --output-dir .cache/internet-preview
```

This builds a local research preview, excluded from Git. To validate it:
set `INTERNET_DATA_TEST_DIR=.cache/internet-preview` and run `npm test`.
Quality counts are printed and written to `.cache/internet-quality.json`.
Requests are serial, at least one second apart, with a 60-second timeout and
at most four attempts. Pagination fails on duplicate IDs or excessive pages.
All four outputs must satisfy the actual application parsers, minimum counts,
unique IDs, cross-file references and byte budgets before replacing the old directory.
An unchanged dataset retains its original build/retrieval timestamps to avoid
timestamp-only commits. A failed upstream never publishes partial data.

## Source and permission verification (2026-10-23)

- TeleGeography GeoJSON: <https://www.submarinecablemap.com/api/v3/cable/cable-geo.json>
  and <https://www.submarinecablemap.com/api/v3/landing-point/landing-point-geo.json>;
  details: `/api/v3/cable/{id}.json`. All responded HTTP 200.
  Current [About](https://www.submarinecablemap.com/about) text labels map
  references, URLs and screenshots CC BY-SA 4.0, not the old CC BY-NC-SA 3.0.
  That wording does not clearly license bulk geocoded data redistribution.
  [Map licensing](https://www2.telegeography.com/license-telegeography-map) and
  [data licensing](https://www2.telegeography.com/license-geocoded-map-data)
  must be distinguished; obtain confirmation for the derived JSON.
- PeeringDB `/api/ix`, `/api/fac`, `/api/ixfac`, `/api/netixlan` all responded
  HTTP 200 to sample requests. [API](https://www.peeringdb.com/apidocs/),
  [API keys](https://docs.peeringdb.com/howto/api_keys/),
  [AUP](https://www.peeringdb.com/aup): Internet research and analysis is an
  operational purpose, but passing data on in bulk requires PeeringDB approval.
  Noncommercial status alone does not establish redistribution permission.
- [Root Server Technical Operations Association](https://root-servers.org/)
  exposes each letter at `https://root-servers.org/root/{A..M}/json/`.
  A and K returned HTTP 200 during initial verification. No explicit data reuse
  license was found on the homepage or JSON; do not invent a CC license.
  [Contact](https://root-servers.org/contact/) for reuse clarification.

## Enable production only after permissions are documented

Record approvals for all three sources in a reviewable issue/document. Set
repository variables `INTERNET_DATA_PUBLICATION_APPROVED=true` and
`INTERNET_DATA_PERMISSION_REFERENCE` to that evidence. Use the same environment
variables locally for the normal entry point:

```
node --experimental-strip-types scripts/internet/build.mjs
```

The weekly workflow and main dispatch deliberately fail before fetching or
writing production data until these variables exist. Branch dispatches build
and pull-request runs build only an ephemeral `.cache` research preview, validate the actual data and never
upload datasets or commit to main; only successful main runs can commit. Merge
remains subject to Claude review under the collaboration document.

## Quality limitations

Cable routes are generalized map paths, not surveyed seabed trajectories.
Country names not confidently mapped to ISO alpha-2 are null. Landing references
without geolocated records are omitted and counted. RFS years retain future years.
PeeringDB contains self-reported data. Facilities without coordinates are omitted.
IXP positions use geolocated member-facility centroids; fallback uses facilities
in the same country/city as an explicitly approximate city coordinate. IXPs
without either are omitted and counted. Port sums include active (`status=ok`)
netixlan records, in Gbit/s; unknown totals remain null. Members use `net_count`.
Root records represent upstream sites, sometimes grouping multiple colocated
instances; only supplied identifiers are copied, with no speculative patterns.
Blank upstream status is accepted (A-root uses it), explicit suspended or
decommissioned sites are excluded. Stable IDs combine root letter and upstream
site ID; array order never determines identity.

The default test suite checks publication withholding when no production data
exists. This is explicitly not the production count acceptance test: after
permission, all four real files must pass `validateBundle` and the size/count tests.
