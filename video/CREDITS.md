# TerraScope promotional video credits

## Original music and sound effects

- File: `audio/terrascope-original.wav`
- Composition and synthesis: generated specifically for this project by Codex, 2026-10-20, using the original procedural score in `audio/generate.py`.
- Material: mathematical oscillators and seeded synthetic noise only. No external samples, recordings, stock tracks, or copied melodies were used.
- Permission: supplied for the project owner's use, modification, distribution, and commercial use with this promotional video. This describes the intended reuse of the generated material; it is not a claim that a third-party music license was purchased or that copyright protection is guaranteed.
- Reproduce: `python video/audio/generate.py` (Python 3 + NumPy). Seed: 20261020; 105 BPM; stereo 48 kHz PCM16; duration comes from `shots.json`.
- The source WAV is an unmastered mix. Final export must be measured and mastered to approximately −14 LUFS integrated, with true peak at or below −1 dBTP.

## Fonts

Font source and license files are stored in `audio/fonts/`. Noto Sans SC and Inter are distributed under the SIL Open Font License 1.1; their bundled OFL notices govern reuse. Use Noto Sans SC weight 300 (Light) and Inter weight 500 (Medium) from the variable files.

## Data and footage

All geographic/data footage must come from the website's actual render; do not synthesize, paint, or embellish observations in post-production. The final footage capture manifest must record capture date, observation/model times, source attribution, and any aurora fallback actually used. This audio credit does not grant rights to any external data, logo, or website imagery.

## Data/source attribution for this cut

| Layer | Source | Meaning |
|---|---|---|
| Daytime globe | NASA GIBS Blue Marble / Natural Earth | Satellite-derived/static map imagery, not a live photograph |
| Night lights | NASA Black Marble 2016 (VIIRS) | Historical annual composite; not tonight's lights |
| Aurora | NOAA SWPC OVATION | Live forecast/probability; shimmer is the website's existing visualization |
| Satellite motion | CelesTrak GP elements + SGP4 | Predicted orbit, not live telemetry |
| Earthquakes | USGS earthquake catalogue | Observed catalogue events; may be revised |
| Clouds | SSEC / UW–Madison RealEarth globalir | Hourly infrared composite; includes surface signals |
| Other site layers | Smithsonian GVP; Macrostrat; Bird PB2002/Nordpil; Natural Earth | See website attribution and layer documentation |

Source links: https://earthdata.nasa.gov/gibs · https://www.swpc.noaa.gov/products/aurora-30-minute-forecast · https://celestrak.org/ · https://earthquake.usgs.gov/ · https://www.ssec.wisc.edu/realearth/ · https://volcano.si.edu/ · https://macrostrat.org/ · https://www.naturalearthdata.com/

Capture provenance is in `production/public/captures/manifest.json` and per-shot source response records. Anchor D for this production run is 2026-10-18T00:00:00Z; capture day is 2026-10-20 UTC. Existing `preview/` stills are only for a watermarked storyboard preview, never substituted into the final moving-footage export. The final cut must pass the capture completeness checks before staging.

Free RealEarth usage has volume/watermark restrictions; retain any provider watermark. Remotion uses its own license; this personal project uses the free individual tier (https://www.remotion.dev/docs/license). Font OFL files are bundled. No logo ownership or blanket third-party data relicensing is asserted here.
