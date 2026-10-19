# TerraScope · 数字地球

Interactive 3D digital Earth: real-time day/night lighting, satellites predicted from public orbital elements, world cities, and on-demand global surface geology (**mapped surface rock units**, geological ages, and lithologies).

The page shows a static splash until the first globe tiles load. Cesium is emitted as its own long-lived chunk, and the satellite modules (including `satellite.js`) load only when the satellite layer is enabled.

## Default Earth view: real sunlight and cities

The first-load Earth experience prioritizes NASA Blue Marble / Natural Earth imagery: **global Macrostrat geology is OFF by default** and its raster imagery provider is not created until you explicitly enable the geological layer. The age/lithology thematic layers remain available on demand.

**Real day and night:** Cesium's `SunLight` replaces the earlier camera-following decorative directional light. The lighting direction is calculated from the Cesium clock in real UTC, refreshed from the browser's current UTC instant every 60 seconds and when returning to a hidden tab, with explicit scene renders only at those moments. Because this is an ephemeris-driven illumination model rather than a daylight/nightlight dataset, it **does not depict artificial city light emissions or current cloud cover**. Device clock errors can shift the terminator. Toggle it on/off in the layer control.

**Important cities:** A bounded hand-curated WGS84 marker set of approximately 50 prominent world cities displays approximate city-centre positions. Primary labels are visible in global views, and secondary labels appear only at regional zoom to reduce clutter. The list is an illustrative selection, **not** a definitive population ranking or authoritative municipal-boundary centroid dataset. Labels are depth-tested against the globe and can be turned off independently. No paid city map service or tracking API is used.

**Northern aurora (illustrative):** animated translucent curtains are drawn around the IGRF geomagnetic north pole at typical auroral-oval distances (~20–23°) and altitudes (~95–330 km), and fade out on the sunlit side using the real sun direction. They are an artistic illustration only, **not** an aurora observation or forecast (e.g. NOAA OVATION); the layer can be turned off.

## Features

- Drag the 3D globe to rotate; use wheel or touch to zoom.
- Toggle the Macrostrat raster or experimental global geological-age and lithology vector overview maps; switch scientific filters and adjust opacity.
- Click the globe to retrieve **all reported surface map-unit candidates** at that coordinate; select among overlapping map results.
- Display best representative chronostratigraphic interval, original lithology, approximate numerical age and uncertainty notes, polygon/source identifiers; additionally resolve source lithology IDs through the official Macrostrat `/defs/lithologies` dictionary.
- Fly to example regions. Chinese-first UI with scientific English preserved.
- Explicit loading, no-data, network-error, and attribution states.

## Fullscreen immersive interface

The Cesium globe fills the browser viewport (100dvh). The layer manager and point inspector float as frosted, translucent cards instead of taking fixed columns. The inspector opens when a globe location is selected, and either card can be collapsed from the header. On narrow/mobile viewports, the controls become mutually exclusive bottom sheets so the globe remains the primary surface.

The animated space overlay is **pure CSS** (drifting stars and low-intensity nebula glow), with no additional image downloads or JavaScript particle loops. Users can pause it with the **动效开 / 动效关** header control, and `prefers-reduced-motion: reduce` disables the motion by default. A separate **全屏** control requests browser fullscreen where supported; fullscreen viewport layout works without it.

Cesium's native map attribution and data citations remain visible. CSS visual effects are pointer-transparent and do not intercept globe rotation, zoom or click queries.

## Performance defaults and quality control

The full-screen globe now uses Cesium **request-only rendering** (`requestRenderMode`) with no idle camera auto-rotation. The CSS starfield can still drift, but does not force repeated WebGL draws. The star effects automatically pause when the page is hidden.

The top-bar diamond **◇** switches render-quality presets:

| Mode | Resolution scale | Frame cap | Screen-space error | Effects |
| --- | ---: | ---: | ---: | --- |
| 省电 · Eco | 0.75 | 30 fps | 4 | No FXAA, minimal blur and star layers |
| 均衡 · Balanced | 1.0 | 45 fps | 2.5 | Restrained glass and stars |
| 高清 · High | 1.25 | 60 fps | 1.6 | Higher pixel density and terrain fidelity |

Phones, users requesting reduced motion, and devices reporting four or fewer CPU cores start in Eco mode. Large-screen devices start in Balanced; no mode increases the image to 2× just because the display is high DPI. The ✦ button pauses decorative CSS star motion, independently of quality.

The experimental global MVT overlay is built on demand only when the age or lithology thematic map is selected. Its global tree is capped at zoom 5 (1,365 hierarchy nodes, versus 5,461 at zoom 6), while the raster map remains available for closer visual geology. Macrostrat data validation and source attribution are unchanged.

To evaluate actual improvement, open DevTools → Performance / Performance monitor and compare CPU utilization, GPU activity, dropped frames and memory on the same computer at the same map coordinates. GitHub CI validates code and build, **not real-device frame rates**.

## Atmosphere and live-predicted satellite orbits

The globe uses Cesium's native `SkyAtmosphere` and `Globe.showGroundAtmosphere` with tuned Rayleigh/Mie scattering parameters. The atmospheric limb and ground haze remain illuminated by the real SunLight/UTC clock and can be toggled independently, without using a separate animated atmosphere mesh or expensive video shaders. This is an atmospheric **visualization**, not a numerical weather or radiative-transfer model.

The Satellite layer (on by default for desktop; off for small/mobile viewports) uses **CelesTrak public GP orbital elements in CCSDS OMM JSON**, retrieved on demand over HTTPS from `/NORAD/elements/gp.php` (stations group, plus four selected individual catalog numbers). Elements are cached in browser localStorage for **at least two hours**, respecting CelesTrak's update policy. Missing, invalid or more-than-10-day-old elements are not shown as current satellite positions.

Positions at the current UTC instant are computed in the browser using `satellite.js` and **SGP4**. ECI coordinates are converted to Earth-fixed geodetic longitude/latitude/altitude before feeding Cesium. Selected trajectories are a **90-minute forecast window, ±45 minutes around now**, updated every two minutes; moving markers update every five seconds while the tab is visible. Orbit paths are rendered at true space altitude and have no ground clamp. Only a small fixed catalogue (ISS, Tiangong, Hubble, Terra, NOAA-20, Landsat 9) is queried; an unavailable satellite is silently omitted and the UI shows a source error if none can be used.

**Scientific boundaries:** orbital positions are SGP4 predictions derived from periodically updated public elements, **not real-time onboard GPS telemetry**; uncertainty can increase with element age and manoeuvres. Displayed satellite icons and orbit paths are symbolic and not drawn to the physical scale of the spacecraft. Satellite catalog numbers or group membership may change, so each unavailable/decayed object is dropped instead of drawing artificial circular animation. Browser time should be synchronized. CelesTrak metadata and data attribution are visible in the layer UI, and all satellite controls are optional for battery performance.

## Getting started

Requires Node.js 22+ and npm.

1. Run: npm install
2. Run: npm run dev
3. Open the local URL printed by Vite.
4. Run validation: npm test && npm run typecheck && npm run build

There is no Cesium ion token or proprietary basemap in this MVP. The globe uses the Natural Earth II texture bundled with Cesium (works offline) under NASA Blue Marble shaded relief and bathymetry tiles from NASA GIBS (public domain), set against Cesium's star-field sky box and atmosphere. A network connection is required for Blue Marble and Macrostrat tiles and point queries.

## Thematic maps: vector overview (experimental)

The **Map Style** control offers three modes:

- **Original raster** (default and fallback): Macrostrat pre-rendered `/carto/{z}/{x}/{y}.png` map.
- **Geological age**: stream Macrostrat `/carto/{z}/{x}/{y}` Mapbox vector tiles directly into Cesium via `MVTDataProvider`. The `units` polygon properties `best_age_top` and `best_age_bottom` provide full-range classification into broad geological eras (Cenozoic, Mesozoic, Paleozoic and Precambrian). Records with missing, conflicting or cross-era ages remain gray. The legend is an *overview*, not an official ICS map color standard.
- **Lithology (indicative only)**: render polygon colors and optional category filters using *explicit English keywords in the map author's free-text `lith` field*. The vector tiles **do not contain normalized `liths` IDs**, unlike the point-query API. Consequently this mode is **not** a scientifically validated global lithology classification. Ambiguous or missing descriptions remain gray, and selecting a category excludes ambiguous matches.

Cesium currently eagerly creates the MVT tile hierarchy. For global safety, this implementation caps its vector source to **zoom levels 0 through 6** (5,461 quadtree nodes); zooming into local areas does not increase vector detail beyond this. Default raster detail remains available when switching back. Vector mode is lazily initialized, remains optional, and falls back to the raster if the provider fails to initialize. A real-browser WebGL visual check is still required after each deployment.

MVT source schema and CORS were verified via `scripts/inspect-vector-tiles.mjs` on GitHub Actions: the `units` layer contains `map_id`, `best_age_top`, `best_age_bottom`, and `lith` and responds with `Access-Control-Allow-Origin: *`. The same tiles include a `lines` layer without polygon/age attributes; styles guard missing fields to avoid renderer exceptions.

Details: [Cesium MVT tutorial](https://cesium.com/learn/cesiumjs-learn/load-mapbox-vector-tiles-in-cesiumjs/) and [Macrostrat vector tile documentation](https://macrostrat.org/docs/data-services/use-in-qgis).

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
2. The response must be **200 JavaScript**, not the TerraScope HTML page.
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
