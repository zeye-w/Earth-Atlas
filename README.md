# Earth Atlas · 地球科学图集

Interactive 3D geological globe for exploring **mapped surface rock units**, geological ages, and lithologies.

## Features

- Drag the 3D globe to rotate; use wheel or touch to zoom.
- Toggle the Macrostrat global geologic raster map and change its opacity.
- Click the globe to query the surface geological unit at that latitude and longitude.
- Display reported geological age, lithology, unit name, numerical age range when available, and map source identifiers.
- Fly to example regions. Chinese-first UI with scientific English preserved.
- Explicit loading, no-data, network-error, and attribution states.

## Getting started

Requires Node.js 22+ and npm.

1. Run: npm install
2. Run: npm run dev
3. Open the local URL printed by Vite.
4. For production: npm run typecheck && npm run build

There is no Cesium ion token or proprietary basemap in this MVP. A network connection is required for Macrostrat tiles and point queries.

## Cloudflare Pages deployment

**The project is not deployed until Git integration is connected in a Cloudflare account.**

- Repository: zeye-w/Earth-Atlas
- Framework preset: React (Vite)
- Root directory: /
- Production branch: main
- Build command: npm run build
- Build output directory: dist
- Environment variables: none

Visit Cloudflare dashboard > Workers & Pages > Create > Pages > Connect to Git. Connect the repository, then use the settings above. Cloudflare assigns the actual pages.dev hostname after creation. Both Preview and Production deploys become available after integration.

CI runs on main and pull requests. GitHub Actions uses npm install and checks TypeScript plus Vite production build. Add and commit a lockfile with npm install once package dependencies can be resolved from npm for fully reproducible installs; do not claim dependencies were installed or the build validated until CI passes.

## Scientific scope and limitations

Geological units represent mapped **surface bedrock or superficial units**, not subsurface geology at arbitrary depth. At varying map scales, unit precedence and local data completeness may change. Each map unit may include multiple lithologies; do not infer a precise rock type where the data are missing.

Displayed geologic colors are supplied by Macrostrat map compilations and are not a guarantee of a uniform global ICS age palette.

## Open data attribution

The geologic map and unit queries are provided by [Macrostrat](https://macrostrat.org), CC BY 4.0. Attribute Macrostrat and underlying map providers where provided by the selected source_id. For source metadata see [Macrostrat sources](https://macrostrat.org/api/v2/defs/sources).

- Documentation: https://macrostrat.org/docs/data-services
- Raster tiles: https://tiles.macrostrat.org/carto/{z}/{x}/{y}.png
- Point query: https://macrostrat.org/api/v2/geologic_units/map?lat=43&lng=-89.3

## Roadmap

MVP: 3D globe + data query + map attribution. Next: official geologic age palettes, normalized lithology classification, saved locations, automated verification of API compatibility.

## License

MIT for this repository's code. Third-party geologic datasets retain their own licenses.
