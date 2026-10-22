"""Post for the TerraScope film: 2.39:1 letterbox, grade, HUD, lock-on boxes,
fades and the end card, then H.264 with the sound design.

Every number on screen comes from plan.json (the data snapshot) or the
capture records (camera, ISS and aircraft positions per frame).

usage: render.py --frames DIR --plan plan.json --out DIR [--audio sfx.wav] [--stills]
"""
from __future__ import annotations

import argparse
import glob
import json
import math
import subprocess
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[2]
W, H, PIC_H = 1920, 1080, 804
TOP = (H - PIC_H) // 2  # 138 px bars
FPS = 30
FONTS = ROOT / "video/audio/fonts"
INK = (207, 230, 255)        # HUD lines and text
AMBER = (255, 180, 84)       # lock-on

ap = argparse.ArgumentParser()
ap.add_argument("--frames", required=True)
ap.add_argument("--plan", required=True)
ap.add_argument("--out", required=True)
ap.add_argument("--audio")
ap.add_argument("--stills", action="store_true")
args = ap.parse_args()
out = Path(args.out)
out.mkdir(parents=True, exist_ok=True)
plan = json.loads(Path(args.plan).read_text(encoding="utf-8"))
R = plan["readings"]
timeline = json.loads(subprocess.run(["node", "--experimental-strip-types", str(ROOT / "video/cinematic/timeline.mjs")],
                                     check=True, capture_output=True, text=True, cwd=ROOT).stdout)
records = {}
for path in glob.glob(str(Path(args.frames) / "capture-*.json")):
    for entry in json.loads(Path(path).read_text(encoding="utf-8"))["frames"]:
        records[entry["frame"]] = entry


# ---------------------------------------------------------------- type

def font(name: str, size: int, weight: str) -> ImageFont.FreeTypeFont:
    f = ImageFont.truetype(str(FONTS / name), size)
    # Variable fonts default to their first master: Noto Sans SC's is Thin (100).
    f.set_variation_by_name(weight)
    return f

ZH_TITLE = font("NotoSansSC-variable.ttf", 112, "Medium")
ZH_SUB = font("NotoSansSC-variable.ttf", 40, "Medium")
ZH_SMALL = font("NotoSansSC-variable.ttf", 24, "Medium")
EN_LOGO = font("Inter-variable.ttf", 92, "SemiBold")
EN_LABEL = font("Inter-variable.ttf", 26, "Medium")
EN_SMALL = font("Inter-variable.ttf", 20, "Medium")
EN_TINY = font("Inter-variable.ttf", 16, "Medium")

try:
    ImageDraw.Draw(Image.new("L", (8, 8))).text((0, 0), "1", font=EN_LABEL, features=["tnum"])
    FEATURES = ["tnum"]  # steady digits in counters
except Exception:
    FEATURES = None


def text(d: ImageDraw.ImageDraw, xy, s: str, f, alpha: float, color=INK, tracking: float = 0, anchor="la", shadow=True):
    """Text with letter spacing and a soft dark edge, so it reads over the globe."""
    if alpha <= 0.01:
        return
    a = int(255 * min(1, alpha))
    x, y = xy
    width = sum(f.getlength(c) for c in s) + tracking * max(0, len(s) - 1)
    if anchor[0] == "m":
        x -= width / 2
    elif anchor[0] == "r":
        x -= width
    v = "a" if anchor[1] == "a" else "m"
    for c in s:
        kw = {"features": FEATURES} if FEATURES and c.isdigit() else {}
        if shadow:
            d.text((x, y), c, font=f, fill=(4, 10, 20, int(a * 0.7)), anchor="l" + v, stroke_width=3, stroke_fill=(4, 10, 20, int(a * 0.55)), **kw)
        d.text((x, y), c, font=f, fill=color + (a,), anchor="l" + v, **kw)
        x += f.getlength(c) + tracking


# ---------------------------------------------------------------- timing helpers

def window(t: float, start: float, end: float, fade_in=0.35, fade_out=0.35) -> float:
    if t < start or t > end:
        return 0.0
    return min(1.0, (t - start) / fade_in if fade_in else 1, (end - t) / fade_out if fade_out else 1)


def count(t: float, start: float, duration: float, value: int) -> int:
    k = min(1.0, max(0.0, (t - start) / duration))
    return round(value * (1 - (1 - k) ** 3))


fmt = lambda n: f"{n:,}"
virtual = lambda t: datetime.fromtimestamp((plan["T0"] + t * 1000) / 1000, tz=timezone.utc)


# ---------------------------------------------------------------- HUD pieces

def brackets(d, x, y, size, alpha, color=AMBER):
    a = int(255 * alpha)
    h, arm = size / 2, max(10, size * 0.22)
    for sx in (-1, 1):
        for sy in (-1, 1):
            cx, cy = x + sx * h, y + sy * h
            d.line([(cx, cy - sy * arm), (cx, cy), (cx - sx * arm, cy)], fill=color + (a,), width=3)


def lock(d, t, start, end, x, y, size, lines):
    """Lock-on: the box closes in on acquisition, then a leader line to the label."""
    alpha = window(t, start, end, 0.2, 0.3)
    if alpha <= 0 or not (0 <= x <= W and TOP <= y <= TOP + PIC_H):
        return
    k = min(1.0, (t - start) / 0.35)
    size = size * (2.6 - 1.6 * (1 - (1 - k) ** 3))
    brackets(d, x, y, size, alpha)
    lx, ly = x + size / 2 + 28, y - size / 2 - 28
    lx = min(lx, W - 520)
    ly = max(TOP + 40, ly)
    a = int(255 * alpha * min(1, max(0, (t - start - 0.25) / 0.25)))
    if a > 0:
        d.line([(x + size / 2, y - size / 2), (lx, ly + 18), (lx + 420, ly + 18)], fill=AMBER + (a,), width=2)
        for i, s in enumerate(lines):
            text(d, (lx + 6, ly - 10 - (len(lines) - 1 - i) * 30), s, EN_LABEL if i == 0 else EN_SMALL, a / 255, AMBER if i == 0 else INK, tracking=1.5)


def altimeter(d, t, height_m, alpha):
    """Scrolling log-scale ruler on the left of the picture."""
    if alpha <= 0:
        return
    a = int(255 * alpha)
    x, y0, y1 = 70, TOP + 110, TOP + PIC_H - 110
    mid = (y0 + y1) / 2
    d.line([(x, y0), (x, y1)], fill=INK + (int(a * 0.5),), width=2)
    v = math.log10(max(1.0, height_m)) * 10  # 0.1-decade units
    for k in range(math.floor(v) - 12, math.floor(v) + 13):
        y = mid + (v - k) * 26
        if y0 <= y <= y1:
            major = k % 10 == 0
            d.line([(x, y), (x + (22 if major else 11), y)], fill=INK + (int(a * (0.9 if major else 0.45)),), width=2)
    d.polygon([(x + 30, mid), (x + 42, mid - 7), (x + 42, mid + 7)], fill=INK + (a,))
    if height_m < 40_000e3:
        label = f"ALT {fmt(round(height_m / 1000))} km"
    else:
        label = f"R {(height_m + 6_371e3) / 6_371e3:.1f} R⊕"
    text(d, (x + 52, mid), label, EN_LABEL, alpha, tracking=1.5, anchor="lm")


def coords(lat, lon):
    return f"{abs(lat):.2f}°{'N' if lat >= 0 else 'S'}  {abs(lon):.2f}°{'E' if lon >= 0 else 'W'}"


def hud(t: float, rec: dict | None, fade: float) -> Image.Image:
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    cam = rec["camera"] if rec else None
    hud_on = lambda a, b, fi=0.35, fo=0.35: window(t, a, b, fi, fo) * fade

    # Top bar: the moment (typed in) and where the camera is over.
    stamp = virtual(t).strftime("%Y-%m-%d  %H:%M:%S") + " UTC"
    typed = stamp[: max(0, min(len(stamp), int((t - 3.0) / 1.0 * len(stamp))))]
    a = max(hud_on(3.0, 18.9, 0.01, 0.2), hud_on(19.4, 25.8, 0.3, 0.6))
    text(d, (72, TOP / 2), typed if t < 4.0 else stamp, EN_LABEL, a, tracking=2.5, anchor="lm")
    if cam:
        a = max(hud_on(4.0, 18.9, 0.5, 0.2), hud_on(21.9, 25.8, 0.4, 0.6))
        text(d, (W - 72, TOP / 2), coords(cam["lat"], cam["lon"]), EN_LABEL, a, tracking=2.5, anchor="rm")

    # Take A: the title.
    a = window(t, 5.0, 6.6, 0.6, 0.5) * fade
    text(d, (W / 2, TOP + PIC_H / 2 - 20), "此刻", ZH_TITLE, a, (244, 248, 252), tracking=36, anchor="mm")
    text(d, (W / 2, TOP + PIC_H / 2 + 72), "RIGHT NOW  ·  REAL DATA", EN_SMALL, a * 0.9, tracking=8, anchor="mm")

    # Altitude, through takes B and C.
    if cam:
        altimeter(d, t, cam["height"], max(hud_on(7.5, 18.9, 0.4, 0.2), hud_on(19.4, 25.8, 0.3, 0.6)))

    # Take B: aircraft over Europe, the locked flight.
    a = hud_on(7.8, 11.4, 0.3, 0.4)
    text(d, (72, TOP + PIC_H + 69), f"ADS-B  ·  {fmt(count(t, 8.0, 0.6, R['aircraft']))} AIRCRAFT", EN_LABEL, a, tracking=2.5, anchor="lm")
    f = rec.get("flight") if rec else None
    fl = plan["flight"]
    if f and f.get("visible") and f.get("altitude"):
        lines = [f"{fl['callsign']}  ·  {fl.get('type') or 'AIRCRAFT'}",
                 f"FL{round(f['altitude'] / 0.3048 / 100):03d}  ·  {round((f.get('speed') or 0) * 3.6)} km/h  ·  {round(f.get('track') or 0):03d}°"]
        lock(d, t, 8.8, 10.2, f["x"], f["y"] + TOP, 46, lines)

    # Take B: the ISS (real SGP4 position, approximate attitude).
    i = rec.get("iss") if rec else None
    if i and i.get("visible") and i.get("distance") and i.get("height") and i.get("speed"):
        fov = math.radians(cam["fov"]) if cam else math.radians(50)
        apparent = 109 / i["distance"] / fov * W
        lines = ["ISS  ·  INTERNATIONAL SPACE STATION",
                 f"{round(i['height'] / 1000)} km  ·  {i['speed'] / 1000:.2f} km/s  ·  SGP4 / CELESTRAK GP"]
        lock(d, t, 11.9, 14.4, i["x"], i["y"] + TOP, min(640, max(70, apparent * 1.15)), lines)
        text(d, (W - 72, TOP + PIC_H + 69), "MODEL  ·  ATTITUDE APPROX.", EN_TINY, hud_on(12.0, 14.6) * 0.8, tracking=3, anchor="rm")

    # Take B: Starlink.
    a = hud_on(15.9, 18.9, 0.3, 0.2)
    text(d, (72, TOP + PIC_H + 56), f"STARLINK  ·  {fmt(count(t, 16.0, 1.6, R['starlink']))}", EN_LABEL, a, tracking=2.5, anchor="lm")
    text(d, (72, TOP + PIC_H + 92), "OBJECTS IN ORBIT  ·  CELESTRAK GP ELEMENTS", EN_TINY, a * 0.8, tracking=3, anchor="lm")

    # Take C: solar wind and the magnetosphere (boundaries and particles are a model).
    sw = R["solarWind"]
    bz = "" if sw["bz"] is None else f"  ·  Bz {sw['bz']:+.1f} nT"
    a = hud_on(19.45, 21.0, 0.25, 0.3)
    text(d, (72, TOP + PIC_H + 56), f"SOLAR WIND  {sw['speed']} km/s  ·  n {sw['density']} cm⁻³{bz}", EN_LABEL, a, tracking=2, anchor="lm")
    text(d, (72, TOP + PIC_H + 92), f"MAGNETOPAUSE  r₀ {R['magnetopause']} R⊕  ·  NOAA SWPC + SHUE (1998)", EN_TINY, a * 0.85, tracking=3, anchor="lm")
    text(d, (W - 72, TOP + PIC_H + 69), "PARTICLES & BOUNDARIES ILLUSTRATIVE", EN_TINY, a * 0.8, tracking=3, anchor="rm")

    # Take C: the aurora forecast.
    a = hud_on(22.6, 25.8, 0.4, 0.6)
    kp = f"{R['kp']:.0f}" if R.get("kp") is not None else "—"
    text(d, (72, TOP + PIC_H + 69), f"AURORA FORECAST  ·  NOAA OVATION  ·  Kp {kp}", EN_LABEL, a, tracking=2.5, anchor="lm")

    # End card.
    a = window(t, 27.0, 30.5, 0.8, 0.01) * fade
    text(d, (W / 2, TOP + PIC_H / 2 - 30), "TERRASCOPE", EN_LOGO, a, (242, 247, 250), tracking=22, anchor="mm")
    text(d, (W / 2, TOP + PIC_H / 2 + 62), "此刻的地球", ZH_SUB, a * 0.95, (220, 232, 243), tracking=10, anchor="mm")
    a = window(t, 28.0, 30.5, 0.6, 0.01) * fade
    text(d, (W / 2, TOP + PIC_H + 52), "earth-atlas.edwardlab.workers.dev", EN_LABEL, a, tracking=2, anchor="mm")
    text(d, (W / 2, TOP + PIC_H + 92), "打开浏览器即可探索 · 无需安装", ZH_SMALL, a * 0.85, tracking=4, anchor="mm")
    recorded = datetime.fromtimestamp(plan["T0"] / 1000, tz=timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    text(d, (W / 2, TOP / 2), f"RECORDED {recorded}   ·   DATA  NASA GIBS · NOAA SWPC · CELESTRAK · ADS-B (ADSB.LOL, ODBL)   ·   ISS MODEL  NASA",
         EN_TINY, a * 0.75, tracking=2, anchor="mm")
    return layer


# ---------------------------------------------------------------- grade

yy, xx = np.mgrid[0:PIC_H, 0:W].astype(np.float32)
r = np.sqrt(((xx - W / 2) / (W / 2)) ** 2 + ((yy - PIC_H / 2) / (PIC_H / 2)) ** 2)
VIGNETTE = (1 - 0.32 * np.clip((r - 0.55) / 0.85, 0, 1) ** 1.6)[..., None]
rng = np.random.default_rng(7)
GRAIN = [rng.normal(0, 1, (PIC_H // 2, W // 2)).astype(np.float32) for _ in range(6)]
TINT_SHADOW = np.array([0.90, 0.98, 1.10], np.float32)


def grade(img: Image.Image, frame: int) -> np.ndarray:
    x = np.asarray(img, np.float32) / 255.0
    # Deep blacks and a gentle S-curve.
    x = np.clip((x - 0.025) / 0.975, 0, 1)
    x = 0.65 * x + 0.35 * x * x * (3 - 2 * x)
    # Cool shadows, neutral highlights.
    lum = x.mean(axis=2, keepdims=True)
    x = x * (TINT_SHADOW * (1 - lum) + lum)
    # Bloom: lights, the Sun, aurora and the limb glow softly.
    small = img.resize((W // 4, PIC_H // 4), Image.BILINEAR)
    s = np.asarray(small, np.float32) / 255.0
    bright = np.clip((s.max(axis=2, keepdims=True) - 0.62) / 0.38, 0, 1) * s
    glow = Image.fromarray((bright * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(7)).resize((W, PIC_H), Image.BILINEAR)
    x = 1 - (1 - x) * (1 - 0.55 * np.asarray(glow, np.float32) / 255.0)
    x *= VIGNETTE
    g = np.repeat(np.repeat(GRAIN[frame % len(GRAIN)], 2, axis=0), 2, axis=1)[..., None]
    x += g * 0.014
    return np.clip(x, 0, 1)


def compose(frame: int, tl: dict) -> Image.Image:
    rec = records.get(frame)
    canvas = np.zeros((H, W, 3), np.float32)
    if rec:
        img = Image.open(Path(args.frames) / rec["file"]).convert("RGB")
        pic = grade(img, frame)
        white = tl["white"]
        pic = pic * (1 - white) + white
        canvas[TOP:TOP + PIC_H] = pic
    canvas *= 1 - tl["black"]
    base = Image.fromarray((canvas * 255 + 0.5).astype(np.uint8))
    fade = (1 - tl["white"]) * (1 - tl["black"])
    over = hud(tl["t"], rec, fade)
    return Image.alpha_composite(base.convert("RGBA"), over).convert("RGB")


# ---------------------------------------------------------------- output

if args.stills:
    shots = sorted(records)
    for frame in shots:
        compose(frame, timeline[frame]).save(out / f"still-{frame:04d}.jpg", quality=92)
    print("stills", len(shots))
else:
    missing = [f for f in range(len(timeline)) if f not in records]
    assert not missing, f"{len(missing)} frames missing, e.g. {missing[:5]}"
    target = out / "terrascope-cinematic-30s.mp4"
    cmd = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
           "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-"]
    if args.audio:
        cmd += ["-i", args.audio, "-map", "0:v:0", "-map", "1:a:0",
                "-af", "loudnorm=I=-16:TP=-1.5:LRA=11", "-c:a", "aac", "-b:a", "256k", "-ar", "48000"]
    cmd += ["-vf", "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p",
            "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-tune", "film",
            "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709",
            "-movflags", "+faststart", "-t", "30", str(target)]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    for frame, tl in enumerate(timeline):
        proc.stdin.write(compose(frame, tl).tobytes())
        if frame % 90 == 0:
            print("encode", frame, "/", len(timeline), flush=True)
    proc.stdin.close()
    if proc.wait() != 0:
        raise SystemExit("ffmpeg failed")
    for frame in (60, 150, 270, 390, 420, 520, 600, 690, 840):
        compose(frame, timeline[frame]).save(out / f"review-{frame:04d}.jpg", quality=90)
    print("DELIVERED", target, target.stat().st_size)
