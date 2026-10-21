# Terrascope — continuous camera flythrough

30-second 1920×1080/30fps promotional film:

ISS and curated satellites → Starlink → live flights → solar wind/magnetopause → aurora forecast → Terrascope end card.

## Important integrity distinctions
- The original camera follows **one unbroken ECEF path in one Cesium Viewer**.
- Source WebGL frames are sampled at 6fps due to software-renderer tile load cost; output frames are editorial linear blends between adjacent recorded images, **not independent 30fps scientific observations**. Do not describe the finished MP4 as "raw uninterrupted 30fps browser screen recording".
- Satellites/Starlink use CelesTrak GP + SGP4, **not spacecraft telemetry**.
- Flights come through the production Worker /api/flights ADS-B snapshot, not comprehensive global flights.
- NOAA real-time solar wind drives the Shue (1998) magnetopause model; bow shock and flowing particles are conceptual model visualizations, not observed photons.
- Aurora is a NOAA OVATION forecast. During low activity there may not be visible auroral curtains. Never replace missing data with synthetic observations.
- Data layers activate as camera moves through their altitudes. Feature changes are visible scene edits, but the camera never hard-cuts.

## Build and production
Only on separate branch \`video/continuous-flight-20261021\`:
1. \`npm ci && npm run build\`
2. \`npm run preview -- --host 127.0.0.1 --port 4173 --strictPort\`
3. Install Chromium via \`npx playwright install --with-deps chromium\`.
4. \`FLIGHT_LOCAL_SITE=http://127.0.0.1:4173/ node --experimental-strip-types video/continuous-flight/capture.mjs\`
5. \`python3 video/audio/generate.py\` then \`python3 video/continuous-flight/render.py\`.

Python dependencies: Pillow and NumPy. System ffmpeg is required for encoding. GitHub Actions workflow installs it via apt, unlike the first (failed) reel job.

The local Vite static preview cannot serve /api/flights: the Playwright capture transparently fetches the **real** production Worker route; failures abort the render. Public NOAA and CelesTrak requests remain unmocked.

Sources and capture data are recorded in \`out/manifest.json\`; \`out/render-manifest.json\` declares editorial interpolation. Review the final MP4, SRT and review stills from workflow artifacts. Raw captured PNGs are transient runner files; retain them separately if full archival reproducibility is required.

The underlying website's public deployment and the main branch are unchanged by the video workflow. The small ECEF camera extension in \`src/recording.ts\` is callable **only** from \`?record\`; it does not affect normal browsing.
