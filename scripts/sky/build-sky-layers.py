"""
Sky box faces without the bright stars, and the bright stars as a catalogue,
for the point-drawn stars (src/stars/). From NASA SVS "Deep Star Maps 2020"
(svs.gsfc.nasa.gov/4851, public domain) and the Hipparcos catalogue (ESA
1997, CDS VizieR I/239).

  python3 scripts/sky/build-sky-layers.py <maps dir> <hip.tsv> <figures_8k.tif> <cesium sky box dir> <out dir>

<maps dir> holds starmap_2020_8k.exr, milkyway_2020_{8k,16k}.exr and
hiptyc_2020_{8k,16k}.exr. <hip.tsv> is VizieR's tab-separated answer with
HIP, RAICRS, DEICRS, Vmag, B-V, pmRA, pmDE.

Writes
  stars.bin            catalogue stars brighter than STAR_LIMIT, brightest
                       first: little-endian float32 x, y, z (unit vector,
                       J2000 equator, x to the equinox, z to the pole: the
                       sky box's own frame), V, B-V
  bg-{1024,2048,4096}-{face}.jpg      Milky Way + the fainter stars
  bglines-{1024,2048}-{face}.jpg      the same with the constellation figures
  report.json, previews

The combined map is 0.5 x Milky Way + 1.0 x stars (fitted on the 8K files);
the 16K files hold a quarter of the 8K value per pixel. Each face is drawn in
linear light at twice its size and area-averaged, so no star's light is lost,
then tone-mapped with the 2048 px faces' exposure (build-sky.py).

The bright stars are taken out of the star layer where the catalogue puts
them: the connected patch of light around each one, within a radius that
grows with its brightness. Before that, the catalogue is checked against the
map: most catalogue stars must sit on a star of the map, which also proves
that the map's right ascension and the sky box frame agree with the
catalogue's.
"""
import os, sys, json, struct
os.environ["OPENCV_IO_ENABLE_OPENEXR"] = "1"
import cv2
import numpy as np

maps, hip_path, figures_path, cesium_dir, out = sys.argv[1:6]
STAR_LIMIT = float(os.environ.get("STAR_LIMIT", 7.0))
SIZES = [int(s) for s in os.environ.get("SKY_SIZES", "1024,2048,4096").split(",")]
HD = int(os.environ.get("SKY_HD_SIZE", 4096))  # the size built from the 16K layers (tests use a small one)
os.makedirs(out, exist_ok=True)
FACES = ["px", "mx", "py", "my", "pz", "mz"]
report = {"star_limit": STAR_LIMIT}

def read_exr(path):
    import OpenEXR
    with OpenEXR.File(path) as f:
        ch = f.channels()
        rgb = ch.get("RGB", ch.get("RGBA")).pixels[..., :3] if ("RGB" in ch or "RGBA" in ch) else np.stack([ch[c].pixels for c in ("R", "G", "B")], -1)
    return np.ascontiguousarray(rgb[..., ::-1]).astype(np.float32)  # BGR, like OpenCV

def tonemap(hdr, exposure):
    x = 1.0 - np.exp(-exposure * np.maximum(hdr, 0))
    return np.clip(x ** (1 / 2.2), 0, 1)

def face_dirs(face, n, rows=None):
    c = (np.arange(n, dtype=np.float32) + 0.5) / n * 2 - 1
    s, t = np.meshgrid(c, c if rows is None else c[rows[0]:rows[1]])
    one = np.ones_like(s)
    x, y, z = {"px": (one, -t, -s), "mx": (-one, -t, s), "py": (s, one, t), "my": (s, -one, -t), "pz": (s, -t, one), "mz": (-s, -t, -one)}[face]
    v = np.stack([x, y, z], -1)
    return v / np.linalg.norm(v, axis=-1, keepdims=True)

def map_xy(ra_deg, dec_deg, w, h, ra_sign, ra_offset):
    """Map pixel (column, row; pixel centres at .0) of a right ascension/declination."""
    u = ((ra_offset + ra_sign * ra_deg) / 360.0) % 1.0
    return u * w - 0.5, (90 - dec_deg) / 180.0 * h - 0.5

def sample(equirect, dirs, ra_sign, ra_offset):
    h, w = equirect.shape[:2]
    ra = np.degrees(np.arctan2(dirs[..., 1], dirs[..., 0]))
    dec = np.degrees(np.arcsin(np.clip(dirs[..., 2], -1, 1)))
    mx, my = map_xy(ra, dec, w, h, ra_sign, ra_offset)
    return cv2.remap(equirect, mx.astype(np.float32), my.astype(np.float32), cv2.INTER_LINEAR, borderMode=cv2.BORDER_WRAP)

def dihedral(img, k):
    o = np.rot90(img, k % 4)
    return np.fliplr(o) if k >= 4 else o

# --- Catalogue ----------------------------------------------------------------
stars = []
with open(hip_path, encoding="utf-8", errors="replace") as fh:
    header = None
    for line in fh:
        if not line.strip() or line.startswith("#"): continue
        cols = [c.strip() for c in line.rstrip("\n").split("\t")]
        if header is None:
            header = cols; continue
        if set("".join(cols)) <= set("-"): continue  # the units / dashes lines
        row = dict(zip(header, cols))
        try:
            ra, dec, v = float(row["RAICRS"]), float(row["DEICRS"]), float(row["Vmag"])
        except (KeyError, ValueError):
            continue
        bv = float(row["B-V"]) if row.get("B-V") not in (None, "") else 0.6
        pmra = float(row["pmRA"]) if row.get("pmRA") else 0.0
        pmde = float(row["pmDE"]) if row.get("pmDE") else 0.0
        stars.append((ra, dec, v, bv, pmra, pmde))
cat = np.array(stars, np.float64)
if len(cat) < int(os.environ.get("MIN_CATALOGUE", 5000)): raise SystemExit(f"catalogue too small: {len(cat)} rows")
# Hipparcos positions are for J1991.25: move them to J2000 with the proper motions (mas/yr, RA's includes cos dec).
years = 8.75
dec_r = np.radians(cat[:, 1])
cat[:, 0] += cat[:, 4] * years / 3.6e6 / np.maximum(np.cos(dec_r), 1e-6)
cat[:, 1] += cat[:, 5] * years / 3.6e6
cat = cat[np.argsort(cat[:, 2])]
bright = cat[cat[:, 2] < STAR_LIMIT]
report["catalogue_rows"] = int(len(cat)); report["points"] = int(len(bright))
ra_r, dec_r = np.radians(bright[:, 0]), np.radians(bright[:, 1])
xyz = np.stack([np.cos(dec_r) * np.cos(ra_r), np.cos(dec_r) * np.sin(ra_r), np.sin(dec_r)], 1)
with open(os.path.join(out, "stars.bin"), "wb") as fh:
    for (x, y, z), v, bv in zip(xyz, bright[:, 2], bright[:, 3]):
        fh.write(struct.pack("<5f", x, y, z, v, bv))
print("catalogue", report, flush=True)

# --- 8K: exposure, layer weights ------------------------------------------------
star8 = read_exr(os.path.join(maps, "starmap_2020_8k.exr"))
exposure = -np.log(1 - 0.3 ** 2.2) / max(float(np.percentile(star8.max(-1), 99)), 1e-9)
milky8 = read_exr(os.path.join(maps, "milkyway_2020_8k.exr"))
hip8 = read_exr(os.path.join(maps, "hiptyc_2020_8k.exr"))
A = np.stack([milky8.ravel(), hip8.ravel()], 1).astype(np.float64)
y = star8.ravel().astype(np.float64)
(w_milky, w_stars), *_ = np.linalg.lstsq(A, y, rcond=None)
report.update(exposure=float(exposure), weight_milky=float(w_milky), weight_stars=float(w_stars),
              weights_fit_rel_error=float(np.abs(y - A @ np.array([w_milky, w_stars])).sum() / np.abs(y).sum()))
del A, y, star8

# --- Orientation against Cesium's sky box (as build-sky.py) ---------------------
def cesium_face(face, n=256):
    img = cv2.imread(os.path.join(cesium_dir, "tycho2t3_80_" + face + ".jpg"), cv2.IMREAD_GRAYSCALE)
    return cv2.resize(img, (n, n), interpolation=cv2.INTER_AREA).astype(np.float32)
def corr(a, b):
    a, b = a - a.mean(), b - b.mean()
    return float((a * b).sum() / np.sqrt((a * a).sum() * (b * b).sum() + 1e-9))
blur = lambda img: cv2.GaussianBlur(img, (0, 0), 2.0)
lum = tonemap(w_milky * milky8 + w_stars * hip8, exposure).max(-1).astype(np.float32)
lum = cv2.resize(lum, (4096, 2048), interpolation=cv2.INTER_AREA)
refs = {f: blur(cesium_face(f)) for f in FACES}
best = None
for ra_sign in (1, -1):
    for ra_offset in (0, 90, 180, 270):
        per = {}
        for f in FACES:
            mine = blur(sample(lum, face_dirs(f, 256), ra_sign, ra_offset))
            sc = [corr(dihedral(mine, k), refs[f]) for k in range(8)]
            per[f] = (int(np.argmax(sc)), max(sc))
        score = float(np.mean([v[1] for v in per.values()]))
        if best is None or score > best[0]: best = (score, ra_sign, ra_offset, {f: k for f, (k, _) in per.items()})
if best[0] < 0.5: raise SystemExit("no orientation matches Cesium's sky box")
_, RA_SIGN, RA_OFFSET, FACE_FIX = best
report["orientation"] = {"score": best[0], "ra_sign": RA_SIGN, "ra_offset": RA_OFFSET, "face_fix": FACE_FIX}
del lum
print("orientation", report["orientation"], flush=True)

# --- Catalogue against the map, and taking the bright stars out ------------------
def check_and_mask(layer, scale):
    """`scale`: 1 for 8K, 2 for 16K. Returns the layer without the catalogue's bright stars, and statistics."""
    h, w = layer.shape[:2]
    g = layer.max(-1)
    cx, cy = map_xy(bright[:, 0], bright[:, 1], w, h, RA_SIGN, RA_OFFSET)
    # Where is the brightest pixel within 3 px (x scale) of each catalogue position?
    r = 3 * scale
    offsets, found = [], 0
    for x, yy in zip(cx[:2000], cy[:2000]):  # the 2000 brightest are enough to check the frame
        xi, yi = int(round(x)), int(round(yy))
        y0, y1 = max(yi - r, 0), min(yi + r + 1, h)
        cols = np.arange(xi - r, xi + r + 1) % w
        patch = g[y0:y1][:, cols]
        if patch.size == 0: continue
        j = np.unravel_index(np.argmax(patch), patch.shape)
        if patch[j] > 0:
            found += 1
            offsets.append((cols[j[1]] - x if abs(cols[j[1]] - x) < w / 2 else 0, y0 + j[0] - yy))
    off = np.array(offsets) if offsets else np.zeros((1, 2))
    stats = {"checked": int(min(2000, len(cx))), "with_map_star_within_3px": int(found),
             "median_offset_px": [float(np.median(off[:, 0])), float(np.median(off[:, 1]))],
             "median_abs_offset_px": float(np.median(np.hypot(off[:, 0], off[:, 1])))}
    # Take each bright star's patch of light out: pixels above a faint threshold,
    # connected to the star, within a radius that grows with brightness.
    thr = 6.7e-5 / exposure / max(w_stars, 1e-9) / (4 if scale == 2 else 1)
    mask = (g > thr).astype(np.uint8)
    n_labels, labels = cv2.connectedComponents(mask, connectivity=8)
    radius = np.clip(3 + 4.0 * (STAR_LIMIT - bright[:, 2]), 3, 48) * scale
    removed = np.zeros(g.shape, bool)
    for x, yy, rad in zip(cx, cy, radius):
        xi, yi, ri = int(round(x)), int(round(yy)), int(np.ceil(rad))
        y0, y1 = max(yi - ri, 0), min(yi + ri + 1, h)
        cols = np.arange(xi - ri, xi + ri + 1) % w
        lab = labels[y0:y1][:, cols]
        yy_, xx_ = np.mgrid[y0:y1, xi - ri:xi + ri + 1]
        inside = (xx_ - x) ** 2 + (yy_ - yy) ** 2 <= rad ** 2
        core = lab[max(yi - y0 - scale, 0):yi - y0 + scale + 1, ri - scale:ri + scale + 1]
        ids = np.unique(core[core > 0])
        sel = inside & (np.isin(lab, ids) if ids.size else np.zeros_like(inside))
        # A faint star with no patch above the threshold: clear its core anyway.
        sel |= inside & ((xx_ - x) ** 2 + (yy_ - yy) ** 2 <= (1.5 * scale) ** 2)
        sub = removed[y0:y1]
        sub[:, cols] |= sel
    before = float(layer.sum(dtype=np.float64))
    layer[removed] = 0
    stats["light_removed_share"] = 1 - float(layer.sum(dtype=np.float64)) / max(before, 1e-12)
    stats["pixels_removed_share"] = float(removed.mean())
    del labels, mask, removed
    return layer, stats

hip8, stats8 = check_and_mask(hip8, 1)
report["check_8k"] = stats8
print("8K", stats8, flush=True)
if stats8["with_map_star_within_3px"] < 0.9 * stats8["checked"]:
    raise SystemExit("the catalogue does not sit on the map's stars: frame or epoch mismatch")

# --- Faces -----------------------------------------------------------------------
figures = cv2.imread(figures_path, cv2.IMREAD_UNCHANGED)
figures = figures.astype(np.float32) / (65535.0 if figures.dtype == np.uint16 else 255.0)
if figures.ndim == 3: figures = figures[..., 3] if figures.shape[2] == 4 else figures[..., :3].max(-1)
gold = np.array([90, 190, 245], np.float32) / 255
JPEG = [cv2.IMWRITE_JPEG_QUALITY, 86, cv2.IMWRITE_JPEG_PROGRESSIVE, 1]

def render(layer, face, size):
    """The face at `size`, drawn at twice that in linear light and area-averaged."""
    big = size * 2
    res = np.empty((size, size, 3), np.float32)
    step = min(1024, big)
    for r0 in range(0, big, step):
        chunk = sample(layer, face_dirs(face, big, (r0, r0 + step)), RA_SIGN, RA_OFFSET)
        res[r0 // 2:(r0 + step) // 2] = cv2.resize(chunk, (size, step // 2), interpolation=cv2.INTER_AREA)
    return res

def write_faces(layer, size, with_lines):
    for f in FACES:
        lin = render(layer, f, size)
        img = tonemap(lin, exposure)
        cv2.imwrite(os.path.join(out, f"bg-{size}-{f}.jpg"), np.clip(dihedral(img, FACE_FIX[f]) * 255 + 0.5, 0, 255).astype(np.uint8), JPEG)
        if with_lines:
            a = sample(figures, face_dirs(f, size), RA_SIGN, RA_OFFSET)[..., None]
            li = img * (1 - 0.55 * a) + gold * (0.55 * a)
            cv2.imwrite(os.path.join(out, f"bglines-{size}-{f}.jpg"), np.clip(dihedral(li, FACE_FIX[f]) * 255 + 0.5, 0, 255).astype(np.uint8), JPEG)
        print("face", size, f, flush=True)

bg8 = w_milky * milky8
bg8 += w_stars * hip8
del milky8, hip8
for size in (s for s in SIZES if s != HD):
    write_faces(bg8, size, True)
del bg8, figures

if HD in SIZES:
    milky16 = read_exr(os.path.join(maps, "milkyway_2020_16k.exr"))
    hip16 = read_exr(os.path.join(maps, "hiptyc_2020_16k.exr"))
    hip16, stats16 = check_and_mask(hip16, 2)
    report["check_16k"] = stats16
    print("16K", stats16, flush=True)
    # The 16K files hold a quarter of the 8K value per pixel.
    milky16 *= 4 * w_milky
    hip16 *= 4 * w_stars
    milky16 += hip16
    del hip16
    write_faces(milky16, HD, False)
    del milky16

# --- Preview: a cross of the 1024 px faces ----------------------------------------
n = 384
cross = np.zeros((3 * n, 4 * n, 3), np.uint8)
for f, (r, c) in {"py": (0, 1), "mx": (1, 0), "pz": (1, 1), "px": (1, 2), "mz": (1, 3), "my": (2, 1)}.items():
    p = os.path.join(out, f"bg-1024-{f}.jpg")
    if os.path.exists(p): cross[r * n:(r + 1) * n, c * n:(c + 1) * n] = cv2.resize(cv2.imread(p), (n, n))
cv2.imwrite(os.path.join(out, "preview-bg-cross.jpg"), cross, [cv2.IMWRITE_JPEG_QUALITY, 85])
report["files_kb"] = {f: round(os.path.getsize(os.path.join(out, f)) / 1024) for f in sorted(os.listdir(out)) if f.endswith((".jpg", ".bin"))}
with open(os.path.join(out, "report.json"), "w") as fh: json.dump(report, fh, indent=1)
print(json.dumps(report, indent=1))
