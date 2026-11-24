"""
4096 px sky box faces from NASA SVS "Deep Star Maps 2020" (svs.gsfc.nasa.gov/4851,
public domain), built from the map's two layers rather than the combined one:

  * milkyway_2020_16k.exr - the Milky Way and Gaia's faint stars, without the
    bright Hipparcos/Tycho stars: a diffuse light that resamples cleanly;
  * hiptyc_2020_16k.exr - the bright stars only.

Both are calibrated to the 8K combined map the 2048 px faces come from: the
16K files store a quarter of the 8K value per pixel (light per pixel, not
brightness), and the combined map weights the two layers, which is fitted
on the 8K files.

  python3 scripts/sky/build-sky-hd.py <starmap_8k.exr> <milkyway_8k.exr> <hiptyc_8k.exr> \
      <milkyway_16k.exr> <hiptyc_16k.exr> <cesium sky box dir> <out dir> [star gain multiplier] [current faces dir]

Why the earlier 4096 faces (from the combined 16K map) looked sparser: each
face was sampled straight from the map at about the map's own resolution, so
a star that is one pixel wide was often missed or split between pixels, and
faint stars became single dim pixels. Here each face is rendered at 8192 px
in linear light and area-averaged down to 4096, which keeps every star's
light, and the stars are calibrated against the 8K map. The exposure is the
2048 px faces' own (from the 8K combined map), so both sizes look alike.

Writes sky-4096-{px,mx,py,my,pz,mz}.jpg and comparison previews: the same
patch of sky as the screen shows it (about 39 px a degree, a 2560 px wide
screen at Cesium's 60° view) from the current 2048 px faces and the new
4096 px ones, with a count of the stars that stand out in each.
"""
import os, sys, json
os.environ["OPENCV_IO_ENABLE_OPENEXR"] = "1"
import cv2
import numpy as np

(starmap8_path, milky8_path, hip8_path, milky16_path, hip16_path, cesium_dir, out) = sys.argv[1:8]
STAR_GAIN_MULT = float(sys.argv[8]) if len(sys.argv) > 8 else 1.0
OLD_FACES_DIR = sys.argv[9] if len(sys.argv) > 9 else "public/sky"
SIZE, SUPER = int(os.environ.get("SKY_HD_SIZE", 4096)), 2
os.makedirs(out, exist_ok=True)
FACES = ["px", "mx", "py", "my", "pz", "mz"]
report = {}

def read_exr(path):
    """RGB float32 in BGR order (like OpenCV), with the OpenEXR package."""
    import OpenEXR
    with OpenEXR.File(path) as f:
        channels = f.channels()
        if "RGB" in channels or "RGBA" in channels:
            rgb = channels.get("RGB", channels.get("RGBA")).pixels[..., :3]
        else:
            rgb = np.stack([channels[c].pixels for c in ("R", "G", "B")], -1)
    return np.ascontiguousarray(rgb[..., ::-1]).astype(np.float32)

def tonemap(hdr, exposure):
    """The 2048 px faces' tone curve: soft shoulder for bright stars, sRGB gamma."""
    x = 1.0 - np.exp(-exposure * np.maximum(hdr, 0))
    return np.clip(x ** (1 / 2.2), 0, 1)

def face_dirs(face, n, rows=None):
    """Unit directions for pixels of one face (OpenGL cube map convention), float32; rows = (start, stop)."""
    c = ((np.arange(n, dtype=np.float32) + 0.5) / n * 2 - 1)
    r = c if rows is None else c[rows[0]:rows[1]]
    s, t = np.meshgrid(c, r)
    one = np.ones_like(s)
    x, y, z = {
        "px": (one, -t, -s), "mx": (-one, -t, s),
        "py": (s, one, t), "my": (s, -one, -t),
        "pz": (s, -t, one), "mz": (-s, -t, -one),
    }[face]
    v = np.stack([x, y, z], -1)
    return v / np.linalg.norm(v, axis=-1, keepdims=True)

def sample(equirect, dirs, ra_sign, ra_offset, interp=cv2.INTER_LINEAR):
    h, w = equirect.shape[:2]
    ra = np.degrees(np.arctan2(dirs[..., 1], dirs[..., 0]))
    dec = np.degrees(np.arcsin(np.clip(dirs[..., 2], -1, 1)))
    u = ((ra_offset + ra_sign * ra) / 360.0) % 1.0
    mx = (u * w - 0.5).astype(np.float32)
    my = ((90 - dec) / 180.0 * h - 0.5).astype(np.float32)
    return cv2.remap(equirect, mx, my, interp, borderMode=cv2.BORDER_WRAP)

def dihedral(img, k):
    o = np.rot90(img, k % 4)
    return np.fliplr(o) if k >= 4 else o

def undihedral(img, k):
    return np.rot90(np.fliplr(img) if k >= 4 else img, -(k % 4))

# --- 8K: exposure (as the 2048 px faces), layer check, star flux -------------
starmap8 = read_exr(starmap8_path)
p99 = float(np.percentile(starmap8.max(-1), 99))
exposure = -np.log(1 - 0.3 ** 2.2) / max(p99, 1e-9)
report["exposure"] = exposure
milky8, hip8 = read_exr(milky8_path), read_exr(hip8_path)
# Is the combined map the sum of its two layers?
diff = np.abs(starmap8 - (milky8 + hip8)).sum() / max(np.abs(starmap8).sum(), 1e-9)
report["layers_sum_rel_error_8k"] = float(diff)
report["hip_share_of_light_8k"] = float(hip8.sum() / max(starmap8.sum(), 1e-9))
# It is not: NASA weights the layers. Fit starmap = a * milkyway + b * stars
# (least squares over all pixels and channels) to keep the combined map's balance.
A = np.stack([milky8.ravel(), hip8.ravel()], 1).astype(np.float64)
y = starmap8.ravel().astype(np.float64)
(w_milky, w_hip), *_ = np.linalg.lstsq(A, y, rcond=None)
fit_err = float(np.abs(y - A @ np.array([w_milky, w_hip])).sum() / max(np.abs(y).sum(), 1e-9))
del A, y
report.update(layer_weight_milky=float(w_milky), layer_weight_stars=float(w_hip), layers_fit_rel_error_8k=fit_err)
hip8_sum = hip8.sum(axis=(0, 1), dtype=np.float64)
milky8_sum = milky8.sum(axis=(0, 1), dtype=np.float64)
del starmap8, milky8, hip8

# --- 16K layers, calibrated to the 8K ones' total light ----------------------
# Equirectangular pixels at 16K cover a quarter of the solid angle of 8K ones
# (row by row), so equal light means sum16 = 4 * sum8.
milky = read_exr(milky16_path)
milky_gain = float((4 * milky8_sum.sum()) / max(float(milky.sum(dtype=np.float64)), 1e-9)) * float(w_milky)
hip = read_exr(hip16_path)
star_gain = float((4 * hip8_sum.sum()) / max(float(hip.sum(dtype=np.float64)), 1e-9)) * float(w_hip) * STAR_GAIN_MULT
report.update(milky_gain_16k=milky_gain, star_gain_16k=star_gain, star_gain_multiplier=STAR_GAIN_MULT)
# Brightest-star peak per pixel at each resolution, for the record.
report["hip_peak_99_99_16k"] = float(np.percentile(hip.max(-1), 99.99))
sky = milky
if abs(milky_gain - 1) > 0.02: sky *= milky_gain
np.multiply(hip, star_gain, out=hip)
sky += hip
del hip
print(json.dumps(report, indent=1), flush=True)

# --- Orientation: as build-sky.py, matched against Cesium's own sky box -------
def cesium_face(face, n=256):
    img = cv2.imread(os.path.join(cesium_dir, "tycho2t3_80_" + face + ".jpg"), cv2.IMREAD_GRAYSCALE)
    return cv2.resize(img, (n, n), interpolation=cv2.INTER_AREA).astype(np.float32)
def corr(a, b):
    a, b = a - a.mean(), b - b.mean()
    return float((a * b).sum() / np.sqrt((a * a).sum() * (b * b).sum() + 1e-9))
blur = lambda img: cv2.GaussianBlur(img, (0, 0), 2.0)
small = cv2.resize(sky, (4096, 2048), interpolation=cv2.INTER_AREA)
lum = tonemap(small, exposure).max(-1).astype(np.float32)
refs = {face: blur(cesium_face(face)) for face in FACES}
best = None
for ra_sign in (1, -1):
    for ra_offset in (0, 90, 180, 270):
        per_face = {}
        for face in FACES:
            mine = blur(sample(lum, face_dirs(face, 256), ra_sign, ra_offset))
            scores = [corr(dihedral(mine, k), refs[face]) for k in range(8)]
            k = int(np.argmax(scores)); per_face[face] = (k, scores[k])
        score = float(np.mean([v[1] for v in per_face.values()]))
        if best is None or score > best[0]: best = (score, ra_sign, ra_offset, {f: k for f, (k, _) in per_face.items()})
print("orientation", best, flush=True)
if best[0] < 0.5: raise SystemExit("no orientation matches Cesium's sky box well")
_, ra_sign, ra_offset, face_fix = best
report["orientation"] = {"score": best[0], "ra_sign": ra_sign, "ra_offset": ra_offset, "face_fix": face_fix}

# --- Faces: 8192 px in linear light, area-averaged to 4096, tone-mapped --------
JPEG = [cv2.IMWRITE_JPEG_QUALITY, 86, cv2.IMWRITE_JPEG_PROGRESSIVE, 1]
big_n = SIZE * SUPER
for face in FACES:
    out_face = np.empty((SIZE, SIZE, 3), np.float32)
    step = min(1024, big_n)  # rows of the 8192 px render per chunk
    for r0 in range(0, big_n, step):
        chunk = sample(sky, face_dirs(face, big_n, (r0, r0 + step)), ra_sign, ra_offset)
        out_face[r0 // SUPER:(r0 + step) // SUPER] = cv2.resize(chunk, (SIZE, step // SUPER), interpolation=cv2.INTER_AREA)
    img = np.ascontiguousarray(dihedral(tonemap(out_face, exposure), face_fix[face]))
    cv2.imwrite(os.path.join(out, f"sky-{SIZE}-{face}.jpg"), np.clip(img * 255 + 0.5, 0, 255).astype(np.uint8), JPEG)
    print("face", face, flush=True)
del sky

# --- Previews: the screen's view of the same sky from 2048 vs 4096 faces -------
def load_canonical(prefix, size):
    return {f: undihedral(cv2.imread(os.path.join(prefix, f"sky-{size}-{f}.jpg")).astype(np.float32) / 255, face_fix[f]) for f in FACES}

def cube_lookup(faces, d):
    """Bilinear lookup in canonical faces (the inverse of face_dirs)."""
    n = next(iter(faces.values())).shape[0]
    x, y, z = d[..., 0], d[..., 1], d[..., 2]
    ax, ay, az = np.abs(x), np.abs(y), np.abs(z)
    out = np.zeros(d.shape[:-1] + (3,), np.float32)
    sel = {
        "px": (ax >= ay) & (ax >= az) & (x > 0), "mx": (ax >= ay) & (ax >= az) & (x <= 0),
        "py": (ay > ax) & (ay >= az) & (y > 0), "my": (ay > ax) & (ay >= az) & (y <= 0),
        "pz": (az > ax) & (az > ay) & (z > 0), "mz": (az > ax) & (az > ay) & (z <= 0),
    }
    st = {
        "px": (-z / x, -y / x), "mx": (z / -x, -y / -x),
        "py": (x / y, z / y), "my": (x / -y, -z / -y),
        "pz": (x / z, -y / z), "mz": (x / z, y / z),
    }
    with np.errstate(divide="ignore", invalid="ignore"):
        for f in FACES:
            m = sel[f]
            if not m.any(): continue
            s, t = st[f]
            mx = np.where(m, (s + 1) / 2 * n - 0.5, 0).astype(np.float32)
            my = np.where(m, (t + 1) / 2 * n - 0.5, 0).astype(np.float32)
            look = cv2.remap(faces[f], mx, my, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
            out[m] = look[m]
    return out

def view_dirs(center, w=1600, h=900, px_per_deg=39.0):
    f = center / np.linalg.norm(center)
    up0 = np.array([0, 0, 1.0]) if abs(f[2]) < 0.9 else np.array([1.0, 0, 0])
    r = np.cross(f, up0); r /= np.linalg.norm(r); u = np.cross(r, f)
    scale = 1 / (px_per_deg * 180 / np.pi)
    xs = (np.arange(w) - w / 2 + 0.5) * scale
    ys = (np.arange(h) - h / 2 + 0.5) * scale
    X, Y = np.meshgrid(xs, -ys)
    d = f[None, None] + X[..., None] * r[None, None] + Y[..., None] * u[None, None]
    return (d / np.linalg.norm(d, axis=-1, keepdims=True)).astype(np.float32)

def stars_that_stand_out(img):
    g = img.max(-1)
    bg = cv2.GaussianBlur(g, (0, 0), 6)
    peak = (g == cv2.dilate(g, np.ones((3, 3), np.uint8))) & (g - bg > 0.12)
    return int(peak.sum())

old = load_canonical(OLD_FACES_DIR, 2048)
new = load_canonical(out, SIZE)
# Three patches: the Milky Way's brightest stretch, a rich star field off it, and a sparse one.
centers = {"milkyway": None, "field": np.array([0.3, 0.8, 0.5]), "sparse": np.array([0.2, -0.3, 0.93])}
lumold = {f: old[f].max(-1) for f in FACES}
best_v, best_d = -1, None
for f in FACES:
    b = cv2.GaussianBlur(lumold[f], (0, 0), 40)
    i = np.unravel_index(np.argmax(b), b.shape)
    if b[i] > best_v:
        n = b.shape[0]; s = (i[1] + 0.5) / n * 2 - 1; t = (i[0] + 0.5) / n * 2 - 1
        best_v, best_d = b[i], face_dirs(f, n, (i[0], i[0] + 1))[0, i[1]]
centers["milkyway"] = best_d
counts = {}
for name, c in centers.items():
    d = view_dirs(np.asarray(c, np.float64))
    a, b = cube_lookup(old, d), cube_lookup(new, d)
    counts[name] = {"2048": stars_that_stand_out(a), "4096": stars_that_stand_out(b)}
    side = np.concatenate([a, np.ones((900, 8, 3), np.float32), b], 1)
    cv2.imwrite(os.path.join(out, f"preview-{name}-2048-vs-4096.jpg"), np.clip(side * 255, 0, 255).astype(np.uint8), [cv2.IMWRITE_JPEG_QUALITY, 92])
    # The middle at 3x, as a magnifier would show the screen.
    cy, cx = 450, 800
    za = cv2.resize(a[cy - 110:cy + 110, cx - 200:cx + 200], (1200, 660), interpolation=cv2.INTER_NEAREST)
    zb = cv2.resize(b[cy - 110:cy + 110, cx - 200:cx + 200], (1200, 660), interpolation=cv2.INTER_NEAREST)
    zoom = np.concatenate([za, np.ones((660, 8, 3), np.float32), zb], 1)
    cv2.imwrite(os.path.join(out, f"preview-{name}-zoom3x.png"), np.clip(zoom * 255, 0, 255).astype(np.uint8))
report["stars_that_stand_out"] = counts
report["face_kb"] = {f: round(os.path.getsize(os.path.join(out, f"sky-{SIZE}-{f}.jpg")) / 1024) for f in FACES}
with open(os.path.join(out, "report.json"), "w") as fh: json.dump(report, fh, indent=1)
print(json.dumps(report, indent=1))
