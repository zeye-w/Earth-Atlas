# TerraScope technical notes

Detailed behaviour, data handling, scientific limits and deployment notes. For an overview with screenshots see the [README](../README.md) ([中文](../README.zh-CN.md)).

The page shows a static splash until the first globe tiles load. Cesium is emitted as its own long-lived chunk, and the satellite modules (including `satellite.js`) load only when the satellite layer is enabled.

## Default Earth view: real sunlight and cities

The first-load Earth experience prioritizes NASA Blue Marble / Natural Earth imagery: **global Macrostrat geology is OFF by default** and its raster imagery provider is not created until you explicitly enable the geological layer. The age/lithology thematic layers remain available on demand.

**Real day and night:** Cesium's `SunLight` replaces the earlier camera-following decorative directional light. The lighting direction is calculated from the Cesium clock in real UTC, refreshed from the browser's current UTC instant every 60 seconds and when returning to a hidden tab, with explicit scene renders only at those moments. **City lights:** the night side shows NASA Black Marble 2016 (VIIRS Day/Night Band annual composite, via NASA GIBS), blended in by Cesium's per-layer `nightAlpha` across the real terminator. Only the lights are kept from each tile (warm emission is separated from Black Marble's navy background and moonlit ground in `src/nightLightsColor.ts`, then given a soft glow), and underneath them the day imagery is shown darkened and desaturated, so the night side is the same Earth rather than a second map pasted over it. It is a 2016 composite, **not tonight's lights**, and there is no current cloud cover. Tiles lying entirely in daylight (Sun more than 12° above the horizon across the whole tile, from a low-precision solar ephemeris) are not downloaded; the layer is rebuilt every 24 minutes as the terminator moves. Device clock errors can shift the terminator. Toggle it on/off in the layer control.

**Important cities:** A bounded hand-curated WGS84 marker set of approximately 50 prominent world cities displays approximate city-centre positions. Primary labels are visible in global views, and secondary labels appear only at regional zoom to reduce clutter. The list is an illustrative selection, **not** a definitive population ranking or authoritative municipal-boundary centroid dataset. Labels are depth-tested against the globe and can be turned off independently. No paid city map service or tracking API is used.

**Geographic labels:** about 130 names of oceans, seas, straits and major mountain ranges (on by default; toggle "地理标注"). Label positions come from Natural Earth 1:10m geography polygons (public domain): each sits at the polygon's pole of inaccessibility, with a few long features and features Natural Earth lacks (e.g. the Strait of Hormuz, Bering Strait) placed by hand. Names are curated simplified Chinese, because Natural Earth's own Chinese names mix simplified and traditional forms. Smaller features appear as you zoom in, and labels beyond the horizon are hidden. Regenerate with `node scripts/build-geo-labels.mjs` (writes `src/data/geoLabels.json`).

**Northern aurora (NOAA OVATION):** the aurora layer reads NOAA SWPC's OVATION nowcast (`services.swpc.noaa.gov/json/ovation_aurora_latest.json`, a 1° grid of visible-aurora probability, refreshed here every 10 minutes). For each longitude the curtain is drawn at the probability-weighted latitude of the northern oval (95–330 km altitude), with brightness from the peak probability there; the ripple animation and colours are stylistic. Curtains fade on the sunlit side. If the feed is unavailable nothing is drawn, and the panel says so.

**Earthquakes and plate boundaries:** real-time earthquakes come from the USGS GeoJSON summary feeds (M2.5+ for the past day or week, M4.5+ for the past month), refreshed every 5 minutes while the layer is on. Marker size grows with magnitude, colour shows depth class (shallow <70 km, intermediate 70–300 km, deep >300 km), and events from the last 24 hours have a white outline; click one for time, magnitude, depth and a link to the USGS event page. If the feed fails nothing is drawn. Plate boundaries are Bird (2003) PB2002 (*An updated digital model of plate boundaries*, G³ 4(3), doi:10.1029/2001GC000252), using the GeoJSON conversion by Hugo Ahlenius / Nordpil (github.com/fraxen/tectonicplates, ODC-BY 1.0), bundled as a lazily loaded chunk; subduction zones are highlighted.

**Volcanoes:** the Smithsonian Global Volcanism Program *Volcanoes of the World* Holocene list (≈1,200 volcanoes) is bundled as a lazily loaded chunk (`src/data/volcanoes.json`). Volcanoes whose catalogued last eruption is within 5 years are drawn as red triangles; others appear as small muted triangles once zoomed in. This reflects catalogue eruption years, **not** real-time alert levels. Refresh the data with the manual **Refresh Volcano Data** workflow (`scripts/fetch-volcanoes.mjs`), which downloads the list from the GVP GeoServer and commits it if it changed. Cite: Global Volcanism Program, Smithsonian Institution, *Volcanoes of the World*.

**Geomagnetic activity (Kp):** next to the aurora layer the panel shows NOAA SWPC's current estimated planetary K-index (1-minute product) with the NOAA G-scale storm level, plus a bar chart of the last 24 hours of 3-hourly Kp.

**Automatic render quality:** while the camera moves (when Cesium renders continuously), the app measures the frame rate over 2-second windows; if it stays below 24 fps it steps quality down one level (high → balanced → eco) at most every 6 s and shows a notice. Choosing a quality manually in Settings turns this off; it can be re-enabled there.

**Atmosphere layers:** optional translucent shells mark the tops of the troposphere (an ellipsoid, ~17 km at the equator to ~9 km at the poles), stratosphere (50 km), mesosphere (85 km), the Kármán line (100 km, a convention) and the thermosphere (~600 km; varies ~500–1000 km with solar activity), after the U.S. Standard Atmosphere 1976. A Fresnel rim shader makes each boundary glow only where the line of sight grazes it. At true scale the troposphere is under 0.3 % of Earth's radius, so the layers show as thin rings at the limb; a 5× / 20× height exaggeration is available and labelled as illustrative. The scale is kept in shared scene links (optional, so older links remain valid).

**Code layout and tests:** `src/App.tsx` only composes; the viewer, render quality and layer settings live in `src/hooks/`, each map layer in its own hook under `src/layers/` (live feeds share `usePolledData`), and the UI in `src/panels/` and `src/ui/`. `npm test` runs the unit tests; `npm run test:e2e` runs the Playwright suite against the production build (run `npm run build` first) with every external service mocked by synthetic fixtures (`tests/e2e/mocks.ts`). Set `PW_CHROMIUM_PATH` to use an installed Chromium.

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

`wrangler.jsonc` also names a small Worker script (`worker/index.ts`) with `run_worker_first: ["/api/*"]`: only `/api/*` requests run it (today just `/api/flights`, see *Live flights*); every other path is served from the assets as before. `npx wrangler deploy` bundles it automatically; `npx wrangler dev` runs both locally (the Vite dev server has no `/api`).

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

Geographic label positions are derived from [Natural Earth](https://www.naturalearthdata.com/) (public domain).

The geologic map and unit queries are provided by [Macrostrat](https://macrostrat.org), CC BY 4.0. Attribute Macrostrat and underlying map providers where provided by the selected source_id. For source metadata see [Macrostrat sources](https://macrostrat.org/api/v2/defs/sources).

- Documentation: https://macrostrat.org/docs/data-services
- Raster tiles: https://tiles.macrostrat.org/carto/{z}/{x}/{y}.png
- Point query: https://macrostrat.org/api/v2/geologic_units/map?lat=43&lng=-89.3

Submarine cables and data centres: © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/). Internet exchanges: [Wikidata](https://www.wikidata.org/), CC0 1.0. Measured DNS queries: [RIPE Atlas](https://atlas.ripe.net/) (RIPE NCC), used under the [RIPE Atlas Service Terms and Conditions](https://www.ripe.net/about-us/legal/ripe-atlas-service-terms-and-conditions/) (article 4: responsible use for the service's purposes; commercial use needs prior permission). Root-server instance data from [root-servers.org](https://root-servers.org/) is used on the server only and not republished.

Live aircraft positions come from [adsb.lol](https://adsb.lol/) (data under the [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/)), with the [OpenSky Network](https://opensky-network.org/) REST API as a fallback; the globe credits both while the layer is on.

## Lithology classification and era guide

The inspector distinguishes the map-author's raw `lith` field from Macrostrat-normalized `liths` IDs. Rock type classes (sedimentary, igneous and metamorphic) are shown **only** if all recognized IDs have an unambiguous class according to the official public dictionary. Missing IDs, mixed classes, and unavailable dictionary requests are labeled rather than guessed.

The geological-era summary uses approximate ICS major boundaries (66, 251.902, 538.8 Ma) and only assigns an era if the complete numerical map-unit range is inside it. Colors are an **illustrative information-panel legend**, not the map's global geologic-age palette. A recolorable global map will require processing Macrostrat vector tiles rather than recoloring the existing raster PNG.

## Roadmap

MVP: 3D globe + data query + map attribution. Next: official geologic age palettes, normalized lithology classification, saved locations, automated verification of API compatibility.

## License

MIT for this repository's code. Third-party geologic datasets retain their own licenses.

## Satellite infrared cloud imagery

The optional “卫星云图（红外）” layer uses the SSEC / UW–Madison RealEarth `globalir` multi-satellite hourly infrared composite. Metadata is checked every 15 minutes while visible; all tiles are pinned to one observation timestamp. Observations older than six hours are rejected. No cloud requests are made until enabled. Tile zoom is capped at 5 to limit traffic.

This is infrared imagery containing cloud and surface signals, not a cloud mask, cloud height, or cloud fraction measurement. Cold surfaces, polar coverage and composite seams can be misleading. The imagery is draped on the globe, not a volumetric cloud model. Errors are displayed; no synthetic replacement is generated.

RealEarth free access has pixel-volume and website-registration/watermark restrictions. Preserve provider attribution and watermarks. Review https://www.ssec.wisc.edu/realearth/realearth-pro/ before high-volume deployment. The browser calls the provider directly; no proxy is used to bypass quotas.

## Location search and scene links

Use the header search to find cities, countries/territories, or latitude-first decimal coordinates (`39.9, 116.4`). Countries use bundled representative coordinates from [mledoze/countries](https://github.com/mledoze/countries), licensed under ODbL (see `src/data/countries.LICENSE`); these are navigation targets, not boundary or sovereignty determinations. Cities use the curated local list and [Open-Meteo / GeoNames](https://open-meteo.com/en/docs/geocoding-api). Online city searches send the entered search term to that service; the free API is for non-commercial use. Country and coordinate searches work locally.

Share captures camera longitude/latitude/height and orientation, all layer switches, cloud/geology opacity, thematic filters, earthquake time range, and selected location coordinates in a versioned URL fragment. Open a shared link to restore that scene and re-query the selected coordinate. Event selections are shared as their location, not a frozen event record. Live observations, predictions, and catalogs continue updating; a scene link is not a historical data snapshot. Invalid links safely retain normal defaults. If clipboard access is unavailable, copy the URL from the share field.


## Geographic labels and startup rendering budget

Geographic labels now include 12 deserts, 8 plains, 6 basins and 14 rivers (172 anchors total). Edit the category lists in `scripts/build-geo-labels.mjs`, then run `node scripts/build-geo-labels.mjs` to regenerate `src/data/geoLabels.json`. The generator fetches three Natural Earth 1:10m files (marine polygons, region polygons, river centerlines); optionally pass a directory containing those files for reproducible/offline generation. Polygon labels use interior anchors; river labels use the midpoint along the longest named line. These are representative labels, not full feature extents.

Screen-space collision layout uses measured text widths and padding, gives city/satellite labels priority, removes duplicate names in one view, and suppresses geographic labels that collide or leave the viewport. Smaller features appear only when zoomed in; names stay at their real anchors. Stationary frames reuse layout for up to one second rather than repeating projections on every animated frame.

Balanced quality caps pixel ratio at 1.25 (about 31% fewer framebuffer pixels than the previous 1.5 on high-DPI screens); High remains available. The bundled globe paints before remote Blue Marble imagery (1.5 s delay) and night-light extraction (1.8 s delay); night lights cap at zoom 6, with lower fine detail in exchange for less download/decode/pixel processing. Aurora animation requests 6 rather than 12 frames/s. These are rendering-budget reductions, not a measured FPS guarantee on all devices.

## Timeline

`src/timeline.ts` holds the scene clock (`TimeController`): **live** follows UTC (refreshed every minute and when the tab becomes visible); otherwise the user has moved to a fixed moment, or is replaying forward (24 h span: 1 h per second; 7 d: 6 h/s; 30 d: 1 day/s; reaching the present returns to live). The range is the chosen span back from now plus one day ahead. Layers subscribe imperatively, so replay ticks do not re-render the React tree:

- **Sunlight:** Cesium's clock (and so `SunLight` and the terminator) is set to the timeline moment.
- **Earthquakes:** events after the moment are hidden and those in the 24 hours before it are outlined, so replay shows them appearing in order. The time-bar span also selects the matching USGS feed (24 h/7 d at M2.5+, 30 d at M4.5+); before the feed's coverage the panel says earlier events are missing.
- **Satellites:** SGP4 positions at the moment (static while paused). Satellites whose elements are more than 10 days from the moment are hidden rather than drawn with large propagation error.
- **City lights:** daylit-tile skipping assumes "now", so away from live the layer is rebuilt without it.
- **Infrared clouds** show the hourly RealEarth frame for the moment (about 30 days are kept); a moment without a frame within two hours (before the archive, in a gap, or in the future) shows none and says so. During replay frames load at zoom ≤ 3 and each new frame replaces the previous one only after the globe has finished loading it.
- **Aurora/Kp** have only current data and are hidden away from live, with a note in the panel.
- **Daily true colour** shows the moment's UTC day (yesterday when live or in the future); the day is held during replay to avoid refetching every second.

Shared scene links carry the moment as optional `time` (ms since epoch); a moment older than 30 days opens live.

## Daily true-colour imagery

NASA GIBS `VIIRS_NOAA20_CorrectedReflectance_TrueColor` (EPSG:3857, `GoogleMapsCompatible_Level9`, JPEG, CORS `*`), one mosaic per UTC day assembled from the satellite's daytime passes. Black no-data areas (gaps between swaths, polar night) are made transparent so the Blue Marble base shows through; the layer is hidden on the night side. Clouds are as seen at each place's overpass time, not a single instant. The live smoke test checks yesterday's and a month-old tile.

## Southern aurora

The OVATION grid covers both hemispheres. `ovalProfile(grid, "north" | "south")` reduces each hemisphere (40°–89°) to a probability-weighted oval latitude and brightness per longitude, and curtains are drawn for each hemisphere that has any probability above the threshold. The panel reports the peak probability per hemisphere.

## Satellite pass predictions

`src/satellitePasses.ts` samples each loaded satellite every 30 s for the next 24 hours with SGP4 (the same CelesTrak elements as the globe), computing elevation and azimuth from the observer with `satellite.js` `ecfToLookAngles`. A pass runs from horizon to horizon (rise and set interpolated between samples) and is listed when it climbs at least 10°. "Visible to the naked eye" means that at some point above 10° the observer's Sun is below −6° (civil twilight) while the satellite is outside Earth's shadow (cylindrical shadow model). Satellites whose elements are more than 10 days from the window are skipped. The observer is the browser's geolocation (asked only when the button is pressed) or the point picked on the globe; it is used only in the browser. Selecting a pass highlights the satellite, moves the timeline to the pass's highest point and looks down on the observer. Predictions ignore refraction, terrain and brightness (magnitude), and can be off by a minute or so as elements age.

## Satellite tracking and the user's location

**Tracking** (the *Track* button in the satellite list, or clicking a satellite) sets Cesium's `trackedEntity` to the marker with a `viewFrom` offset behind and above it; the user can still orbit and zoom around it, and any other camera flight (reset, search, regions, passes) ends tracking. A card beside the marker (repositioned after every render, docked at the top on narrow screens) refreshes four times a second from `src/satelliteTelemetry.ts`: sub-satellite point, altitude, inertial speed, ground-track heading, sunlight (cylindrical shadow), orbital period, and — with the user's location — azimuth, elevation and range. It follows the timeline like the markers do, and says so when the moment is too far from the elements for a reliable position.

**User location** comes from the browser's geolocation only when the user presses *My location* (or *Use my location* in pass predictions); if the site already has permission it is shown on load without a prompt. A blue dot (with the accuracy circle when between 200 m and 100 km) marks it. It is not sent anywhere.

**Layer groups** in the left panel all start collapsed.

## Starlink constellation

The *Starlink* toggle downloads CelesTrak's GP group `starlink` as OMM CSV (about 1.7 MB for ~11,000 satellites; the JSON form is four times larger and does not fit in localStorage). It is kept in memory and in Cache Storage for two hours, CelesTrak's update interval. A module Web Worker (`src/constellationWorker.ts`) converts the rows with `satellite.js` `json2satrec` and propagates all of them with SGP4 (about 20 ms for 11,000), returning Earth-fixed positions and a sunlit/shadow flag (cylindrical shadow) in transferable typed arrays. The main thread updates one `PointPrimitive` per satellite: twice a second when live, or when the timeline moves. Satellites whose elements are more than 10 days from the scene time, or whose solution is below 100 km (decayed), are not drawn, and the panel says how many. Clicking a point shows its name, altitude and sunlight. Recording mode also waits for pending worker results (`src/pendingWork.ts`) before each frame.

## Solar wind and the magnetosphere

Data: NOAA SWPC real-time solar wind JSON (`/json/rtsw/rtsw_wind_1m.json` for proton speed and density, `rtsw_mag_1m.json` for the IMF in GSM), one-minute values over about the last 24 hours from the L1 monitors (currently SOLAR-1, IMAP and ACE). Per minute the row SWPC marks `active` is preferred; rows with unphysical values are dropped. The older `/products/solar-wind/*.json` tables now return 404. Live shows the latest sample; a timeline moment uses the nearest sample within 30 minutes, otherwise nothing is drawn and the panel says so.

Model: dynamic pressure Pd = 1.6726×10⁻⁶ · n · v² nPa; magnetopause from Shue et al. (1998), r(θ) = r₀ (2 / (1 + cos θ))^α with r₀ = (10.22 + 1.29 tanh(0.184 (Bz + 8.14))) Pd^(−1/6.6) and α = (0.58 − 0.007 Bz)(1 + 0.024 ln Pd). The bow shock is an approximation: the same shape with a 1.3× standoff and slightly less flaring. Both are surfaces of revolution about the Sun–Earth line (dipole tilt and aberration ignored), built once in a local frame and rotated to the Sun direction for the scene time, drawn with a Fresnel rim shader up to 135° from the nose. The magnetopause turns pink for southward Bz ≤ −5 nT.

Particles (2,200, each with a three-point trail) enter 26 Earth radii upstream and leave 30 downstream; inside the bow shock their radial distance is mapped between the shock and the magnetopause so none enter the magnetosphere. Their paths are illustrative; their speed is proportional to the measured speed (sped up about 100×), their colour follows the speed, and the number shown follows the density. In recording mode the animation phase is set by `setEffectsTime`. With this layer on, the camera may zoom out to 600,000 km.


## Live flights

Data: ADS-B and MLAT positions received by volunteer receivers and published by adsb.lol (`https://re-api.adsb.lol/?all_with_pos`, ODbL 1.0; typically 5,000–8,000 aircraft, about 3 MB of JSON). None of the open feeds can be called from the browser: adsb.lol and adsb.fi send no CORS headers, OpenSky only allows its own origin (and limits anonymous clients to 400 credits a day), and airplanes.live requires approval. So the site's Worker (`worker/index.ts`) serves `/api/flights`: it fetches adsb.lol with an identifying User-Agent (adsb.lol rejects generic ones), falls back to OpenSky `/api/states/all` if that fails or returns fewer than 100 aircraft, and keeps only what is drawn — ICAO hex, callsign, position, altitude (geometric, else barometric; metres; null on the ground), ground speed (m/s), track, type, registration, and the position's age. Positions older than 60 s and category C targets (airport vehicles, obstacles) are dropped. The result (about 400 KB of JSON before compression) is held in memory for 30 s per Worker isolate, so visitors share one upstream request; if a refresh fails the last snapshot is served for up to five minutes, otherwise the endpoint answers 502 and the panel says the data is unavailable.

The browser polls every minute while the layer is on and the timeline is live. Each aircraft is a billboard at its altitude, rotated to its track and coloured by altitude band (ground, below 3,000 m, 3,000–9,000 m, above 9,000 m). Between polls airborne aircraft are moved along a great circle at their reported ground speed and track (dead reckoning, at most two minutes past the report) — an estimate, as the panel says. Coverage depends on where volunteers run receivers: dense over North America, Europe and parts of Asia, sparse over the oceans, Africa and some countries, so the layer does not show every flight. The feeds keep no history, so away from live nothing is drawn and the panel explains why. Clicking an aircraft shows its callsign, type, registration, altitude, ground speed, track and how old the position report is.

## Internet infrastructure

Five layers (`cables`, `dataCenters`, `ixps`, `dnsFlows`, `rootServers` in the scene link). The data contracts are `src/internet/types.ts`; `src/internet/data.ts` holds the parsers that every producer tests its output against, and the app never draws an item that fails them (malformed items are dropped; a wrong version or a missing list fails the whole file).

**Static datasets.** `scripts/internet/build.mjs` builds three files in `public/data/internet/` from sources whose licences allow republishing, and the [internet-data](../.github/workflows/internet-data.yml) workflow rebuilds them every Monday (03:17 UTC), runs the unit tests on the result and commits only when the content changed; on a pull request that touches the pipeline it builds and tests without committing.

- `cables.json` (about 300 KB): OpenStreetMap ways tagged as underwater communication lines (`communication=line` or `telecom=line|cable` with `location=underwater` / `submarine=yes`, or `seamark:type=cable_submarine` with a communication category), queried through Overpass; power, mooring and ferry cables are excluded. Ways are grouped by route relation, then exact name or `ref`; unnamed ways stay separate. Paths are simplified (Douglas–Peucker, 0.04°) and split at ±180°. `start_date` gives the ready-for-service year when it parses (about 2 % of cables). No landing stations are published: OSM has no landing-station tagging, and the loose ends of ways are often offshore where mapping stops.
- `facilities.json` (about 800 KB, ~5,000 sites): `telecom=data_center`, `building=data_center` and `building:use=data_center`, nodes or area centres.
- `ixps.json` (a few KB, a few dozen exchanges): Wikidata items that are internet exchange points, with their coordinates or, failing that, their city's (an estimate).

OpenStreetMap data is ODbL 1.0 (© OpenStreetMap contributors) and Wikidata is CC0 1.0; each file records its sources, licence and retrieval time. Adapters for PeeringDB, TeleGeography and root-servers.org are kept but disabled: their terms need permission to republish bulk data, and running them requires `INTERNET_DATA_PUBLICATION_APPROVED=true` with a recorded permission reference, writing only to `.cache/`.

**Measured DNS queries.** The Worker serves `GET /api/internet/dns-flows` (`worker/ripeAtlas.ts`). It reads the latest results of RIPE Atlas's built-in IPv4 `hostname.bind` CHAOS TXT measurements to the 13 root servers (one measurement ID per letter, in `src/internet/dnsFlows.ts`) for a fixed sample of 104 public probes (13 in each of eight countries), keeps results from the last five minutes, and matches each answer to one root instance: by the instance's published identifiers first, then by a city or airport code in the answer when exactly one instance of that letter is in that city. Ambiguous or unknown answers are counted (`examined` vs `matched`) and left out; nothing is inferred from the probe's position. A snapshot is cached in the isolate and in the Cache API; it is refreshed after four minutes, the last good one is served for up to five minutes if a refresh fails, and otherwise the endpoint answers 503 (the panel says the data is unavailable). Probe coordinates (rounded to 0.01°) are cached for 24 hours. A cold refresh makes 21 requests to RIPE Atlas (8 probe lists, 13 result sets) plus one asset read; with probe coordinates cached, 13 plus one. Root-instance positions are not republished: they are only used on the server to place the answering site. (Until the change that fetches them from root-servers.org on the server lands, the Worker reads them from a static file that is not published, so the endpoint answers 503.)

**In the app.** `src/layers/useInternet.ts` loads each static file the first time its layer is shown and keeps it; it polls the DNS endpoint every five minutes while the DNS or root layer is on and the timeline is live, and derives the root layer from the flows (`src/internet/measuredRoots.ts`: the instances that answered, with query count, probes and median round trip).

**Rendering** (`src/internet/internetOverlay.ts`). One primitive collection per layer, so each toggles on its own.

- Cables are polylines densified to 0.5° and lifted 2 km so the straight chords stay above the sea, drawn with a custom material (`flowMaterial.ts`): a soft halo, a dim core and comet-shaped pulses that slide along the line (towards the last point) and brighten towards white. Cables are grouped into length buckets with their own pulse count, so pulse spacing is similar on long and short cables. The shader receives the scene time modulo 1,000 s: seconds since 1970 have no fractional part left in a 32-bit float, which would freeze the pulses.
- Data centres, exchanges and root instances are `PointPrimitive`s scaled by distance; data centres fade from 1.5 to 22 million metres away; root instances take one hue per letter.
- Each measured query is a faint great-circle arc between probe and instance, lifted in the middle (up to 1,200 km for long hops) and sampled about every 2° (6 to 32 vertices), with a packet that flies probe → instance → probe and rests; one leg lasts 0.6 s + RTT / 40 (capped at 600 ms RTT), so a longer round trip flies visibly slower. Packets are moved on the CPU along the precomputed arc.
- The scene renders continuously only while something that moves is visible (cables or packets), and then at most 30 frames a second; otherwise it stays in render-on-demand. Pulses and packets follow the scene clock (`src/clock.ts`), so recordings are deterministic, and they stand still with `prefers-reduced-motion`.

**Load.** Measured in headless Chromium with software rendering (so only the relative figures mean anything), with the real static datasets and a synthetic DNS snapshot at the 3,000-flow cap, dragging the globe to keep it rendering: drawing one frame took about 7 % longer with the cables on, 3 % with the data centres, 7 % with the DNS queries and root instances (20 % before arcs were sampled by length), and 18 % with all five layers (about 12,900 lines and points). With the camera still, the data-centre and exchange layers leave the scene idle; cables and DNS packets keep it rendering, capped at 30 fps.
