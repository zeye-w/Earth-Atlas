import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MOVIE_TIMESCALE, buildMovie, frameAt, keyPhotoTime, pairJpeg, sampleTiming, stillImageSample } from "../src/livePhotoFormat.ts";
import { pairJpeg as referencePairJpeg } from "../tools/live-photo/jpeg.mjs";
import { inspectKeyPhoto } from "../tools/live-photo/movValidation.mjs";

const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0 && spawnSync("ffprobe", ["-version"]).status === 0;
const ID = "0B1C2D3E-4F50-6172-8394-A5B6C7D8E9F0";

/**
 * H.264 from ffmpeg (synthetic test pattern, not a recording) in the form
 * WebCodecs produces: an avcC record and length-prefixed access units.
 */
function encodeTestPattern(dir, { width = 320, height = 240, frames = 90 } = {}) {
  const file = join(dir, "pattern.h264");
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", `testsrc2=size=${width}x${height}:rate=30`, "-frames:v", String(frames),
    "-c:v", "libx264", "-profile:v", "baseline", "-g", "15", "-bf", "0", "-pix_fmt", "yuv420p", "-bsf:v", "h264_metadata=aud=insert", "-f", "h264", file]);
  const stream = readFileSync(file);
  const nals = [];
  for (let i = 0; i + 3 < stream.length;) {
    const start = stream[i] === 0 && stream[i + 1] === 0 && stream[i + 2] === 1 ? 3 : stream[i] === 0 && stream[i + 1] === 0 && stream[i + 2] === 0 && stream[i + 3] === 1 ? 4 : 0;
    if (!start) { i++; continue; }
    if (nals.length) nals[nals.length - 1].end = i;
    nals.push({ start: i + start, end: stream.length });
    i += start;
  }
  let sps, pps;
  const units = [];
  for (const { start, end } of nals) {
    const nal = stream.subarray(start, end);
    const type = nal[0] & 31;
    if (type === 9) { units.push([]); continue; }
    if (type === 7) sps ??= nal;
    if (type === 8) pps ??= nal;
    units[units.length - 1].push(nal);
  }
  const description = Buffer.concat([Buffer.from([1, sps[1], sps[2], sps[3], 0xff, 0xe1]), Buffer.from([sps.length >> 8, sps.length & 255]), sps,
    Buffer.from([1, pps.length >> 8, pps.length & 255]), pps]);
  // Slightly irregular capture times, like frames taken when the globe renders.
  const samples = units.map((au, i) => ({
    data: new Uint8Array(Buffer.concat(au.flatMap((nal) => [Buffer.from([nal.length >>> 24, (nal.length >> 16) & 255, (nal.length >> 8) & 255, nal.length & 255]), nal]))),
    time: Math.round(i * 33_333 + (i % 3) * 1500),
    key: au.some((nal) => (nal[0] & 31) === 5),
  }));
  return { width, height, description: new Uint8Array(description), samples };
}

const probe = (file) => JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", file], { encoding: "utf8" }));

test("timing: irregular capture times become increasing movie units", () => {
  const samples = [0, 33_000, 33_100, 70_000].map((time) => ({ data: new Uint8Array(1), time, key: false }));
  const { starts, durations, duration } = sampleTiming(samples);
  assert.deepEqual(starts, [0, 20, 21, 42]);
  assert.deepEqual(durations, [20, 1, 21, 14]);
  assert.equal(duration, 56);
  assert.equal(frameAt(samples, 0.034), 1);
  assert.equal(frameAt(samples, 0.0352), 2);
  assert.equal(frameAt(samples, 5), 3);
  assert.equal(keyPhotoTime(samples, 3), 42 / MOVIE_TIMESCALE);
});

test("still-image sample matches Apple's 105-byte layout", () => {
  const sample = stillImageSample(1280, 720);
  assert.equal(sample.length, 105);
  const view = new DataView(sample.buffer);
  assert.deepEqual([view.getUint32(0), view.getUint32(4), view.getInt8(8)], [9, 1, -1]);
  assert.deepEqual([view.getFloat32(97), view.getFloat32(101)], [1280, 720]);
});

test("JPEG pairing is byte-identical to the local tool's", () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 1, 2, 0xff, 0xd9]);
  assert.deepEqual(Buffer.from(pairJpeg(jpeg, ID)), referencePairJpeg(Buffer.from(jpeg), ID));
  assert.throws(() => pairJpeg(jpeg, "not-a-uuid"));
});

test("Live Photo movie: decodable H.264, pairing identifier, key photo at the chosen frame", { skip: !hasFfmpeg && "ffmpeg not installed" }, () => {
  const dir = mkdtempSync(join(tmpdir(), "terrascope-live-"));
  try {
    const video = encodeTestPattern(dir);
    const keyFrame = frameAt(video.samples, 1.2);
    const movie = buildMovie(video, { container: "mov", live: { identifier: ID, keyFrame }, created: new Date("2026-10-21T00:00:00Z") });
    const file = join(dir, "live.mov");
    writeFileSync(file, movie);
    const info = probe(file);
    assert.equal(info.format.tags["com.apple.quicktime.content.identifier"], ID);
    const stream = info.streams.find((s) => s.codec_type === "video");
    assert.equal(stream.codec_name, "h264");
    assert.equal(Number(stream.nb_frames), 90);
    assert.deepEqual([stream.width, stream.height], [320, 240]);
    assert.ok(Math.abs(Number(info.format.duration) - 3) < 0.05, info.format.duration);
    assert.ok(info.streams.some((s) => s.codec_tag_string === "mebx"), "timed metadata track");
    // The edit list puts the still-image-time sample at the key frame's start.
    const keyPhoto = inspectKeyPhoto(Buffer.from(movie));
    assert.equal(keyPhoto.time, keyPhotoTime(video.samples, keyFrame));
    assert.deepEqual([keyPhoto.width, keyPhoto.height], [320, 240]);
    // Every frame decodes without errors.
    const decode = spawnSync("ffmpeg", ["-v", "error", "-i", file, "-map", "0:v:0", "-f", "null", "-"], { encoding: "utf8" });
    assert.equal(decode.status, 0);
    assert.equal(decode.stderr.trim(), "");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("preview MP4 has the same frames and no Live Photo metadata", { skip: !hasFfmpeg && "ffmpeg not installed" }, () => {
  const dir = mkdtempSync(join(tmpdir(), "terrascope-live-"));
  try {
    const video = encodeTestPattern(dir, { frames: 45 });
    const file = join(dir, "preview.mp4");
    writeFileSync(file, buildMovie(video, { container: "mp4" }));
    const info = probe(file);
    assert.equal(info.format.format_name.includes("mp4"), true);
    assert.equal(info.streams.length, 1);
    assert.equal(Number(info.streams[0].nb_frames), 45);
    assert.equal(info.format.tags?.["com.apple.quicktime.content.identifier"], undefined);
    assert.throws(() => buildMovie(video, { container: "mp4", live: { identifier: ID, keyFrame: 0 } }));
    assert.throws(() => buildMovie(video, { container: "mov", live: { identifier: ID, keyFrame: 45 } }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
