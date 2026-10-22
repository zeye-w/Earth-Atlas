"""Sound design for the TerraScope film (no music, no voice): ambience,
whooshes, impacts, HUD blips and counter ticks on the storyboard's cues, and
one sonification: the solar-wind tone's pitch follows the measured speed.

Everything is synthesised here (deterministic, no samples).
usage: sfx.py --plan plan.json --out sfx.wav
"""
from __future__ import annotations

import argparse
import json
import wave
from pathlib import Path

import numpy as np

SR = 48_000
DURATION = 30.0
ap = argparse.ArgumentParser()
ap.add_argument("--plan", required=True)
ap.add_argument("--out", required=True)
args = ap.parse_args()
plan = json.loads(Path(args.plan).read_text(encoding="utf-8"))

N = int(SR * DURATION)
t = np.arange(N) / SR
mix = np.zeros((N, 2))
rng = np.random.default_rng(20261022)


def add(sig, start=0.0, pan=0.0, gain=1.0):
    i = int(start * SR)
    sig = sig[: max(0, N - i)]
    mix[i:i + len(sig), 0] += sig * gain * np.sqrt((1 - pan) / 2)
    mix[i:i + len(sig), 1] += sig * gain * np.sqrt((1 + pan) / 2)


def env(n, attack, release, curve=2.0):
    """Attack/release envelope over n samples (seconds)."""
    x = np.arange(n) / SR
    a = np.clip(x / max(attack, 1e-3), 0, 1)
    r = np.clip((n / SR - x) / max(release, 1e-3), 0, 1)
    return (a * r) ** curve


def lowpass(x, cutoff):
    """One-pole low-pass; cutoff may vary per sample."""
    cutoff = np.broadcast_to(cutoff, x.shape)
    k = 1 - np.exp(-2 * np.pi * cutoff / SR)
    y = np.empty_like(x)
    acc = 0.0
    for i in range(len(x)):
        acc += k[i] * (x[i] - acc)
        y[i] = acc
    return y


def noise(seconds):
    return rng.normal(0, 1, int(seconds * SR))


def bandnoise(seconds, lo, hi):
    n = noise(seconds)
    return lowpass(n, hi) - lowpass(n, lo)


def sweep_sine(seconds, f0, f1, curve=1.0):
    x = np.arange(int(seconds * SR)) / SR
    f = f0 + (f1 - f0) * (x / seconds) ** curve
    return np.sin(2 * np.pi * np.cumsum(f) / SR)


def whoosh(seconds, lo, hi, peak=0.6):
    """Filtered noise whose band rises then falls, peaking at `peak` (0–1)."""
    n = int(seconds * SR)
    x = np.arange(n) / n
    shape = np.where(x < peak, x / peak, (1 - x) / (1 - peak))
    cutoff = lo + (hi - lo) * shape ** 1.5
    return lowpass(noise(seconds), cutoff) * shape ** 1.2


def impact(seconds=1.6, f0=70, f1=32, body=1.0, crack=0.5):
    sub = sweep_sine(seconds, f0, f1, 0.4) * env(int(seconds * SR), 0.004, seconds * 0.9, 1.5)
    burst = lowpass(noise(0.35), 900) * env(int(0.35 * SR), 0.002, 0.3, 2)
    out = sub * body
    out[: len(burst)] += burst * crack
    return out


def blip(f=1400, seconds=0.09, second=None):
    s = np.sin(2 * np.pi * f * np.arange(int(seconds * SR)) / SR) * env(int(seconds * SR), 0.003, 0.07, 1.5)
    if second:
        s2 = np.sin(2 * np.pi * second * np.arange(int(seconds * SR)) / SR) * env(int(seconds * SR), 0.003, 0.07, 1.5)
        s = np.concatenate([s, np.zeros(int(0.03 * SR)), s2])
    return s


def tick():
    return lowpass(noise(0.012), 6000) * env(int(0.012 * SR), 0.0005, 0.01, 1)


# ---------------------------------------------------------------- take A: 此刻 (0–7.2)

# Deep-space bed: dark filtered noise and a low hum, swelling in.
bed = lowpass(noise(7.4), 160) * 0.9 + np.sin(2 * np.pi * 41 * np.arange(int(7.4 * SR)) / SR) * 0.25
add(bed * env(len(bed), 1.6, 0.25, 1.3), 0.0, gain=0.35)
# The Sun clearing the limb: a slow bright shimmer.
shimmer = sum(np.sin(2 * np.pi * f * np.arange(int(3.2 * SR)) / SR + p) for f, p in [(2637, 0), (3951, 1.1), (5274, 2.3)])
add(shimmer * env(int(3.2 * SR), 0.7, 2.2, 1.4) / 3, 3.2, pan=-0.2, gain=0.05)
# The UTC stamp typing in.
for k in range(25):
    add(tick(), 3.0 + k * 0.04, pan=-0.6, gain=0.18)
# Riser into the cut.
add(sweep_sine(1.6, 120, 900, 2.2) * env(int(1.6 * SR), 1.2, 0.05, 1.6), 5.6, gain=0.08)
add(whoosh(1.7, 200, 6000, 0.97), 5.55, gain=0.35)

# ---------------------------------------------------------------- take B: 上升 (7.2–19.2)

add(impact(1.8, 75, 30, 1.0, 0.6), 7.2, gain=0.85)
air = bandnoise(11.8, 120, 900)
air_env = np.interp(np.arange(len(air)) / SR + 7.2, [7.2, 7.6, 10.6, 11.6, 12.4, 14.6, 15.4, 18.6, 18.95], [0, .5, .45, .9, .35, .35, .8, .55, 0])
add(air * air_env, 7.2, gain=0.42)
# A low orbital hum under the whole ascent, opening up as the view widens.
hum = lowpass(noise(11.8), 110) + 0.3 * np.sin(2 * np.pi * 49 * np.arange(int(11.8 * SR)) / SR)
add(hum * np.interp(np.arange(len(hum)) / SR + 7.2, [7.2, 8, 15, 16.5, 18.9, 18.95], [0, .5, .5, 1, 1, 0]), 7.2, gain=0.3)
for k in range(14):                                   # aircraft counter
    add(tick(), 8.0 + k * 0.042, pan=-0.5, gain=0.16)
add(blip(1250, 0.08, 1760), 8.8, pan=0.2, gain=0.22)  # flight lock
add(whoosh(1.4, 300, 5000, 0.75), 10.5, pan=-0.3, gain=0.5)   # dive onto the station
add(blip(1480, 0.08, 1980), 11.9, pan=0.2, gain=0.22) # station lock
pas = whoosh(1.8, 250, 7000, 0.45)                    # the pass: sweeps left to right
for side, pan in ((0.0, -0.7), (0.35, 0.7)):
    add(pas * (0.6 if side else 0.5), 12.5 + side, pan=pan, gain=0.6)
add(whoosh(2.0, 150, 4000, 0.6), 14.6, gain=0.45)     # pull away
for k in range(32):                                   # Starlink counter
    add(tick(), 16.0 + k * 0.05, pan=0.5, gain=0.14)
add(sweep_sine(1.2, 300, 1400, 2) * env(int(1.2 * SR), 0.9, 0.02, 1.5), 17.7, gain=0.05)

# ---------------------------------------------------------------- take C: 风暴 (19.2–30)

# Sonified solar wind: 250–800 km/s mapped onto 55–110 Hz, with harmonics and a slow pulse.
speed = plan["readings"]["solarWind"]["speed"]
f = 55 * 2 ** ((min(800, max(250, speed)) - 250) / 550)
x = np.arange(int(2.4 * SR)) / SR
tone = sum(np.sin(2 * np.pi * f * h * x) / h ** 1.3 for h in (1, 2, 3, 5))
tone *= (0.75 + 0.25 * np.sin(2 * np.pi * (speed / 400) * x)) * env(len(x), 0.08, 0.5, 1.2)
add(tone, 19.25, gain=0.22)
add(lowpass(noise(2.4), 90) * env(int(2.4 * SR), 0.1, 0.4, 1), 19.25, gain=0.5)
add(impact(1.0, 55, 28, 0.8, 0.2), 20.35, gain=0.55)  # through the bow shock
roar = lowpass(noise(0.75), np.linspace(300, 5000, int(0.75 * SR)))
add(roar * env(len(roar), 0.6, 0.06, 1.4), 20.9, gain=0.6)  # atmosphere entry
add(impact(2.4, 62, 26, 1.0, 0.8), 21.6, gain=1.0)
# Aurora: a wide, slowly beating airy pad (sound design, not a melody).
x = np.arange(int(5.0 * SR)) / SR
pad = sum(np.sin(2 * np.pi * fr * x + 0.4 * np.sin(2 * np.pi * 0.13 * x * (i + 1))) for i, fr in enumerate((220, 220.7, 329.6, 330.4, 440)))
add(pad * env(len(x), 1.2, 1.6, 1.2) / 5, 21.7, pan=-0.25, gain=0.16)
add(bandnoise(5.0, 2000, 7000) * env(int(5.0 * SR), 1.5, 2.0, 1.5), 21.8, pan=0.3, gain=0.12)
add(lowpass(noise(5.0), 140) * env(int(5.0 * SR), 0.8, 1.5, 1.2), 21.8, gain=0.3)
add(whoosh(2.2, 120, 2200, 0.5), 24.5, gain=0.3)      # rising away
# The end card: a soft swell and a low resolution.
add(np.sin(2 * np.pi * 73.4 * np.arange(int(3.4 * SR)) / SR) * env(int(3.4 * SR), 0.6, 1.8, 1.4), 26.4, gain=0.25)
add(shimmer[: int(2.6 * SR)] * env(int(2.6 * SR), 0.5, 1.8, 1.4) / 3, 27.0, pan=0.2, gain=0.05)

# Silence for the cut into the storm (18.95–19.2) and a clean tail.
gate = np.ones(N)
gate[int(18.95 * SR):int(19.2 * SR)] = 0
mix *= gate[:, None]
mix *= np.clip((DURATION - t) / 0.6, 0, 1)[:, None]
mix /= max(1e-9, np.max(np.abs(mix))) / 0.7

with wave.open(args.out, "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes((mix * 32767).astype("<i2").tobytes())
print("sfx", args.out, f"{DURATION}s", f"tone {f:.1f} Hz for {speed} km/s")
