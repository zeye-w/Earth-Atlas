#!/usr/bin/env python3
"""Turn a plain QuickTime MOV into the video half of an Apple Live Photo.

What it adds: a metadata track (handler 'meta', format 'mebx') holding Apple's
still-image-time record, which is what makes Photos treat a JPEG+MOV pair as a
Live Photo. It also relocates the Keys/ilst metadata to ``moov/meta`` in Apple's
shape (a plain QTFF box, *no* 4-byte version/flags) and bumps ``nextTrackID``.

The video and audio samples are never touched: the tool only rewrites the moov
and appends the 105-byte metadata sample inside mdat, fixing up chunk offsets.

usage:
    makelive_mov.py BASE.MOV OUT.MOV [--still-time 2.0] [--ref-size 768 1024]
                    [--template PATH]
"""
from __future__ import annotations

import argparse
import os
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_TEMPLATE = os.path.join(HERE, os.pardir, "assets", "apple-meta-trak.bin")

CONTAINERS = {"moov", "trak", "mdia", "minf", "stbl", "dinf", "edts", "udta"}


def atoms_in(buf: bytes, start: int, end: int):
    """Yield (offset, size, type, header_size) for siblings in [start, end)."""
    pos = start
    while pos + 8 <= end:
        size, typ = struct.unpack(">I4s", buf[pos:pos + 8])
        hsize = 8
        if size == 1:
            size = struct.unpack(">Q", buf[pos + 8:pos + 16])[0]
            hsize = 16
        elif size == 0:
            size = end - pos
        if size < hsize or pos + size > end:
            break
        yield pos, size, typ.decode("latin1"), hsize
        pos += size


def body_start(typ: str, off: int, hsize: int) -> int:
    # 'meta' is a FullBox under udta (ISO) but a plain box at moov level (Apple).
    return off + hsize


def walk(buf: bytes, start: int, end: int, path: str = ""):
    """Yield (offset, size, type, path) recursively; path is like 'moov/trak/mdia'."""
    for off, size, typ, hsize in atoms_in(buf, start, end):
        here = f"{path}/{typ}"
        yield off, size, typ, here
        if typ in CONTAINERS:
            yield from walk(buf, body_start(typ, off, hsize), off + size, here)


def find_all(buf: bytes, start: int, end: int, want: str):
    return [a for a in atoms_in(buf, start, end) if a[2] == want]


def has_mebx(buf: bytes, start: int, end: int) -> bool:
    """True if any trak in [start, end) carries a 'mebx' metadata sample entry.

    The sample entry lives inside stsd, whose children are not sibling atoms, so
    plain walk() never reaches it — descend explicitly.
    """
    for off, size, typ, _path in walk(buf, start, end):
        if typ == "stsd":
            # stsd is a FullBox: 8-byte box header + version/flags + entry_count,
            # so its entries start 16 bytes in. (stsd is never a 64-bit box.)
            if any(a[2] == "mebx" for a in atoms_in(buf, off + 16, off + size)):
                return True
    return False


def patch_u32(buf: bytearray, off: int, value: int) -> None:
    struct.pack_into(">I", buf, off, value & 0xFFFFFFFF)


# The key set and key order of a genuine iPhone Live Photo, and the keys ffmpeg
# injects into the same ilst when the file is remuxed with use_metadata_tags.
# Normalising to this shape keeps the deliverable indistinguishable from an
# Apple original to anything that reads the Keys metadata.
APPLE_KEY_ORDER = (
    "com.apple.quicktime.live-photo.auto",
    "com.apple.quicktime.content.identifier",
    "com.apple.quicktime.live-photo.vitality-score",
    "com.apple.quicktime.live-photo.vitality-scoring-version",
    "com.apple.quicktime.make",
    "com.apple.quicktime.model",
    "com.apple.quicktime.software",
    "com.apple.quicktime.creationdate",
)
FFMPEG_BOOKKEEPING_KEYS = {
    "encoder", "major_brand", "minor_version", "compatible_brands",
    # `-metadata creation_time=…` sets the header times, which is wanted, but
    # with use_metadata_tags ffmpeg also stores it as a key of its own.
    "creation_time",
}

# ffmpeg writes this one under a shortened name; Apple's own files (and the
# canonical Key) spell it with the live-photo prefix.
FFMPEG_KEY_ALIASES = {
    "com.apple.quicktime.vitality-scoring-version":
        "com.apple.quicktime.live-photo.vitality-scoring-version",
}

# Apple stores three of the eight keys as typed binary values rather than
# strings (verified against genuine iPhone Live Photos): the data atom's type
# code is 22 (unsigned int), 23 (float32) and 21 (signed int). ffmpeg can only
# write strings into this ilst, so those three are rewritten here.
APPLE_KEY_VALUES = {
    "com.apple.quicktime.live-photo.auto": (22, struct.pack(">B", 1)),
    "com.apple.quicktime.live-photo.vitality-score": (23, struct.pack(">f", 1.0)),
    "com.apple.quicktime.live-photo.vitality-scoring-version":
        (21, struct.pack(">q", 4)),
}

# an mdta ilst entry is: size | index | data_size | 'data' | type | locale | value
DATA_BOX_HEADER = 16


def ilst_entry(index: int, data_type: int, payload: bytes) -> bytes:
    body = struct.pack(">I4sII", DATA_BOX_HEADER + len(payload), b"data",
                       data_type, 0) + payload
    return struct.pack(">I4s", 8 + len(body), struct.pack(">I", index)) + body


def normalise_meta_children(children: bytes) -> bytes:
    """Reorder the Keys/ilst pair into Apple's shape and retype its values.

    `children` is the body of a moov/meta box (hdlr, keys, ilst, ...). The ilst
    entries are addressed by the 1-based position of their key in `keys`, so a
    key may only be removed by renumbering every entry after it - which is what
    this does. Unknown keys are kept (in their original relative order) rather
    than dropped: only ffmpeg's bookkeeping keys are known to be noise.
    """
    keys_box = ilst_box = None
    passthrough = []
    for off, size, typ, _hsize in atoms_in(children, 0, len(children)):
        if typ == "keys":
            keys_box = (off, size)
        elif typ == "ilst":
            ilst_box = (off, size)
        else:
            passthrough.append(children[off:off + size])
    if keys_box is None or ilst_box is None:
        return children

    count = struct.unpack(">I", children[keys_box[0] + 12:keys_box[0] + 16])[0]
    key_entries, pos = [], keys_box[0] + 16
    for _ in range(count):
        entry_size = struct.unpack(">I", children[pos:pos + 4])[0]
        if entry_size < 8 or pos + entry_size > keys_box[0] + keys_box[1]:
            return children                      # unexpected shape: leave as is
        namespace = children[pos + 4:pos + 8]
        raw_name = children[pos + 8:pos + entry_size].decode("utf-8", "replace")
        name = FFMPEG_KEY_ALIASES.get(raw_name, raw_name)
        key_entries.append((name, raw_name, namespace, children[pos:pos + entry_size]))
        pos += entry_size

    ilst_values = {}
    for off, size, _typ, _hsize in atoms_in(children, ilst_box[0] + 8,
                                            ilst_box[0] + ilst_box[1]):
        # the entry index is a binary u32, so it is read as an integer rather
        # than through the decoded atom type.
        index = struct.unpack(">I", children[off + 4:off + 8])[0]
        ilst_values[index] = children[off:off + size]

    paired = [(name, raw_name, namespace, raw, ilst_values[i])
              for i, (name, raw_name, namespace, raw) in enumerate(key_entries, 1)
              if i in ilst_values]
    ordered = [p for p in paired if p[0] in APPLE_KEY_ORDER]
    ordered.sort(key=lambda p: APPLE_KEY_ORDER.index(p[0]))
    ordered += [p for p in paired
                if p[0] not in APPLE_KEY_ORDER
                and p[0] not in FFMPEG_BOOKKEEPING_KEYS]
    if not ordered:
        return children

    def key_entry(name: str, namespace: bytes) -> bytes:
        encoded = name.encode("utf-8")
        return struct.pack(">I4s", 8 + len(encoded), namespace) + encoded

    new_keys = b"".join(raw if name == raw_name else key_entry(name, namespace)
                        for name, raw_name, namespace, raw, _v in ordered)
    keys_atom = (struct.pack(">I4s", 16 + len(new_keys), b"keys")
                 + struct.pack(">I", 0) + struct.pack(">I", len(ordered))
                 + new_keys)
    new_ilst = b""
    for new_index, (name, _raw_name, _ns, _raw, value) in enumerate(ordered, 1):
        typed = APPLE_KEY_VALUES.get(name)
        if typed is not None:
            new_ilst += ilst_entry(new_index, typed[0], typed[1])
        elif value[12:16] == b"data":            # keep the original data box
            new_ilst += (struct.pack(">I4s", len(value),
                                     struct.pack(">I", new_index)) + value[8:])
        else:
            new_ilst += value
    ilst_atom = struct.pack(">I4s", 8 + len(new_ilst), b"ilst") + new_ilst

    return b"".join(passthrough) + keys_atom + ilst_atom


def parse_elst(buf: bytes, off: int, size: int):
    """Return [(entry_offset, segment_duration_offset, duration_fmt), ...]."""
    version = buf[off + 8]
    count = struct.unpack(">I", buf[off + 12:off + 16])[0]
    entries = []
    p = off + 16
    for _ in range(count):
        if version == 1:
            entries.append((p, p, "Q", 20))          # segment_duration u64
        else:
            entries.append((p, p, "I", 12))          # segment_duration u32
        p += entries[-1][3]
    return version, entries


def patch_trak(template: bytes, track_id: int, still_units: int,
               sample_offset: int, sample: bytes, movie_timescale: int,
               movie_created: int) -> bytes:
    """Fill the Apple metadata trak template with this file's values."""
    trak = bytearray(template)
    seen = {}

    for off, size, typ, path in walk(template, 0, len(template)):
        seen.setdefault(typ, []).append((off, size))

    # tkhd: trackID + duration (both in movie timescale), plus creation and
    # modification times. The template is a real Apple trak, so leaving its own
    # 2022 timestamps in place would make this the only part of the file with a
    # date that no other box agrees with; genuine files share one date.
    off, _ = seen["tkhd"][0]
    version = trak[off + 8]
    tid_off = off + (28 if version == 1 else 20)
    dur_off = off + (36 if version == 1 else 28)
    patch_u32(trak, tid_off, track_id)
    if version == 1:
        struct.pack_into(">QQ", trak, off + 12, movie_created, movie_created)
        struct.pack_into(">Q", trak, dur_off, still_units + 1)
    else:
        struct.pack_into(">II", trak, off + 12, movie_created & 0xFFFFFFFF,
                         movie_created & 0xFFFFFFFF)
        patch_u32(trak, dur_off, still_units + 1)

    # edts/elst: [0] empty segment covering the time before the still frame,
    #            [1] the single metadata sample
    off, size = seen["elst"][0]
    version, entries = parse_elst(template, off, size)
    fmt = entries[0][2]
    struct.pack_into(f">{fmt}", trak, entries[0][1], still_units)
    struct.pack_into(">i" if version == 0 else ">q", trak,
                     entries[0][0] + (4 if version == 0 else 8), -1)   # media_time
    struct.pack_into(f">{fmt}", trak, entries[1][1], 1)
    struct.pack_into(">i" if version == 0 else ">q", trak,
                     entries[1][0] + (4 if version == 0 else 8), 0)    # media_time

    # mdhd: media timescale must equal the movie timescale (Apple uses 600)
    off, _ = seen["mdhd"][0]
    version = trak[off + 8]
    ts_off = off + (20 if version == 0 else 28)
    dur_off_md = off + (24 if version == 0 else 32)
    patch_u32(trak, ts_off, movie_timescale)
    if version == 1:
        struct.pack_into(">QQ", trak, off + 12, movie_created, movie_created)
        struct.pack_into(">Q", trak, dur_off_md, 1)
    else:
        struct.pack_into(">II", trak, off + 12, movie_created & 0xFFFFFFFF,
                         movie_created & 0xFFFFFFFF)
        patch_u32(trak, dur_off_md, 1)

    # stsz: one sample of len(sample)
    off, _ = seen["stsz"][0]
    patch_u32(trak, off + 12, len(sample))
    patch_u32(trak, off + 16, 1)

    # stco/co64: point at the appended sample
    if "stco" in seen:
        off, _ = seen["stco"][0]
        patch_u32(trak, off + 12, 1)
        patch_u32(trak, off + 16, sample_offset)
    else:
        off, _ = seen["co64"][0]
        patch_u32(trak, off + 12, 1)
        struct.pack_into(">Q", trak, off + 16, sample_offset)

    return bytes(trak)


def build_sample(ref_w: int, ref_h: int) -> bytes:
    """Apple's 3 records: still-image-time, still-image-transform, ref dimensions."""
    r1 = struct.pack(">IIb", 9, 1, -1)
    r2 = struct.pack(">II", 80, 2) + struct.pack(
        ">9d", 1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0)
    r3 = struct.pack(">II", 16, 3) + struct.pack(">2f", float(ref_w), float(ref_h))
    out = r1 + r2 + r3
    assert len(out) == 105, len(out)
    return out


def shift_sample_offsets(moov: bytearray, delta: int) -> int:
    """Add delta to every chunk offset inside moov; return number patched."""
    patched = 0
    for off, size, typ, path in list(walk(bytes(moov), 0, len(moov))):
        if typ == "stco":
            count = struct.unpack(">I", moov[off + 12:off + 16])[0]
            for i in range(count):
                p = off + 16 + 4 * i
                shifted = struct.unpack(">I", moov[p:p + 4])[0] + delta
                if shifted < 0:
                    raise SystemExit("error: chunk offset underflow while "
                                     "normalising the file layout")
                patch_u32(moov, p, shifted)
                patched += 1
        elif typ == "co64":
            count = struct.unpack(">I", moov[off + 12:off + 16])[0]
            for i in range(count):
                p = off + 16 + 8 * i
                struct.pack_into(">Q", moov, p,
                                 struct.unpack(">Q", moov[p:p + 8])[0] + delta)
                patched += 1
    return patched


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("src", help="base MOV (video+audio already remuxed losslessly)")
    ap.add_argument("dst", help="output MOV")
    ap.add_argument("--still-time", type=float, default=2.0,
                    help="time of the still frame in seconds (default 2.0)")
    ap.add_argument("--ref-size", type=int, nargs=2, default=None, metavar=("W", "H"),
                    help="still-image reference dimensions (default: video size)")
    ap.add_argument("--template", default=DEFAULT_TEMPLATE,
                    help="Apple metadata trak template (default: assets/apple-meta-trak.bin)")
    args = ap.parse_args(argv)

    data = open(args.src, "rb").read()
    template = open(args.template, "rb").read()

    tops = list(atoms_in(data, 0, len(data)))
    mdats = [a for a in tops if a[2] == "mdat"]
    moovs = [a for a in tops if a[2] == "moov"]
    if len(mdats) != 1 or len(moovs) != 1:
        print(f"error: expected exactly one mdat and one moov, got "
              f"{len(mdats)} mdat / {len(moovs)} moov", file=sys.stderr)
        return 2
    mdat_off, mdat_size, _, mdat_hsize = mdats[0]
    moov_off, moov_size, _, moov_hsize = moovs[0]

    if has_mebx(data, moov_off, moov_off + moov_size):
        print("error: input already has a mebx metadata track (this is a Live "
              "Photo MOV). Pass a plain MOV/video instead - livephoto.sh remuxes "
              "the video first, which drops any existing metadata track.",
              file=sys.stderr)
        return 2

    # ---- moov children: keep everything except moov/udta, lift meta out of udta
    keep, meta_children = [], None
    moov_end = moov_off + moov_size
    for off, size, typ, hsize in atoms_in(data, moov_off + moov_hsize, moov_end):
        if typ == "udta":
            for o2, s2, t2, h2 in atoms_in(data, off + hsize, off + size):
                if t2 == "meta":
                    # udta/meta is a FullBox: drop the 4-byte version/flags so the
                    # box matches Apple's moov/meta shape.
                    meta_children = data[o2 + h2 + 4:o2 + s2]
        else:
            keep.append(data[off:off + size])

    if meta_children is None:
        for off, size, typ, hsize in atoms_in(data, moov_off + moov_hsize, moov_end):
            if typ == "meta":
                meta_children = data[off + hsize + 4:off + size]
    if meta_children is None:
        print("error: no Keys/ilst metadata found; remux with "
              "-movflags use_metadata_tags so the content identifier is present",
              file=sys.stderr)
        return 2
    meta_children = normalise_meta_children(meta_children)
    meta_box = struct.pack(">I4s", 8 + len(meta_children), b"meta") + meta_children

    movie_timescale = None
    movie_duration = None
    movie_created = 0
    max_track_id = 0
    for off, size, typ, path in walk(data, moov_off, moov_end):
        if typ == "mvhd":
            version = data[off + 8]
            movie_timescale = struct.unpack(
                ">I", data[off + (20 if version == 0 else 28):
                           off + (24 if version == 0 else 32)])[0]
            if version == 1:
                movie_created = struct.unpack(">Q", data[off + 12:off + 20])[0]
                movie_duration = struct.unpack(">Q", data[off + 32:off + 40])[0]
            else:
                movie_created = struct.unpack(">I", data[off + 12:off + 16])[0]
                movie_duration = struct.unpack(">I", data[off + 24:off + 28])[0]
        elif typ == "tkhd":
            version = data[off + 8]
            max_track_id = max(max_track_id, struct.unpack(
                ">I", data[off + (20 if version == 0 else 28):
                           off + (24 if version == 0 else 32)])[0])
    if not movie_timescale:
        print("error: could not read mvhd timescale", file=sys.stderr)
        return 2

    # A still time outside the movie produces a file that looks fine to a box
    # walk but shows a moment the video does not have - and a negative one
    # would be written into the edit list as a negative segment duration.
    # livephoto.sh pre-checks both; this guard covers direct callers.
    if args.still_time < 0:
        print("error: --still-time cannot be negative "
              f"(got {args.still_time}s)", file=sys.stderr)
        return 2
    if movie_duration and args.still_time >= movie_duration / movie_timescale:
        print(f"error: --still-time {args.still_time}s is outside the movie "
              f"(duration {movie_duration / movie_timescale:.3f}s)",
              file=sys.stderr)
        return 2

    track_id = max_track_id + 1
    ref_w, ref_h = (args.ref_size if args.ref_size else _video_size(data, moov_off, moov_end))
    still_units = round(args.still_time * movie_timescale)
    sample = build_sample(ref_w, ref_h)

    # ---- new layout: <prefix without moov> | mdat | sample | moov
    prefix = b"".join(data[a[0]:a[0] + a[1]] for a in tops
                      if a[2] not in ("mdat", "moov"))
    old_mdat_data = mdat_off + mdat_hsize
    new_mdat_off = len(prefix)
    new_mdat_data = new_mdat_off + mdat_hsize
    delta = new_mdat_data - old_mdat_data

    new_mdat_payload = data[old_mdat_data:mdat_off + mdat_size]
    sample_offset = new_mdat_data + len(new_mdat_payload)

    trak = patch_trak(template, track_id, still_units, sample_offset, sample,
                      movie_timescale, movie_created)

    new_moov = bytearray(b"\x00\x00\x00\x00moov")
    for box in keep:
        new_moov += box

    # Chunk offsets in the *inherited* boxes must follow mdat, so they are
    # shifted here - before the metadata trak is appended. That trak's stco
    # already holds an absolute offset in the new layout (sample_offset, computed
    # above from the new mdat position); shifting it again would corrupt it and
    # make the file point the still-image-time sample at arbitrary bytes.
    if delta:
        shift_sample_offsets(new_moov, delta)

    new_moov += trak
    new_moov += meta_box
    struct.pack_into(">I", new_moov, 0, len(new_moov))

    # mvhd nextTrackID > every track id (and > the new one)
    for off, size, typ, path in atoms_in(bytes(new_moov), 8, len(new_moov)):
        if typ == "mvhd":
            version = new_moov[off + 8]
            nxt_off = off + (104 if version == 0 else 116)
            cur = struct.unpack(">I", new_moov[nxt_off:nxt_off + 4])[0]
            patch_u32(new_moov, nxt_off, max(cur, track_id + 1))
            break

    mdat_header = struct.pack(">I4s", mdat_hsize + len(new_mdat_payload) + len(sample),
                              b"mdat")
    if mdat_hsize == 16:                       # 64-bit mdat: keep the wide size
        mdat_header = (struct.pack(">I4s", 1, b"mdat")
                       + struct.pack(">Q", 16 + len(new_mdat_payload) + len(sample)))

    out = bytearray()
    out += prefix
    out += mdat_header
    out += new_mdat_payload
    out += sample
    out += new_moov
    with open(args.dst, "wb") as fh:
        fh.write(bytes(out))

    print(f"movie timescale {movie_timescale}, still time {args.still_time}s "
          f"-> {still_units} units")
    print(f"metadata trak id {track_id}, sample {len(sample)} B @ {sample_offset}, "
          f"ref size {ref_w}x{ref_h}, chunk offsets shifted by {delta}")
    print(f"wrote {args.dst} ({len(out)} bytes)")
    return 0


def _video_size(data: bytes, moov_off: int, moov_end: int):
    """Width/height of the video sample description (ignores audio tracks)."""
    nodes = list(walk(data, moov_off, moov_end))
    for trak_off, trak_size, _, trak_path in [n for n in nodes
                                              if n[2] == "trak" and n[3].count("/") == 2]:
        inside = [n for n in nodes if n[3].startswith(trak_path + "/")]
        is_video = any(n[2] == "hdlr" and data[n[0] + 16:n[0] + 20] == b"vide"
                       for n in inside)
        if not is_video:
            continue
        for off, size, typ, path in inside:
            if typ == "stsd":
                p = off + 16                       # first VisualSampleEntry
                w, h = struct.unpack(">HH", data[p + 32:p + 36])
                if w and h:
                    return w, h
    raise RuntimeError("could not read the video dimensions from stsd")


if __name__ == "__main__":
    # A corrupt input must fail with one `error:` line, not a Python traceback:
    # livephoto.sh reports whatever this process writes to stderr.
    try:
        raise SystemExit(main())
    except (OSError, RuntimeError, ValueError, KeyError, IndexError,
            StopIteration, struct.error) as exc:
        print(f"error: cannot build the Live Photo MOV: {exc}", file=sys.stderr)
        raise SystemExit(2)
