/**
 * Live Photo files built in the browser, no server: an H.264 QuickTime movie
 * and a JPEG key photo that iOS/macOS Photos pair by a shared content
 * identifier.
 *
 * - The movie carries `com.apple.quicktime.content.identifier` in moov/meta
 *   (Keys + ilst) and a timed metadata track (`mebx`) whose single sample,
 *   placed by the edit list at the key-photo time, is Apple's
 *   still-image-time record.
 * - The JPEG carries the same identifier in an Apple MakerNote (tag 0x11).
 *
 * This is a port of tools/live-photo (vendor/makelive_mov.py, MIT, and
 * jpeg.mjs); the metadata track is the same Apple template. No camera make,
 * model or location is written: the picture is a rendering, not a photo.
 */

export const MOVIE_TIMESCALE = 600;

export interface EncodedSample {
  /** One access unit in AVC (length-prefixed) format. */
  data: Uint8Array;
  /** Presentation time, microseconds from the start. */
  time: number;
  key: boolean;
}

export interface EncodedVideo {
  width: number;
  height: number;
  /** avcC decoder configuration record. */
  description: Uint8Array;
  /** In decode order; must also be in presentation order (no B-frames). */
  samples: EncodedSample[];
}

// ---------------------------------------------------------------- bytes

class Bytes {
  private parts: Uint8Array[] = [];
  length = 0;
  push(...parts: Uint8Array[]): this {
    for (const part of parts) { this.parts.push(part); this.length += part.length; }
    return this;
  }
  concat(): Uint8Array {
    const out = new Uint8Array(this.length);
    let offset = 0;
    for (const part of this.parts) { out.set(part, offset); offset += part.length; }
    return out;
  }
}

const u8 = (...values: number[]) => Uint8Array.from(values);
function u16(value: number) { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, value); return b; }
function u32(value: number) { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, value >>> 0); return b; }
function i32(value: number) { const b = new Uint8Array(4); new DataView(b.buffer).setInt32(0, value); return b; }
function f32(value: number) { const b = new Uint8Array(4); new DataView(b.buffer).setFloat32(0, value); return b; }
function f64(value: number) { const b = new Uint8Array(8); new DataView(b.buffer).setFloat64(0, value); return b; }
const ascii = (text: string) => Uint8Array.from(text, (c) => c.charCodeAt(0));
const utf8 = (text: string) => new TextEncoder().encode(text);
const zeros = (n: number) => new Uint8Array(n);

function box(type: string, ...parts: Uint8Array[]): Uint8Array {
  const body = new Bytes().push(...parts);
  return new Bytes().push(u32(8 + body.length), ascii(type), body.concat()).concat();
}
const fullBox = (type: string, version: number, flags: number, ...parts: Uint8Array[]) =>
  box(type, u8(version, (flags >> 16) & 255, (flags >> 8) & 255, flags & 255), ...parts);

const MATRIX = [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000];
const matrix = () => new Bytes().push(...MATRIX.map(u32)).concat();
/** Seconds since 1904-01-01 (QuickTime epoch). */
export const quickTimeSeconds = (date: Date) => Math.floor(date.getTime() / 1000) + 2_082_844_800;

// ---------------------------------------------------------------- timing

/**
 * Sample start times and durations in the movie timescale. Capture times are
 * irregular (frames come when the globe renders), so durations vary; each is
 * at least one unit. The last frame lasts as long as the average one.
 */
export function sampleTiming(samples: readonly EncodedSample[], timescale = MOVIE_TIMESCALE) {
  if (samples.length === 0) throw new Error("No video samples");
  const starts: number[] = [];
  for (const sample of samples) {
    const start = Math.round((sample.time - samples[0].time) * timescale / 1_000_000);
    starts.push(starts.length ? Math.max(start, starts[starts.length - 1] + 1) : 0);
  }
  const average = samples.length > 1 ? Math.max(1, Math.round(starts[starts.length - 1] / (samples.length - 1))) : Math.round(timescale / 30);
  const durations = starts.map((start, i) => (i + 1 < starts.length ? starts[i + 1] - start : average));
  return { starts, durations, duration: starts[starts.length - 1] + average };
}

/** Index of the frame shown at `seconds` (the last one starting at or before it). */
export function frameAt(samples: readonly EncodedSample[], seconds: number): number {
  const { starts } = sampleTiming(samples);
  const units = seconds * MOVIE_TIMESCALE;
  let index = 0;
  while (index + 1 < starts.length && starts[index + 1] <= units + 1e-9) index++;
  return index;
}

// ---------------------------------------------------------------- Apple metadata track

/**
 * A real Apple `mebx` metadata trak (from vendor/apple-meta-trak.bin): keys
 * still-image-time, still-image-transform and its reference dimensions.
 * Its ids, times, edit list and sample location are patched per movie.
 */
const APPLE_META_TRAK = "AAADDXRyYWsAAABcdGtoZAAAAA/ffji13344tQAAAAUAAAAAAAADNQAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAADBlZHRzAAAAKGVsc3QAAAAAAAAAAgAAAzT/////AAEAAAAAAAEAAAAAAAEAAAAAAnltZGlhAAAAIG1kaGQAAAAA3344td9+OLUAAAJYAAAAAVXEAAAAAAA0aGRscgAAAABtaGxybWV0YWFwcGwAAAABAAAAABNDb3JlIE1lZGlhIE1ldGFkYXRhAAACHW1pbmYAAAAgZ21oZAAAABhnbWluAAAAAABAgACAAIAAAAAAAAAAADhoZGxyAAAAAGRobHJhbGlzYXBwbAAAAAAAAAAAF0NvcmUgTWVkaWEgRGF0YSBIYW5kbGVyAAAAJGRpbmYAAAAcZHJlZgAAAAAAAAABAAAADGFsaXMAAAABAAABmXN0YmwAAAE1c3RzZAAAAAAAAAABAAABJW1lYngAAAAAAAAAAQAAARVrZXlzAAAASAAAAAEAAAAwa2V5ZG1kdGFjb20uYXBwbGUucXVpY2t0aW1lLnN0aWxsLWltYWdlLXRpbWUAAAAQZHR5cAAAAAAAAABBAAAAWAAAAAIAAABAa2V5ZG1kdGFjb20uYXBwbGUucXVpY2t0aW1lLmxpdmUtcGhvdG8tc3RpbGwtaW1hZ2UtdHJhbnNmb3JtAAAAEGR0eXAAAAAAAAAAUwAAAG0AAAADAAAAVWtleWRtZHRhY29tLmFwcGxlLnF1aWNrdGltZS5saXZlLXBob3RvLXN0aWxsLWltYWdlLXRyYW5zZm9ybS1yZWZlcmVuY2UtZGltZW5zaW9ucwAAABBkdHlwAAAAAAAAAEcAAAAYc3R0cwAAAAAAAAABAAAAAQAAAAEAAAAcc3RzYwAAAAAAAAABAAAAAQAAAAEAAAABAAAAFHN0c3oAAAAAAAAAaQAAAAEAAAAUc3RjbwAAAAAAAAABAFb7zw==";
const META_CONTAINERS = new Set(["trak", "mdia", "minf", "stbl", "dinf", "edts"]);

function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

/** Offsets of the boxes in a trak (stsd is not entered: its keys are not boxes we patch). */
function boxOffsets(buffer: Uint8Array, start = 0, end = buffer.length, found = new Map<string, number>()) {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  for (let p = start; p + 8 <= end;) {
    const size = view.getUint32(p);
    const type = String.fromCharCode(...buffer.subarray(p + 4, p + 8));
    if (size < 8 || p + size > end) throw new Error("Invalid box " + type);
    if (!found.has(type)) found.set(type, p);
    if (META_CONTAINERS.has(type)) boxOffsets(buffer, p + 8, p + size, found);
    p += size;
  }
  return found;
}

/** Apple's three records: still-image-time, still-image-transform (identity), reference size. */
export function stillImageSample(width: number, height: number): Uint8Array {
  return new Bytes().push(
    u32(9), u32(1), u8(0xff),
    u32(80), u32(2), ...[1, 0, 0, 0, 1, 0, 0, 0, 1].map(f64),
    u32(16), u32(3), f32(width), f32(height),
  ).concat();
}

function appleMetadataTrak(trackId: number, stillUnits: number, sampleOffset: number, sampleSize: number, created: number): Uint8Array {
  const trak = fromBase64(APPLE_META_TRAK);
  const view = new DataView(trak.buffer);
  const at = boxOffsets(trak);
  const get = (type: string) => { const offset = at.get(type); if (offset === undefined) throw new Error("Template lacks " + type); return offset; };
  // The template's boxes are all version 0.
  const tkhd = get("tkhd");
  view.setUint32(tkhd + 12, created); view.setUint32(tkhd + 16, created);
  view.setUint32(tkhd + 20, trackId);
  view.setUint32(tkhd + 28, stillUnits + 1);
  // Edit list: an empty edit up to the key photo, then the one metadata sample.
  const elst = get("elst");
  view.setUint32(elst + 16, stillUnits); view.setInt32(elst + 20, -1);
  view.setUint32(elst + 28, 1); view.setInt32(elst + 32, 0);
  const mdhd = get("mdhd");
  view.setUint32(mdhd + 12, created); view.setUint32(mdhd + 16, created);
  view.setUint32(mdhd + 20, MOVIE_TIMESCALE);
  view.setUint32(mdhd + 24, 1);
  const stsz = get("stsz");
  view.setUint32(stsz + 12, sampleSize); view.setUint32(stsz + 16, 1);
  const stco = get("stco");
  view.setUint32(stco + 12, 1); view.setUint32(stco + 16, sampleOffset);
  return trak;
}

/** moov/meta in Apple's shape (a plain box): hdlr 'mdta', Keys, ilst. */
function contentIdentifierMeta(identifier: string): Uint8Array {
  const key = utf8("com.apple.quicktime.content.identifier");
  const value = utf8(identifier);
  return box("meta",
    fullBox("hdlr", 0, 0, u32(0), ascii("mdta"), zeros(12), u8(0)),
    fullBox("keys", 0, 0, u32(1), u32(8 + key.length), ascii("mdta"), key),
    box("ilst", new Bytes().push(u32(8 + 16 + value.length), u32(1), u32(16 + value.length), ascii("data"), u32(1), u32(0), value).concat()),
  );
}

// ---------------------------------------------------------------- movie

export interface MovieOptions {
  /** "mov": QuickTime (for Photos); "mp4": plain MP4 for previews and downloads. */
  container: "mov" | "mp4";
  created?: Date;
  /** Live Photo pairing: content identifier and key-photo frame index (mov only). */
  live?: { identifier: string; keyFrame: number };
}

function stts(durations: number[]): Uint8Array {
  const runs: [number, number][] = [];
  for (const d of durations) {
    const last = runs[runs.length - 1];
    if (last && last[1] === d) last[0]++; else runs.push([1, d]);
  }
  return fullBox("stts", 0, 0, u32(runs.length), ...runs.flatMap(([count, delta]) => [u32(count), u32(delta)]));
}

function avc1(video: EncodedVideo): Uint8Array {
  const compressor = zeros(32);
  return box("avc1",
    zeros(6), u16(1),
    zeros(16),
    u16(video.width), u16(video.height),
    u32(0x00480000), u32(0x00480000), u32(0), u16(1),
    compressor, u16(0x0018), u16(0xffff),
    box("avcC", video.description),
  );
}

/** A QuickTime/MP4 movie of the encoded frames, optionally as the video half of a Live Photo. */
export function buildMovie(video: EncodedVideo, options: MovieOptions): Uint8Array {
  const { container, live } = options;
  if (live && container !== "mov") throw new Error("Live Photo movies must be QuickTime");
  const mov = container === "mov";
  const created = quickTimeSeconds(options.created ?? new Date());
  const { starts, durations, duration } = sampleTiming(video.samples);
  for (let i = 1; i < video.samples.length; i++) {
    if (video.samples[i].time < video.samples[i - 1].time) throw new Error("Reordered frames (B-frames) are not supported");
  }

  const ftyp = mov
    ? box("ftyp", ascii("qt  "), u32(0x200), ascii("qt  "))
    : box("ftyp", ascii("isom"), u32(0x200), ascii("isom"), ascii("iso2"), ascii("avc1"), ascii("mp41"));
  const videoBytes = video.samples.reduce((n, s) => n + s.data.length, 0);
  const stillSample = live ? stillImageSample(video.width, video.height) : null;
  const mdatSize = 8 + videoBytes + (stillSample?.length ?? 0);
  const videoOffset = ftyp.length + 8;

  const handlerName = (name: string) => (mov ? new Bytes().push(u8(name.length), ascii(name)).concat() : new Bytes().push(ascii(name), u8(0)).concat());
  const videoTrak = box("trak",
    fullBox("tkhd", 0, 3, u32(created), u32(created), u32(1), u32(0), u32(duration), zeros(8), u16(0), u16(0), u16(0), u16(0), matrix(), u32(video.width << 16), u32(video.height << 16)),
    box("edts", fullBox("elst", 0, 0, u32(1), u32(duration), u32(0), u32(0x00010000))),
    box("mdia",
      fullBox("mdhd", 0, 0, u32(created), u32(created), u32(MOVIE_TIMESCALE), u32(duration), u16(mov ? 0 : 0x55c4), u16(0)),
      fullBox("hdlr", 0, 0, mov ? ascii("mhlr") : u32(0), ascii("vide"), zeros(12), handlerName("VideoHandler")),
      box("minf",
        fullBox("vmhd", 0, 1, zeros(8)),
        ...(mov ? [fullBox("hdlr", 0, 0, ascii("dhlr"), ascii("url "), zeros(12), handlerName("DataHandler"))] : []),
        box("dinf", fullBox("dref", 0, 0, u32(1), fullBox("url ", 0, 1))),
        box("stbl",
          fullBox("stsd", 0, 0, u32(1), avc1(video)),
          stts(durations),
          fullBox("stss", 0, 0, u32(video.samples.filter((s) => s.key).length), ...video.samples.flatMap((s, i) => (s.key ? [u32(i + 1)] : []))),
          fullBox("stsc", 0, 0, u32(1), u32(1), u32(video.samples.length), u32(1)),
          fullBox("stsz", 0, 0, u32(0), u32(video.samples.length), ...video.samples.map((s) => u32(s.data.length))),
          fullBox("stco", 0, 0, u32(1), u32(videoOffset)),
        ),
      ),
    ),
  );

  const moovParts: Uint8Array[] = [
    fullBox("mvhd", 0, 0, u32(created), u32(created), u32(MOVIE_TIMESCALE), u32(duration), u32(0x00010000), u16(0x0100), zeros(10), matrix(), zeros(24), u32(live ? 3 : 2)),
    videoTrak,
  ];
  if (live && stillSample) {
    if (!(live.keyFrame >= 0 && live.keyFrame < starts.length)) throw new Error("Key photo frame out of range");
    moovParts.push(appleMetadataTrak(2, starts[live.keyFrame], videoOffset + videoBytes, stillSample.length, created));
    moovParts.push(contentIdentifierMeta(live.identifier));
  }

  const out = new Bytes().push(ftyp, u32(mdatSize), ascii("mdat"));
  for (const sample of video.samples) out.push(sample.data);
  if (stillSample) out.push(stillSample);
  out.push(box("moov", ...moovParts));
  return out.concat();
}

/** Seconds of the key photo for a frame index (snapped to the movie timescale). */
export function keyPhotoTime(samples: readonly EncodedSample[], keyFrame: number): number {
  return sampleTiming(samples).starts[keyFrame] / MOVIE_TIMESCALE;
}

// ---------------------------------------------------------------- JPEG

/**
 * The JPEG key photo with the pairing identifier in an Apple MakerNote
 * (APP1 Exif: IFD0 → ExifIFD → MakerNote "Apple iOS", tag 0x0011). The
 * compressed image is untouched.
 */
export function pairJpeg(jpeg: Uint8Array, identifier: string): Uint8Array {
  if (!/^[0-9a-f-]{36}$/i.test(identifier) || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) throw new Error("Invalid JPEG/identifier");
  const id = new Bytes().push(ascii(identifier), u8(0)).concat();
  const maker = new Uint8Array(32 + id.length);
  const mv = new DataView(maker.buffer);
  maker.set(ascii("Apple iOS\0\0\x01MM"));
  mv.setUint16(14, 1);
  mv.setUint16(16, 0x11); mv.setUint16(18, 2);
  mv.setUint32(20, id.length); mv.setUint32(24, 32);
  maker.set(id, 32);
  // Big-endian TIFF; offsets are relative to its start.
  const tiff = new Uint8Array(44 + maker.length);
  const tv = new DataView(tiff.buffer);
  tiff.set(ascii("MM")); tv.setUint16(2, 42); tv.setUint32(4, 8);
  tv.setUint16(8, 1); tv.setUint16(10, 0x8769); tv.setUint16(12, 4); tv.setUint32(14, 1); tv.setUint32(18, 26);
  tv.setUint16(26, 1); tv.setUint16(28, 0x927c); tv.setUint16(30, 7); tv.setUint32(32, maker.length); tv.setUint32(36, 44);
  tiff.set(maker, 44);
  const body = new Bytes().push(ascii("Exif\0\0"), tiff).concat();
  return new Bytes().push(jpeg.subarray(0, 2), u16(0xffe1), u16(body.length + 2), body, jpeg.subarray(2)).concat();
}

/** Upper-case UUID, the form Apple uses for content identifiers. */
export const newContentIdentifier = () => crypto.randomUUID().toUpperCase();
