# Earth Atlas · 地球科学图集

Interactive 3D geological globe for exploring **mapped surface rock units**, geological ages, and lithologies.

## Features

- Drag the 3D globe to rotate; use wheel or touch to zoom.
- Toggle the Macrostrat global geologic raster map and change its opacity.
- Click the globe to retrieve **all reported surface map-unit candidates** at that coordinate; select among overlapping map results.
- Display best representative chronostratigraphic interval, original lithology, approximate numerical age and uncertainty notes, polygon/source identifiers; additionally resolve source lithology IDs through the official Macrostrat `/defs/lithologies` dictionary.
- Fly to example regions. Chinese-first UI with scientific English preserved.
- Explicit loading, no-data, network-error, and attribution states.

## Getting started

Requires Node.js 22+ and npm.

1. Run: npm install
2. Run: npm run dev
3. Open the local URL printed by Vite.
4. Run validation: npm test && npm run typecheck && npm run build

There is no Cesium ion token or proprietary basemap in this MVP. The globe uses the Natural Earth II texture bundled with Cesium (works offline) under NASA Blue Marble shaded relief and bathymetry tiles from NASA GIBS (public domain), set against Cesium's star-field sky box and atmosphere. A network connection is required for Blue Marble and Macrostrat tiles and point queries.

## Cloudflare Workers static-assets deployment (current production target)

Actual service: https://earth-atlas.edwardlab.workers.dev/ (Cloudflare Workers, not Pages). GitHub builds alone do not prove the deployed Worker serves its static assets.

Cloudflare Workers must upload the **whole** Vite output including `dist/cesium/Workers`, `dist/cesium/Assets`, `dist/cesium/Widgets`, and `dist/cesium/ThirdParty`. The repository now contains `wrangler.jsonc` with `assets.directory: ./dist` and `not_found_handling: 404-page` so absent JavaScript does not silently return `index.html`.

Recommended Git-connected Worker build/deploy configuration (verify against your Cloudflare setup):

- Repository: `zeye-w/Earth-Atlas`
- Build command: `npm install && npm run build && npm run verify:assets`
- Deploy command: `npx wrangler deploy` (requires Wrangler/cloud deployment authorization)
- Deploy assets: `./dist` as specified in `wrangler.jsonc`
- Production branch: `main`

If you use the Cloudflare console's default Git integration build flow, ensure its deploy command actually reads the repository's Wrangler configuration and uploads the entire `dist` tree. Avoid upload methods that only publish `index.html` or `dist/assets`.

Browser smoke test after deployment:

1. Open `https://earth-atlas.edwardlab.workers.dev/cesium/Workers/transferTypedArrayTest.js`
2. The response must be **200 JavaScript**, not the Earth Atlas HTML page.
3. Open `https://earth-atlas.edwardlab.workers.dev/cesium/Workers/createVerticesFromHeightmap.js` and confirm the same.
4. Open DevTools > Network, reload the page, and verify Worker files are status 200 and type `javascript`.

CI runs TypeScript, Vite production build, and verifies the existence of Cesium worker files in `dist` (it does not prove Cloudflare has uploaded them). For reproducibility, commit the npm lockfile generated from a clean npm install.

## Scientific scope and limitations

Geological units represent mapped **surface bedrock or superficial units**, not subsurface geology at arbitrary depth. The blended Macrostrat `/carto` raster does not correspond to one fixed `tiny/small/medium/large` source bucket; therefore the point API is intentionally queried without a forced scale. Overlapping results are shown as **candidates**, not asserted to be a pixel-perfect match to the visualized map. At varying map scales, unit precedence and local data completeness may change. Each map unit may include multiple lithologies; do not infer a precise rock type where the data are missing.

Displayed geologic colors are supplied by Macrostrat map compilations and are not a guarantee of a uniform global ICS age palette.

The geology parser is exercised by offline unit/contract tests using the [documented rmacrostrat Hell Creek example](https://rmacrostrat.palaeoverse.org/articles/geologic-map.html) and constructed edge-case fixtures. **These are not live API or production-browser smoke tests.**

## Open data attribution

The geologic map and unit queries are provided by [Macrostrat](https://macrostrat.org), CC BY 4.0. Attribute Macrostrat and underlying map providers where provided by the selected source_id. For source metadata see [Macrostrat sources](https://macrostrat.org/api/v2/defs/sources).

- Documentation: https://macrostrat.org/docs/data-services
- Raster tiles: https://tiles.macrostrat.org/carto/{z}/{x}/{y}.png
- Point query: https://macrostrat.org/api/v2/geologic_units/map?lat=43&lng=-89.3

## Lithology classification and era guide

The inspector distinguishes the map-author's raw `lith` field from Macrostrat-normalized `liths` IDs. Rock type classes (sedimentary, igneous and metamorphic) are shown **only** if all recognized IDs have an unambiguous class according to the official public dictionary. Missing IDs, mixed classes, and unavailable dictionary requests are labeled rather than guessed.

The geological-era summary uses approximate ICS major boundaries (66, 251.902, 538.8 Ma) and only assigns an era if the complete numerical map-unit range is inside it. Colors are an **illustrative information-panel legend**, not the map's global geologic-age palette. A recolorable global map will require processing Macrostrat vector tiles rather than recoloring the existing raster PNG.

## Roadmap

MVP: 3D globe + data query + map attribution. Next: official geologic age palettes, normalized lithology classification, saved locations, automated verification of API compatibility.

## License

MIT for this repository's code. Third-party geologic datasets retain their own licenses.
