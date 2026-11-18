"""
Sky box textures for the globe's background, from NASA SVS "Deep Star Maps
2020" (svs.gsfc.nasa.gov/4851, public domain): the star map (Hipparcos,
Tycho-2 and Gaia stars plus the Milky Way, equirectangular, celestial ICRF)
and the constellation figures overlay.

  python3 scripts/sky/build-sky.py <starmap.exr> <figures.tif> <cesium sky box dir> <out dir>

Writes, for sizes 2048 and 1024, the six faces of a Cesium sky box
(sky-{size}-{px,mx,py,my,pz,mz}.jpg) and the same with constellation figures
(lines-{size}-*.jpg), plus previews. Cesium samples the sky box cube map with
the direction in its inertial frame (x to the equinox, z to the celestial
pole, see SkyBoxVS.glsl); which way the map's right ascension runs is found
by matching the faces against Cesium's own Tycho sky box.
"""
import os, sys
os.environ["OPENCV_IO_ENABLE_OPENEXR"] = "1"
import cv2
import numpy as np

starmap_path, figures_path, cesium_dir, out = sys.argv[1:5]
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

starmap = cv2.imread(starmap_path, cv2.IMREAD_UNCHANGED)
if starmap is None: raise SystemExit("cannot read " + starmap_path)
starmap = starmap[..., :3].astype(np.float32)  # BGR
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
exposure = -np.log(1 - 0.3 ** 2.2) / max(p99, 1e-9)
print("exposure", exposure)

# Which way right ascension runs on the map: match against Cesium's Tycho sky box.
def cesium_face(face, n=256):
    img = cv2.imread(os.path.join(cesium_dir, "tycho2t3_80_" + face + ".jpg"), cv2.IMREAD_GRAYSCALE)
    return cv2.resize(img, (n, n), interpolation=cv2.INTER_AREA).astype(np.float32)

lum = tonemap(starmap, exposure).max(-1).astype(np.float32)
best = None
for ra_sign in (1, -1):
    for ra_offset in (0, 90, 180, 270):
        score = 0.0
        for face in FACES:
            mine = sample(lum, face_dirs(face, 256), ra_sign, ra_offset)
            ref = cesium_face(face)
            a, b = mine - mine.mean(), ref - ref.mean()
            score += float((a * b).sum() / np.sqrt((a * a).sum() * (b * b).sum() + 1e-9))
        score /= len(FACES)
        print(f"ra_sign {ra_sign:+d} offset {ra_offset:3d}: correlation with Cesium's sky box {score:.3f}")
        if best is None or score > best[0]: best = (score, ra_sign, ra_offset)
print("chosen", best)
if best[0] < 0.3: raise SystemExit("no orientation matches Cesium's sky box well; check the face convention")
_, ra_sign, ra_offset = best

display = tonemap(starmap, exposure)
gold = np.array([90, 190, 245], np.float32) / 255  # BGR, a soft gold
with_lines = display * (1 - 0.55 * figures[..., None]) + gold * (0.55 * figures[..., None])

for name, image in (("sky", display), ("lines", with_lines)):
    for face in FACES:
        big = sample(image.astype(np.float32), face_dirs(face, 2048), ra_sign, ra_offset)
        big8 = np.clip(big * 255 + 0.5, 0, 255).astype(np.uint8)
        cv2.imwrite(os.path.join(out, f"{name}-2048-{face}.jpg"), big8, [cv2.IMWRITE_JPEG_QUALITY, 88, cv2.IMWRITE_JPEG_PROGRESSIVE, 1])
        small = cv2.resize(big8, (1024, 1024), interpolation=cv2.INTER_AREA)
        cv2.imwrite(os.path.join(out, f"{name}-1024-{face}.jpg"), small, [cv2.IMWRITE_JPEG_QUALITY, 88, cv2.IMWRITE_JPEG_PROGRESSIVE, 1])

# Previews: the faces in a cross, and the equirectangular map.
def cross(name):
    n = 384
    faces = {f: cv2.resize(cv2.imread(os.path.join(out, f"{name}-1024-{f}.jpg")), (n, n)) for f in FACES}
    canvas = np.zeros((3 * n, 4 * n, 3), np.uint8)
    for f, (r, c) in {"py": (0, 1), "mx": (1, 0), "pz": (1, 1), "px": (1, 2), "mz": (1, 3), "my": (2, 1)}.items():
        canvas[r * n:(r + 1) * n, c * n:(c + 1) * n] = faces[f]
    cv2.imwrite(os.path.join(out, f"preview-{name}-cross.jpg"), canvas, [cv2.IMWRITE_JPEG_QUALITY, 85])
cross("sky"); cross("lines")
cv2.imwrite(os.path.join(out, "preview-equirect.jpg"), cv2.resize(np.clip(with_lines * 255, 0, 255).astype(np.uint8), (2048, 1024), interpolation=cv2.INTER_AREA), [cv2.IMWRITE_JPEG_QUALITY, 85])
for f in sorted(os.listdir(out)): print(f"{os.path.getsize(os.path.join(out, f)) / 1024:8.0f} KB {f}")
