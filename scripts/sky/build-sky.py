"""
Sky box textures for the globe's background, from NASA SVS "Deep Star Maps
2020" (svs.gsfc.nasa.gov/4851, public domain): the star map (Hipparcos,
Tycho-2 and Gaia stars plus the Milky Way, equirectangular, celestial ICRF)
and the constellation figures overlay.

  python3 scripts/sky/build-sky.py <starmap.exr> <figures.tif> <cesium sky box dir> <out dir> <size> [exposure]

Writes the six faces of a Cesium sky box at <size> px
(sky-{size}-{px,mx,py,my,pz,mz}.jpg) and, up to 2048 px, the same with the
constellation figures (lines-{size}-*.jpg), plus 1024 px faces from the
2048 ones, and previews. Each size should come from the map that matches it
(8K for 2048, 16K for 4096): area-averaging a finer map spreads each star
over more pixels and dims it. The exposure (printed by the 8K run) can be
passed to the 16K run so both look the same. Cesium samples the sky box cube map with
the direction in its inertial frame (x to the equinox, z to the celestial
pole, see SkyBoxVS.glsl); which way the map's right ascension runs is found
by matching the faces against Cesium's own Tycho sky box.
"""
import os, sys
os.environ["OPENCV_IO_ENABLE_OPENEXR"] = "1"
import cv2
import numpy as np

starmap_path, figures_path, cesium_dir, out = sys.argv[1:5]
SIZE = int(sys.argv[5]) if len(sys.argv) > 5 else 2048
EXPOSURE = float(sys.argv[6]) if len(sys.argv) > 6 else None
os.makedirs(out, exist_ok=True)
FACES = ["px", "mx", "py", "my", "pz", "mz"]

def face_dirs(face, n):
    """Unit directions for each pixel of one face (OpenGL cube map convention)."""
    c = (np.arange(n) + 0.5) / n * 2 - 1
    s, t = np.meshgrid(c, c)  # s: columns, t: rows top to bottom
    one = np.ones_like(s)
    x, y, z = {
        "px": (one, -t, -s), "mx": (-one, -t, s),
        "py": (s, one, t), "my": (s, -one, -t),
        "pz": (s, -t, one), "mz": (-s, -t, -one),
    }[face]
    v = np.stack([x, y, z], -1)
    return v / np.linalg.norm(v, axis=-1, keepdims=True)

def sample(equirect, dirs, ra_sign, ra_offset):
    """Equirectangular lookup: column from right ascension, row from declination."""
    h, w = equirect.shape[:2]
    ra = np.degrees(np.arctan2(dirs[..., 1], dirs[..., 0]))
    dec = np.degrees(np.arcsin(np.clip(dirs[..., 2], -1, 1)))
    u = ((ra_offset + ra_sign * ra) / 360.0) % 1.0
    mx = (u * w - 0.5).astype(np.float32)
    my = ((90 - dec) / 180.0 * h - 0.5).astype(np.float32)
    return cv2.remap(equirect, mx, my, cv2.INTER_LINEAR, borderMode=cv2.BORDER_WRAP)

def tonemap(hdr, exposure):
    """Linear HDR to display: soft shoulder for bright stars, sRGB gamma."""
    x = 1.0 - np.exp(-exposure * np.maximum(hdr, 0))
    return np.clip(x ** (1 / 2.2), 0, 1)

def read_exr(path):
    """RGB as float32 (returned BGR, like OpenCV), with the OpenEXR package (OpenCV lacks some compressions)."""
    import OpenEXR
    with OpenEXR.File(path) as f:
        channels = f.channels()
        print("exr channels", {k: getattr(v.pixels, "shape", None) for k, v in channels.items()})
        if "RGB" in channels or "RGBA" in channels:
            rgb = channels.get("RGB", channels.get("RGBA")).pixels[..., :3]
        else:
            rgb = np.stack([channels[c].pixels for c in ("R", "G", "B")], -1)
    return np.ascontiguousarray(rgb[..., ::-1]).astype(np.float32)

starmap = read_exr(starmap_path)
print("starmap", starmap.shape, "percentiles", np.percentile(starmap, [50, 90, 99, 99.9, 99.99]))
figures = cv2.imread(figures_path, cv2.IMREAD_UNCHANGED)
if figures is None: raise SystemExit("cannot read " + figures_path)
print("figures", figures.shape, figures.dtype, "max", figures.max())
figures = figures.astype(np.float32) / (65535.0 if figures.dtype == np.uint16 else 255.0)
if figures.ndim == 3:
    # Lines as alpha (or luminance when there is none).
    figures = figures[..., 3] if figures.shape[2] == 4 else figures[..., :3].max(-1)
figures = cv2.resize(figures, (starmap.shape[1], starmap.shape[0]), interpolation=cv2.INTER_AREA)

# Exposure: put the Milky Way's bright regions (99th percentile) at about 30% grey.
p99 = float(np.percentile(starmap.max(-1), 99))
exposure = EXPOSURE if EXPOSURE is not None else -np.log(1 - 0.3 ** 2.2) / max(p99, 1e-9)
print("exposure", exposure)
with open(os.path.join(out, "exposure.txt"), "w") as f: f.write(repr(exposure))

# Which way right ascension runs on the map: match against Cesium's Tycho sky box.
def cesium_face(face, n=256):
    img = cv2.imread(os.path.join(cesium_dir, "tycho2t3_80_" + face + ".jpg"), cv2.IMREAD_GRAYSCALE)
    return cv2.resize(img, (n, n), interpolation=cv2.INTER_AREA).astype(np.float32)

lum = tonemap(starmap, exposure).max(-1).astype(np.float32)

# Each face may also need one of the 8 rotations/mirrors to match Cesium's own
# faces; find, for each right ascension direction, the best one per face.
def dihedral(img, k):
    out = np.rot90(img, k % 4)
    return np.fliplr(out) if k >= 4 else out

def corr(a, b):
    a, b = a - a.mean(), b - b.mean()
    return float((a * b).sum() / np.sqrt((a * a).sum() * (b * b).sum() + 1e-9))

def blur(img):
    # Stars are points: compare smoothed maps so a one-pixel offset still matches.
    return cv2.GaussianBlur(img, (0, 0), 2.0)

refs = {face: blur(cesium_face(face)) for face in FACES}
best = None
for ra_sign in (1, -1):
    for ra_offset in (0, 90, 180, 270):
        per_face = {}
        for face in FACES:
            mine = blur(sample(lum, face_dirs(face, 256), ra_sign, ra_offset))
            scores = [corr(dihedral(mine, k), refs[face]) for k in range(8)]
            k = int(np.argmax(scores))
            per_face[face] = (k, scores[k])
        score = float(np.mean([v[1] for v in per_face.values()]))
        print(f"ra_sign {ra_sign:+d} offset {ra_offset:3d}: mean {score:.3f}  " + " ".join(f"{f}:k{k}={v:.2f}" for f, (k, v) in per_face.items()))
        if best is None or score > best[0]: best = (score, ra_sign, ra_offset, {f: k for f, (k, _) in per_face.items()})
print("chosen", best)
if best[0] < 0.5: raise SystemExit("no orientation matches Cesium's sky box well; check the face convention")
_, ra_sign, ra_offset, face_fix = best

display = tonemap(starmap, exposure).astype(np.float32)
del starmap, lum  # the 16K map is 1.6 GB in memory
if SIZE > 2048:
    # A light unsharp mask for the finest faces only, where stars are a pixel or two.
    blurred = cv2.GaussianBlur(display, (0, 0), 1.0)
    display = np.clip(display + 0.3 * (display - blurred), 0, 1)
    del blurred
gold = np.array([90, 190, 245], np.float32) / 255  # BGR, a soft gold
with_lines = (display * (1 - 0.55 * figures[..., None]) + gold * (0.55 * figures[..., None])).astype(np.float32)
del figures

# The 4096 px faces weigh most: a little more compression there.
JPEG = [cv2.IMWRITE_JPEG_QUALITY, 84 if SIZE > 2048 else 88, cv2.IMWRITE_JPEG_PROGRESSIVE, 1]
variants = (("sky", display), ("lines", with_lines)) if SIZE <= 2048 else (("sky", display),)
for name, image in variants:
    for face in FACES:
        big = np.ascontiguousarray(dihedral(sample(image, face_dirs(face, SIZE), ra_sign, ra_offset), face_fix[face]))
        big8 = np.clip(big * 255 + 0.5, 0, 255).astype(np.uint8)
        del big
        cv2.imwrite(os.path.join(out, f"{name}-{SIZE}-{face}.jpg"), big8, JPEG)
        if SIZE == 2048:
            cv2.imwrite(os.path.join(out, f"{name}-1024-{face}.jpg"), cv2.resize(big8, (1024, 1024), interpolation=cv2.INTER_AREA), JPEG)

# Previews: the faces in a cross, and the equirectangular map.
def cross(name):
    n = 384
    faces = {f: cv2.resize(cv2.imread(os.path.join(out, f"{name}-1024-{f}.jpg")), (n, n)) for f in FACES}
    canvas = np.zeros((3 * n, 4 * n, 3), np.uint8)
    for f, (r, c) in {"py": (0, 1), "mx": (1, 0), "pz": (1, 1), "px": (1, 2), "mz": (1, 3), "my": (2, 1)}.items():
        canvas[r * n:(r + 1) * n, c * n:(c + 1) * n] = faces[f]
    cv2.imwrite(os.path.join(out, f"preview-{name}-cross.jpg"), canvas, [cv2.IMWRITE_JPEG_QUALITY, 85])
if SIZE == 2048: cross("sky"); cross("lines")
cv2.imwrite(os.path.join(out, "preview-equirect.jpg"), cv2.resize(np.clip(with_lines * 255, 0, 255).astype(np.uint8), (2048, 1024), interpolation=cv2.INTER_AREA), [cv2.IMWRITE_JPEG_QUALITY, 85])
for f in sorted(os.listdir(out)): print(f"{os.path.getsize(os.path.join(out, f)) / 1024:8.0f} KB {f}")
