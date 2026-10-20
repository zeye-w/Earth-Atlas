# Reproducible video production

The website is unchanged. The independent Remotion app is in `video/remotion` and consumes `video/shots.json`. Numbers in the shot table win over prose: for example shot6 covers -648h to0h (27 days), despite the artistic caption "30 days". This discrepancy should be resolved by the director before publication; no extra events are fabricated.

## Setup

1. From the repository root: `npm ci` and `npm run build`.
2. In `video/remotion`: `npm ci` (separate locked dependencies).
3. Generate the original audio: `python video/audio/generate.py` (Python3 + NumPy).
4. Font files and OFL notices are in `video/audio/fonts`.
5. Start `npm run preview -- --host 127.0.0.1 --port 4173 --strictPort`.

On Windows, set `PW_CHROMIUM_PATH` to the installed Chrome executable. Hardware GPU capture uses `--hardware`; omit it for software WebGL. All actual captures come from the unmodified site's `?record` interface.

## Capture

```
node --experimental-strip-types video/production/capture.mjs --base http://127.0.0.1:4173/ --mode frames --hardware --concurrency 2 --anchor 2026-10-18
```

One page per shot, bounded concurrent shots, timestamped manifests and resumable frames. Use `--shot s5-iss` to retry one shot; `--max-frames 1 --out .cache/video-smoke` for a nonfinal smoke. `--dry-run` checks the schedule. The aurora decision archives the real NOAA response; it mirrors south when needed and selects the atmosphere shot if both peaks are below8%. Data or tile failures leave the shot incomplete instead of silently rendering fake/missing data.

The cloud shot captures exactly31 hourly images. All other shots use their full30fps frame count. The optional alternate aurora is never added as an extra timeline segment. Reuse the same anchor and output directory to resume. Completed live aurora is only reusable on its capture day.

To resume clouds separately, add `--shot s7-clouds --cloud-workers 3 --concurrency 3` to the same command. This assigns disjoint hours to at most three browser pages and keeps already captured frames. Clouds have a 300-second tile wait because the upstream service may respond slowly; failures remain incomplete. The source service's own watermark is preserved.

## Render and review

```
node video/production/stage.mjs --mode preview
node video/production/render.mjs
node video/production/stage.mjs --mode final
node video/production/render.mjs --final
```

Preview mode uses the handoff stills with a permanent nonfinal watermark; it is a layout/music animatic, not the captured first cut. Final mode rejects incomplete shot manifests and stages only captured PNGs. It preserves captions/timing from the shot table, includes local licensed fonts, and outputs a bilingualSRT. The selected coordinate/time data are not modified in post.

`video/delivery/` contains the MP4/SRT, nine review PNGs, frame/codec metadata and final audio loudness measurement. Render uses H.264/yuv420p at12Mbps; audio is two-pass loudnorm to-14LUFS with a-1.5dBTP mastering target, AAC48kHz stereo, and the muxed output is measured again against-1dBTP. Delivery is rejected if loudness/truepeak fail. Capture data, rendered files and duplicate staged public assets are gitignored; source, lockfile and credits are versioned.

For review, reference output timecodes, e.g. "00:13.9 card too prominent". Retry only changed captures, then restage/render. No message is automatically sent to another chat or reviewer.
