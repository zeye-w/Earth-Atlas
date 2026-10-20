<div align="center">

# TerraScope · 数字地球

**A real-time 3D digital Earth in the browser — live sunlight, night lights, aurora, earthquakes, volcanoes, satellites and global geology, all from open data.**

English · [简体中文](README.zh-CN.md)

[**Live demo →**](https://earth-atlas.edwardlab.workers.dev/)

[![CI](https://github.com/zeye-w/Earth-Atlas/actions/workflows/ci.yml/badge.svg)](https://github.com/zeye-w/Earth-Atlas/actions/workflows/ci.yml)
![React 19](https://img.shields.io/badge/React-19-61dafb)
![CesiumJS](https://img.shields.io/badge/CesiumJS-1.146-6caddf)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6)
![License: MIT](https://img.shields.io/badge/license-MIT-green)

![TerraScope — the globe with real-time sunlight, city lights and the layer panel](docs/screenshots/hero.jpg)

</div>

## Highlights

- **Real Earth, right now** — sunlight from the current UTC time, NASA Blue Marble by day and NASA Black Marble city lights on the night side.
- **Live geophysics** — USGS earthquakes, NOAA aurora forecast and Kp index, Smithsonian volcano catalogue, PB2002 plate boundaries.
- **Satellites in orbit** — positions predicted with SGP4 from CelesTrak orbital elements, with orbit paths at true altitude.
- **Geology on demand** — Macrostrat global geologic map; click anywhere for rock units, ages and lithology.
- **Travel in time** — a timeline replays the past 24 hours, 7 or 30 days (and looks a day ahead): sunlight, earthquakes, satellite positions and daily satellite imagery all follow it.
- **Honest by design** — no fabricated data. When a feed is down the layer says so and draws nothing; illustrative elements are labelled.
- **Fast and light** — render-on-demand, automatic quality by frame rate, layers loaded only when switched on; no API keys or paid services.

## Feature tour

<table>
<tr>
<td width="50%"><img src="docs/screenshots/night-lights.jpg" alt="City lights on the night side"><br><b>City lights</b><br>NASA Black Marble (VIIRS) lights on the night side across the real terminator, with only the lights kept and a soft glow over a darkened copy of the day imagery.</td>
<td width="50%"><img src="docs/screenshots/aurora.jpg" alt="Aurora oval and Kp panel"><br><b>Aurora and geomagnetic activity</b><br>Aurora curtains placed from the NOAA SWPC OVATION nowcast, with the current planetary K-index, NOAA G-scale level and 24-hour history.</td>
</tr>
<tr>
<td><img src="docs/screenshots/tectonics.jpg" alt="Earthquakes, plate boundaries and volcanoes"><br><b>Earthquakes, plates and volcanoes</b><br>USGS real-time earthquakes (size = magnitude, colour = depth), Bird (2003) plate boundaries with subduction zones, and ~1,200 Holocene volcanoes. Click for details.</td>
<td><img src="docs/screenshots/satellites.jpg" alt="Satellites and orbit paths"><br><b>Satellites</b><br>ISS, Tiangong, Hubble and Earth-observation satellites moving along SGP4-predicted orbits, with optional 60× / 300× time preview.</td>
</tr>
<tr>
<td><img src="docs/screenshots/geology.jpg" alt="Geologic map and inspector"><br><b>Global geology</b><br>Macrostrat geologic map (raster, or experimental age / lithology vector views). Click the ground to list the mapped units, ages and rock types there.</td>
<td><img src="docs/screenshots/atmosphere-layers.jpg" alt="Atmosphere layers at the limb"><br><b>Atmosphere layers</b><br>Troposphere, stratosphere, mesosphere, Kármán line and thermosphere drawn at their real heights (U.S. Standard Atmosphere 1976), with labelled 5× / 20× exaggeration.</td>
</tr>
<tr>
<td><img src="docs/screenshots/timeline.jpg" alt="Timeline replaying earthquakes"><br><b>Timeline</b><br>Drag or replay through the last 24 h / 7 / 30 days: the terminator, earthquakes (appearing as they happened), satellite positions and the daily imagery follow the chosen moment. Live-only feeds (aurora, clouds) say so instead of showing stale data.</td>
<td><img src="docs/screenshots/true-color.jpg" alt="Daily true-colour imagery"><br><b>Daily true colour</b><br>NASA GIBS NOAA-20 VIIRS corrected reflectance for the selected UTC day — the real clouds, snow and smoke of that day rather than the static Blue Marble.</td>
</tr>
<tr>
<td><img src="docs/screenshots/geo-labels.jpg" alt="Geographic labels over East Asia"><br><b>Geographic labels</b><br>Oceans, seas, straits, mountain ranges, deserts, plains, basins and rivers in Chinese, placed from Natural Earth geometry, with collision-aware layout that reveals more as you zoom in.</td>
<td><img src="docs/screenshots/clouds.jpg" alt="Infrared cloud imagery"><br><b>Satellite clouds</b><br>SSEC RealEarth hourly multi-satellite infrared composite, pinned to one observation time that is shown in the panel.</td>
</tr>
</table>

<p align="center"><img src="docs/screenshots/mobile.jpg" alt="TerraScope on a phone" width="260"><br><sub>Works on phones too: panels become bottom sheets and quality starts in Eco mode.</sub></p>

**Also included:** place and coordinate search; shareable scene links that restore the camera, layers, filters and timeline moment; fullscreen; reduced-motion support; eco / balanced / high quality presets.

## Data sources

| Layer | Source | Update |
| --- | --- | --- |
| Day imagery | NASA GIBS — Blue Marble shaded relief & bathymetry | static |
| Daily true colour | NASA GIBS — NOAA-20 VIIRS corrected reflectance | daily (previous UTC day when live) |
| City lights | NASA GIBS — VIIRS Black Marble 2016 | 2016 composite (not tonight's lights) |
| Aurora | NOAA SWPC — OVATION aurora nowcast | every 10 min |
| Kp index | NOAA SWPC — planetary K-index | every 10 min |
| Earthquakes | USGS — GeoJSON summary feeds | every 5 min |
| Volcanoes | Smithsonian GVP — *Volcanoes of the World* | bundled, refreshed by workflow |
| Plate boundaries | Bird (2003) PB2002, GeoJSON by Hugo Ahlenius / Nordpil (ODC-BY) | bundled |
| Satellites | CelesTrak — GP elements (OMM JSON), SGP4 via `satellite.js` | cached ≥ 2 h |
| Clouds | SSEC / UW–Madison RealEarth — `globalir` | hourly |
| Geology | Macrostrat (CC BY 4.0) | live tiles & queries |
| Labels | Natural Earth (public domain) | bundled |
| Search | Open-Meteo / GeoNames; mledoze/countries (ODbL) | on demand |

Full attribution and scientific limits are in [docs/TECHNICAL.md](docs/TECHNICAL.md).

## Getting started

Requires Node.js 22+.

```bash
npm install
npm run dev          # start the dev server
npm test             # unit tests
npm run build        # production build
npm run test:e2e     # Playwright end-to-end tests against the build (all services mocked)
```

No API keys are needed. A network connection is required for the live imagery and data feeds.

## Project structure

```
src/
  App.tsx            composes hooks and panels
  hooks/             viewer, render quality, layer settings, polled live data
  layers/            one hook per map layer (lights, aurora, quakes, satellites, …)
  panels/ ui/        glass-card UI
  data/              bundled datasets (volcanoes, plate boundaries, labels)
scripts/             data generators, live smoke tests, screenshot capture
tests/               unit tests (node:test) and e2e tests (Playwright)
```

Deployed as static assets on Cloudflare Workers (`wrangler.jsonc`). The screenshots in this README are rendered with live data by the [README Screenshots](.github/workflows/screenshots.yml) workflow.

## Scientific notes

- Satellite positions are SGP4 **predictions** from public orbital elements, not live telemetry.
- City lights are a 2016 annual composite; the aurora curtain shape and motion are stylised, while its position and brightness follow the NOAA forecast.
- Volcano colours reflect catalogued eruption years, not current alert levels.
- Geologic units are mapped surface units; overlapping map results are shown as candidates.

More detail: [docs/TECHNICAL.md](docs/TECHNICAL.md).

## License

Code: MIT. Third-party datasets keep their own licenses (see the table above).
