# TerraScope promo video — handoff

Division of work: **Claude** wrote the storyboard, the shot list and the site's recording mode; **Codex** builds the video project (Remotion), captures the frames, adds captions, transitions, music, and renders the MP4.

| File | What it is |
| --- | --- |
| [`storyboard.md`](storyboard.md) | The storyboard (Chinese): pacing, every shot, caption / visual / audio specs. |
| [`shots.json`](shots.json) | Machine-readable shot list: times, scene time, layers, camera keyframes, captions, transitions. **Source of truth for numbers.** |
| [`reference/capture.mjs`](reference/capture.mjs) | Reference capture script implementing the protocol below (stills or full PNG sequences). |
| `preview/` | Framing stills from the *Video Preview Stills* workflow (only on working branches). |

The Remotion project should live in its own directory/repository and not modify the site, apart from this recording mode (already in `src/recording.ts`).

## Recording mode

Open the site with `?record` and a scene hash:

```
<baseUrl>?record#scene=<url-encoded JSON scene>
```

The scene JSON is the same as the app's share links (`v`, `camera`, `layers`, `options`); the reference script builds it from `shots.json`. With `?record` the page exposes `window.__terrascope` (types in `src/recording.ts`) and pauses all CSS motion:

| Call | Effect |
| --- | --- |
| `await ready()` | Viewer exists and the first tiles have loaded. |
| `setCamera({longitude, latitude, height, heading?, pitch?, roll?})` | Degrees and metres; default straight down. |
| `lookAt({longitude, latitude, height, heading, pitch, range})` | Camera at `range` metres from a target, facing `heading`. |
| `setTime(ms \| null)` | Timeline moment (null = live). Widens the timeline range when needed. Sunlight, earthquakes, satellites, clouds and daily imagery follow it. |
| `setLayers({...})`, `setOptions({...})` | Same keys as the scene JSON. |
| `setUi("full" \| "clean" \| "timebar")` | Whole app / globe only / globe + time bar. |
| `showTrackCard(id \| null)` | Satellite tracking card (`"iss"`, `"tiangong"`, …) without locking the camera. |
| `satellite(id)` | `{latitude, longitude, altitudeKm, headingDeg}` at the scene time, or null. |
| `setEffectsTime(seconds)` | Aurora shimmer phase (deterministic animation). |
| `await idle(timeoutMs?)` | Renders until all tiles are loaded; `true` if they did. |
| `render()` | One synchronous render. |

**Per frame**: `setTime` → camera → (`setEffectsTime`) → `await idle()` → screenshot. Nothing moves between calls, so a slow software-rendered browser still yields smooth, reproducible frames. Load one page per shot.

```bash
npm run build && npx vite preview --port 4173 &
node --experimental-strip-types video/reference/capture.mjs --base http://localhost:4173/ --mode frames --out frames
```

- `--mode stills` captures first/middle/last frames for review; `--mode frames` captures every frame (`frames/<shot id>/0000.png` …) at 30 fps.
- `--anchor YYYY-MM-DD` pins the anchor day **D**; by default it is two days before today (UTC) so every data source has coverage. Re-capture all shots with the same anchor.
- Shot `s7-clouds` is `hourly-stills`: capture one still per hour (31) and cross-fade in Remotion (see `post` in `shots.json`).
- Shot `s4-aurora` is live-only; check its `fallback` before rendering.
- Shot `s9-end-card` is Remotion-only.
- On GitHub-hosted runners (software WebGL) expect roughly 1–3 s per frame, i.e. 15–45 min for all ~800 captured frames; split shots across jobs if needed.

## Deliverables

1. `terrascope-promo-30s.mp4` — H.264 High, 1920×1080, 30 fps, yuv420p, ~12 Mbps; AAC 48 kHz stereo, −14 LUFS, true peak ≤ −1 dBTP.
2. Captions as burned-in text (Chinese + English) per `storyboard.md`; also export `terrascope-promo-30s.srt` (bilingual) for platforms.
3. `video/CREDITS.md` — music/SFX source and licence, fonts (Noto Sans SC, Inter — OFL), data sources.

## Review loop

Claude reviews the preview stills and the first cut against the storyboard and replies with timecoded notes. Re-render only the shots that change.
