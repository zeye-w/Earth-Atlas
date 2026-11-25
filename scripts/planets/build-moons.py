"""
Global maps of Pluto, Charon and the large moons for the solar system's
close views, in the planet maps' layout: simple cylindrical, 2048 × 1024,
180°W at the left edge, the prime meridian in the middle, east to the
right, north up (src/planetSpheres.ts).

  python3 scripts/planets/build-moons.py <download dir> <out dir>

Sources (USGS Astrogeology mosaics from NASA missions, public domain):
  Io, Europa, Ganymede, Callisto  Voyager + Galileo SSI global mosaics (grey)
  Titan                           Cassini ISS 938 nm global mosaic (grey: the surface under the haze)
  Triton                          Voyager 2 global colour mosaic
  Pluto, Charon                   New Horizons LORRI/MVIC global mosaics (grey)
Colour, where the mosaic is grey:
  Pluto  NASA/JHUAPL/SwRI global colour map (PIA11707): its colour, the mosaic's detail
  Io     JPL (D. Seal) Voyager/Galileo colour map: its colour, the mosaic's detail
  Europa, Ganymede, Callisto, Charon: one overall tint (their colours are muted)
  Titan  drawn as its orange haze, with the surface faintly through it

Each mosaic's own georeferencing (gdalinfo) gives where its pixels lie; the
colour maps, which have none, are aligned to the mosaic by the shift (and
mirror) that best correlates their brightness. Some USGS products count
longitude westward: the previews mark known landforms at their east
longitudes, to check the result is not mirrored.
"""
import json, os, re, subprocess, sys
import cv2
import numpy as np

dl, out = sys.argv[1:3]
os.makedirs(out, exist_ok=True)
W, H = 2048, 1024
MOSAIC = "https://planetarymaps.usgs.gov/mosaic/"

BODIES = {
    "io": {"urls": [MOSAIC + "Io_GalileoSSI-Voyager_Global_Mosaic_1km.tif"], "color": "https://maps.jpl.nasa.gov/tmaps/pix/jup1vss2.jpg",
           "marks": {"Pele": (104.7, -18.7), "Loki": (51.2, 13.0), "Prometheus": (-153.0, -1.5)}},
    "europa": {"urls": [MOSAIC + "Europa_Voyager_GalileoSSI_global_mosaic_500m.tif"], "tint": (0.96, 0.90, 0.80),
               "marks": {"Pwyll": (88.6, -25.2)}},
    "ganymede": {"urls": [MOSAIC + "Ganymede_Voyager_GalileoSSI_global_mosaic_1km.tif"], "tint": (0.88, 0.83, 0.76),
                 "marks": {"Galileo Regio": (-145.0, 35.0), "Tros": (-27.0, 11.0)}},
    "callisto": {"urls": [MOSAIC + "Callisto_Voyager_GalileoSSI_global_mosaic_1km.tif"], "tint": (0.78, 0.70, 0.60),
                 "marks": {"Valhalla": (-56.0, 14.7), "Asgard": (-140.0, 32.0)}},
    "titan": {"urls": [MOSAIC + "Titan_ISS_P19658_Mosaic_Global_4km.tif"], "haze": (0.86, 0.60, 0.30),
              "marks": {"Xanadu": (-100.0, -10.0), "Belet": (105.0, -7.0)}},
    "triton": {"urls": [MOSAIC + "Triton_Voyager2_ClrMosaic_GlobalFill_600m.tif"], "marks": {}},
    "pluto": {"urls": [MOSAIC + "Pluto_NewHorizons_Global_Mosaic_300m_Jul2017_8bit.tif",
                       MOSAIC + "Pluto_NewHorizons_Global_Mosaic_300m_Jul2017_8bit.TIF"],
              "color": "https://photojournal.jpl.nasa.gov/tiff/PIA11707.tif",
              "marks": {"Sputnik Planitia": (178.0, 20.0), "Cthulhu": (100.0, -15.0)}},
    "charon": {"urls": [MOSAIC + "Charon_NewHorizons_Global_Mosaic_300m_Jul2017_8bit.tif"], "tint": (0.90, 0.87, 0.84), "marks": {}},
}
ONLY = [b for b in os.environ.get("BODIES", "").split(",") if b]
report = {}

def run(*args):
    return subprocess.run(args, check=True, capture_output=True, text=True).stdout

def download(urls, path):
    for url in urls:
        if subprocess.run(["curl", "-sSfL", "--retry", "3", "--connect-timeout", "30", "-A", "Mozilla/5.0", "-o", path, url]).returncode == 0 and os.path.getsize(path) > 10000:
            return url
    raise SystemExit(f"no source answered for {path}: {urls}")

def read_mosaic(path):
    """The mosaic downsized to about 4096 px across, with where its pixels lie (degrees east, north)."""
    info = json.loads(run("gdalinfo", "-json", path))
    small = path + ".small.tif"
    band = info["bands"][0]
    args = ["gdal_translate", "-q", "-of", "GTiff", "-outsize", "4096", "0", "-r", "average"]
    if band.get("type") != "Byte":
        args += ["-ot", "Byte", "-scale"]
    run(*args, path, small)
    si = json.loads(run("gdalinfo", "-json", small))
    proj4 = run("gdalsrsinfo", "-o", "proj4", small).strip().strip("'")
    img = cv2.imread(small, cv2.IMREAD_UNCHANGED)
    if img.ndim == 3 and img.shape[2] in (2, 4):  # a grey or colour band with alpha: drop the alpha
        img = img[..., 0] if img.shape[2] == 2 else img[..., :3]
    if img.ndim == 3: img = np.ascontiguousarray(img[..., ::-1])  # OpenCV reads BGR; keep RGB here
    nodata = band.get("noDataValue")
    p = dict(re.findall(r"\+(\w+)=([^\s]+)", proj4))
    return img, si["geoTransform"], p, proj4, nodata, info

def to_grid(img, gt, p):
    """Resample to the target grid (lon −180..180 east, lat 90..−90)."""
    lon = (np.arange(W) + 0.5) / W * 360 - 180
    lat = 90 - (np.arange(H) + 0.5) / H * 180
    LON, LAT = np.meshgrid(lon, lat)
    proj = p.get("proj")
    if proj in ("longlat", "lonlat", "latlong"):
        x, y = LON.copy(), LAT.copy()
    elif proj == "eqc":
        R = float(p.get("R", p.get("a", "1")))
        lon0, lat_ts = float(p.get("lon_0", 0)), float(p.get("lat_ts", 0))
        x = R * np.cos(np.radians(lat_ts)) * np.radians(LON - lon0)
        y = R * np.radians(LAT)
    else:
        raise SystemExit(f"unexpected projection {proj}")
    col = (x - gt[0]) / gt[1] - 0.5
    row = (y - gt[3]) / gt[5] - 0.5
    w = img.shape[1]
    # One turn of longitude in source pixels: wrap columns that fall outside.
    turn = 360 / gt[1] if proj in ("longlat", "lonlat", "latlong") else (2 * np.pi * float(p.get("R", p.get("a", "1"))) * np.cos(np.radians(float(p.get("lat_ts", 0))))) / gt[1]
    col = np.mod(col, abs(turn))
    out = cv2.remap(img, col.astype(np.float32), row.astype(np.float32), cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    return out, {"turn_px": float(turn), "width_px": int(w)}

def fill_gaps(img, mask):
    """Unimaged areas (mask true) filled with the surrounding brightness, smoothly (normalized convolution)."""
    if not mask.any(): return img
    f = img.astype(np.float32)
    valid = (~mask).astype(np.float32)
    acc = f.copy() if f.ndim == 2 else f.copy()
    for sigma in (4, 16, 64, 256):
        num = cv2.GaussianBlur(f * (valid if f.ndim == 2 else valid[..., None]), (0, 0), sigma)
        den = cv2.GaussianBlur(valid, (0, 0), sigma)
        est = num / np.maximum(den if f.ndim == 2 else den[..., None], 1e-6)
        sel = mask & (den > 1e-3)
        acc[sel] = est[sel]
        mask = mask & ~(den > 1e-3)
        if not mask.any(): break
    return acc

def align_color(color, gray):
    """Shift (and mirror) of a colour map that best matches the mosaic's brightness; both full globes."""
    cg = cv2.resize(cv2.cvtColor(color, cv2.COLOR_RGB2GRAY).astype(np.float32), (512, 256), interpolation=cv2.INTER_AREA)
    g = cv2.resize(gray.astype(np.float32), (512, 256), interpolation=cv2.INTER_AREA)
    band = slice(40, 216)  # leave out the poles, often unimaged
    gz = (g[band] - g[band].mean()) / (g[band].std() + 1e-6)
    best = None
    for mirror in (False, True):
        c = cg[:, ::-1] if mirror else cg
        for dx in range(512):
            cs = np.roll(c, dx, axis=1)[band]
            cz = (cs - cs.mean()) / (cs.std() + 1e-6)
            r = float((gz * cz).mean())
            if best is None or r > best[0]: best = (r, mirror, dx)
    r, mirror, dx = best
    full = color[:, ::-1] if mirror else color
    full = cv2.resize(full, (W, H), interpolation=cv2.INTER_AREA)
    return np.roll(full, dx * (W // 512), axis=1), {"correlation": r, "mirrored": mirror, "shift_deg": dx * 360 / 512}

def preview(img, marks, path):
    p = cv2.resize(img, (1024, 512), interpolation=cv2.INTER_AREA).copy()
    bgr = p[..., ::-1].copy() if p.ndim == 3 else cv2.cvtColor(p, cv2.COLOR_GRAY2BGR)
    for lon in range(-180, 181, 30):
        x = int((lon + 180) / 360 * 1024)
        cv2.line(bgr, (x, 0), (x, 511), (90, 90, 90), 1)
        cv2.putText(bgr, str(lon), (x + 2, 12), cv2.FONT_HERSHEY_SIMPLEX, 0.35, (0, 255, 255), 1)
    for lat in range(-60, 61, 30):
        y = int((90 - lat) / 180 * 512)
        cv2.line(bgr, (0, y), (1023, y), (90, 90, 90), 1)
    for name, (lon, lat) in marks.items():
        x, y = int((lon + 180) / 360 * 1024), int((90 - lat) / 180 * 512)
        cv2.circle(bgr, (x, y), 9, (0, 0, 255), 2)
        cv2.putText(bgr, name, (x + 11, y + 4), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 0, 255), 1)
    cv2.imwrite(path, bgr, [cv2.IMWRITE_JPEG_QUALITY, 88])

for key, cfg in BODIES.items():
    if ONLY and key not in ONLY: continue
    src = os.path.join(dl, key + ".tif")
    url = download(cfg["urls"], src)
    img, gt, p, proj4, nodata, info = read_mosaic(src)
    grid, geo = to_grid(img, gt, p)
    entry = {"source": url, "proj4": proj4, "bands": len(info["bands"]), "type": info["bands"][0].get("type"), "nodata": nodata, **geo}
    g0 = grid if grid.ndim == 2 else grid.max(-1)
    # Unimaged areas: the no-data value, or (without one) black.
    mask = g0 <= (float(nodata) if nodata is not None else 0)
    entry["unimaged_share"] = float(mask.mean())
    grid = fill_gaps(grid, mask)
    if grid.ndim == 2:
        gray = grid.astype(np.float32)
        if "color" in cfg:
            cpath = os.path.join(dl, key + "-color" + os.path.splitext(cfg["color"])[1])
            download([cfg["color"]], cpath)
            # Through GDAL: some colour maps are TIFFs OpenCV cannot read.
            run("gdal_translate", "-q", "-of", "PNG", "-ot", "Byte", "-b", "1", "-b", "2", "-b", "3", "-outsize", "2048", "0", cpath, cpath + ".png")
            c = cv2.imread(cpath + ".png", cv2.IMREAD_COLOR)[..., ::-1]
            if c.shape[1] != 2 * c.shape[0]:
                entry["color_size_note"] = f"colour map is {c.shape[1]}x{c.shape[0]}, not 2:1; resized"
            aligned, entry["color_alignment"] = align_color(c, gray)
            lab = cv2.cvtColor(aligned, cv2.COLOR_RGB2LAB).astype(np.float32)
            ab = cv2.GaussianBlur(lab[..., 1:], (0, 0), 3)
            # The mosaic's detail as lightness, scaled to the colour map's mean lightness.
            L = gray * (lab[..., 0].mean() / max(float(gray.mean()), 1e-6))
            merged = np.dstack([np.clip(L, 0, 255), ab]).astype(np.uint8)
            rgb = cv2.cvtColor(merged, cv2.COLOR_LAB2RGB).astype(np.float32)
        elif "haze" in cfg:
            n = (gray - gray.mean()) / (gray.std() + 1e-6)
            rgb = np.dstack([np.full_like(gray, c * 255) for c in cfg["haze"]]) * (1 + 0.07 * np.clip(n, -3, 3))[..., None]
        else:
            rgb = gray[..., None] * np.array(cfg.get("tint", (1, 1, 1)), np.float32)
    else:
        rgb = grid.astype(np.float32)
    rgb = np.clip(rgb, 0, 255).astype(np.uint8)
    cv2.imwrite(os.path.join(out, key + ".jpg"), rgb[..., ::-1], [cv2.IMWRITE_JPEG_QUALITY, 86, cv2.IMWRITE_JPEG_PROGRESSIVE, 1])
    preview(rgb, cfg["marks"], os.path.join(out, "preview-" + key + ".jpg"))
    entry["kb"] = round(os.path.getsize(os.path.join(out, key + ".jpg")) / 1024)
    report[key] = entry
    print(key, json.dumps(entry), flush=True)
    for f in (src, src + ".small.tif"):
        if os.path.exists(f): os.remove(f)

with open(os.path.join(out, "report.json"), "w") as fh: json.dump(report, fh, indent=1)
